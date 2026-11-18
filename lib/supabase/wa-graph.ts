/**
 * WhatsApp Business Cloud API — outbound text delivery (Module A, Unit 2).
 *
 * SERVER ONLY: imported from the webhook route path
 * (lib/supabase/meta-webhook.ts), never from a client component —
 * `WHATSAPP_ACCESS_TOKEN` is a secret and lives in the environment
 * (`.env.example` documents every variable name, with no values).
 *
 * Contract of this module:
 *
 *  - `sendWhatsAppText` NEVER throws. Every failure — missing config,
 *    timeout, network error, Graph rejection — comes back as
 *    `{ ok: false, reason }`, so the webhook pipeline can record the
 *    outcome on the `wa_messages` row and still answer Meta with a 200;
 *  - no token / no phone-number id → `{ ok: false, reason: "not_configured" }`
 *    with ONE log line per process: the app degrades to inbox-only mode
 *    (the reply is still stored locally), which is the state until the
 *    real credentials arrive;
 *  - Graph errors are mapped from the numeric `code`, following Meta's own
 *    guidance to build error handling on `code` + `details` rather than on
 *    titles (deprecated) or HTTP status codes.
 */

/** Meta Graph API endpoint root; only the version segment is configurable. */
const GRAPH_BASE_URL = "https://graph.facebook.com";
const DEFAULT_API_VERSION = "v21.0";
/** A stuck Graph request must not hold the webhook open. */
const SEND_TIMEOUT_MS = 10_000;
/** Meta's free-form customer-service window (flow 9 in whatsapp-bot.md). */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Why a send did not happen (or was rejected). Stable tokens: they are
 * stored in `wa_messages.error`, so the inbox chip copy is driven by them.
 */
export type WhatsAppSendReason =
  /** No token / phone-number id in the environment — inbox-only mode. */
  | "not_configured"
  /** Outside the 24 h window: only approved templates may be sent. */
  | "outside_window"
  /** Meta throttled us (HTTP 429 / rate-limit codes). */
  | "rate_limited"
  /** The recipient cannot receive: not on WhatsApp, same as sender, … */
  | "invalid_recipient"
  /** The request exceeded SEND_TIMEOUT_MS. */
  | "timeout"
  /** DNS/TLS/socket failure — never reached Meta. */
  | "network_error"
  /** Any other Graph rejection (bad token, server error, …). */
  | "api_error";

export type WhatsAppSendResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: WhatsAppSendReason; detail?: string };

export interface SendWhatsAppTextInput {
  /** Recipient: E.164 with `+` or the bare wa_id — normalised to digits. */
  to: string;
  type?: "text";
  text: string;
}

/** The injectable seam the webhook pipeline is tested through. */
export type WhatsAppSender = (
  input: SendWhatsAppTextInput,
) => Promise<WhatsAppSendResult>;

/** Exactly the JSON body POSTed to `/{version}/{id}/messages`. */
export interface WhatsAppTextRequest {
  messaging_product: "whatsapp";
  to: string;
  type: "text";
  text: { body: string };
}

interface GraphConfig {
  token: string;
  phoneNumberId: string;
  apiVersion: string;
}

interface GraphErrorBody {
  error?: {
    code?: number;
    message?: string;
    type?: string;
    error_data?: { details?: string };
  };
  messages?: Array<{ id?: string }>;
}

/**
 * Meta's error codes → our typed reasons (source: "WhatsApp error codes",
 * developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes).
 *
 *  - 131047 "More than 24 hours have passed since the recipient last
 *    replied" IS the customer-service-window rejection;
 *  - 131026 "Unable to deliver" is NOT a window error: the number is not
 *    on WhatsApp, the app is too old, or the terms were not accepted.
 *    (The unit brief listed 131026 as the window code — mapping it that
 *    way would show "Fuera de ventana" for a number that simply cannot
 *    receive WhatsApp messages, so the codes are mapped as Meta defines
 *    them and BOTH end in a typed failure the pipeline records.)
 */
const CODE_REASONS: Record<number, WhatsAppSendReason> = {
  131047: "outside_window",
  131026: "invalid_recipient",
  131021: "invalid_recipient", // sender and recipient are the same number
  130429: "rate_limited", // "Rate limit hit"
  131056: "rate_limited", // too many messages to the same recipient
};

let missingConfigLogged = false;

/**
 * Meta's error code → our typed reason; unknown codes become `api_error`
 * (Meta's codes are an open set, so the fallback must stay total).
 */
export function mapGraphErrorCode(code: number): WhatsAppSendReason {
  return CODE_REASONS[code] ?? "api_error";
}

/** Reads the env config; logs the inbox-only fallback exactly once. */
function readConfig(): GraphConfig | null {
  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneNumberId) {
    if (!missingConfigLogged) {
      missingConfigLogged = true;
      console.warn(
        "[wa-graph] WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID are not " +
          "set: outbound WhatsApp sends are skipped and recorded as " +
          "not_configured (inbox-only mode). See .env.example.",
      );
    }
    return null;
  }
  return {
    token,
    phoneNumberId,
    apiVersion: process.env.WHATSAPP_API_VERSION?.trim() || DEFAULT_API_VERSION,
  };
}

/**
 * Meta's `to` is the wa_id: bare digits, never the `+` of E.164 (the
 * webhook stores E.164 because of the `wa_contacts_phone_e164_check`).
 */
export function toWaId(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** The request body — shared with the row the pipeline stores, so the
 *  recorded payload and the bytes on the wire can never drift apart. */
export function buildTextMessageRequest(
  to: string,
  text: string,
): WhatsAppTextRequest {
  return {
    messaging_product: "whatsapp",
    to: toWaId(to),
    type: "text",
    text: { body: text },
  };
}

function mapGraphFailure(
  status: number,
  body: GraphErrorBody | null,
): WhatsAppSendResult {
  const code = body?.error?.code;
  const detail =
    body?.error?.error_data?.details ?? body?.error?.message ?? undefined;
  if (typeof code === "number" && code in CODE_REASONS) {
    return { ok: false, reason: mapGraphErrorCode(code), detail };
  }
  if (status === 429) return { ok: false, reason: "rate_limited", detail };
  return { ok: false, reason: "api_error", detail: detail ?? `HTTP ${status}` };
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * POST one text message to the Cloud API.
 *
 * Resolves to a typed result for every outcome; it never throws, so the
 * webhook pipeline can always finish and acknowledge the delivery.
 */
export async function sendWhatsAppText(
  input: SendWhatsAppTextInput,
): Promise<WhatsAppSendResult> {
  const config = readConfig();
  if (!config) return { ok: false, reason: "not_configured" };

  const to = toWaId(input.to);
  if (!to) {
    return { ok: false, reason: "invalid_recipient", detail: "empty recipient" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${GRAPH_BASE_URL}/${config.apiVersion}/${config.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(buildTextMessageRequest(to, input.text)),
        signal: controller.signal,
      },
    );
    const body = (await response.json().catch(() => null)) as
      | GraphErrorBody
      | null;
    if (!response.ok) return mapGraphFailure(response.status, body);

    const messageId = body?.messages?.[0]?.id;
    if (!messageId) {
      return {
        ok: false,
        reason: "api_error",
        detail: "Graph response carried no message id",
      };
    }
    return { ok: true, messageId };
  } catch (error) {
    if (isAbort(error)) return { ok: false, reason: "timeout" };
    return {
      ok: false,
      reason: "network_error",
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}
