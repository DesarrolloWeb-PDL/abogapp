import { test, expect, type Page, type Route } from "@playwright/test";
import {
  SEED,
  addBusinessDays,
  appAlert,
  expectNoAxeViolations,
  formatDate,
  guardPage,
  restGet,
  restSend,
  tabUntil,
  toArtDate,
} from "./helpers";

/**
 * F03 — agregar una prueba con plazo (S12): the fecha límite always comes
 * from the DB trigger (never from the screen), so this spec compares the UI
 * badge against (a) the raw `plazos.fecha_limite` row and (b) an independent
 * business-day computation over `calendar_days`.
 */

const FORM_URL = `/expedientes/${SEED.gomezId}/pruebas/nueva`;
const PRUEBA_REST = /\/rest\/v1\/pruebas(\?|$)/;

interface PlazoRow {
  fecha_limite: string;
  tipo: string;
  cantidad: number;
  fecha_efectiva: string;
}

async function fillPruebaForm(
  page: Page,
  fields: { titulo: string; informante?: string; fecha?: string },
) {
  await page.getByLabel("Título").fill(fields.titulo);
  await page.getByLabel("Informante").fill(
    fields.informante ?? "Estudio Contable Rivadavia",
  );
  await page.getByLabel("Fecha efectiva").fill(fields.fecha ?? "2026-11-16");
}

