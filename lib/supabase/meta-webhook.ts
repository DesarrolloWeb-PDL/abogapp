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
 *  3. the shared bot rules (lib/data/bot.ts) decide the reply;
 *  4. reply stored as an outbound message; conversation preview/status
 *     updated; event marked processed;
 *  5. a failed handler DELETES the event row (mirrors releaseEventKey in
 *     the fake layer) so Meta's retry is still processed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { decideBotReply } from "@/lib/data/bot";
import { parseInboundMessages, type ParsedInbound } from "@/lib/data/webhook";
import type { WebhookProcessResult } from "@/lib/data/webhook";
import { getServiceClient } from "./service";

const UNIQUE_VIOLATION = "23505";
const PROVIDER = "whatsapp_cloud_api";
/** Meta's customer-service window: free-form replies only for 24 h. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function processInboundMeta(
  payload: unknown,
): Promise<WebhookProcessResult> {
  const supabase = getServiceClient();
  const messages = parseInboundMessages(payload);
  const result: WebhookProcessResult = { accepted: 0, duplicates: 0, replies: [] };

  for (const message of messages) {
    const claimed = await claimEvent(supabase, message.eventKey, payload);
    if (!claimed) {
      result.duplicates += 1;
      continue;
    }

    try {
      const reply = await storeInboundAndReply(supabase, message);
      await supabase
        .from("wa_webhook_events")
        .update({ processed_at: new Date().toISOString(), attempts: 1 })
        .eq("event_key", message.eventKey);
      result.accepted += 1;
      if (reply) result.replies.push(reply);
    } catch (error) {
      // Not stored → give the key back so Meta's retry reprocesses it.
      await supabase
        .from("wa_webhook_events")
        .delete()
        .eq("event_key", message.eventKey);
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
): Promise<boolean> {
  const { error } = await supabase.from("wa_webhook_events").insert({
    event_key: eventKey,
    provider: PROVIDER,
    event_type: "message",
    payload,
  });
  if (!error) return true;
  if (error.code === UNIQUE_VIOLATION) return false;
  throw new Error(`wa_webhook_events insert failed: ${error.message}`);
}

async function storeInboundAndReply(
  supabase: SupabaseClient,
  message: ParsedInbound,
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

  const decision = decideBotReply(conversation.status, message.text);
  const now = new Date().toISOString();
  const windowExpires = new Date(Date.now() + WINDOW_MS).toISOString();

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
    const { error: replyError } = await supabase.from("wa_messages").insert({
      study_id: study.id,
      conversation_id: conversation.id,
      direction: "out",
      provider: PROVIDER,
      message_type: "text",
      body: decision.reply,
      status: "sent",
    });
    if (replyError) {
      throw new Error(`wa_messages insert failed: ${replyError.message}`);
    }
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
