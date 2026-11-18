import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BOT_SETTINGS,
  DEFAULT_REPLY,
  GREETING_REPLY,
  decideBotReply,
} from "./bot";
import {
  LLM_DISCLAIMER,
  LLM_USER_MAX_CHARS,
  resolveBotReply,
} from "./bot-llm";
import {
  BOT_MESSAGE_MAX,
  getBotSettings,
  updateBotSettings,
  validateBotSettingsInput,
} from "./bot-settings";
import { DataLayerError } from "./errors";

/**
 * WhatsApp Unit 1 — study-level bot settings.
 *
 * RED→GREEN coverage for the three claims of the unit:
 *  1. decideBotReply USES the settings it is given (custom greeting in the
 *     reply, silent when the study switched the bot off) and still falls
 *     back to the built-in copy when none arrive;
 *  2. validation rejects empty and oversized messages with a typed error
 *     BEFORE anything reaches a store;
 *  3. the supabase driver inserts the defaults when a study has no row
 *     (mocked client — no network), and the fake driver answers the same
 *     defaults (driver parity).
 */

const CUSTOM_GREETING = "Hola, sos del Estudio Rivera. ¿En qué te ayudo?";
const STUDY_ID = "33333333-3333-3333-3333-333333333333";

/** The row PostgREST returns for a study that still has the defaults. */
const DEFAULT_ROW = {
  study_id: STUDY_ID,
  enabled: true,
  greeting: GREETING_REPLY,
  off_hours: DEFAULT_BOT_SETTINGS.offHours,
  handoff: DEFAULT_BOT_SETTINGS.handoff,
};

// Shared query-builder mock: every builder returns the chain itself, the
// way supabase-js's fluent builder does; each test scripts the terminal
// maybeSingle/single answers with mockResolvedValueOnce.
const { chain } = vi.hoisted(() => {
  const chain = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  };
  chain.from.mockImplementation(() => chain);
  chain.select.mockImplementation(() => chain);
  chain.eq.mockImplementation(() => chain);
  chain.insert.mockImplementation(() => chain);
  chain.update.mockImplementation(() => chain);
  return { chain };
});

// Only the client factory is stubbed; lib/supabase/bot-settings.ts is the
// REAL implementation under test (same partial-mock pattern as
// auth-supabase.test.ts).
vi.mock("@/lib/supabase/client", () => ({ getBrowserClient: () => chain }));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("decideBotReply + settings", () => {
  it("answers with the study's custom greeting, not the built-in one", () => {
    const decision = decideBotReply("bot", "hola, buenos días", {
      enabled: true,
      greeting: CUSTOM_GREETING,
    });

    expect(decision.reply).toBe(CUSTOM_GREETING);
    expect(decision.reply).not.toBe(GREETING_REPLY);
    expect(decision.nextStatus).toBe("bot");
  });

  it("falls back to the built-in copy when settings are absent or blank", () => {
    expect(decideBotReply("bot", "hola").reply).toBe(GREETING_REPLY);
    expect(decideBotReply("bot", "hola", null).reply).toBe(GREETING_REPLY);
    expect(
      decideBotReply("bot", "hola", { enabled: true, greeting: "   " }).reply,
    ).toBe(GREETING_REPLY);
    // A non-greeting still gets the fixed acknowledgement (no settings home).
    expect(decideBotReply("bot", "mi consulta", { greeting: CUSTOM_GREETING })
      .reply).toBe(
      "Recibí tu mensaje. Alguien del estudio se va a comunicar con vos a la brevedad.",
    );
  });

  it("keeps STOP closing silently and honours enabled=false", () => {
    const off = { enabled: false, greeting: CUSTOM_GREETING };

    expect(decideBotReply("bot", "hola", off)).toEqual({
      reply: null,
      nextStatus: "bot",
    });
    // Opt-out is never gated on the bot being on.
    expect(decideBotReply("bot", "STOP", off)).toEqual({
      reply: null,
      nextStatus: "cerrada",
    });
    expect(
      decideBotReply("cerrada", "hola", { enabled: true, greeting: CUSTOM_GREETING }),
    ).toEqual({ reply: null, nextStatus: "cerrada" });
  });
});

