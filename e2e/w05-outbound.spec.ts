import { test, expect, type Route } from "@playwright/test";
import {
  envLocal,
  guardPage,
  hubSignature,
  metaMessagePayload,
  optionalEnv,
  restGet,
  restSend,
} from "./helpers";

/**
 * WA05 — outbound delivery (WhatsApp Unit 2): the Graph send, the 24 h
 * window and Meta's `statuses` webhook, driven against OUR local dev server
 * only — never Meta. No live Graph call is possible today: `.env.local`
 * carries no WHATSAPP_ACCESS_TOKEN, so the sender answers `not_configured`
 * before any network I/O, which is exactly the state H1 pins down.
 *
 * Why the payload is asserted on the stored row instead of through
 * `page.route`: the Graph POST runs INSIDE the Next.js server process (the
 * webhook route handler), and Playwright only intercepts requests issued by
 * the browser context. The stored row carries the byte-identical body —
 * sender and row share one `buildTextMessageRequest()` — so asserting it IS
 * asserting the request the bot tried to send. A route for
 * graph.facebook.com is registered anyway as a safety net: it answers with
 * a canned Graph ack and must stay at zero attempts.
 *
 * The 24 h gate itself is unit-tested (lib/supabase/wa-graph.test.ts): the
 * bot's reply is always inside the window, because every inbound delivery
 * stamps `last_inbound_at` first — only a human/late reply can be outside,
 * and there is no reply route in M1.
 */

const APP_SECRET = envLocal("WHATSAPP_APP_SECRET");

/** Fresh threads for this spec — never shared with w01's or WA04's phones. */
const PHONE_OUT = "5491155550911";
const PHONE_STATUS = "5491155550912";
const E164_OUT = `+${PHONE_OUT}`;
const E164_STATUS = `+${PHONE_STATUS}`;

const GRAPH_ROUTE = /graph\.facebook\.com/;

interface ConversationRow {
  id: string;
  study_id: string;
  status: string;
  last_message_preview: string;
  wa_contacts: { phone_e164: string } | null;
}

interface MessageRow {
  id: string;
  direction: string;
  status: string;
  error: string | null;
  provider_message_id: string | null;
  body: string;
  payload: Record<string, unknown>;
}

function signedHeaders(body: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-hub-signature-256": hubSignature(body, APP_SECRET),
  };
}

async function findConversation(e164: string): Promise<ConversationRow | null> {
  const rows = await restGet<ConversationRow[]>(
    "wa_conversations?select=id,study_id,status,last_message_preview,wa_contacts(phone_e164)&order=updated_at.desc",
  );
  return rows.find((row) => row.wa_contacts?.phone_e164 === e164) ?? null;
}

async function outboundMessages(conversationId: string): Promise<MessageRow[]> {
  return restGet<MessageRow[]>(
    `wa_messages?select=id,direction,status,error,provider_message_id,body,payload` +
      `&conversation_id=eq.${conversationId}&direction=eq.out&order=created_at.desc`,
  );
}

/** Meta's `statuses` delivery for one outbound message id. */
function statusPayload(options: {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  errors?: Array<{ code: number; title: string }>;
}): string {
  const status: Record<string, unknown> = {
    id: options.id,
    status: options.status,
    timestamp: "1763000000",
    recipient_id: PHONE_STATUS,
  };
  if (options.errors) status.errors = options.errors;

  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1000000000000000",
        changes: [
          {
            field: "messages",
            value: { messaging_product: "whatsapp", statuses: [status] },
          },
        ],
      },
    ],
  });
}

