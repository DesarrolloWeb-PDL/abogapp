import { test, expect } from "@playwright/test";
import {
  envLocal,
  guardPage,
  hubSignature,
  metaMessagePayload,
  optionalEnv,
  restGet,
} from "./helpers";

/**
 * WA06 — LLM fallback, non-configured path (WhatsApp Unit 3).
 *
 *  The unit is env-gated on purpose: with AI_API_KEY ABSENT in .env.local
 *  (the state of this dev project) an unknown-intent message must get the
 *  rule engine's default acknowledgement — the byte-identical reply the bot
 *  sent before the fallback existed — and no LLM-flavoured answer (no
 *  WA-020 disclaimer) may appear. One signed webhook, assertion on the
 *  stored row AND on the inbox thread (A01). The spec skips itself with a
 *  printed reason once the user adds AI_API_KEY, because from then on the
 *  rule-fallback answer is no longer the expected one.
 */

const APP_SECRET = envLocal("WHATSAPP_APP_SECRET");

/** Fresh thread for this spec — never shared with the other WA phones. */
const PHONE_D = "5491155550906";
const E164_D = `+${PHONE_D}`;

/** Byte-identical to DEFAULT_REPLY in lib/data/bot.ts. */
const RULE_FALLBACK =
  "Recibí tu mensaje. Alguien del estudio se va a comunicar con vos a la brevedad.";

/** No greeting keyword, no STOP — the "no rule matched" case by definition. */
const UNKNOWN_INTENT = "¿Cuánto cuesta redactar un contrato de alquiler comercial?";

interface ConversationRow {
  id: string;
  status: string;
  last_message_preview: string;
  wa_contacts: { phone_e164: string; display_name: string } | null;
}

async function findOwnConversation(): Promise<ConversationRow | null> {
  const rows = await restGet<ConversationRow[]>(
    "wa_conversations?select=id,status,last_message_preview,wa_contacts(phone_e164,display_name)",
  );
  return rows.find((row) => row.wa_contacts?.phone_e164 === E164_D) ?? null;
}

test.describe("WA06 LLM fallback (env-gated)", () => {
  test("WA06-H1 unknown intent without AI_API_KEY → the rule fallback, end to end", async ({
    request,
    page,
  }) => {
    const aiKey = optionalEnv("AI_API_KEY");
    test.skip(
      Boolean(aiKey),
      "AI_API_KEY is set in .env.local — the non-configured path cannot be observed (Unit 3 doc: replica/whatsapp-bot.md §9)",
    );

    const guard = guardPage(page);
    const stamp = Date.now();
    const payload = metaMessagePayload({
      id: `wamid.e2e.llmfb.${stamp}`,
      from: PHONE_D,
      text: UNKNOWN_INTENT,
      profileName: "E2E LLM Fallback",
    });

    // Signed webhook exactly like Meta: the reply is decided server-side.
    const response = await request.post("/api/webhooks/whatsapp", {
      data: payload,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": hubSignature(payload, APP_SECRET),
      },
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).accepted).toBe(1);

    // Stored row: the default RULE reply, not an LLM answer.
    const conversation = await findOwnConversation();
    expect(conversation, "webhook created the conversation").not.toBeNull();
    expect(conversation!.status).toBe("bot");
    expect(conversation!.last_message_preview).toBe(RULE_FALLBACK);
    // The model's answers always carry WA-020 (appended client-side), so
    // its absence proves the fallback never ran.
    expect(conversation!.last_message_preview).not.toContain(
      "asesoramiento legal",
    );

    // Inbox thread (A01 list row) renders the same rule line.
    await page.goto("/bandeja");
    const row = page.getByRole("listitem").filter({ hasText: E164_D });
    await expect(row).toHaveCount(1);
    await expect(row.getByText(RULE_FALLBACK)).toBeVisible();

    await guard.assertClean();
  });
});
