/**
 * LLM fallback behind the rule engine (WhatsApp Unit 3 — whatsapp-bot.md
 * §9, fase 2 of the bot spec).
 *
 * SERVER ONLY: reads `AI_*` env vars through lib/ai/llm.ts and, when the
 * webhook hands us its service client, a light case context. Never import
 * this from a client component (no NEXT_PUBLIC_ variable exists for it).
 *
 * The flow, in order:
 *
 *  1. RULES FIRST — `decideBotReply` decides exactly as before this unit
 *     existed (STOP, closed, disabled, greeting, configured copies);
 *  2. only the ONE case no rule decides — the unknown intent, signalled by
 *     the DEFAULT_REPLY sentinel — may reach the model, and only when
 *     `AI_API_KEY` is set (env-gated ONLY: no migration, no admin toggle —
 *     "toggle en admin = futuro", whatsapp-bot.md §9);
 *  3. the model gets a Spanish (rioplatense voseo) system prompt with the
 *     WA-020 disclaimer, the study name and its case carátulas (≤10 rows,
 *     context only — a failing fetch degrades to an answer WITHOUT context,
 *     never to silence), plus the inbound text capped at
 *     LLM_USER_MAX_CHARS;
 *  4. the reply ALWAYS carries WA-020: appended client-side when the model
 *     omits it, never duplicated when it includes it;
 *  5. ANY model failure → today's default rule reply — the bot NEVER goes
 *     silent (the same philosophy as Units 1-2's not_configured handling).
 *
 * Note: no `lib/supabase/service.ts` import lives here on purpose — this
 * module is reachable from the client-reachable barrel (lib/data/index.ts),
 * and the service-role client stays route-only. The webhook passes its own
 * service client; without one the fallback simply runs without context.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WaConversationStatus } from "@/lib/types";
import {
  askLlm,
  isLlmConfigured,
  type AskLlmInput,
  type LlmResult,
} from "@/lib/ai/llm";
import {
  DEFAULT_REPLY,
  decideBotReply,
  matchesGreetingRule,
  type BotDecision,
  type BotReplySettings,
} from "./bot";

/**
 * WA-020 — the mandatory disclaimer on every AI-ish answer (spec:
 * "Esto es orientación general, no es asesoramiento legal…"). Kept
 * byte-identical to replica/whatsapp-bot.md's `[UI copy]`.
 */
export const LLM_DISCLAIMER =
  "Esto es orientación general, no es asesoramiento legal. Para tu caso concreto, consultá con una persona del estudio.";

/** Inbound cap for the model's user message (a wall of text helps nobody). */
export const LLM_USER_MAX_CHARS = 1000;

/** Light context: at most this many case carátulas. */
const CONTEXT_CASES_LIMIT = 10;

/** The seam tests inject; production falls through to `askLlm`. */
export type LlmAsk = (input: AskLlmInput) => Promise<LlmResult>;

export interface ResolveBotReplyOptions {
  /** Study the conversation belongs to — scopes the case context. */
  studyId?: string;
  /** The webhook's service client (absent → no context, reply unaffected). */
  supabase?: SupabaseClient;
  /** Test seam: swap the LLM client (the unit suite never hits the network). */
  ask?: LlmAsk;
}

/** What the system prompt gets: a name and a few carátulas, nothing else. */
interface CaseContext {
  studyName: string | null;
  caseTitles: string[];
}

/**
 * Study name + the study's case carátulas (id/title, ≤10 rows, service
 * client scoped to the study). NEVER throws and never fails the reply: any
 * error — no client, failed read, missing table — degrades to no context.
 */
async function loadCaseContext(
  studyId: string | undefined,
  supabase: SupabaseClient | undefined,
): Promise<CaseContext> {
  const empty: CaseContext = { studyName: null, caseTitles: [] };
  if (!studyId || !supabase) return empty;
  try {
    const [studyRow, caseRows] = await Promise.all([
      supabase.from("studies").select("name").eq("id", studyId).maybeSingle(),
      supabase
        .from("cases")
        .select("id, caratula")
        .eq("study_id", studyId)
        .is("deleted_at", null)
        .order("last_activity_at", { ascending: false })
        .limit(CONTEXT_CASES_LIMIT),
    ]);

    const studyName =
      studyRow.data && typeof studyRow.data.name === "string"
        ? studyRow.data.name
        : null;
    const caseTitles = Array.isArray(caseRows.data)
      ? caseRows.data
          .map((row) => (typeof row.caratula === "string" ? row.caratula : ""))
          .filter((title) => title.length > 0)
      : [];
    return { studyName, caseTitles };
  } catch {
    return empty;
  }
}

