/**
 * WhatsApp webhook processing for the `supabase` driver (Module A).
 *
 * Server-only: imported by app/api/webhooks/whatsapp/route.ts, never by a
 * client component. All writes run on the SERVICE-ROLE client (Meta delivers
 * with no user session — there is no auth.uid() to satisfy RLS):
 *
 *  1. idempotency: every Meta delivery inserts into `wa_webhook_events`
 *     (event_key unique) — a retry hits 23505 and becomes a counted no-op;
 *  2. contact + conversation upsert, inbound message stored;
 *  3. the shared bot rules (lib/data/bot.ts), fed by the study's
 *     bot_settings row (Unit 1: configurable greeting/toggle), decide the
 *     reply via resolveBotReply (lib/data/bot-llm.ts, Unit 3: an
 *     env-gated LLM fallback answers ONLY the unknown-intent case when
 *     AI_API_KEY is set — rules always run first);
 *  4. reply stored as an outbound message, then delivered through the Graph
 *     API when credentials exist and the 24 h window is open (Unit 2 — the
 *     outcome is written back as `wa_messages.status` / `.error`, and a
 *     delivery failure never fails the webhook);
 *  5. Meta's `statuses` deliveries (sent/delivered/read/failed) update the
 *     outbound row they name, idempotently;
 *  6. a failed handler DELETES the event row (mirrors releaseEventKey in
 *     the fake layer) so Meta's retry is still processed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotSettings } from "@/lib/data/bot";
import { resolveBotReply } from "@/lib/data/bot-llm";
import {
  parseInboundMessages,
  parseStatusUpdates,
  type ParsedInbound,
  type ParsedStatusUpdate,
} from "@/lib/data/webhook";
import type { WebhookProcessResult } from "@/lib/data/webhook";
import { getServiceClient } from "./service";
import { getBotSettingsSupabase } from "./bot-settings";
import {
  WINDOW_MS,
  buildTextMessageRequest,
  mapGraphErrorCode,
  sendWhatsAppText,
  type WhatsAppSendReason,
  type WhatsAppSendResult,
  type WhatsAppSender,
} from "./wa-graph";

const UNIQUE_VIOLATION = "23505";
const PROVIDER = "whatsapp_cloud_api";

export interface ProcessMetaOptions {
  /**
   * Test seam: swap the Graph sender — the unit suite never touches the
   * network, exactly like `ProcessInboundOptions.handleInbound`.
   */
  sender?: WhatsAppSender;
  /** Test seam: swap the service-role client (mocked Supabase in tests). */
  supabase?: SupabaseClient;
}

export async function processInboundMeta(
  payload: unknown,
  options: ProcessMetaOptions = {},
): Promise<WebhookProcessResult> {
  const supabase = options.supabase ?? getServiceClient();
  const messages = parseInboundMessages(payload);
  const result: WebhookProcessResult = { accepted: 0, duplicates: 0, replies: [] };

  for (const message of messages) {
    const claimed = await claimEvent(supabase, message.eventKey, payload);
    if (!claimed) {
      result.duplicates += 1;
      continue;
    }

    try {
      const reply = await storeInboundAndReply(supabase, message, options);
      await markEventProcessed(supabase, message.eventKey);
      result.accepted += 1;
      if (reply) result.replies.push(reply);
    } catch (error) {
      // Not stored → give the key back so Meta's retry reprocesses it.
      await releaseEventKey(supabase, message.eventKey);
      throw error;
    }
  }

  return result;
}

/** Insert-once gate over wa_webhook_events.event_key. */
async function claimEvent(
  supabase: SupabaseClient,
  eventKey: string,
  payload: unknown,
  eventType: "message" | "status" = "message",
): Promise<boolean> {
  const { error } = await supabase.from("wa_webhook_events").insert({
    event_key: eventKey,
    provider: PROVIDER,
    event_type: eventType,
    payload,
  });
  if (!error) return true;
  if (error.code === UNIQUE_VIOLATION) return false;
  throw new Error(`wa_webhook_events insert failed: ${error.message}`);
}

/** Marks the claimed event processed (Meta stops retrying it). */
async function markEventProcessed(
  supabase: SupabaseClient,
  eventKey: string,
): Promise<void> {
  await supabase
    .from("wa_webhook_events")
    .update({ processed_at: new Date().toISOString(), attempts: 1 })
    .eq("event_key", eventKey);
}

