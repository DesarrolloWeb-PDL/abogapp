/**
 * Webhook plumbing for the Meta WhatsApp Cloud API (Module A — assumption).
 *
 * Kept out of the route handler so the deterministic parts — signature
 * verification, payload parsing and the idempotent inbound loop — are unit
 * testable without a Next.js request. The route stays a thin wrapper that
 * reads env vars and returns the right status code.
 *
 * Mirrors the production constraints in `replica/architecture.md`:
 *  - `X-Hub-Signature-256` is HMAC-SHA256 of the raw body with the app
 *    secret, compared in constant time;
 *  - `wa_webhook_events.event_key` is unique, so Meta's retries insert
 *    conflict into no-ops (here: `markEventProcessed` returns false), while
 *    a failed handler rolls the key back (`releaseEventKey`) so the retry
 *    is still processed;
 *  - the handler answers 200 fast and does the work inline for M1 — the
 *    async fan-out (Inngest) arrives with the real jobs.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { handleInboundMessage, markEventProcessed, releaseEventKey } from "./whatsapp";

/**
 * Constant-time check of Meta's `X-Hub-Signature-256` header
 * (`sha256=<hex hmac>` over the raw request body).
 */
export function verifyHubSignature(
  body: string,
  header: string | null,
  secret: string,
): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const received = header.slice("sha256=".length);
  const expected = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  if (received.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export interface ParsedInbound {
  /** Meta's message id — the `event_key` of `wa_webhook_events`. */
  eventKey: string;
  phone: string;
  text: string;
  contactName?: string;
}

/**
 * Meta sends the bare digits (`5491122334455`); `wa_contacts_phone_e164_check`
 * stores E.164 with a leading `+`. Normalizing at the parser keeps every
 * consumer (contact upsert, lookup, conversation) on the same value.
 */
export function toE164(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  return `+${digits}`;
}

/** Meta's webhook shape: entry[] → changes[] → value.messages[]. */
export function parseInboundMessages(payload: unknown): ParsedInbound[] {
  if (typeof payload !== "object" || payload === null) return [];
  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];

  const parsed: ParsedInbound[] = [];
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as { value?: unknown }).value;
      const messages = (value as { messages?: unknown } | undefined)?.messages;
      if (!Array.isArray(messages)) continue;
      for (const message of messages) {
        const record = message as Record<string, unknown>;
        if (record.type !== "text") continue; // M1 handles text only
        const text = (record.text as { body?: unknown } | undefined)?.body;
        const id = typeof record.id === "string" ? record.id : null;
        const from = typeof record.from === "string" ? record.from : null;
        if (!id || !from || typeof text !== "string" || !text.trim()) continue;
        const profile = record.profile as { name?: unknown } | undefined;
        parsed.push({
          eventKey: id,
          phone: toE164(from),
          text,
          contactName:
            typeof profile?.name === "string" ? profile.name : undefined,
        });
      }
    }
  }
  return parsed;
}

export interface WebhookProcessResult {
  /** Fresh events stored (and answered by the bot). */
  accepted: number;
  /** Retries dropped by the idempotency gate. */
  duplicates: number;
  /** Bot replies produced, in order. */
  replies: string[];
}

export interface ProcessInboundOptions {
  /**
   * Test seam: swap the inbound handler. A failing handler exercises the
   * key-release path — Meta's retry must still be processed.
   */
  handleInbound?: typeof handleInboundMessage;
}

/**
 * Store every fresh inbound message exactly once and collect the bot's
 * replies. Duplicate deliveries (Meta retries) are counted and dropped.
 *
 * When the handler fails the event key is released before the rejection
 * propagates, so the route answers with an error and Meta's retry of the
 * same delivery is processed instead of being dropped as a duplicate.
 */
export async function processInboundPayload(
  payload: unknown,
  options: ProcessInboundOptions = {},
): Promise<WebhookProcessResult> {
  const handle = options.handleInbound ?? handleInboundMessage;
  const result: WebhookProcessResult = { accepted: 0, duplicates: 0, replies: [] };

  for (const message of parseInboundMessages(payload)) {
    if (!markEventProcessed(message.eventKey)) {
      result.duplicates += 1;
      continue;
    }
    try {
      const outcome = await handle({
        phone: message.phone,
        contactName: message.contactName,
        text: message.text,
      });
      result.accepted += 1;
      if (outcome.botReply) result.replies.push(outcome.botReply);
    } catch (error) {
      releaseEventKey(message.eventKey);
      throw error;
    }
  }

  return result;
}