describe("fake driver settings", () => {
  it("getBotSettings answers the seeded defaults until something is saved", async () => {
    const settings = await getBotSettings("study-fake-defaults");

    expect(settings).toEqual({ studyId: "study-fake-defaults", ...DEFAULT_BOT_SETTINGS });
    expect(settings.greeting).toBe(GREETING_REPLY);
  });

  it("updateBotSettings persists trims per study and leaves the rest alone", async () => {
    await updateBotSettings({
      studyId: "study-fake-edited",
      enabled: false,
      greeting: `  ${CUSTOM_GREETING}  `,
      offHours: "  Fuera de horario personalizado  ",
      handoff: "Traspaso personalizado",
    });

    const edited = await getBotSettings("study-fake-edited");
    expect(edited.enabled).toBe(false);
    expect(edited.greeting).toBe(CUSTOM_GREETING);
    expect(edited.offHours).toBe("Fuera de horario personalizado");
    expect(edited.handoff).toBe("Traspaso personalizado");

    // Another study keeps the defaults — settings are per study.
    const untouched = await getBotSettings("study-fake-other");
    expect(untouched.greeting).toBe(GREETING_REPLY);
    expect(untouched.enabled).toBe(true);
  });
});

describe("validation (both drivers)", () => {
  it("rejects empty, oversized and non-boolean input with typed errors", async () => {
    await expect(
      updateBotSettings({
        studyId: "study-invalid",
        enabled: true,
        greeting: "   ",
        offHours: "ok",
        handoff: "ok",
      }),
    ).rejects.toBeInstanceOf(DataLayerError);

    // The >500 bound reuses missing_fields: errors.ts is outside this
    // unit's surfaces (reported upstream — a dedicated code would read
    // better in the toast). The form shows per-field copy instead.
    await expect(
      updateBotSettings({
        studyId: "study-invalid",
        enabled: true,
        greeting: "x".repeat(BOT_MESSAGE_MAX + 1),
        offHours: "ok",
        handoff: "ok",
      }),
    ).rejects.toMatchObject({ code: "missing_fields" });

    await expect(
      updateBotSettings({
        studyId: "study-invalid",
        enabled: "yes" as unknown as boolean,
        greeting: "ok",
        offHours: "ok",
        handoff: "ok",
      }),
    ).rejects.toMatchObject({ code: "missing_fields" });

    // Nothing invalid ever reached a store.
    expect(await getBotSettings("study-invalid")).toEqual({
      studyId: "study-invalid",
      ...DEFAULT_BOT_SETTINGS,
    });
  });

  it("validateBotSettingsInput returns the Spanish per-field copy", () => {
    const errors = validateBotSettingsInput({
      greeting: " ",
      offHours: "",
      handoff: "Traspaso válido",
    });

    expect(errors.greeting).toBe("El saludo no puede quedar vacío.");
    expect(errors.offHours).toBe(
      "El mensaje de fuera de horario no puede quedar vacío.",
    );
    expect(errors.handoff).toBeUndefined();

    const tooLong = validateBotSettingsInput({
      greeting: "g".repeat(BOT_MESSAGE_MAX + 1),
      offHours: "o",
      handoff: "h",
    });
    expect(tooLong.greeting).toBe(
      `El saludo no puede superar los ${BOT_MESSAGE_MAX} caracteres.`,
    );

    expect(
      validateBotSettingsInput({ greeting: "g", offHours: "o", handoff: "h" }),
    ).toEqual({});
  });
});

