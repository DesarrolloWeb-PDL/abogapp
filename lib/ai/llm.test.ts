import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askLlm, isLlmConfigured } from "./llm";

/**
 * WhatsApp Unit 3 — provider-agnostic LLM client (lib/ai/llm.ts).
 *
 * RED→GREEN coverage of the unit's client claims (NO live calls anywhere:
 * `fetch` is a stub for every test):
 *
 *  1. without `AI_API_KEY` the client answers `not_configured` before any
 *     network I/O and logs once per process (same philosophy as
 *     lib/supabase/wa-graph.ts's config guard);
 *  2. when configured it POSTs the OpenAI-compatible `{base}/chat/completions`
 *     shape — bearer key, system+user messages, low temperature, capped
 *     `max_tokens` — honouring the optional env overrides;
 *  3. every failure comes back as a typed reason (`rate_limited`,
 *     `api_error`, `bad_response`, `network_error`, `timeout`) and the
 *     function NEVER throws;
 *  4. the module stays out of the client bundle: no `AI_API_KEY` reference
 *     exists under app/ or components/.
 */

const API_KEY = "sk-unit-test";
const fetchMock = vi.fn();

function chatResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function okCompletion(text: string): Record<string, unknown> {
  return { choices: [{ message: { role: "assistant", content: text } }] };
}

function abortError(): Error {
  return Object.assign(new Error("aborted"), { name: "AbortError" });
}

