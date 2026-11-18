import { test, expect } from "@playwright/test";
import {
  envLocal,
  expectNoAxeViolations,
  guardPage,
  hubSignature,
  metaMessagePayload,
  restGet,
  restPatch,
} from "./helpers";

/**
 * WA04 — bot settings admin (/configuracion/bot, WhatsApp Unit 1).
 *
 *  H1 always runs: the sidebar entry lands on the screen, which renders its
 *    ready form when the settings row exists — or its error + Reintentar
 *    state when the database still lacks the table (the 404 console line is
 *    tolerated only in that pre-migration case).
 *  H2 runs the full loop and SKIPS with a printed reason until migration
 *    20261117120000_bot_settings.sql has been applied in the Supabase SQL
 *    Editor: change the greeting through the UI, save it (success toast),
 *    fire a signed webhook (HMAC with WHATSAPP_APP_SECRET, exactly like
 *    Meta) and assert the NEW greeting is what the bot answers — in the
 *    stored row AND in the inbox thread (A01). Cleanup restores the seeded
 *    defaults in `finally` so every other spec keeps the baseline copy.
 */

const APP_SECRET = envLocal("WHATSAPP_APP_SECRET");

/** Fresh thread for this spec — never shared with w01's phones. */
const PHONE_C = "5491155550999";
const E164_C = `+${PHONE_C}`;

/** Byte-identical to the migration's column defaults (cleanup restores them). */
const DEFAULT_GREETING =
  "¡Hola! Soy el asistente del estudio. ¿En qué te puedo ayudar?";
const DEFAULT_OFF_HOURS =
  "Estamos fuera de horario: de lunes a viernes de 9 a 18 respondemos las consultas de una persona. El asistente sigue tomando tus datos a cualquier hora y el próximo día hábil te respondemos.";
const DEFAULT_HANDOFF =
  "Te paso con una persona del estudio. En horario hábil te responden el mismo día; si es fuera de horario, el próximo día hábil.";

const NEW_GREETING = "Saludo personalizado desde la configuración (e2e).";

const MIGRATION_HINT =
  "bot_settings table missing — apply supabase/migrations/20261117120000_bot_settings.sql in the Supabase SQL Editor, then re-run";

interface SettingsRow {
  study_id: string;
  enabled: boolean;
  greeting: string;
  off_hours: string;
  handoff: string;
}

interface ConversationRow {
  id: string;
  status: string;
  last_message_preview: string;
  wa_contacts: { phone_e164: string; display_name: string } | null;
}

/** True when the settings table exists; the read itself tells us (404 = not). */
async function probeTable(): Promise<{ exists: boolean; rows: SettingsRow[] }> {
  try {
    const rows = await restGet<SettingsRow[]>(
      "bot_settings?select=study_id,enabled,greeting,off_hours,handoff",
    );
    return { exists: true, rows };
  } catch {
    return { exists: false, rows: [] };
  }
}

async function findOwnConversation(): Promise<ConversationRow | null> {
  const rows = await restGet<ConversationRow[]>(
    "wa_conversations?select=id,status,last_message_preview,wa_contacts(phone_e164,display_name)",
  );
  return (
    rows.find((row) => row.wa_contacts?.phone_e164 === E164_C) ?? null
  );
}