test.describe("F03 prueba with días-hábiles plazo", () => {
  test("F03-H1/E12/E15 create case → plazo → DB date → notification", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const stamp = Date.now();
    const caratula = `E2E ${stamp}`;
    const titulo = `E2E plazo ${stamp}`;

    // 1. Manual case creation (S07) with a unique carátula per run.
    await page.goto("/expedientes");
    await page.getByRole("link", { name: "Nuevo expediente" }).click();
    await expect(
      page.getByRole("heading", { name: "Nuevo expediente" }),
    ).toBeVisible();
    await page.getByLabel("Carátula").fill(caratula);
    await page.getByRole("button", { name: "Crear expediente" }).click();

    await page.waitForURL(/\/expedientes\/[^/]+$/);
    await expect(page.getByRole("heading", { name: caratula })).toBeVisible();

    // 2. Agregar prueba with a 10-días-hábiles plazo from 2026-11-16.
    await page.getByRole("link", { name: "Pruebas" }).click();
    await expect(page).toHaveURL(/tab=pruebas/);
    await page.getByRole("link", { name: "Agregar prueba" }).click();
    await expect(
      page.getByRole("heading", { name: "Agregar prueba" }),
    ).toBeVisible();

    await fillPruebaForm(page, { titulo });
    await page.getByRole("radio", { name: "Días hábiles" }).check();
    await page.getByLabel("Cantidad").fill("10");

    await page.getByRole("button", { name: "Guardar prueba" }).click();

    // 3. Lands back on the Pruebas tab with the new row.
    await page.waitForURL(/tab=pruebas/);
    await expect(page.getByText(titulo)).toBeVisible();

    // 4. Resumen shows the engine's fecha límite.
    const caseId = /\/expedientes\/([^/?]+)/.exec(page.url())![1];
    await page.getByRole("link", { name: "Resumen" }).click();
    await expect(
      page.getByText(`Vence ${formatDate("2026-11-30")}`, { exact: true }),
    ).toBeVisible();

    // 5. Compare against the DB-returned value (raw REST row, RLS-scoped).
    const plazos = await restGet<PlazoRow[]>(
      `plazos?case_id=eq.${caseId}&select=fecha_limite,tipo,cantidad,fecha_efectiva`,
    );
    expect(plazos, "the plazo row exists in the DB").toHaveLength(1);
    expect(plazos[0].tipo).toBe("habiles");
    expect(plazos[0].cantidad).toBe(10);
    const dbArtDate = toArtDate(plazos[0].fecha_limite);
    expect(dbArtDate, "DB trigger result").toBe("2026-11-30");

    // 6. Independent engine cross-check over calendar_days (weekends +
    //    feria/feriados/studio days), never reusing the app's code path.
    const calendar = await restGet<{ day: string }[]>(
      "calendar_days?select=day",
    );
    const expected = addBusinessDays(
      "2026-11-16",
      10,
      calendar.map((row) => row.day),
    );
    expect(expected, "independent business-day computation").toBe("2026-11-30");
    expect(dbArtDate, "DB agrees with the independent computation").toBe(expected);
    const weekday = new Date(`${dbArtDate}T12:00:00Z`).getUTCDay();
    expect(weekday, "deadline lands on a business day").not.toBe(0);
    expect(weekday).not.toBe(6);

    // 7. The bell gained an unread and the notificaciones page shows THIS
    //    run's row (older runs leave same-dated notifications behind, so the
    //    item is scoped by the unique título).
    await expect(
      page.getByRole("link", { name: /Notificaciones, \d+ sin leer/ }),
    ).toBeVisible();
    await page.goto("/notificaciones");
    const ownItem = page.getByRole("listitem").filter({ hasText: titulo });
    await expect(ownItem).toBeVisible();
    expect(await ownItem.innerText()).toContain(
      `Vence el ${formatDate(dbArtDate)}`,
    );
    expect(await ownItem.innerText()).toContain(
      `El plazo de «${titulo}» (10 días hábiles)`,
    );

    // F03-E15: the add-prueba form is scanned at the END (a violation must
    // never mask the functional + DB assertions above).
    await page.goto(`/expedientes/${caseId}/pruebas/nueva`);
    await expect(
      page.getByRole("heading", { name: "Agregar prueba" }),
    ).toBeVisible();
    await expectNoAxeViolations(page, "add-prueba form (F03-E15)");

    await guard.assertClean();
  });

  test("F03-E1 empty required fields → typed error, no row", async ({
    page,
  }) => {
    const guard = guardPage(page);
    await page.goto(FORM_URL);
    await page.getByRole("button", { name: "Guardar prueba" }).click();

    await expect(appAlert(page)).toHaveText(
      "Completá todos los campos para continuar.",
    );
    await expect(page).toHaveURL(/pruebas\/nueva/);
    await guard.assertClean();
  });

  test("F03-E2 over-long título (DB limit 300) → typed error, no row", async ({
    page,
  }) => {
    // The invalid input is rejected with HTTP 400 by design; Chromium logs
    // every failed resource load, which is the EXPECTED signal here.
    const guard = guardPage(page, {
      ignoreConsole: (text) => text.includes("status of 400"),
    });
    await page.goto(FORM_URL);
    await fillPruebaForm(page, { titulo: "x".repeat(1000) });
    await page.getByRole("button", { name: "Guardar prueba" }).click();

    await expect(appAlert(page)).toContainText(
      "No pudimos completar la operación",
    );
    await expect(page).toHaveURL(/pruebas\/nueva/);
    await guard.assertClean();
  });

  test("F03-E3 accents and emoji survive the round trip", async ({ page }) => {
    const guard = guardPage(page);
    const titulo = `Señoría 🚀 — prueba con acentos ${Date.now()}`;
    await page.goto(FORM_URL);
    await fillPruebaForm(page, { titulo });
    await page.getByRole("button", { name: "Guardar prueba" }).click();

    await page.waitForURL(/tab=pruebas/);
    await expect(page.getByText(titulo)).toBeVisible();
    await guard.assertClean();
  });

  test("F03-E4 the same form submitted from two tabs creates two rows", async ({
    page,
    context,
  }) => {
    const guard = guardPage(page);
    const page2 = await context.newPage();
    const guard2 = guardPage(page2);
    const stamp = Date.now();

    await Promise.all([page.goto(FORM_URL), page2.goto(FORM_URL)]);

    await fillPruebaForm(page, { titulo: `E2E doble pestaña A ${stamp}` });
    await page.getByRole("button", { name: "Guardar prueba" }).click();
    await page.waitForURL(/tab=pruebas/);

    // The second tab still works independently (no shared-form corruption).
    await fillPruebaForm(page2, { titulo: `E2E doble pestaña B ${stamp}` });
    await page2.getByRole("button", { name: "Guardar prueba" }).click();
    await page2.waitForURL(/tab=pruebas/);
    await expect(
      page2.getByText(`E2E doble pestaña B ${stamp}`),
    ).toBeVisible();

    await expect(page.getByText(`E2E doble pestaña A ${stamp}`)).toBeVisible();
    await page2.close();
    await guard.assertClean();
    await guard2.assertClean();
  });

  test("F03-E5 double click on Guardar creates exactly one prueba", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const titulo = `E2E doble click ${Date.now()}`;
    await page.goto(FORM_URL);
    await fillPruebaForm(page, { titulo });

    const submit = page.getByRole("button", { name: "Guardar prueba" });
    // First click normally; a second, immediate click must be swallowed by
    // the disabled state (or land before it) — never produce a 2nd row.
    await submit.click();
    await submit
      .click({ force: true, timeout: 2_000 })
      .catch(() => undefined);

    await page.waitForURL(/tab=pruebas/);
    await expect(page.getByText(titulo)).toHaveCount(1);
    await guard.assertClean();
  });

  test("F03-E6 back mid-flow leaves no partial row", async ({ page }) => {
    const guard = guardPage(page);
    const titulo = `E2E cancel ${Date.now()}`;
    await page.goto(FORM_URL);
    await fillPruebaForm(page, { titulo });
    await page.getByRole("link", { name: "Volver al expediente" }).click();

    await page.waitForURL(/tab=pruebas/);
    await expect(page.getByText(titulo)).toHaveCount(0);
    await guard.assertClean();
  });

  test("F03-E7 refresh mid-flow resets the form, no row", async ({ page }) => {
    const guard = guardPage(page);
    const titulo = `E2E refresh ${Date.now()}`;
    await page.goto(FORM_URL);
    await fillPruebaForm(page, { titulo });

    await page.reload();
    await expect(page.getByLabel("Título")).toHaveValue("");
    await expect(page.getByText(titulo)).toHaveCount(0);
    await guard.assertClean();
  });

  test("F03-E8 slow insert shows Guardando… and stays disabled", async ({
    page,
  }) => {
    const guard = guardPage(page);
    await page.route(PRUEBA_REST, async (route: Route) => {
      if (route.request().method() !== "POST") return route.continue();
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      await route.continue();
    });

    await page.goto(FORM_URL);
    await fillPruebaForm(page, { titulo: `E2E lento ${Date.now()}` });
    await page.getByRole("button", { name: "Guardar prueba" }).click();

    const busy = page.getByRole("button", { name: "Guardando…" });
    await expect(busy).toBeVisible();
    await expect(busy).toBeDisabled();

    await page.waitForURL(/tab=pruebas/);
    await guard.assertClean();
  });

  test("F03-E9 offline insert errors typed, retry succeeds", async ({ page }) => {
    const guard = guardPage(page, {
      ignoreConsole: (text) => text.includes("Failed to load resource"),
    });
    const titulo = `E2E offline ${Date.now()}`;
    const handler = (route: Route) =>
      route.request().method() === "POST"
        ? route.abort("internetdisconnected")
        : route.continue();
    await page.route(PRUEBA_REST, handler);

    await page.goto(FORM_URL);
    await fillPruebaForm(page, { titulo });
    await page.getByRole("button", { name: "Guardar prueba" }).click();
    await expect(appAlert(page)).toContainText(
      "No pudimos completar la operación",
    );
    await expect(page).toHaveURL(/pruebas\/nueva/);

    await page.unroute(PRUEBA_REST, handler);
    await page.getByRole("button", { name: "Guardar prueba" }).click();
    await page.waitForURL(/tab=pruebas/);
    await expect(page.getByText(titulo)).toBeVisible();
    await guard.assertClean();
  });

  test("F03-E10 expired session blocks the flow (login redirect, no row)", async ({
    page,
    context,
  }) => {
    const guard = guardPage(page, {
      ignoreConsole: (text) => text.includes("Failed to load resource"),
    });
    const titulo = `E2E sesion ${Date.now()}`;
    await page.goto(FORM_URL);
    await fillPruebaForm(page, { titulo });

    // Session dies mid-flow: the next navigation hits the session gate
    // instead of silently saving with a stale in-memory token.
    await context.clearCookies();
    await page.reload();
    await expect(page).toHaveURL(/\/login/);

    const rows = await restGet<unknown[]>(
      `pruebas?titulo=eq.${encodeURIComponent(titulo)}&select=id`,
    );
    expect(rows, "no row was created without a session").toHaveLength(0);
    await guard.assertClean();
  });

  test("F03-N1 plazo quantity outside 1..5000 is rejected typed", async ({
    page,
  }) => {
    // Engine guard violation → PostgREST 400 (P0001) by design; the typed
    // toast below is the app's answer, so only the browser's own log of the
    // expected 400 is ignored.
    const guard = guardPage(page, {
      ignoreConsole: (text) => text.includes("status of 400"),
    });
    await page.goto(FORM_URL);
    await fillPruebaForm(page, { titulo: `E2E plazo invalido ${Date.now()}` });
    await page.getByRole("radio", { name: "Días hábiles" }).check();
    await page.getByLabel("Cantidad").fill("6000");
    await page.getByRole("button", { name: "Guardar prueba" }).click();

    await expect(appAlert(page)).toHaveText(
      "La cantidad del plazo tiene que estar entre 1 y 5000.",
    );
    await expect(page).toHaveURL(/pruebas\/nueva/);
    await guard.assertClean();
  });

  test("F03-E14 keyboard-only: fill and submit without the mouse", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const titulo = `E2E teclado ${Date.now()}`;
    await page.goto(FORM_URL);

    const reachedTitle = await tabUntil(
      page,
      () => document.activeElement?.getAttribute("name") === "titulo",
      30,
    );
    expect(reachedTitle, "Título reachable by keyboard").toBe(true);
    await page.keyboard.type(titulo);

    await page.keyboard.press("Tab"); // → Informante
    expect(
      await page.evaluate(
        () => document.activeElement?.getAttribute("name") === "informante",
      ),
    ).toBe(true);
    await page.keyboard.type("Estudio Contable Rivadavia");

    await page.keyboard.press("Tab"); // → Fecha efectiva
    // NOTE: the date field is filled with `fill`, not keystrokes — Chromium's
    // date input swallows part of a synthetic "2026-11-16" sequence and can
    // store a garbage year (that is how BUG-004's bad rows were born). The
    // rest of this test stays keyboard-driven.
    await page.getByLabel("Fecha efectiva").fill("2026-11-16");

    // Radiogroup: reach "Días hábiles" with the arrow keys.
    await page.getByRole("radio", { name: "Horas" }).focus();
    await page.keyboard.press("ArrowDown"); // → Días corridos
    await page.keyboard.press("ArrowDown"); // → Días hábiles
    await expect(
      page.getByRole("radio", { name: "Días hábiles" }),
    ).toBeChecked();

    await page.keyboard.press("Tab"); // → Cantidad (leaves the radio group)
    await page.keyboard.type("5");
    await page.keyboard.press("Tab"); // → Guardar prueba
    await page.keyboard.press("Enter");

    await page.waitForURL(/tab=pruebas/);
    await expect(page.getByText(titulo)).toBeVisible();
    await guard.assertClean();
  });
});

