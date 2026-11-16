import { test, expect } from "@playwright/test";
import {
  BASE_URL,
  envLocal,
  guardPage,
  hubSignature,
  metaMessagePayload,
  restGet,
} from "./helpers";

/**
 * WA01/WA03 — WhatsApp webhook API + bot rules, driven through Playwright's
 * request context against OUR local dev server only (never Meta, never the
 * original product). Signature = HMAC-SHA256 of the raw body with
 * WHATSAPP_APP_SECRET, exactly as Meta signs it.
 */

const VERIFY_TOKEN = envLocal("WHATSAPP_VERIFY_TOKEN");
const APP_SECRET = envLocal("WHATSAPP_APP_SECRET");

const PHONE_A = "5491155550901"; // greeting thread
const PHONE_B = "5491155550902"; // STOP thread
const E164_A = `+${PHONE_A}`;
const E164_B = `+${PHONE_B}`;

const GREETING_REPLY = "¡Hola! Soy el asistente del estudio. ¿En qué te puedo ayudar?";

interface ConversationRow {
  id: string;
  status: string;
  last_message_preview: string;
  wa_contacts: { phone_e164: string; display_name: string } | null;
}

async function findConversation(e164: string): Promise<ConversationRow | null> {
  const rows = await restGet<ConversationRow[]>(
    "wa_conversations?select=id,status,last_message_preview,wa_contacts(phone_e164,display_name)",
  );
  return rows.find((row) => row.wa_contacts?.phone_e164 === e164) ?? null;
}

async function outboundCount(conversationId: string): Promise<number> {
  const rows = await restGet<unknown[]>(
    `wa_messages?select=id&conversation_id=eq.${conversationId}&direction=eq.out`,
  );
  return rows.length;
}

function signedHeaders(body: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-hub-signature-256": hubSignature(body, APP_SECRET),
  };
}

test.describe("WA01 webhook API", () => {
  test("WA01-H1 handshake echoes the challenge; wrong token → 403 (N2)", async ({
    request,
  }) => {
    const challenge = `challenge-${Date.now()}`;
    const ok = await request.get(
      `/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=${challenge}`,
    );
    expect(ok.status()).toBe(200);
    expect(ok.headers()["content-type"]).toContain("text/plain");
    expect(await ok.text()).toBe(challenge);

    const forbidden = await request.get(
      `/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=token-incorrecto&hub.challenge=${challenge}`,
    );
    expect(forbidden.status()).toBe(403);
    expect(await forbidden.text()).toBe("Forbidden");
  });

  test("WA01-H2/H3/E1/E2/N1 signed POST lifecycle", async ({ request }) => {
    const stamp = Date.now();

    // H2: fresh signed delivery → accepted exactly once.
    const greeting = metaMessagePayload({
      id: `wamid.e2e.greet.${stamp}`,
      from: PHONE_A,
      text: "Hola, ¿me pueden ayudar?",
      profileName: "E2E Cliente",
    });
    const first = await request.post("/api/webhooks/whatsapp", {
      data: greeting,
      headers: signedHeaders(greeting),
    });
    expect(first.status()).toBe(200);
    expect(await first.json()).toEqual({
      received: true,
      accepted: 1,
      duplicates: 0,
    });

    // H3/E5: Meta retries the same delivery → counted duplicate, not restored.
    const retry = await request.post("/api/webhooks/whatsapp", {
      data: greeting,
      headers: signedHeaders(greeting),
    });
    expect(retry.status()).toBe(200);
    expect(await retry.json()).toEqual({
      received: true,
      accepted: 0,
      duplicates: 1,
    });

    // E3: accents + emoji survive storage intact.
    const emoji = metaMessagePayload({
      id: `wamid.e2e.emoji.${stamp}`,
      from: PHONE_A,
      text: "Buenos días 🚀 — ¿me ayudan con un contrato?",
    });
    const emojiResponse = await request.post("/api/webhooks/whatsapp", {
      data: emoji,
      headers: signedHeaders(emoji),
    });
    expect(emojiResponse.status()).toBe(200);
    expect((await emojiResponse.json()).accepted).toBe(1);
    const stored = await restGet<{ body: string }[]>(
      `wa_messages?select=body&provider_message_id=eq.${encodeURIComponent(`wamid.e2e.emoji.${stamp}`)}`,
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].body).toBe("Buenos días 🚀 — ¿me ayudan con un contrato?");

    // N1: bad signature → 401, nothing accepted.
    const forged = await request.post("/api/webhooks/whatsapp", {
      data: greeting,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      },
    });
    expect(forged.status()).toBe(401);
    expect(await forged.json()).toEqual({ error: "invalid_signature" });

    // E1: payload without messages → accepted 0, still a 200 ack.
    const empty = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const emptyResponse = await request.post("/api/webhooks/whatsapp", {
      data: empty,
      headers: signedHeaders(empty),
    });
    expect(emptyResponse.status()).toBe(200);
    expect(await emptyResponse.json()).toEqual({
      received: true,
      accepted: 0,
      duplicates: 0,
    });

    // E2: 1 MB signed body with valid structure → no 5xx.
    const huge = JSON.stringify({ entry: [], pad: "x".repeat(1_000_000) });
    const hugeResponse = await request.post("/api/webhooks/whatsapp", {
      data: huge,
      headers: signedHeaders(huge),
    });
    expect(hugeResponse.status()).toBe(200);
    expect((await hugeResponse.json()).accepted).toBe(0);
  });

  test("WA01-H4/H5 conversations route: 401 without session, 200 with it", async ({
    request,
    playwright,
  }) => {
    // H4 (backend.md security item 1): no session → 401. The context is
    // created with an EXPLICITLY empty storageState so it can never inherit
    // the project's saved session.
    const anon = await playwright.request.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
    });
    const unauthorized = await anon.get("/api/wa/conversations");
    expect(unauthorized.status()).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "unauthorized" });
    await anon.dispose();

    // H5: the demo session reads its study's conversations (RLS), including
    // the webhook thread written by the previous test. The ROUTE response is
    // the mapped WaConversation shape (`phone`), not the raw REST embed.
    const authed = await request.get("/api/wa/conversations");
    expect(authed.status()).toBe(200);
    const payload = (await authed.json()) as {
      conversations: Array<{ phone: string; status: string }>;
    };
    expect(Array.isArray(payload.conversations)).toBe(true);
    expect(payload.conversations.length).toBeGreaterThanOrEqual(2);
    expect(
      payload.conversations.some((row) => row.phone === E164_A),
      "webhook-written conversation visible under RLS",
    ).toBe(true);
  });
});

