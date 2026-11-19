/**
 * replica-diff layout capture (throwaway tooling spec, not a behaviour test).
 *
 * Captures the clone's screens at 1440x900 (desktop) and 390x844 (mobile)
 * into `replica/clone-screens/` in the seeded state, logged in through the
 * session minted by `auth.setup.ts` (storageState) — or through the shared
 * `login()` helper when that session is gone. Screenshots are named after
 * the recon screen IDs so they can be paired with `replica/screens/`
 * originals later (see replica/parity.md for the mapping and its confidence).
 *
 * Session rules that shape this file (verified against the app):
 * - proxy.ts / updateSession redirects an authed user AWAY from /login, so
 *   an unconditional `login()` hangs on a valid storageState;
 * - the onboarding wizard bounces to /login when there is NO session, so S03
 *   must be captured authed.
 * Hence `ensureSession`: try the stored session first, log in only if the
 * guard bounced us.
 *
 * No assertions beyond "the screen finished rendering its data" — this spec
 * only exists to produce diff inputs, and it must never flake the suite.
 */
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { SEED, login } from "./helpers";

const OUT = path.resolve(__dirname, "..", "replica", "clone-screens");

/** Lands on /expedientes with a working session (storageState or login()). */
async function ensureSession(page: Page): Promise<void> {
  await page.goto("/expedientes");
  if (new URL(page.url()).pathname === "/login") {
    await login(page);
  }
  await expect(
    page.getByRole("heading", { name: "Expedientes", exact: true }),
  ).toBeVisible();
}

/** Waits until the notifications page left its loading state. */
async function notificationsReady(page: Page) {
  const list = page.getByRole("listitem");
  const empty = page.getByText("No hay notificaciones nuevas");
  await expect(list.first().or(empty).first()).toBeVisible();
}

test.describe("replica-diff capture — guest screens", () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    storageState: { cookies: [], origins: [] },
  });

  test("S01 login", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Iniciar sesión" })).toBeVisible();
    await page.screenshot({ path: path.join(OUT, "S01-login.png") });
  });
});

test.describe("replica-diff capture — authed screens", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("S03 onboarding step 1", async ({ page }) => {
    await ensureSession(page);
    await page.goto("/onboarding");
    await expect(page.getByText("Paso 1 de 5")).toBeVisible();
    await page.screenshot({ path: path.join(OUT, "S03-onboarding.png") });
  });

  test("S07 list", async ({ page }) => {
    await ensureSession(page);
    await expect(page.getByRole("link", { name: SEED.caseGomez })).toBeVisible();
    await page.screenshot({ path: path.join(OUT, "S07-list.png") });
  });

  test("S07-nueva form", async ({ page }) => {
    await ensureSession(page);
    await page.goto("/expedientes/nueva");
    await expect(page.getByRole("heading", { name: "Nuevo expediente" })).toBeVisible();
    await expect(page.getByLabel("Carátula")).toBeVisible();
    await page.screenshot({ path: path.join(OUT, "S07-nueva.png") });
  });

  test("S08 detail Resumen", async ({ page }) => {
    await ensureSession(page);
    await page.goto(`/expedientes/${SEED.gomezId}`);
    await expect(page.getByRole("heading", { name: SEED.caseGomez })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Próximos plazos" })).toBeVisible();
    await page.screenshot({ path: path.join(OUT, "S08-detail-resumen.png") });
  });

  test("S12 nueva prueba", async ({ page }) => {
    await ensureSession(page);
    await page.goto(`/expedientes/${SEED.gomezId}/pruebas/nueva`);
    await expect(page.getByRole("heading", { name: "Agregar prueba" })).toBeVisible();
    await page.screenshot({ path: path.join(OUT, "S12-nueva-prueba.png") });
  });

  test("S21 notificaciones", async ({ page }) => {
    await ensureSession(page);
    await page.goto("/notificaciones");
    await expect(page.getByRole("heading", { name: "Notificaciones" })).toBeVisible();
    await notificationsReady(page);
    await page.screenshot({ path: path.join(OUT, "S21-notificaciones.png") });
  });

  test("A01 bandeja", async ({ page }) => {
    await ensureSession(page);
    await page.goto("/bandeja");
    await expect(page.getByRole("heading", { name: "Bandeja WhatsApp" })).toBeVisible();
    await expect(page.getByRole("listitem").first()).toBeVisible();
    await page.screenshot({ path: path.join(OUT, "A01-bandeja.png") });
  });
});

test.describe("replica-diff capture — mobile 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("S38 expedientes mobile", async ({ page }) => {
    await ensureSession(page);
    await expect(page.getByRole("link", { name: SEED.caseGomez })).toBeVisible();
    await page.screenshot({ path: path.join(OUT, "S38-expedientes-390.png") });
  });
});