/** Gives the key back so a failed handler's Meta retry is processed. */
async function releaseEventKey(
  supabase: SupabaseClient,
  eventKey: string,
): Promise<void> {
  await supabase.from("wa_webhook_events").delete().eq("event_key", eventKey);
}

async function storeInboundAndReply(
  supabase: SupabaseClient,
  message: ParsedInbound,
  options: ProcessMetaOptions,
): Promise<string | null> {
  // M1 routing: inbound messages land in the oldest study (single-tenant
  // demo). TODO(M3): route phone → study per number once Module A ships.
  const { data: study, error: studyError } = await supabase
    .from("studies")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (studyError) {
    throw new Error(`studies lookup failed: ${studyError.message}`);
  }
  if (!study) return null; // no tenant yet: nothing to attach (still a 200)

  const contact = await upsertContact(supabase, study.id, message);
  const conversation = await upsertConversation(
    supabase,
    study.id,
    contact.id,
  );

  await supabase.from("wa_messages").insert({
    study_id: study.id,
    conversation_id: conversation.id,
    direction: "in",
    provider: PROVIDER,
    provider_message_id: message.eventKey,
    message_type: "text",
    body: message.text,
    status: "received",
  });

  // Unit 1: the study's bot_settings row drives the reply copy — ONE read
  // per inbound message (never per field: no N+1). A failed read must never
  // stop the bot answering, so it falls back to null and the rules use the
  // built-in defaults (identical to the pre-settings behaviour).
  let settings: BotSettings | null = null;
  try {
    settings = await getBotSettingsSupabase(study.id, supabase);
  } catch {
    settings = null;
  }

  // Units 1+3: rules decide first (STOP / greeting / configured copies);
  // ONLY the unknown-intent case may reach the LLM fallback, and only when
  // AI_API_KEY is set (env-gated). The context read for the model rides on
  // THIS service client and a failure there never stops the reply.
  const decision = await resolveBotReply(
    conversation.status,
    message.text,
    settings,
    { studyId: study.id, supabase },
  );
  const now = new Date().toISOString();
  const windowExpires = new Date(Date.now() + WINDOW_MS).toISOString();

  // The stamp Meta's 24 h window counts from: EVERY inbound delivery
  // refreshes it, so the bot's reply below is inside the window by
  // construction (the gate in deliverOutbound exists for human/late
  // replies, which are the ones that can arrive after it expires).
  const patch: Record<string, unknown> = {
    last_inbound_at: now,
    window_expires_at: windowExpires,
    unread_from_client: conversation.unread + 1,
    last_message_preview: decision.reply ?? message.text,
    status: decision.nextStatus,
  };

  const { error: updateError } = await supabase
    .from("wa_conversations")
    .update(patch)
    .eq("id", conversation.id);
  if (updateError) {
    throw new Error(`wa_conversations update failed: ${updateError.message}`);
  }

  if (decision.reply) {
    const { data: created, error: replyError } = await supabase
      .from("wa_messages")
      .insert({
        study_id: study.id,
        conversation_id: conversation.id,
        direction: "out",
        provider: PROVIDER,
        message_type: "text",
        body: decision.reply,
        // The exact Graph body deliverOutbound is about to POST, recorded
        // BEFORE the attempt: a crash mid-send still leaves an audit trail
        // of what we tried to deliver.
        payload: buildTextMessageRequest(message.phone, decision.reply),
        // No 'pending' value exists in the status check constraint, and a
        // row Meta has not confirmed must not claim 'sent' — deliverOutbound
        // overwrites this within the same request.
        status: "failed",
      })
      .select("id")
      .single();
    if (replyError || !created) {
      throw new Error(
        `wa_messages insert failed: ${replyError?.message ?? "no row returned"}`,
      );
    }

    // Delivery is best effort: the row above already stores the reply, so a
    // Graph failure only downgrades its status — never the webhook.
    await deliverOutbound(
      { id: created.id as string, to: message.phone, body: decision.reply },
      { last_inbound_at: now, window_expires_at: windowExpires },
      { sender: options.sender, supabase },
    );
  }

  return decision.reply;
}