beforeEach(() => {
  // Explicit stubs every time: a value leaked from the shell must never
  // decide the config guard either way.
  vi.stubEnv("AI_API_KEY", API_KEY);
  vi.stubEnv("AI_BASE_URL", "");
  vi.stubEnv("AI_MODEL", "");
  vi.stubEnv("AI_MAX_TOKENS", "");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/* ---------------------------------------------------------- config guard ---- */

describe("askLlm — config guard", () => {
  it("isLlmConfigured mirrors AI_API_KEY presence (empty/blank = off)", () => {
    expect(isLlmConfigured()).toBe(true);
    vi.stubEnv("AI_API_KEY", "");
    expect(isLlmConfigured()).toBe(false);
    vi.stubEnv("AI_API_KEY", "   ");
    expect(isLlmConfigured()).toBe(false);
  });

  it("answers not_configured without a key and never touches the network", async () => {
    vi.stubEnv("AI_API_KEY", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await askLlm({ system: "Sistema", user: "Consulta" });

    expect(result).toEqual({ ok: false, reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs the missing key once per process, not per message", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();
    const fresh = await import("./llm");
    vi.stubEnv("AI_API_KEY", "");

    await fresh.askLlm({ system: "s", user: "u" });
    await fresh.askLlm({ system: "s", user: "otra" });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("AI_API_KEY");
  });
});

/* --------------------------------------------------------- request shape ---- */

describe("askLlm — request shape", () => {
  it("POSTs {base}/chat/completions with bearer, messages and the reply caps", async () => {
    fetchMock.mockResolvedValue(chatResponse(200, okCompletion("Hola, ¿en qué te ayudo?")));

    const result = await askLlm({ system: "Sistema", user: "Consulta" });

    expect(result).toEqual({ ok: true, text: "Hola, ¿en qué te ayudo?" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${API_KEY}`,
    );
    expect((init.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );
    expect(init.signal).toBeInstanceOf(AbortSignal);

    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 400,
      messages: [
        { role: "system", content: "Sistema" },
        { role: "user", content: "Consulta" },
      ],
    });
  });

  it("honours AI_BASE_URL / AI_MODEL overrides and strips a trailing slash", async () => {
    vi.stubEnv("AI_BASE_URL", "https://llm.example.test/v1/");
    vi.stubEnv("AI_MODEL", "modelo-propio");
    fetchMock.mockResolvedValue(chatResponse(200, okCompletion("ok")));

    await askLlm({ system: "s", user: "u" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://llm.example.test/v1/chat/completions");
    expect(JSON.parse(init.body as string).model).toBe("modelo-propio");
  });

  it("defaults AI_MAX_TOKENS to 400, rejects garbage and clamps a runaway value", async () => {
    fetchMock.mockResolvedValue(chatResponse(200, okCompletion("ok")));
    const maxTokensOfCall = (): number =>
      JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string)
        .max_tokens as number;

    // Empty → the modest default.
    await askLlm({ system: "s", user: "u" });
    expect(maxTokensOfCall()).toBe(400);

    // Not a number → still the default.
    vi.stubEnv("AI_MAX_TOKENS", "no-es-un-numero");
    await askLlm({ system: "s", user: "u" });
    expect(maxTokensOfCall()).toBe(400);

    // A valid override wins…
    vi.stubEnv("AI_MAX_TOKENS", "120");
    await askLlm({ system: "s", user: "u" });
    expect(maxTokensOfCall()).toBe(120);

    // …until it hits the hard cap (cost guard).
    vi.stubEnv("AI_MAX_TOKENS", "999999");
    await askLlm({ system: "s", user: "u" });
    expect(maxTokensOfCall()).toBe(2048);
  });
});

/* --------------------------------------------------------- failure map ---- */

describe("askLlm — typed failures (never throws)", () => {
  it("maps HTTP 429 to rate_limited and other rejections to api_error", async () => {
    fetchMock.mockResolvedValueOnce(
      chatResponse(429, { error: { message: "Slow down" } }),
    );
    await expect(askLlm({ system: "s", user: "u" })).resolves.toMatchObject({
      ok: false,
      reason: "rate_limited",
    });

    fetchMock.mockResolvedValueOnce(
      chatResponse(500, { error: { message: "boom" } }),
    );
    await expect(askLlm({ system: "s", user: "u" })).resolves.toEqual({
      ok: false,
      reason: "api_error",
      detail: "boom",
    });

    // Non-JSON error body: still typed, never a throw.
    fetchMock.mockResolvedValueOnce(new Response("no-json", { status: 400 }));
    await expect(askLlm({ system: "s", user: "u" })).resolves.toEqual({
      ok: false,
      reason: "api_error",
      detail: "HTTP 400",
    });
  });

  it("maps a malformed success payload to bad_response", async () => {
    // JSON, but no choices at all.
    fetchMock.mockResolvedValueOnce(chatResponse(200, { choices: [] }));
    await expect(askLlm({ system: "s", user: "u" })).resolves.toMatchObject({
      ok: false,
      reason: "bad_response",
    });

    // Blank content is not an answer the bot can send.
    fetchMock.mockResolvedValueOnce(
      chatResponse(200, { choices: [{ message: { content: "   " } }] }),
    );
    await expect(askLlm({ system: "s", user: "u" })).resolves.toMatchObject({
      ok: false,
      reason: "bad_response",
    });

    // 200 with a body that is not JSON at all.
    fetchMock.mockResolvedValueOnce(
      new Response("<html>proxy error</html>", { status: 200 }),
    );
    await expect(askLlm({ system: "s", user: "u" })).resolves.toMatchObject({
      ok: false,
      reason: "bad_response",
    });
  });

  it("maps a refused connection to network_error", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(askLlm({ system: "s", user: "u" })).resolves.toEqual({
      ok: false,
      reason: "network_error",
      detail: "fetch failed",
    });
  });

  it("aborts the request after the 10 s timeout", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(abortError()));
        }),
    );

    const pending = askLlm({ system: "s", user: "u" });
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toEqual({ ok: false, reason: "timeout" });
  });

  it("wires a caller signal: an aborted one resolves to timeout", async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      init.signal?.aborted
        ? Promise.reject(abortError())
        : Promise.resolve(chatResponse(200, okCompletion("ok"))),
    );

    const controller = new AbortController();
    controller.abort();

    await expect(
      askLlm({ system: "s", user: "u", signal: controller.signal }),
    ).resolves.toEqual({ ok: false, reason: "timeout" });
  });
});

/* ----------------------------------------------------- client-bundle safe ---- */

/** Every .ts/.tsx source under `dir`, recursively (node_modules skipped). */
function collectSources(dir: string, out: string[] = []): string[] {
  if (!dir) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") collectSources(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("client-bundle safety", () => {
  it("no source file under app/ or components/ mentions AI_API_KEY", () => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const sources = ["app", "components"].flatMap((dir) =>
      collectSources(path.join(root, dir)),
    );
    expect(sources.length, "the scan must actually find sources").toBeGreaterThan(0);

    const offenders = sources.filter((file) =>
      readFileSync(file, "utf8").includes("AI_API_KEY"),
    );
    expect(offenders).toEqual([]);
  });
});
