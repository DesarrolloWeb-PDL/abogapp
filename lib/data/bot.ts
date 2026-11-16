/**
 * Local rule-based WhatsApp bot (Module A — M1 scope, no provider calls).
 *
 * Pure decision function shared by BOTH drivers:
 *  - the fake layer applies it to the in-memory conversation;
 *  - the Supabase webhook writer (lib/supabase/meta-webhook.ts) applies it
 *    to the rows it just stored.
 * Keeping one implementation guarantees the demo and the real inbox answer
 * identically.
 */

import type { WaConversationStatus } from "@/lib/types";

export interface BotDecision {
  /** Bot answer, or null when the bot must stay silent. */
  reply: string | null;
  /** Conversation status after the reply (STOP closes it). */
  nextStatus: WaConversationStatus;
}

/** WhatsApp opt-out keyword; once seen the conversation stops answering. */
const STOP_PATTERN = /^(stop|baja|cancelar)[.!]?$/i;

const GREETING_PATTERN =
  /\b(hola|buenas|buenos d[ií]as|buenas tardes|buenas noches|hey|qu[eé] tal)\b/i;

const GREETING_REPLY =
  "¡Hola! Soy el asistente del estudio. ¿En qué te puedo ayudar?";

const DEFAULT_REPLY =
  "Recibí tu mensaje. Alguien del estudio se va a comunicar con vos a la brevedad.";

/**
 * Rules (M1):
 *  - a conversation already stopped by STOP never replies again;
 *  - `STOP` / `baja` / `cancelar` closes the conversation silently;
 *  - greetings get the greeting, anything else gets an acknowledgement;
 *  - every other status keeps answering exactly as before.
 */
export function decideBotReply(
  currentStatus: WaConversationStatus,
  text: string,
): BotDecision {
  if (currentStatus === "cerrada") {
    return { reply: null, nextStatus: "cerrada" };
  }
  if (STOP_PATTERN.test(normalize(text))) {
    return { reply: null, nextStatus: "cerrada" };
  }
  const reply = GREETING_PATTERN.test(text) ? GREETING_REPLY : DEFAULT_REPLY;
  return { reply, nextStatus: currentStatus };
}

/** Lowercase the message — used for keyword matching only. */
export function normalize(text: string): string {
  return text.trim().toLowerCase();
}
