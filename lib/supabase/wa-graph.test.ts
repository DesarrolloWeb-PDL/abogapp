import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GREETING_REPLY } from "@/lib/data/bot";
import { parseStatusUpdates } from "@/lib/data/webhook";
import {
  buildTextMessageRequest,
  mapGraphErrorCode,
  sendWhatsAppText,
  toWaId,
} from "./wa-graph";
import {
  deliverOutbound,
  processInboundMeta,
  processStatusUpdatesMeta,
  withinWindow,
} from "./meta-webhook";

/**
 * WhatsApp Unit 2 — outbound delivery through the Meta Graph API and the
 * 24 h service-window gate.
 *
 * RED→GREEN coverage of the unit's claims (NO live network anywhere: the
 * sender's `fetch` is stubbed and the Supabase client is a scripted fake):
 *
 *  1. the sender builds the exact URL / bearer header / JSON body Meta's
 *     `/messages` endpoint expects, and degrades to `not_configured`
 *     without credentials (inbox-only mode, logged once);
 *  2. Graph rejections map to typed reasons — never a raw throw into the
 *     webhook pipeline;
 *  3. `withinWindow` decides the 24 h gate, and `deliverOutbound` calls the
 *     sender only inside it, writing the outcome back onto the row;
 *  4. the inbound pipeline stamps `last_inbound_at` / `window_expires_at`
 *     on every delivery and records the exact Graph payload it attempted;
 *  5. Meta's `statuses` deliveries update the outbound row they name,
 *     idempotently.
 *
 * The file lives next to `wa-graph.ts` (the unit's new module) but also
 * covers the pipeline in `meta-webhook.ts` that consumes it.
 */

const TOKEN = "EAAG-test-token";
const PHONE_ID = "123456789012345";
const E164 = "+5491155550901";
const WA_ID = "5491155550901";

const fetchMock = vi.fn();

function graphResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubEnv("WHATSAPP_ACCESS_TOKEN", TOKEN);
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", PHONE_ID);
  vi.stubEnv("WHATSAPP_API_VERSION", "");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/* --------------------------------------------------------------- sender ---- */

