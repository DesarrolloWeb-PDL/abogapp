/**
 * WhatsApp intake functions — FAKE driver (Module A — assumption, no
 * reference screen).
 *
 * `handleInboundMessage` is what POST /api/webhooks/whatsapp calls after
 * Meta delivers an inbound event when the data driver is `fake`: it stores
 * the client's message, runs the shared rule-based bot (`./bot`) and returns
 * the reply. M1 rules: greeting + STOP are enough; no Meta calls at all.
 *
 * The `supabase` driver keeps the same behaviour with real rows — see
 * lib/supabase/meta-webhook.ts (service-role writes, RLS-scoped reads).
 */

import type { WaConversation, WaMessage } from "@/lib/types";
import { decideBotReply } from "./bot";
import { getMyStudy } from "./studies";
import { getStore, isoNow, nextId } from "./store";

export interface InboundMessageInput {
  phone: string;
  contactName?: string;
  text: string;
}

export interface InboundMessageResult {
  conversation: WaConversation;
  /** The bot's reply, or null when the bot must stay silent (STOP). */
  botReply: string | null;
}

/**
 * Conversations of the current study, most recent activity first.
 * FAKE driver only: the conversations route serves the Supabase driver from
 * lib/supabase/inbox.ts (RLS-scoped query). No tenancy filter in the fake
 * layer (ids carry no cross-study risk in the demo).
 */
export async function listConversations(): Promise<WaConversation[]> {
  return [...getStore().waConversations].sort((a, b) =>
    b.lastMessageAt.localeCompare(a.lastMessageAt),
  );
}

/** Messages of one conversation, oldest first. */
export async function listMessages(conversationId: string): Promise<WaMessage[]> {
  return getStore()
    .waMessages.filter((entry) => entry.conversationId === conversationId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Idempotency gate for Meta deliveries — the fake `wa_webhook_events`
 * unique index on `event_key`. Returns true the first time a key is seen
 * and false for every retry, so a duplicate webhook becomes a no-op.
 */
export function markEventProcessed(eventKey: string): boolean {
  const store = getStore();
  if (store.waWebhookEvents.has(eventKey)) return false;
  store.waWebhookEvents.add(eventKey);
  return true;
}

/**
 * Give an event key back after `handleInboundMessage` failed: the delivery
 * was not stored, so the gate must not swallow Meta's retry as a duplicate.
 * Counterpart of `markEventProcessed`, mirroring a rolled-back insert of
 * `wa_webhook_events`.
 */
export function releaseEventKey(eventKey: string): void {
  getStore().waWebhookEvents.delete(eventKey);
}

/**
 * Store an inbound client message and produce the local bot reply.
 *
 * The bot rules live in `./bot` — one implementation for every driver.
 */
export async function handleInboundMessage(
  input: InboundMessageInput,
): Promise<InboundMessageResult> {
  const store = getStore();
  const phone = input.phone.trim();
  const text = input.text.trim();
  if (!phone || !text) throw new Error("inbound message requires phone and text");

  const study = await getMyStudy();
  const conversation = upsertConversation(
    store,
    phone,
    input.contactName,
    study?.id ?? store.studies[0]?.id ?? "study-1",
  );

  pushMessage(conversation, "inbound", text);
  conversation.unread += 1;

  const decision = decideBotReply(conversation.status, text);
  if (decision.nextStatus !== conversation.status) {
    conversation.status = decision.nextStatus;
  }
  if (decision.reply) pushMessage(conversation, "outbound", decision.reply);

  return { conversation, botReply: decision.reply };
}

function upsertConversation(
  store: ReturnType<typeof getStore>,
  phone: string,
  contactName: string | undefined,
  studyId: string,
): WaConversation {
  const existing = store.waConversations.find((entry) => entry.phone === phone);
  if (existing) return existing;

  const conversation: WaConversation = {
    id: nextId("wa-conv"),
    studyId,
    phone,
    contactName: contactName?.trim() || "Contacto nuevo",
    status: "bot",
    unread: 0,
    lastSnippet: "",
    lastMessageAt: isoNow(),
  };
  store.waConversations.push(conversation);
  return conversation;
}

function pushMessage(
  conversation: WaConversation,
  direction: WaMessage["direction"],
  body: string,
): void {
  const message: WaMessage = {
    id: nextId("wa-msg"),
    conversationId: conversation.id,
    direction,
    body,
    createdAt: isoNow(),
  };
  getStore().waMessages.push(message);
  conversation.lastSnippet = body;
  conversation.lastMessageAt = message.createdAt;
}