test.describe("WA05 outbound delivery", () => {
  test("WA05-H1 no token: the reply is stored with the Graph payload, Meta is never called", async ({
    page,
    request,
  }) => {
    // With a real token in .env.local this spec would have to talk to Meta;
    // the inbox-only assertions below describe the state without one.
    test.skip(
      optionalEnv("WHATSAPP_ACCESS_TOKEN") !== null,
      "WHATSAPP_ACCESS_TOKEN is set — H1 asserts the inbox-only (not_configured) path",
    );

    const guard = guardPage(page);
    const graphAttempts: string[] = [];
    // Safety net + canned ack: a browser-side call to Meta would be caught
    // here and reported by the zero-attempts assertion below.
    await page.route(GRAPH_ROUTE, async (route: Route) => {
      graphAttempts.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ messages: [{ id: "wamid.CANNED.ACK" }] }),
      });
    });

    const stamp = Date.now();
    const payload = metaMessagePayload({
      id: `wamid.e2e.out.${stamp}`,
      from: PHONE_OUT,
      text: "Hola, ¿me ayudan con una consulta?",
      profileName: "E2E Outbound",
    });
    const response = await request.post("/api/webhooks/whatsapp", {
      data: payload,
      headers: signedHeaders(payload),
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).accepted).toBe(1);

    const conversation = await findConversation(E164_OUT);
    expect(conversation, "the webhook created the conversation").not.toBeNull();

    const messages = await outboundMessages(conversation!.id);
    expect(messages.length, "the bot's reply is stored").toBeGreaterThan(0);
    const reply = messages[0];

    // The reply is NOT claimed as delivered: no credentials → not_configured.
    expect(reply.status).toBe("failed");
    expect(reply.error).toBe("not_configured");
    expect(reply.provider_message_id).toBeNull();

    // The recorded payload IS the body the sender would POST (same builder):
    // recipient as the bare wa_id (no `+`), type text, same body text.
    expect(reply.payload).toEqual({
      messaging_product: "whatsapp",
      to: PHONE_OUT,
      type: "text",
      text: { body: reply.body },
    });
    expect(reply.body.length).toBeGreaterThan(0);
    expect(conversation!.last_message_preview).toBe(reply.body);
    expect(conversation!.status).toBe("bot");

    // Inbox-only mode: nothing ever left the machine for Meta.
    expect(graphAttempts, "no Graph call while unconfigured").toEqual([]);

    // …and the inbox still renders the thread with that reply.
    await page.goto("/bandeja");
    const row = page.getByRole("listitem").filter({ hasText: E164_OUT });
    await expect(row).toHaveCount(1);
    await expect(row.getByText(reply.body)).toBeVisible();

    await guard.assertClean();
  });

  test("WA05-H2 Meta's statuses webhook moves the outbound row (delivered / failed), idempotently", async ({
    request,
  }) => {
    const stamp = Date.now();

    // A thread to hang the seeded outbound row on.
    const inbound = metaMessagePayload({
      id: `wamid.e2e.status.${stamp}`,
      from: PHONE_STATUS,
      text: "Consulta para verificar el estado",
    });
    const created = await request.post("/api/webhooks/whatsapp", {
      data: inbound,
      headers: signedHeaders(inbound),
    });
    expect(created.status()).toBe(200);
    expect((await created.json()).accepted).toBe(1);

    const conversation = await findConversation(E164_STATUS);
    expect(conversation, "the webhook created the conversation").not.toBeNull();

    // Stand-in for the Graph ack: a sent row carrying Meta's message id.
    const deliveredId = `wamid.e2e.ack.delivered.${stamp}`;
    const failedId = `wamid.e2e.ack.failed.${stamp}`;
    const seedRow = (providerId: string) => ({
      study_id: conversation!.study_id,
      conversation_id: conversation!.id,
      direction: "out",
      provider: "whatsapp_cloud_api",
      provider_message_id: providerId,
      message_type: "text",
      body: `Estado ${providerId}`,
      status: "sent",
    });

    const [deliveredRow] = await restSend<{ id: string }[]>(
      "POST",
      "wa_messages",
      seedRow(deliveredId),
    );
    const [failedRow] = await restSend<{ id: string }[]>(
      "POST",
      "wa_messages",
      seedRow(failedId),
    );
    expect(deliveredRow?.id, "seeded outbound row").toBeTruthy();
    expect(failedRow?.id, "seeded outbound row").toBeTruthy();

    try {
      // 1. delivered → the row follows Meta's state.
      const deliveredBody = statusPayload({
        id: deliveredId,
        status: "delivered",
      });
      const delivered = await request.post("/api/webhooks/whatsapp", {
        data: deliveredBody,
        headers: signedHeaders(deliveredBody),
      });
      expect(delivered.status()).toBe(200);
      expect(await delivered.json()).toEqual({
        received: true,
        accepted: 1,
        duplicates: 0,
      });

      const [afterDelivered] = await restGet<MessageRow[]>(
        `wa_messages?select=id,status,error&id=eq.${deliveredRow!.id}`,
      );
      expect(afterDelivered?.status).toBe("delivered");

      // 2. Meta re-delivers the same status → counted no-op, no rewrite.
      const retry = await request.post("/api/webhooks/whatsapp", {
        data: deliveredBody,
        headers: signedHeaders(deliveredBody),
      });
      expect(retry.status()).toBe(200);
      expect(await retry.json()).toEqual({
        received: true,
        accepted: 0,
        duplicates: 1,
      });

      // 3. failed + Meta's error code → status failed with the typed reason
      //    the inbox chip copy is driven by (131026 = undeliverable number).
      const failedBody = statusPayload({
        id: failedId,
        status: "failed",
        errors: [{ code: 131026, title: "Message undeliverable" }],
      });
      const failed = await request.post("/api/webhooks/whatsapp", {
        data: failedBody,
        headers: signedHeaders(failedBody),
      });
      expect(failed.status()).toBe(200);
      expect((await failed.json()).accepted).toBe(1);

      const [afterFailed] = await restGet<MessageRow[]>(
        `wa_messages?select=id,status,error&id=eq.${failedRow!.id}`,
      );
      expect(afterFailed?.status).toBe("failed");
      expect(afterFailed?.error).toBe("invalid_recipient");

      // The inbound half of the same conversation is untouched: a status
      // payload carries no messages, so nothing new was stored.
      const messages = await outboundMessages(conversation!.id);
      expect(
        messages.filter((row) => row.id === deliveredRow!.id),
      ).toHaveLength(1);
      expect(messages.filter((row) => row.id === failedRow!.id)).toHaveLength(1);
    } finally {
      // Clean up: every other spec must not see these rows.
      await restSend("DELETE", `wa_messages?id=eq.${deliveredRow!.id}`);
      await restSend("DELETE", `wa_messages?id=eq.${failedRow!.id}`);
    }
  });
});