test.describe("F03-E12 deadline render outside ART", () => {
  test.use({ timezoneId: "Europe/Madrid" });

  test("fecha límite badge keeps the ART calendar day", async ({ page }) => {
    const guard = guardPage(page);
    await page.goto(`/expedientes/${SEED.gomezId}`);
    await expect(page.getByText(SEED.gomezPlazoBadge)).toBeVisible();
    await guard.assertClean();
  });
});

/** Row returned by a REST insert with `return=representation`. */
interface RestInsertRow {
  id: string;
  /** plazos only — the corrupt value this regression seeds. */
  fecha_limite?: string;
}

test.describe("F03-N4 corrupt fecha_limite regression (BUG-004)", () => {
  test("case detail renders when the DB holds an out-of-range fecha_limite", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const stamp = Date.now();
    const caratula = `E2E fecha corrupta ${stamp}`;
    const titulo = `Prueba fecha corrupta ${stamp}`;

    // The form itself advertises the sane window (BUG-004 prevention).
    await page.goto(`/expedientes/${SEED.gomezId}/pruebas/nueva`);
    const fechaInput = page.getByLabel("Fecha efectiva");
    await expect(fechaInput).toHaveAttribute("min", "1900-01-01");
    await expect(fechaInput).toHaveAttribute("max", "2100-12-31");

    // A throwaway case (same UI flow as F03-H1), unique per run.
    await page.goto("/expedientes");
    await page.getByRole("link", { name: "Nuevo expediente" }).click();
    await page.getByLabel("Carátula").fill(caratula);
    await page.getByRole("button", { name: "Crear expediente" }).click();
    // The heading wait matters: waitForURL alone also matches the
    // intermediate `/expedientes/nueva` route before the redirect lands.
    await page.waitForURL(/\/expedientes\/[^/]+$/);
    await expect(page.getByRole("heading", { name: caratula })).toBeVisible();
    const caseId = /\/expedientes\/([^/?]+)/.exec(page.url())![1];
    expect(caseId).toMatch(/^[0-9a-f-]{36}$/);

    let plazoId: string | null = null;
    let pruebaId: string | null = null;
    try {
      // Seed the exact BUG-004 shape through REST: an absurd anchor year
      // makes the trigger write fecha_limite "61116-02-10T02:59:59+00:00".
      const [studyRow] = await restGet<{ study_id: string }[]>(
        `cases?id=eq.${caseId}&select=study_id`,
      );
      const [pruebaRow] = await restSend<RestInsertRow[]>("POST", "pruebas", {
        study_id: studyRow.study_id,
        case_id: caseId,
        type: "informativa",
        titulo,
        parte: "Estudio Contable Rivadavia",
        fecha_efectiva: "61116-02-02",
      });
      pruebaId = pruebaRow.id;
      const [plazoRow] = await restSend<RestInsertRow[]>("POST", "plazos", {
        study_id: studyRow.study_id,
        case_id: caseId,
        prueba_id: pruebaRow.id,
        concepto: titulo,
        tipo: "corridos",
        cantidad: 7,
        fecha_efectiva: "61116-02-02",
        source: "prueba",
      });
      plazoId = plazoRow.id;
      // The corrupt row really exists in the DB (the trigger accepts it).
      expect(plazoRow.fecha_limite).toContain("61116-02-10");

      // The whole case must render — never the generic error panel.
      await page.goto(`/expedientes/${caseId}`);
      await expect(page.getByRole("heading", { name: caratula })).toBeVisible();
      await expect(
        page.getByText("No pudimos cargar el expediente."),
      ).toHaveCount(0);
      // The corrupt deadline degrades to the documented safe fallback.
      await expect(page.getByText("Fecha pendiente")).toBeVisible();

      // The Pruebas tab stays readable too (the seeded prueba row).
      await page.getByRole("link", { name: "Pruebas" }).click();
      await expect(page).toHaveURL(/tab=pruebas/);
      await expect(page.getByText(titulo)).toBeVisible();
    } finally {
      // Clean the seeded rows up (order respects the foreign keys).
      if (plazoId) await restSend("DELETE", `plazos?id=eq.${plazoId}`);
      if (pruebaId) await restSend("DELETE", `pruebas?id=eq.${pruebaId}`);
      await restSend("DELETE", `cases?id=eq.${caseId}`);
    }

    await guard.assertClean();
  });
});