test.describe("WA04 bot settings admin", () => {
  test("WA04-H1 sidebar entry renders the admin screen (ready or error state)", async ({
    page,
  }) => {
    const probe = await probeTable();
    // A missing table makes the screen's first read answer 404, which Chrome
    // logs at the network layer — tolerated ONLY until the migration runs.
    const guard = guardPage(
      page,
      probe.exists
        ? {}
        : { ignoreConsole: (text) => text.includes("Failed to load resource") },
    );

    // chromium project: already signed in through the project storageState
    // (auth.setup.ts) — no login() here (auth pages redirect signed-in
    // users, so the login form never renders).
    await page.goto("/expedientes");
    await expect(
      page.getByRole("heading", { name: "Expedientes", exact: true }),
    ).toBeVisible();

    await page.getByRole("link", { name: "Configuración" }).click();
    await page.waitForURL("**/configuracion/bot");
    await expect(
      page.getByRole("heading", { name: "Configuración del bot" }),
    ).toBeVisible();

    if (probe.exists) {
      // Ready state: the form is prefilled with the study's stored greeting.
      await expect(page.getByLabel("Saludo")).toHaveValue(
        probe.rows[0]?.greeting ?? DEFAULT_GREETING,
      );
      await expect(
        page.getByRole("button", { name: "Guardar cambios" }),
      ).toBeVisible();
    } else {
      // No table yet: the screen must degrade to error + Reintentar, never
      // a crash or a silently blank form.
      await expect(
        page.getByRole("alert").filter({ hasText: "No pudimos cargar la configuración del bot." }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
    }

    await expectNoAxeViolations(page, "/configuracion/bot");
    await guard.assertClean();
  });

  test("WA04-H2 change the greeting → webhook answers with it → inbox shows it", async ({
    page,
    request,
  }) => {
    const probe = await probeTable();
    test.skip(!probe.exists, MIGRATION_HINT);

    let studyId = probe.rows[0]?.study_id;
    if (!studyId) {
      const studies = await restGet<{ id: string }[]>("studies?select=id");
      studyId = studies[0]?.id;
      test.skip(!studyId, "no study visible under the demo session (RLS)");
    }
    const targetStudy = studyId as string;

    const guard = guardPage(page);
    try {
      // 1. Open the screen (the chromium storageState is already signed in;
      //    the sidebar entry itself is covered in H1).
      await page.goto("/configuracion/bot");
      await expect(
        page.getByRole("heading", { name: "Configuración del bot" }),
      ).toBeVisible();

      // 2. Keyboard-only edit of the greeting (native control, no mouse).
      const greetingField = page.getByLabel("Saludo");
      await expect(greetingField).toHaveValue(
        probe.rows[0]?.greeting ?? DEFAULT_GREETING,
      );
      await greetingField.focus();
      await page.keyboard.press("Control+A");
      await page.keyboard.type(NEW_GREETING);

      // 3. Save → success toast (role=status) + the row really changed.
      await page
        .getByRole("button", { name: "Guardar cambios" })
        .click();
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "Guardamos la configuración del bot." }),
      ).toBeVisible();

      const saved = await probeTable();
      expect(saved.rows[0]?.greeting).toBe(NEW_GREETING);
      expect(saved.rows[0]?.enabled).toBe(true);

      // 4. Fire a signed webhook: the bot must answer with the NEW greeting.
      const payload = metaMessagePayload({
        id: `wamid.e2e.botcfg.${Date.now()}`,
        from: PHONE_C,
        text: "Hola, ¿me ayudan con una consulta?",
        profileName: "E2E Config",
      });
      const response = await request.post("/api/webhooks/whatsapp", {
        data: payload,
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": hubSignature(payload, APP_SECRET),
        },
      });
      expect(response.status()).toBe(200);
      expect((await response.json()).accepted).toBe(1);

      // 5. Stored row: the outbound preview IS the new greeting.
      const conversation = await findOwnConversation();
      expect(conversation, "webhook created the conversation").not.toBeNull();
      expect(conversation!.status).toBe("bot");
      expect(conversation!.last_message_preview).toBe(NEW_GREETING);

      // 6. Inbox thread (A01 list row) shows the same new line.
      await page.goto("/bandeja");
      const row = page.getByRole("listitem").filter({ hasText: E164_C });
      await expect(row).toHaveCount(1);
      await expect(row.getByText(NEW_GREETING)).toBeVisible();

      // 7. 390px: the admin screen stays usable (responsive requirement).
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/configuracion/bot");
      await expect(
        page.getByRole("heading", { name: "Configuración del bot" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Guardar cambios" }),
      ).toBeVisible();

      await guard.assertClean();
    } finally {
      // Restore the seeded defaults so every other spec sees the baseline.
      await restPatch(`bot_settings?study_id=eq.${targetStudy}`, {
        enabled: true,
        greeting: DEFAULT_GREETING,
        off_hours: DEFAULT_OFF_HOURS,
        handoff: DEFAULT_HANDOFF,
      });
    }
  });
});
