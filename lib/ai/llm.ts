/**
 * Provider-agnostic LLM client — OpenAI-compatible chat completions
 * (WhatsApp Unit 3, the rule bot's fase-2 fallback).
 *
 * SERVER ONLY: reached from the webhook pipeline
 * (lib/supabase/meta-webhook.ts → lib/data/bot-llm.ts), never from a client
 * component — `AI_API_KEY` is a secret and lives in the environment
 * (`.env.example` documents every variable name, with no values; no
 * NEXT_PUBLIC_ var exists for this module on purpose).
 *
 * Contract of this module (mirrors lib/supabase/wa-graph.ts):
 *
 *  - `askLlm` NEVER throws. Every failure — missing config, timeout, rate
 *    limit, malformed payload, network error — comes back as
 *    `{ ok: false, reason }` with a typed reason, so the caller can fall
 *    back to the rule engine and the bot never goes silent;
 *  - no `AI_API_KEY` → `{ ok: false, reason: "not_configured" }` with ONE
 *    log line per process: the fallback simply stays off (that is the state
 *    until the user adds the key to `.env.local`);
 *  - the request is a plain `fetch` POST to `{base}/chat/completions`, ~10 s
 *    abort, low temperature, `max_tokens` capped — no SDK.
 */

/** OpenAI-compatible endpoint root; the `/chat/completions` path is fixed. */
export const DEFAULT_LLM_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_LLM_MODEL = "gpt-4o-mini";
/** Modest reply cap; the environment can lower or raise it (clamped). */
export const DEFAULT_MAX_TOKENS = 400;
/** Hard ceiling on `AI_MAX_TOKENS` — a runaway value must not cost us. */
export const MAX_TOKENS_CAP = 2048;
/** A stuck completion must not hold the webhook open. */
export const LLM_TIMEOUT_MS = 10_000;
/** Deterministic, cost-predictable answers (this is a fallback, not chat). */
const TEMPERATURE = 0.2;

/**
 * Why an answer was not produced (or is unusable). Stable tokens: they are
 * logged and asserted in the tests, same vocabulary idea as wa-graph's
 * `WhatsAppSendReason`.
 */
export type LlmFailureReason =
  /** No `AI_API_KEY` in the environment — fallback off (rules only). */
  | "not_configured"
  /** The request exceeded LLM_TIMEOUT_MS (or the caller aborted it). */
  | "timeout"
  /** The provider throttled us (HTTP 429). */
  | "rate_limited"
  /** Any other HTTP rejection (bad key, server error, …). */
  | "api_error"
  /** DNS/TLS/socket failure — the provider was never reached. */
  | "network_error"
  /** 2xx with a body we cannot read a non-empty answer from. */
  | "bad_response";

export type LlmResult =
  | { ok: true; text: string }
  | { ok: false; reason: LlmFailureReason; detail?: string };

export interface AskLlmInput {
  /** The system prompt (assistant persona + rules + context). */
  system: string;
  /** The end user's message, already trimmed and capped by the caller. */
  user: string;
  /** Optional caller cancellation — an abort resolves as `timeout`. */
  signal?: AbortSignal;
}

interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
}

interface ChatCompletionBody {
  choices?: Array<{ message?: { content?: unknown } }>;
  error?: { message?: unknown };
}

/** True while the fallback is switched on (`AI_API_KEY` IS the toggle). */
export function isLlmConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY?.trim());
}

let missingConfigLogged = false;

/** Reads the env config; logs the rules-only fallback exactly once. */
function readConfig(): LlmConfig | null {
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey) {
    if (!missingConfigLogged) {
      missingConfigLogged = true;
      console.warn(
        "[ai-llm] AI_API_KEY is not set: the LLM fallback stays off " +
          "(not_configured) and the WhatsApp bot answers with its rules " +
          "only. See .env.example.",
      );
    }
    return null;
  }

  const rawTokens = Number.parseInt(process.env.AI_MAX_TOKENS ?? "", 10);
  const maxTokens =
    Number.isFinite(rawTokens) && rawTokens > 0
      ? Math.min(rawTokens, MAX_TOKENS_CAP)
      : DEFAULT_MAX_TOKENS;

  const baseUrl = process.env.AI_BASE_URL?.trim() || DEFAULT_LLM_BASE_URL;
  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model: process.env.AI_MODEL?.trim() || DEFAULT_LLM_MODEL,
    maxTokens,
  };
}

/** AbortError from either our timeout or the caller's signal. */
function isAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/**
 * Ask the model one system+user exchange.
 *
 * Resolves to a typed result for every outcome; it never throws, so the
 * bot's fallback flow can always finish with the rule engine's reply.
 */
export async function askLlm(input: AskLlmInput): Promise<LlmResult> {
  const config = readConfig();
  if (!config) return { ok: false, reason: "not_configured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const onCallerAbort = (): void => controller.abort();
  if (input.signal) {
    if (input.signal.aborted) controller.abort();
    else input.signal.addEventListener("abort", onCallerAbort, { once: true });
  }

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
        temperature: TEMPERATURE,
        max_tokens: config.maxTokens,
      }),
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => null)) as
      | ChatCompletionBody
      | null;

    if (!response.ok) {
      const detail =
        typeof body?.error?.message === "string"
          ? body.error.message
          : `HTTP ${response.status}`;
      if (response.status === 429) {
        return { ok: false, reason: "rate_limited", detail };
      }
      return { ok: false, reason: "api_error", detail };
    }

    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      return {
        ok: false,
        reason: "bad_response",
        detail: "completion carried no usable text",
      };
    }
    return { ok: true, text };
  } catch (error) {
    if (isAbort(error)) return { ok: false, reason: "timeout" };
    return {
      ok: false,
      reason: "network_error",
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onCallerAbort);
  }
}