describe("sendWhatsAppText — request shape", () => {
  it("POSTs the versioned /messages URL with the bearer header and body", async () => {
    fetchMock.mockResolvedValue(
      graphResponse(200, { messages: [{ id: "wamid.OK.1" }] }),
    );

    const result = await sendWhatsAppText({
      to: E164,
      type: "text",
      text: "Hola, ¿me ayudan?",
    });

    expect(result).toEqual({ ok: true, messageId: "wamid.OK.1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://graph.facebook.com/v21.0/${PHONE_ID}/messages`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${TOKEN}`,
    );
    expect((init.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // The recipient is the wa_id: digits only, never the `+` of E.164.
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: "whatsapp",
      to: WA_ID,
      type: "text",
      text: { body: "Hola, ¿me ayudan?" },
    });
  });

  it("honours WHATSAPP_API_VERSION and defaults to v21.0 when empty", async () => {
    fetchMock.mockResolvedValue(
      graphResponse(200, { messages: [{ id: "wamid.OK.2" }] }),
    );
    vi.stubEnv("WHATSAPP_API_VERSION", "v22.0");
    await sendWhatsAppText({ to: WA_ID, text: "hola" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/v22.0/");

    vi.stubEnv("WHATSAPP_API_VERSION", "");
    await sendWhatsAppText({ to: WA_ID, text: "hola" });
    expect(String(fetchMock.mock.calls[1][0])).toContain("/v21.0/");
  });

  it("shares one body builder with the stored payload record", () => {
    expect(buildTextMessageRequest(E164, "hola")).toEqual({
      messaging_product: "whatsapp",
      to: WA_ID,
      type: "text",
      text: { body: "hola" },
    });
    expect(toWaId("  +54 9 11 5555-0901 ")).toBe(WA_ID);
  });
});

describe("sendWhatsAppText — config guard", () => {
  it("answers not_configured and never touches the network", async () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await sendWhatsAppText({ to: E164, text: "hola" });

    expect(result).toEqual({ ok: false, reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a missing phone-number id as not_configured too", async () => {
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(sendWhatsAppText({ to: E164, text: "hola" })).resolves.toEqual({
      ok: false,
      reason: "not_configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs the missing configuration once per process, not per message", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();
    const fresh = await import("./wa-graph");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "");

    await fresh.sendWhatsAppText({ to: E164, text: "hola" });
    await fresh.sendWhatsAppText({ to: E164, text: "hola de nuevo" });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("not_configured");
  });
});

describe("sendWhatsAppText — Graph error mapping", () => {
  it("maps 131047 (24 h window expired) to outside_window", async () => {
    fetchMock.mockResolvedValue(
      graphResponse(400, {
        error: {
          code: 131047,
          message: "(#131047) Re-engagement message",
          error_data: {
            details: "More than 24 hours have passed since the recipient last replied.",
          },
        },
      }),
    );

    await expect(sendWhatsAppText({ to: E164, text: "hola" })).resolves.toEqual({
      ok: false,
      reason: "outside_window",
      detail: expect.stringContaining("24 hours"),
    });
  });

  it("maps 131026 (undeliverable) to invalid_recipient, not to the window", async () => {
    // Meta's own error table: 131026 = "Unable to deliver message" (the
    // number is not on WhatsApp / old app / terms not accepted); the window
    // rejection is 131047. Labeling 131026 as "outside window" would show
    // the studio "Fuera de ventana" for a number that cannot receive
    // WhatsApp messages at all.
    fetchMock.mockResolvedValue(
      graphResponse(400, {
        error: { code: 131026, message: "(#131026) Message Undeliverable" },
      }),
    );

    await expect(sendWhatsAppText({ to: E164, text: "hola" })).resolves.toEqual({
      ok: false,
      reason: "invalid_recipient",
      detail: "(#131026) Message Undeliverable",
    });
    expect(mapGraphErrorCode(131026)).toBe("invalid_recipient");
    expect(mapGraphErrorCode(131047)).toBe("outside_window");
    expect(mapGraphErrorCode(999999)).toBe("api_error");
  });

  it("maps HTTP 429 and the rate-limit codes to rate_limited", async () => {
    fetchMock.mockResolvedValue(
      graphResponse(429, { error: { message: "Too many calls" } }),
    );
    await expect(sendWhatsAppText({ to: E164, text: "hola" })).resolves.toMatchObject(
      { ok: false, reason: "rate_limited" },
    );

    fetchMock.mockResolvedValue(
      graphResponse(400, { error: { code: 130429, message: "(#130429) Rate limit hit" } }),
    );
    await expect(sendWhatsAppText({ to: E164, text: "hola" })).resolves.toMatchObject(
      { ok: false, reason: "rate_limited" },
    );
  });

  it("maps anything it does not recognise to api_error, never throws", async () => {
    fetchMock.mockResolvedValue(graphResponse(500, { error: { code: 131016 } }));
    await expect(sendWhatsAppText({ to: E164, text: "hola" })).resolves.toEqual({
      ok: false,
      reason: "api_error",
      detail: "HTTP 500",
    });

    // Non-JSON body: still a typed result, never a throw.
    fetchMock.mockResolvedValue(new Response("boom", { status: 400 }));
    await expect(sendWhatsAppText({ to: E164, text: "hola" })).resolves.toEqual({
      ok: false,
      reason: "api_error",
      detail: "HTTP 400",
    });

    // 200 without a message id is not a delivery we can confirm.
    fetchMock.mockResolvedValue(graphResponse(200, {}));
    await expect(sendWhatsAppText({ to: E164, text: "hola" })).resolves.toEqual({
      ok: false,
      reason: "api_error",
      detail: "Graph response carried no message id",
    });

    // An empty recipient never reaches the network either.
    fetchMock.mockClear();
    await expect(sendWhatsAppText({ to: " + ", text: "hola" })).resolves.toEqual({
      ok: false,
      reason: "invalid_recipient",
      detail: "empty recipient",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a refused connection to network_error", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(sendWhatsAppText({ to: E164, text: "hola" })).resolves.toEqual({
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
          init.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );

    const pending = sendWhatsAppText({ to: E164, text: "hola" });
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toEqual({ ok: false, reason: "timeout" });
  });
});

/* --------------------------------------------------------------- window ---- */

describe("withinWindow — the 24 h gate", () => {
  const now = new Date("2026-11-18T12:00:00.000Z");
  const HOUR = 60 * 60 * 1000;

  it("is inside while the last inbound is younger than 24 h", () => {
    expect(
      withinWindow({ last_inbound_at: new Date(now.getTime() - HOUR).toISOString() }, now),
    ).toBe(true);
    expect(
      withinWindow(
        { last_inbound_at: new Date(now.getTime() - 24 * HOUR).toISOString() },
        now,
      ),
      "exactly 24 h is still inside (<= 24 h)",
    ).toBe(true);
    expect(
      withinWindow(
        { last_inbound_at: new Date(now.getTime() - 24 * HOUR - 1).toISOString() },
        now,
      ),
    ).toBe(false);
  });

  it("derives the window from window_expires_at when no stamp exists", () => {
    expect(
      withinWindow(
        { window_expires_at: new Date(now.getTime() + HOUR).toISOString() },
        now,
      ),
    ).toBe(true);
    expect(
      withinWindow(
        { window_expires_at: new Date(now.getTime() - 1).toISOString() },
        now,
      ),
    ).toBe(false);
  });

  it("has no window for a conversation that never received a message", () => {
    expect(withinWindow({}, now)).toBe(false);
    expect(withinWindow({ last_inbound_at: null, window_expires_at: null }, now)).toBe(
      false,
    );
    // Garbage timestamps must not open a window by accident.
    expect(withinWindow({ last_inbound_at: "not-a-date" }, now)).toBe(false);
    expect(
      withinWindow({ window_expires_at: "not-a-date" }, now),
    ).toBe(false);
  });
});

/* ------------------------------------------------------------- delivery ---- */

interface RecordedCall {
  table: string;
  op: string;
  args: unknown[];
}

/** Minimal fluent Supabase double: every terminal resolves like the real
 *  builder (`await …` → the builder itself, whose `.error` is the answer). */
function createFakeSupabase() {
  const queues = new Map<string, Array<Record<string, unknown>>>();
  const calls: RecordedCall[] = [];

  const answer = (table: string, op: string, reply: Record<string, unknown>) => {
    const key = `${table}:${op}`;
    queues.set(key, [...(queues.get(key) ?? []), reply]);
  };
  const take = (table: string, op: string): Record<string, unknown> =>
    queues.get(`${table}:${op}`)?.shift() ?? { data: null, error: null };

  function from(table: string) {
    const builder: Record<string, unknown> = {};
    let pending: string | null = null;
    const record = (op: string, args: unknown[] = []) => {
      calls.push({ table, op, args });
    };

    for (const op of ["select", "eq", "order", "limit", "delete"]) {
      builder[op] = (...args: unknown[]) => {
        record(op, args);
        return builder;
      };
    }
    builder.insert = (...args: unknown[]) => {
      record("insert", args);
      pending = "insert";
      return builder;
    };
    builder.update = (...args: unknown[]) => {
      record("update", args);
      pending = "update";
      return builder;
    };
    builder.maybeSingle = () => {
      record("maybeSingle");
      return Promise.resolve(take(table, "maybeSingle"));
    };
    builder.single = () => {
      record("single");
      return Promise.resolve(take(table, "single"));
    };
    Object.defineProperty(builder, "error", {
      get: () => (pending ? ((take(table, pending).error as unknown) ?? null) : null),
    });

    record("from");
    return builder;
  }

  const client = { from } as unknown as SupabaseClient;
  return { client, calls, answer };
}

/** Scripted replies for one full inbound → reply → delivery pass. */
function scriptInboundPass(db: ReturnType<typeof createFakeSupabase>) {
  db.answer("studies", "maybeSingle", { data: { id: "study-1" }, error: null });
  db.answer("wa_contacts", "single", { data: { id: "contact-1" }, error: null });
  db.answer("wa_conversations", "single", {
    data: { id: "conv-1", status: "bot", unread_from_client: 0 },
    error: null,
  });
  db.answer("bot_settings", "maybeSingle", {
    data: {
      study_id: "study-1",
      enabled: true,
      greeting: GREETING_REPLY,
      off_hours: "fuera",
      handoff: "traspaso",
    },
    error: null,
  });
  db.answer("wa_conversations", "update", { data: null, error: null });
  db.answer("wa_messages", "single", { data: { id: "msg-out-1" }, error: null });
  db.answer("wa_messages", "update", { data: null, error: null });
  db.answer("wa_webhook_events", "insert", { data: null, error: null });
  db.answer("wa_webhook_events", "update", { data: null, error: null });
}

function inboundPayload(id: string): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              messages: [
                {
                  id,
                  from: WA_ID,
                  type: "text",
                  text: { body: "hola" },
                  profile: { name: "Ana" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe("processInboundMeta — pipeline wiring (mocked Supabase)", () => {
  it("stamps the window, stores the reply and records the Graph payload", async () => {
    const db = createFakeSupabase();
    scriptInboundPass(db);
    const sender = vi.fn(async () => ({ ok: true, messageId: "wamid.OUT.9" } as const));

    const result = await processInboundMeta(inboundPayload("wamid.IN.1"), {
      sender,
      supabase: db.client,
    });

    expect(result).toMatchObject({ accepted: 1, duplicates: 0 });
    expect(result.replies).toEqual([GREETING_REPLY]);

    // The inbound stamp: every delivery refreshes the window.
    const conversationUpdate = db.calls.find(
      (call) => call.table === "wa_conversations" && call.op === "update",
    );
    expect(conversationUpdate).toBeDefined();
    const stamp = conversationUpdate!.args[0] as Record<string, string>;
    expect(stamp.last_inbound_at).toEqual(expect.any(String));
    expect(stamp.window_expires_at).toEqual(expect.any(String));
    expect(
      Date.parse(stamp.window_expires_at) - Date.parse(stamp.last_inbound_at),
    ).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 2);
    expect(
      Date.parse(stamp.window_expires_at) - Date.parse(stamp.last_inbound_at),
    ).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 2);

    // The outbound row carries the exact Graph body we are about to POST.
    const outboundInsert = db.calls.find(
      (call) =>
        call.table === "wa_messages" &&
        call.op === "insert" &&
        (call.args[0] as { direction?: string }).direction === "out",
    );
    expect(outboundInsert).toBeDefined();
    expect(outboundInsert!.args[0]).toMatchObject({
      status: "failed",
      payload: {
        messaging_product: "whatsapp",
        to: WA_ID,
        type: "text",
        text: { body: GREETING_REPLY },
      },
    });

    // …and the sender is called with the same text for the same recipient.
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender).toHaveBeenCalledWith({
      to: E164,
      type: "text",
      text: GREETING_REPLY,
    });

    // The ack is written back: sent + Meta's id, error cleared.
    const messageOps = db.calls.filter((call) => call.table === "wa_messages");
    const outcomeIndex = messageOps.findIndex((call) => call.op === "update");
    expect(outcomeIndex).toBeGreaterThan(-1);
    expect(messageOps[outcomeIndex].args[0]).toEqual({
      status: "sent",
      provider_message_id: "wamid.OUT.9",
      error: null,
    });
    expect(messageOps[outcomeIndex + 1]).toMatchObject({
      op: "eq",
      args: ["id", "msg-out-1"],
    });
  });

  it("keeps the webhook alive without credentials: not_configured is data", async () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const db = createFakeSupabase();
    scriptInboundPass(db);

    // No `sender` option → the real sender runs and finds no credentials.
    const result = await processInboundMeta(inboundPayload("wamid.IN.2"), {
      supabase: db.client,
    });

    expect(result.accepted).toBe(1);
    expect(result.replies).toEqual([GREETING_REPLY]);

    const outcome = db.calls.find(
      (call) => call.table === "wa_messages" && call.op === "update",
    );
    expect(outcome?.args[0]).toEqual({
      status: "failed",
      error: "not_configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts a Meta retry as a duplicate and stores nothing twice", async () => {
    const db = createFakeSupabase();
    scriptInboundPass(db);
    const sender = vi.fn(async () => ({ ok: true, messageId: "wamid.OUT.R" } as const));
    const payload = inboundPayload("wamid.IN.RETRY");

    await processInboundMeta(payload, { sender, supabase: db.client });
    const insertsAfterFirst = db.calls.filter(
      (call) => call.table === "wa_messages" && call.op === "insert",
    ).length;

    // The claim gate answers the unique violation on the second delivery.
    db.answer("wa_webhook_events", "insert", {
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    });
    const retry = await processInboundMeta(payload, { supabase: db.client });

    expect(retry).toMatchObject({ accepted: 0, duplicates: 1, replies: [] });
    expect(
      db.calls.filter((call) => call.table === "wa_messages" && call.op === "insert"),
    ).toHaveLength(insertsAfterFirst);
  });
});

describe("deliverOutbound — window gate and outcome", () => {
  const inside = { last_inbound_at: new Date().toISOString() };
  const outside = {
    last_inbound_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
  };

  it("sends inside the window and records Meta's id on the row", async () => {
    const db = createFakeSupabase();
    db.answer("wa_messages", "update", { data: null, error: null });
    const sender = vi.fn(async () => ({ ok: true, messageId: "wamid.OUT.1" } as const));

    const outcome = await deliverOutbound(
      { id: "msg-1", to: E164, body: "Hola" },
      inside,
      { sender, supabase: db.client },
    );

    expect(outcome).toEqual({ sent: true, messageId: "wamid.OUT.1" });
    expect(sender).toHaveBeenCalledWith({ to: E164, type: "text", text: "Hola" });
    expect(
      db.calls.find((call) => call.table === "wa_messages" && call.op === "update")
        ?.args[0],
    ).toEqual({
      status: "sent",
      provider_message_id: "wamid.OUT.1",
      error: null,
    });
  });

  it("never calls the sender outside the window — the row says why", async () => {
    const db = createFakeSupabase();
    db.answer("wa_messages", "update", { data: null, error: null });
    const sender = vi.fn(async () => ({ ok: true, messageId: "wamid.NOPE" } as const));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const outcome = await deliverOutbound(
      { id: "msg-2", to: E164, body: "Hola" },
      outside,
      { sender, supabase: db.client },
    );

    expect(outcome).toEqual({ sent: false, reason: "outside_window" });
    expect(sender).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      db.calls.find((call) => call.table === "wa_messages" && call.op === "update")
        ?.args[0],
    ).toEqual({ status: "failed", error: "outside_window" });
  });

  it("turns a Graph rejection into status + error on the row", async () => {
    const db = createFakeSupabase();
    db.answer("wa_messages", "update", { data: null, error: null });
    const sender = vi.fn(async () => ({
      ok: false as const,
      reason: "rate_limited" as const,
      detail: "HTTP 429",
    }));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const outcome = await deliverOutbound(
      { id: "msg-3", to: E164, body: "Hola" },
      inside,
      { sender, supabase: db.client },
    );

    expect(outcome).toEqual({ sent: false, reason: "rate_limited" });
    expect(
      db.calls.find((call) => call.table === "wa_messages" && call.op === "update")
        ?.args[0],
    ).toEqual({ status: "failed", error: "rate_limited" });
  });

  it("never throws — a sender that blows up still resolves", async () => {
    const db = createFakeSupabase();
    db.answer("wa_messages", "update", { data: null, error: null });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sender = vi.fn(async () => {
      throw new Error("sender exploded");
    });

    await expect(
      deliverOutbound({ id: "msg-4", to: E164, body: "Hola" }, inside, {
        sender,
        supabase: db.client,
      }),
    ).resolves.toEqual({ sent: false, reason: "api_error" });
  });

  it("never throws when the status write itself fails", async () => {
    const db = createFakeSupabase();
    db.answer("wa_messages", "update", {
      data: null,
      error: { message: "permission denied" },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      deliverOutbound({ id: "msg-5", to: E164, body: "Hola" }, inside, {
        sender: vi.fn(async () => ({
          ok: true as const,
          messageId: "wamid.X",
        })),
        supabase: db.client,
      }),
    ).resolves.toEqual({ sent: true, messageId: "wamid.X" });
  });
});

/* ------------------------------------------------------------ statuses ---- */

function statusPayload(
  statuses: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [{ field: "messages", value: { statuses } }],
      },
    ],
  };
}

describe("parseStatusUpdates", () => {
  it("reads the four delivery states Meta reports", () => {
    const parsed = parseStatusUpdates(
      statusPayload([
        { id: "wamid.OUT.1", status: "delivered", timestamp: "1763000000", recipient_id: WA_ID },
        { id: "wamid.OUT.1", status: "read", timestamp: "1763000005" },
      ]),
    );

    expect(parsed).toEqual([
      {
        eventKey: "wamid.OUT.1:delivered",
        messageId: "wamid.OUT.1",
        status: "delivered",
        timestamp: "1763000000",
        recipientId: WA_ID,
        errorCode: undefined,
        errorDetail: undefined,
      },
      {
        eventKey: "wamid.OUT.1:read",
        messageId: "wamid.OUT.1",
        status: "read",
        timestamp: "1763000005",
        recipientId: undefined,
        errorCode: undefined,
        errorDetail: undefined,
      },
    ]);
  });

  it("keeps the first error code of a failed status", () => {
    const [failed] = parseStatusUpdates(
      statusPayload([
        {
          id: "wamid.OUT.2",
          status: "failed",
          timestamp: "1763000009",
          errors: [
            { code: 131026, title: "Message undeliverable", error_data: { details: "not on WhatsApp" } },
          ],
        },
      ]),
    );

    expect(failed).toMatchObject({
      messageId: "wamid.OUT.2",
      status: "failed",
      errorCode: 131026,
      errorDetail: "not on WhatsApp",
    });
  });

  it("ignores unknown states, ids and non-status payloads", () => {
    expect(parseStatusUpdates(statusPayload([{ id: "wamid.X", status: "pending" }]))).toEqual([]);
    expect(parseStatusUpdates(statusPayload([{ status: "read" }]))).toEqual([]);
    expect(parseStatusUpdates(inboundPayload("wamid.IN.1"))).toEqual([]);
    expect(parseStatusUpdates(null)).toEqual([]);
    expect(parseStatusUpdates({})).toEqual([]);
  });
});

describe("processStatusUpdatesMeta — mocked Supabase", () => {
  it("moves the matching row to delivered and is idempotent", async () => {
    const db = createFakeSupabase();
    db.answer("wa_webhook_events", "insert", { data: null, error: null });
    db.answer("wa_messages", "update", { data: null, error: null });
    db.answer("wa_webhook_events", "update", { data: null, error: null });

    const payload = statusPayload([
      { id: "wamid.OUT.7", status: "delivered", timestamp: "1763000001" },
    ]);

    const first = await processStatusUpdatesMeta(payload, { supabase: db.client });
    expect(first).toEqual({ applied: 1, duplicates: 0 });

    const update = db.calls.find(
      (call) => call.table === "wa_messages" && call.op === "update",
    );
    expect(update?.args[0]).toEqual({ status: "delivered" });
    // Matched on provider + direction + the id the Graph ack stored.
    const matches = db.calls.filter(
      (call) => call.table === "wa_messages" && call.op === "eq",
    );
    expect(matches.map((call) => call.args)).toEqual([
      ["provider", "whatsapp_cloud_api"],
      ["direction", "out"],
      ["provider_message_id", "wamid.OUT.7"],
    ]);
    // Claimed, then marked processed — Meta can stop retrying.
    expect(
      db.calls
        .filter((call) => call.table === "wa_webhook_events")
        .map((call) => call.op),
    ).toEqual(["from", "insert", "from", "update", "eq"]);

    // Meta re-delivers the same status → counted no-op, no second write.
    db.answer("wa_webhook_events", "insert", {
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    });
    const writesSoFar = db.calls.filter(
      (call) => call.table === "wa_messages" && call.op === "update",
    ).length;
    const retry = await processStatusUpdatesMeta(payload, { supabase: db.client });

    expect(retry).toEqual({ applied: 0, duplicates: 1 });
    expect(
      db.calls.filter((call) => call.table === "wa_messages" && call.op === "update"),
    ).toHaveLength(writesSoFar);
  });

  it("stores Meta's failure as the same typed reason vocabulary", async () => {
    const db = createFakeSupabase();
    db.answer("wa_webhook_events", "insert", { data: null, error: null });
    db.answer("wa_messages", "update", { data: null, error: null });
    db.answer("wa_webhook_events", "update", { data: null, error: null });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await processStatusUpdatesMeta(
      statusPayload([
        {
          id: "wamid.OUT.8",
          status: "failed",
          timestamp: "1763000002",
          errors: [{ code: 131047, title: "Re-engagement message" }],
        },
      ]),
      { supabase: db.client },
    );

    expect(
      db.calls.find((call) => call.table === "wa_messages" && call.op === "update")
        ?.args[0],
    ).toEqual({ status: "failed", error: "outside_window" });
  });

  it("answers {0,0} for a payload without statuses and touches nothing", async () => {
    const db = createFakeSupabase();

    await expect(
      processStatusUpdatesMeta(inboundPayload("wamid.IN.3"), { supabase: db.client }),
    ).resolves.toEqual({ applied: 0, duplicates: 0 });
    await expect(
      processStatusUpdatesMeta(null, { supabase: db.client }),
    ).resolves.toEqual({ applied: 0, duplicates: 0 });

    expect(db.calls).toHaveLength(0);
  });
});