test.describe("WA03 bot rules", () => {
  test("WA03-H1 greeting gets the greeting reply, shown in the inbox", async ({
    request,
    page,
  }) => {
    const guard = guardPage(page);
    const stamp = Date.now();
    const payload = metaMessagePayload({
      id: `wamid.e2e.ui.${stamp}`,
      from: PHONE_A,
      text: "Hola, ¿me pueden ayudar?",
      profileName: "E2E Cliente",
    });
    const response = await request.post("/api/webhooks/whatsapp", {
      data: payload,
      headers: signedHeaders(payload),
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).accepted).toBe(1);

    const conversation = await findConversation(E164_A);
    expect(conversation, "contact + conversation created from scratch (N3)").not.toBeNull();
    expect(conversation!.status).toBe("bot");
    expect(conversation!.last_message_preview).toBe(GREETING_REPLY);

    // The UI shows the same bot line as the row snippet of THIS thread
    // (the seeded "Maria Perez" row carries the same greeting text).
    await page.goto("/bandeja");
    const row = page.getByRole("listitem").filter({ hasText: E164_A });
    await expect(row).toHaveCount(1);
    await expect(row.getByText(GREETING_REPLY)).toBeVisible();
    await expect(page.getByText(E164_A)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Bot \(\d+\)$/ }),
    ).toBeVisible();
    await guard.assertClean();
  });

  test("WA03-H2/N1 STOP closes silently; later messages get no reply", async ({
    request,
  }) => {
    const stamp = Date.now();

    const stop = metaMessagePayload({
      id: `wamid.e2e.stop.${stamp}`,
      from: PHONE_B,
      text: "STOP",
    });
    const stopResponse = await request.post("/api/webhooks/whatsapp", {
      data: stop,
      headers: signedHeaders(stop),
    });
    expect(stopResponse.status()).toBe(200);
    expect(await stopResponse.json()).toEqual({
      received: true,
      accepted: 1,
      duplicates: 0,
    });

    const conversation = await findConversation(E164_B);
    expect(conversation).not.toBeNull();
    expect(conversation!.status, "STOP closes the conversation").toBe("cerrada");
    const outboundBefore = await outboundCount(conversation!.id);

    // N1: a stopped conversation keeps storing messages but stays silent.
    const followUp = metaMessagePayload({
      id: `wamid.e2e.after-stop.${stamp}`,
      from: PHONE_B,
      text: "hola de nuevo",
    });
    const followResponse = await request.post("/api/webhooks/whatsapp", {
      data: followUp,
      headers: signedHeaders(followUp),
    });
    expect(followResponse.status()).toBe(200);
    expect((await followResponse.json()).accepted).toBe(1);

    const stillClosed = await findConversation(E164_B);
    expect(stillClosed!.status).toBe("cerrada");
    expect(
      await outboundCount(stillClosed!.id),
      "no bot reply is sent to a closed conversation",
    ).toBe(outboundBefore);
  });
});