/**
 * The system prompt (Spanish, rioplatense voseo — this string IS what the
 * bot speaks). It mandates WA-020 inside the answer, forbids inventing case
 * statuses and routes uncertainty to a human; the reply assembly below
 * appends the disclaimer anyway, so the guarantee does not depend on the
 * model obeying.
 */
function buildSystemPrompt(context: CaseContext): string {
  const lines = [
    `Sos el asistente de WhatsApp de ${context.studyName ?? "un estudio jurídico"}.`,
    "Atendés consultas generales de clientes por chat, en español rioplatense (voseo), con respuestas cortas y claras.",
    "",
    "Reglas obligatorias:",
    `1. Terminá SIEMPRE tu respuesta con este aviso, textual: "${LLM_DISCLAIMER}"`,
    "2. No das asesoramiento legal: no opines sobre estrategia ni recomiendes qué hacer en un caso concreto.",
    "3. Nunca inventes datos de causas (estado, número de expediente, juzgado o fechas). Si te preguntan por el estado de una causa, contestá que una persona del estudio lo va a verificar y le responde a la brevedad.",
    "4. Si no sabés algo o no estás seguro, contestá que una persona del estudio va a retomar la consulta a la brevedad.",
    "5. No inventes datos del estudio (horarios, precios, dirección o profesionales): si no figuran abajo, derivá la consulta al estudio.",
    "",
    `Contexto del estudio (solo referencia, no lo repitas de memoria): nombre: ${context.studyName ?? "(desconocido)"}`,
  ];
  if (context.caseTitles.length > 0) {
    lines.push(
      `Causas registradas (hasta ${CONTEXT_CASES_LIMIT}, solo para ubicarte — nunca inventes ni afirmes su estado):`,
      ...context.caseTitles.map((title) => `- ${title}`),
    );
  }
  return lines.join("\n");
}

/** WA-020 appended deterministically; "" when the model answered nothing. */
function withDisclaimer(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.includes(LLM_DISCLAIMER)
    ? trimmed
    : `${trimmed}\n\n${LLM_DISCLAIMER}`;
}

/**
 * Async wrapper over `decideBotReply` for callers that can await the LLM
 * fallback (the webhook pipeline). Source-compatible: the rules and the
 * decision shape are unchanged, and every non-unknown-intent path returns
 * EXACTLY what `decideBotReply` answered.
 */
export async function resolveBotReply(
  currentStatus: WaConversationStatus,
  text: string,
  settings?: BotReplySettings | null,
  options: ResolveBotReplyOptions = {},
): Promise<BotDecision> {
  const decision = decideBotReply(currentStatus, text, settings);

  // Rules first. Silence (STOP / closed / disabled) and every explicit rule
  // answer (the greeting copy today; the handoff / off-hours copies when
  // their rules land) bypass the model by construction.
  if (decision.reply === null) return decision;
  if (decision.reply !== DEFAULT_REPLY || matchesGreetingRule(text)) {
    return decision;
  }

  // No rule matched — the unknown intent. Env-gated ONLY: the presence of
  // AI_API_KEY IS the switch, so without it this returns the rule decision
  // above before any I/O (today's behaviour, byte for byte).
  if (!isLlmConfigured()) return decision;

  const context = await loadCaseContext(options.studyId, options.supabase);
  const ask = options.ask ?? askLlm;

  let result: LlmResult;
  try {
    result = await ask({
      system: buildSystemPrompt(context),
      user: text.trim().slice(0, LLM_USER_MAX_CHARS),
    });
  } catch (error) {
    // The seam contract forbids throws; belt and braces for a bad swap.
    console.warn("[bot-llm] the LLM seam threw; the rule reply is used:", error);
    return decision;
  }

  if (!result.ok) {
    if (result.reason !== "not_configured") {
      console.warn(
        `[bot-llm] LLM fallback failed (${result.reason}); the rule reply is used`,
      );
    }
    return decision;
  }

  const reply = withDisclaimer(result.text);
  return reply ? { reply, nextStatus: decision.nextStatus } : decision;
}
