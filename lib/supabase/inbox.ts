/**
 * WhatsApp inbox reads for the `supabase` driver — called from the
 * conversations route handler (server) with the request-scoped client, so
 * every query runs under the caller's RLS membership (is_member(study_id)
 * on wa_conversations / wa_contacts).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  WaConversation,
  WaConversationStatus,
  WaMessage,
} from "@/lib/types";

interface ConversationRow {
  id: string;
  study_id: string;
  status: string;
  unread_from_client: number;
  last_message_preview: string;
  updated_at: string;
  wa_contacts: { phone_e164: string; display_name: string } | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  direction: string;
  body: string;
  created_at: string;
}

const CONVERSATION_STATUSES: WaConversationStatus[] = ["bot", "humano", "cerrada"];

export async function listConversationsSupabase(
  supabase: SupabaseClient,
): Promise<WaConversation[]> {
  const { data, error } = await supabase
    .from("wa_conversations")
    .select(
      "id, study_id, status, unread_from_client, last_message_preview, updated_at, wa_contacts(phone_e164, display_name)",
    )
    .order("updated_at", { ascending: false });
  if (error) {
    throw new Error(`wa_conversations query failed: ${error.message}`);
  }

  return ((data ?? []) as unknown as ConversationRow[]).map((row) => ({
    id: row.id,
    studyId: row.study_id,
    phone: row.wa_contacts?.phone_e164 ?? "",
    contactName: row.wa_contacts?.display_name || "Contacto nuevo",
    status: CONVERSATION_STATUSES.includes(row.status as WaConversationStatus)
      ? (row.status as WaConversationStatus)
      : "bot",
    unread: row.unread_from_client,
    lastSnippet: row.last_message_preview,
    lastMessageAt: row.updated_at,
  }));
}

export async function listMessagesSupabase(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<WaMessage[]> {
  const { data, error } = await supabase
    .from("wa_messages")
    .select("id, conversation_id, direction, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`wa_messages query failed: ${error.message}`);
  }

  return ((data ?? []) as unknown as MessageRow[]).map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction === "out" ? "outbound" : "inbound",
    body: row.body,
    createdAt: row.created_at,
  }));
}
