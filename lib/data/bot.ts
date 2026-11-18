/**
 * Local rule-based WhatsApp bot (Module A — M1 scope, no provider calls).
 *
 * Pure decision function shared by BOTH drivers:
 *  - the fake layer applies it to the in-memory conversation;
 *  - the Supabase webhook writer (lib/supabase/meta-webhook.ts) applies it
 *    to the rows it just stored.
 * Keeping one implementation guarantees the demo and the real inbox answer
 * identically.
 *
 * Rules stay in code (STOP, status gating, the greeting trigger); the
 * message STRINGS the study can edit live in the `bot_settings` row (admin
 * screen /configuracion/bot) and reach this function through `settings`.
 * Callers that have not loaded settings (or that failed to) pass nothing and
 * get exactly the behaviour they had before the settings existed.
 *
 * Unit 3: `resolveBotReply` (lib/data/bot-llm.ts) wraps this function and
 * adds the env-gated LLM fallback for the ONE case this engine does not
 * decide with a rule — the unknown intent (DEFAULT_REPLY). This module stays
 * synchronous and pure: every rule still lives here.
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

/** The built-in greeting — also the `greeting` default of bot_settings. */
export const GREETING_REPLY =
  "¡Hola! Soy el asistente del estudio. ¿En qué te puedo ayudar?";

/** Acknowledgement for anything that is not a greeting (no settings home:
 *  bot_settings holds the three editable strings, this one stays fixed).
 *  Exported because it is the SENTINEL for "no rule matched": the LLM
 *  fallback (lib/data/bot-llm.ts) only ever considers a reply equal to this
 *  constant — every other outcome is an explicit rule and bypasses the model. */
export const DEFAULT_REPLY =
  "Recibí tu mensaje. Alguien del estudio se va a comunicar con vos a la brevedad.";

/** One study's editable bot configuration (the bot_settings row). */
export interface BotSettings {
  studyId: string;
  enabled: boolean;
  greeting: string;
  offHours: string;
  handoff: string;
}

/** The subset decideBotReply consumes; absent fields fall back to constants. */
export type BotReplySettings = Partial<Pick<BotSettings, "enabled" | "greeting">>;

/**
 * Defaults seeded by supabase/migrations/20261117120000_bot_settings.sql
 * (column defaults + backfill + init_study_defaults) — keep the three
 * strings byte-identical to that file.
 *
 * `offHours` and `handoff` have no M1 rule yet: the after-hours check
 * (whatsapp-bot.md flow 7) and the handoff trigger (flow 6) arrive with
 * Unit 2. They ship stored and editable now so that unit needs no second
 * migration.
 */
export const DEFAULT_BOT_SETTINGS: Omit<BotSettings, "studyId"> = {
  enabled: true,
  greeting: GREETING_REPLY,
  offHours:
    "Estamos fuera de horario: de lunes a viernes de 9 a 18 respondemos las consultas de una persona. El asistente sigue tomando tus datos a cualquier hora y el próximo día hábil te respondemos.",
  handoff:
    "Te paso con una persona del estudio. En horario hábil te responden el mismo día; si es fuera de horario, el próximo día hábil.",
};

/**
 * True when the text fires the greeting rule — the ONE pattern
 * `decideBotReply` branches on for a reply. Exported so the LLM fallback
 * can tell "a rule matched" from "no rule matched" without ever
 * re-implementing the pattern.
 */
export function matchesGreetingRule(text: string): boolean {
  return GREETING_PATTERN.test(text);
}

/**
 * Rules (M1):
 *  - a conversation already stopped by STOP never replies again;
 *  - `STOP` / `baja` / `cancelar` closes the conversation silently — the
 *    opt-out is honoured even when the study switched the bot off;
 *  - `enabled: false` (the admin toggle) keeps the bot silent;
 *  - greetings get `settings.greeting` (falling back to GREETING_REPLY),
 *    anything else gets the acknowledgement;
 *  - every other status keeps answering exactly as before.
 */
export function decideBotReply(
  currentStatus: WaConversationStatus,
  text: string,
  settings?: BotReplySettings | null,
): BotDecision {
  if (currentStatus === "cerrada") {
    return { reply: null, nextStatus: "cerrada" };
  }
  if (STOP_PATTERN.test(normalize(text))) {
    return { reply: null, nextStatus: "cerrada" };
  }
  if (settings && settings.enabled === false) {
    return { reply: null, nextStatus: currentStatus };
  }
  const greeting = settings?.greeting?.trim() || GREETING_REPLY;
  const reply = matchesGreetingRule(text) ? greeting : DEFAULT_REPLY;
  return { reply, nextStatus: currentStatus };
}

/** Lowercase the message — used for keyword matching only. */
export function normalize(text: string): string {
  return text.trim().toLowerCase();
}