async function upsertContact(
  supabase: SupabaseClient,
  studyId: string,
  message: ParsedInbound,
): Promise<{ id: string }> {
  const { data: existing, error: findError } = await supabase
    .from("wa_contacts")
    .select("id")
    .eq("study_id", studyId)
    .eq("phone_e164", message.phone)
    .maybeSingle();
  if (findError) {
    throw new Error(`wa_contacts lookup failed: ${findError.message}`);
  }
  if (existing) return existing as { id: string };

  const { data: created, error: insertError } = await supabase
    .from("wa_contacts")
    .insert({
      study_id: studyId,
      phone_e164: message.phone,
      display_name: message.contactName ?? "",
    })
    .select("id")
    .single();
  if (insertError || !created) {
    throw new Error(
      `wa_contacts insert failed: ${insertError?.message ?? "no row returned"}`,
    );
  }
  return created as { id: string };
}

async function upsertConversation(
  supabase: SupabaseClient,
  studyId: string,
  contactId: string,
): Promise<{ id: string; status: "bot" | "humano" | "cerrada"; unread: number }> {
  const { data: existing, error: findError } = await supabase
    .from("wa_conversations")
    .select("id, status, unread_from_client")
    .eq("study_id", studyId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (findError) {
    throw new Error(`wa_conversations lookup failed: ${findError.message}`);
  }
  if (existing) {
    return {
      id: existing.id as string,
      status: existing.status as "bot" | "humano" | "cerrada",
      unread: existing.unread_from_client as number,
    };
  }

  const { data: created, error: insertError } = await supabase
    .from("wa_conversations")
    .insert({
      study_id: studyId,
      contact_id: contactId,
      status: "bot",
      unread_from_client: 0,
    })
    .select("id, status, unread_from_client")
    .single();
  if (insertError || !created) {
    throw new Error(
      `wa_conversations insert failed: ${insertError?.message ?? "no row returned"}`,
    );
  }
  return {
    id: created.id as string,
    status: created.status as "bot" | "humano" | "cerrada",
    unread: created.unread_from_client as number,
  };
}

/* ------------------------------------------------------------- window ---- */

/** The window columns a delivery decision needs (nothing else is read). */
export interface WindowConversation {
  last_inbound_at?: string | null;
  window_expires_at?: string | null;
}

/**
 * True while Meta still accepts free-form messages for this conversation
 * (flow 9, whatsapp-bot.md). `now - last_inbound_at <= 24 h` is the rule;
 * `window_expires_at` (the same instant, written alongside it) covers rows
 * that only carry it. A conversation that never received a message has no
 * window → false.
 */
export function withinWindow(
  conversation: WindowConversation,
  now: Date = new Date(),
): boolean {
  const nowMs = now.getTime();
  const lastInbound = conversation.last_inbound_at
    ? Date.parse(conversation.last_inbound_at)
    : Number.NaN;
  if (Number.isFinite(lastInbound)) return nowMs - lastInbound <= WINDOW_MS;

  const expires = conversation.window_expires_at
    ? Date.parse(conversation.window_expires_at)
    : Number.NaN;
  return Number.isFinite(expires) && nowMs <= expires;
}

/* ----------------------------------------------------------- delivery ---- */

/** One stored outbound row, ready to be delivered. */
export interface OutboundMessage {
  /** Local `wa_messages.id` — the row the outcome is written back to. */
  id: string;
  /** Recipient: E.164 with `+` or the bare wa_id (the sender normalises). */
  to: string;
  body: string;
}

export interface DeliverOutboundOptions {
  /** Test seam: swap the Graph sender. */
  sender?: WhatsAppSender;
  /** Test seam: swap the service-role client. */
  supabase?: SupabaseClient;
}

export type DeliveryOutcome =
  | { sent: true; messageId: string }
  | { sent: false; reason: WhatsAppSendReason };

/**
 * Writes the delivery outcome back onto the row. Never throws: losing the
 * status write must not fail the webhook that is carrying the message.
 */
async function recordOutcome(
  supabase: SupabaseClient,
  messageId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  try {
    const { error } = await supabase
      .from("wa_messages")
      .update(patch)
      .eq("id", messageId);
    if (error) throw new Error(error.message);
  } catch (error) {
    console.error("[wa-graph] could not record the delivery outcome:", error);
  }
}

/**
 * Deliver one stored outbound row through the Graph API and record the
 * outcome on it (`status` + `provider_message_id` on ack, `status` +
 * `error` reason otherwise).
 *
 * NEVER throws: a delivery failure is data, not a reason to fail the
 * webhook — Meta would simply retry a 500 forever without ever seeing the
 * message. The 24 h gate lives HERE and only here: the bot's own reply is
 * inside the window by construction (the inbound stamp above it), so this
 * gate is what protects human/late replies from Meta's 131047 rejection.
 */
export async function deliverOutbound(
  message: OutboundMessage,
  conversation: WindowConversation,
  options: DeliverOutboundOptions = {},
): Promise<DeliveryOutcome> {
  try {
    const sender = options.sender ?? sendWhatsAppText;
    const supabase = options.supabase ?? getServiceClient();

    if (!withinWindow(conversation)) {
      // No Graph call at all: Meta would answer 131047 anyway.
      console.warn(
        `[wa-graph] delivery of ${message.id} skipped: outside the 24 h window`,
      );
      await recordOutcome(supabase, message.id, {
        status: "failed",
        error: "outside_window",
      });
      return { sent: false, reason: "outside_window" };
    }

    let result: WhatsAppSendResult;
    try {
      result = await sender({
        to: message.to,
        type: "text",
        text: message.body,
      });
    } catch (error) {
      // The sender contract forbids this; belt and braces for a bad swap.
      console.error("[wa-graph] sender threw:", error);
      result = { ok: false, reason: "api_error" };
    }

    if (result.ok) {
      await recordOutcome(supabase, message.id, {
        status: "sent",
        provider_message_id: result.messageId,
        error: null,
      });
      return { sent: true, messageId: result.messageId };
    }

    if (result.detail) {
      console.warn(
        `[wa-graph] send not delivered (${result.reason}): ${result.detail}`,
      );
    }
    await recordOutcome(supabase, message.id, {
      status: "failed",
      error: result.reason,
    });
    return { sent: false, reason: result.reason };
  } catch (error) {
    // Missing service client, broken seam… the webhook still has to live.
    console.error("[wa-graph] outbound delivery failed:", error);
    return { sent: false, reason: "api_error" };
  }
}

/* ------------------------------------------------ statuses (Meta acks) ---- */

export interface StatusProcessResult {
  /** Status records applied to a `wa_messages` row. */
  applied: number;
  /** Status records dropped by the idempotency gate (Meta retries). */
  duplicates: number;
}

/**
 * Applies Meta's `statuses` deliveries (sent / delivered / read / failed)
 * to the outbound rows they name, matching on
 * `wa_messages.provider_message_id` (the id the Graph ack stored).
 *
 * Idempotent exactly like the inbound path: the event key
 * `${messageId}:${status}` is claimed first, a retry becomes a counted
 * no-op, and a failed write releases the key so Meta's retry is processed.
 * A payload without statuses answers `{0,0}` before touching the client.
 */
export async function processStatusUpdatesMeta(
  payload: unknown,
  options: ProcessMetaOptions = {},
): Promise<StatusProcessResult> {
  const updates = parseStatusUpdates(payload);
  const result: StatusProcessResult = { applied: 0, duplicates: 0 };
  if (updates.length === 0) return result;

  const supabase = options.supabase ?? getServiceClient();
  for (const update of updates) {
    const claimed = await claimEvent(supabase, update.eventKey, payload, "status");
    if (!claimed) {
      result.duplicates += 1;
      continue;
    }

    try {
      await applyStatusUpdate(supabase, update);
      await markEventProcessed(supabase, update.eventKey);
      result.applied += 1;
    } catch (error) {
      await releaseEventKey(supabase, update.eventKey);
      throw error;
    }
  }
  return result;
}

async function applyStatusUpdate(
  supabase: SupabaseClient,
  update: ParsedStatusUpdate,
): Promise<void> {
  const patch: Record<string, unknown> = { status: update.status };
  if (update.status === "failed") {
    // One vocabulary for `wa_messages.error`: the same typed reason tokens
    // the send path stores, so the inbox chip has a single mapping table.
    patch.error =
      update.errorCode === undefined
        ? "api_error"
        : mapGraphErrorCode(update.errorCode);
    const detail = update.errorDetail ? ` ${update.errorDetail}` : "";
    console.warn(
      `[wa-graph] Meta reported a failed send (${update.messageId}): ` +
        `code ${update.errorCode ?? "n/a"}${detail}`,
    );
  }

  const { error } = await supabase
    .from("wa_messages")
    .update(patch)
    .eq("provider", PROVIDER)
    .eq("direction", "out")
    .eq("provider_message_id", update.messageId);
  if (error) {
    throw new Error(`wa_messages status update failed: ${error.message}`);
  }
}