describe("supabase driver (mocked client)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-demo");

    chain.select.mockClear();
    chain.eq.mockClear();
    chain.insert.mockClear();
    chain.update.mockClear();
    chain.from.mockClear();
    chain.maybeSingle.mockReset();
    chain.single.mockReset();
    chain.maybeSingle.mockResolvedValue({ data: null, error: null });
    chain.single.mockResolvedValue({ data: null, error: null });
  });

  it("getBotSettings returns the existing row without inserting", async () => {
    chain.maybeSingle.mockResolvedValueOnce({
      data: { ...DEFAULT_ROW, greeting: CUSTOM_GREETING },
      error: null,
    });

    const settings = await getBotSettings(STUDY_ID);

    expect(settings).toEqual({
      studyId: STUDY_ID,
      enabled: true,
      greeting: CUSTOM_GREETING,
      offHours: DEFAULT_BOT_SETTINGS.offHours,
      handoff: DEFAULT_BOT_SETTINGS.handoff,
    });
    expect(chain.insert).not.toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith("study_id", STUDY_ID);
  });

  it("getBotSettings inserts the defaults when the study has no row", async () => {
    chain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    chain.single.mockResolvedValueOnce({ data: DEFAULT_ROW, error: null });

    const settings = await getBotSettings(STUDY_ID);

    expect(chain.insert).toHaveBeenCalledTimes(1);
    expect(chain.insert).toHaveBeenCalledWith({
      study_id: STUDY_ID,
      enabled: true,
      greeting: GREETING_REPLY,
      off_hours: DEFAULT_BOT_SETTINGS.offHours,
      handoff: DEFAULT_BOT_SETTINGS.handoff,
    });
    expect(settings).toEqual({ studyId: STUDY_ID, ...DEFAULT_BOT_SETTINGS });
  });

  it("re-reads the winner's row when a concurrent insert loses the race", async () => {
    chain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    });
    chain.maybeSingle.mockResolvedValueOnce({ data: DEFAULT_ROW, error: null });

    const settings = await getBotSettings(STUDY_ID);

    expect(settings).toEqual({ studyId: STUDY_ID, ...DEFAULT_BOT_SETTINGS });
  });

  it("maps a failed read onto the save_failed code", async () => {
    chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "42P01", message: 'relation "bot_settings" does not exist' },
    });

    await expect(getBotSettings(STUDY_ID)).rejects.toMatchObject({
      code: "save_failed",
    });
  });

  it("updateBotSettings validates first, then writes the snake_case row", async () => {
    // Invalid copy must never reach the client (validation before dispatch).
    await expect(
      updateBotSettings({
        studyId: STUDY_ID,
        enabled: true,
        greeting: "",
        offHours: "ok",
        handoff: "ok",
      }),
    ).rejects.toMatchObject({ code: "missing_fields" });
    expect(chain.update).not.toHaveBeenCalled();

    const savedRow = {
      ...DEFAULT_ROW,
      greeting: CUSTOM_GREETING,
      enabled: false,
      off_hours: "ok",
      handoff: "ok",
    };
    chain.maybeSingle.mockResolvedValueOnce({ data: savedRow, error: null });

    const saved = await updateBotSettings({
      studyId: STUDY_ID,
      enabled: false,
      greeting: CUSTOM_GREETING,
      offHours: "ok",
      handoff: "ok",
    });

    expect(chain.update).toHaveBeenCalledWith({
      enabled: false,
      greeting: CUSTOM_GREETING,
      off_hours: "ok",
      handoff: "ok",
    });
    expect(chain.eq).toHaveBeenCalledWith("study_id", STUDY_ID);
    expect(saved).toEqual({
      studyId: STUDY_ID,
      enabled: false,
      greeting: CUSTOM_GREETING,
      offHours: "ok",
      handoff: "ok",
    });
  });
});

/* ------------------------------------------------- LLM fallback (Unit 3) ---- */

/**
 * WhatsApp Unit 3 — `resolveBotReply`, the async wrapper that puts the LLM
 * BEHIND the rules (fase 2 of whatsapp-bot.md). All stubbed: the model is an
 * injected seam or a stubbed `fetch`, and every test pins `AI_API_KEY`
 * explicitly so the config gate can never depend on the shell.
 *
 * Claims covered:
 *  1. rules run FIRST — STOP / closed / disabled / greeting never reach the
 *     model, and without `AI_API_KEY` the unknown intent keeps today's
 *     default rule reply;
 *  2. configured → ONE call with system prompt + WA-020 disclaimer + the
 *     study's case context, and the reply ALWAYS carries the disclaimer
 *     (appended client-side when the model omits it);
 *  3. any model failure → the default rule reply (the bot never goes silent);
 *  4. the inbound text is capped before it reaches the model, and a failing
 *     case-context fetch degrades to an answer without context.
 */
describe("resolveBotReply — LLM fallback behind the rules", () => {
  const LLM_STUDY = "study-llm-0001";
  const UNKNOWN_INTENT = "¿Cuánto cuesta redactar un contrato de alquiler?";

  /** Scripted Supabase double for the case-context read (no network). */
  function contextClient(
    options: {
      studyName?: string | null;
      cases?: string[];
      /** Tables whose query answers an error instead of rows. */
      failTables?: string[];
      /** The whole client explodes (service client unavailable). */
      explode?: boolean;
    } = {},
  ): SupabaseClient {
    const from = (table: string): Record<string, unknown> => {
      if (options.explode) throw new Error("service client unavailable");
      const answer = (): Promise<{
        data: unknown;
        error: { message: string } | null;
      }> => {
        if (options.failTables?.includes(table)) {
          return Promise.resolve({ data: null, error: { message: "boom" } });
        }
        if (table === "studies") {
          return Promise.resolve({
            data: options.studyName ? { name: options.studyName } : null,
            error: null,
          });
        }
        if (table === "cases") {
          return Promise.resolve({
            data: (options.cases ?? []).map((caratula, index) => ({
              id: `case-${index}`,
              caratula,
            })),
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      };
      const builder: Record<string, unknown> = {};
      for (const op of ["select", "eq", "is", "order", "limit"]) {
        builder[op] = () => builder;
      }
      builder.maybeSingle = answer;
      // List queries end with `await builder` — a thenable, like supabase-js.
      builder.then = (
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => answer().then(onFulfilled, onRejected);
      return builder;
    };
    return { from } as unknown as SupabaseClient;
  }

  const configuredEnv = () => {
    vi.stubEnv("AI_API_KEY", "sk-test-llm");
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("without AI_API_KEY the unknown intent keeps the default rule reply", async () => {
    vi.stubEnv("AI_API_KEY", "");
    const ask = vi.fn();

    const decision = await resolveBotReply("bot", UNKNOWN_INTENT, null, {
      studyId: LLM_STUDY,
      supabase: contextClient({ studyName: "Estudio Rivera" }),
      ask,
    });

    expect(decision).toEqual({ reply: DEFAULT_REPLY, nextStatus: "bot" });
    expect(ask).not.toHaveBeenCalled();
    expect(decision.reply).not.toContain("asesoramiento legal");
  });

  it("configured → one call with system + disclaimer + case context; reply carries the disclaimer", async () => {
    configuredEnv();
    const ask = vi.fn().mockResolvedValue({
      ok: true,
      text: "Redactamos contratos con revisión previa.",
    });

    const decision = await resolveBotReply("bot", UNKNOWN_INTENT, null, {
      studyId: LLM_STUDY,
      supabase: contextClient({
        studyName: "Estudio Beltrán & Asociados",
        cases: ["Gómez, Rosa c/ Empresa de Luz S.A. s/ cobro de pesos"],
      }),
      ask,
    });

    expect(ask).toHaveBeenCalledTimes(1);
    const input = ask.mock.calls[0][0] as {
      system: string;
      user: string;
    };
    // The system prompt: Spanish voseo assistant, the study, its cases and
    // the WA-020 disclaimer it must always end with.
    expect(input.system).toContain("Estudio Beltrán & Asociados");
    expect(input.system).toContain(
      "Gómez, Rosa c/ Empresa de Luz S.A. s/ cobro de pesos",
    );
    expect(input.system).toContain(LLM_DISCLAIMER);
    expect(input.user).toBe(UNKNOWN_INTENT);
    // The disclaimer is appended CLIENT-SIDE, so it survives a model that
    // ignores the system prompt.
    expect(decision.reply).toBe(
      `Redactamos contratos con revisión previa.\n\n${LLM_DISCLAIMER}`,
    );
    expect(decision.nextStatus).toBe("bot");
  });

  it("does not duplicate the disclaimer when the model already wrote it", async () => {
    configuredEnv();
    const ask = vi.fn().mockResolvedValue({
      ok: true,
      text: `Solo orientación.\n\n${LLM_DISCLAIMER}`,
    });

    const decision = await resolveBotReply("bot", UNKNOWN_INTENT, null, {
      studyId: LLM_STUDY,
      supabase: contextClient(),
      ask,
    });

    expect(decision.reply).toBe(`Solo orientación.\n\n${LLM_DISCLAIMER}`);
    const occurrences = decision.reply!.split(LLM_DISCLAIMER).length - 1;
    expect(occurrences).toBe(1);
  });

  it("falls back to the default rule reply on timeout, api_error and a throwing seam", async () => {
    configuredEnv();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = contextClient();

    for (const failure of [
      { ok: false, reason: "timeout" },
      { ok: false, reason: "api_error" },
      { ok: false, reason: "rate_limited" },
    ]) {
      const ask = vi.fn().mockResolvedValue(failure);
      const decision = await resolveBotReply("bot", UNKNOWN_INTENT, null, {
        studyId: LLM_STUDY,
        supabase: client,
        ask,
      });
      expect(decision).toEqual({ reply: DEFAULT_REPLY, nextStatus: "bot" });
    }

    // Belt and braces: the seam contract forbids throws, a bad one still
    // cannot silence the bot.
    const throwing = vi.fn().mockRejectedValue(new Error("model exploded"));
    await expect(
      resolveBotReply("bot", UNKNOWN_INTENT, null, {
        studyId: LLM_STUDY,
        supabase: client,
        ask: throwing,
      }),
    ).resolves.toEqual({ reply: DEFAULT_REPLY, nextStatus: "bot" });
  });

  it("STOP, closed, disabled and greeting inputs never reach the model", async () => {
    configuredEnv(); // the gate must be the RULE, not the config
    const ask = vi.fn();
    const base = { studyId: LLM_STUDY, supabase: contextClient(), ask };

    // STOP closes silently (opt-out wins even with the LLM on).
    await expect(resolveBotReply("bot", "STOP", null, base)).resolves.toEqual({
      reply: null,
      nextStatus: "cerrada",
    });
    // A closed conversation stays closed.
    await expect(
      resolveBotReply("cerrada", UNKNOWN_INTENT, null, base),
    ).resolves.toEqual({ reply: null, nextStatus: "cerrada" });
    // The admin toggle keeps the bot silent — no model call behind a pause.
    await expect(
      resolveBotReply("bot", UNKNOWN_INTENT, { enabled: false }, base),
    ).resolves.toEqual({ reply: null, nextStatus: "bot" });
    // The greeting rule answers with the configured copy, never the model.
    const greeting = await resolveBotReply(
      "bot",
      "hola, buenos días",
      { enabled: true, greeting: CUSTOM_GREETING },
      base,
    );
    expect(greeting.reply).toBe(CUSTOM_GREETING);

    expect(ask).not.toHaveBeenCalled();
  });

  it("caps a long inbound at LLM_USER_MAX_CHARS before sending it", async () => {
    configuredEnv();
    const ask = vi.fn().mockResolvedValue({ ok: true, text: "Respuesta" });
    const longText = `¿Me pasan presupuesto? ${"x".repeat(5000)}`;

    await resolveBotReply("bot", longText, null, {
      studyId: LLM_STUDY,
      supabase: contextClient(),
      ask,
    });

    const input = ask.mock.calls[0][0] as { user: string };
    expect(input.user).toHaveLength(LLM_USER_MAX_CHARS);
    expect(LLM_USER_MAX_CHARS).toBe(1000);
  });

  it("still answers when the case-context fetch fails or explodes", async () => {
    configuredEnv();
    const ask = vi.fn().mockResolvedValue({ ok: true, text: "Te oriento." });

    // Partial failure: the cases query errors — no carátulas in context.
    const decision = await resolveBotReply("bot", UNKNOWN_INTENT, null, {
      studyId: LLM_STUDY,
      supabase: contextClient({
        studyName: "Estudio Rivera",
        failTables: ["cases"],
      }),
      ask,
    });
    const input = ask.mock.calls[0][0] as { system: string };
    expect(input.system).toContain("Estudio Rivera");
    expect(input.system).not.toContain("Gómez");
    expect(decision.reply).toBe(`Te oriento.\n\n${LLM_DISCLAIMER}`);

    // Total failure: even building the client throws — the reply still goes
    // out, without context and never as silence.
    const decision2 = await resolveBotReply("bot", UNKNOWN_INTENT, null, {
      studyId: LLM_STUDY,
      supabase: contextClient({ explode: true }),
      ask,
    });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(decision2.reply).toBe(`Te oriento.\n\n${LLM_DISCLAIMER}`);
  });

  it("uses the real askLlm client when no seam is given (fetch stubbed)", async () => {
    configuredEnv();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "Respuesta del modelo" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const decision = await resolveBotReply("bot", UNKNOWN_INTENT, null, {
      studyId: LLM_STUDY,
      supabase: contextClient({ studyName: "Estudio Rivera" }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/chat/completions");
    expect(decision.reply).toBe(`Respuesta del modelo\n\n${LLM_DISCLAIMER}`);
  });
});
