import { test, expect, type Page, type Route } from "@playwright/test";
import {
  SEED,
  expectNoAxeViolations,
  formatDate,
  guardPage,
  restGet,
  restSend,
  toArtDate,
} from "./helpers";

/**
 * M2 / S09 — the case's MANUAL movement log: open the Movimientos tab of
 * the seeded case, create a row, pin it, prove it persists (UI + raw DB),
 * and show the tipo filter hiding/clearing it. This tab is hand-entered,
 * never portal-synced: the negative path (empty fecha → inline error) and
 * the empty state belong to this spec, not to the Actuaciones behaviour.
 *
 * Every row this spec writes carries the `E2E movimientos` prefix and is
 * deleted through REST in `finally` (plus a sweep at the start, so a
 * crashed run never poisons the next one).
 */

const MOVEMENTS_REST = /\/rest\/v1\/movements(\?|$)/;
const DETALLE_PREFIX = "E2E movimientos";

/** Delete every movement this spec family ever wrote on the seeded case. */
async function sweepE2EMovements(): Promise<void> {
  await restSend(
    "DELETE",
    `movements?case_id=eq.${SEED.gomezId}&detalle=like.${encodeURIComponent(
      `${DETALLE_PREFIX}%`,
    )}`,
  );
}

async function gotoMovimientos(page: Page): Promise<void> {
  await page.goto(`/expedientes/${SEED.gomezId}?tab=movimientos`);
  await expect(
    page.getByRole("link", { name: "Movimientos", exact: true }),
  ).toBeVisible();
  // The tab header renders for every state (loading / error / filled).
  await expect(page.getByRole("heading", { name: "Movimientos" })).toBeVisible();
}

test.describe("M2-H create + pin + filter", () => {
  test("M2-H1 create → appears → fijar → persists after reload → tipo filter", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const stamp = Date.now();
    const detalle = `${DETALLE_PREFIX} ${stamp}`;
    const today = toArtDate(new Date().toISOString());
    await sweepE2EMovements();

    try {
      await gotoMovimientos(page);

      // 1. Create: dialog opens, scans clean (a11y first), then the happy path.
      await page.getByRole("button", { name: "Agregar movimiento" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expectNoAxeViolations(page, "agregar movimiento dialog");
      await dialog.getByLabel("Fecha").fill(today);
      await dialog.getByLabel("Tipo").selectOption({ label: "Resolución" });
      await dialog.getByLabel("Detalle").fill(detalle);
      await dialog.getByRole("button", { name: "Agregar movimiento" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText("Movimiento agregado.")).toBeVisible();

      // 2. The row renders with fecha (dd/mm/yyyy), the tipo badge and text.
      const row = page.getByRole("listitem").filter({ hasText: detalle });
      await expect(row).toBeVisible();
      await expect(row).toContainText(formatDate(today));
      await expect(row).toContainText("Resolución");

      // 3. Fijar: the star flips the row into its pinned state.
      await row
        .getByRole("button", { name: "Fijar movimiento", exact: true })
        .click();
      await expect(page.getByText("Movimiento fijado.")).toBeVisible();
      await expect(row.getByText("Fijado", { exact: true })).toBeVisible();
      await expect(
        row.getByRole("button", { name: "Desfijar movimiento", exact: true }),
      ).toBeVisible();

      // 4. Persists after reload — UI badge AND the raw DB row (RLS read).
      await page.reload();
      const reloadedRow = page.getByRole("listitem").filter({ hasText: detalle });
      await expect(reloadedRow).toBeVisible();
      await expect(reloadedRow.getByText("Fijado", { exact: true })).toBeVisible();
      const dbRows = await restGet<{ id: string; pinned: boolean }[]>(
        `movements?detalle=eq.${encodeURIComponent(detalle)}&select=id,pinned`,
      );
      expect(dbRows, "exactly one row for this run's detalle").toHaveLength(1);
      expect(dbRows[0].pinned).toBe(true);

      // 5. The tipo filter hides it (Audiencia ≠ Resolución) …
      await page.getByLabel("Tipo").selectOption({ label: "Audiencia" });
      await expect(reloadedRow).toHaveCount(0);
      // … and "Limpiar filtros" brings it back.
      await page.getByRole("button", { name: "Limpiar filtros" }).click();
      await expect(reloadedRow).toBeVisible();

      // 6. The filled list itself scans clean.
      await expectNoAxeViolations(page, "/expedientes/[id] movimientos");
      await guard.assertClean();
    } finally {
      // Spec hygiene: no fixture outlives the run (spec rows only).
      await sweepE2EMovements();
    }
  });

  test("M2-E1 empty fecha shows the inline error and writes nothing", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const stamp = Date.now();
    const detalle = `${DETALLE_PREFIX} sin fecha ${stamp}`;
    await sweepE2EMovements();

    try {
      await gotoMovimientos(page);
      await page.getByRole("button", { name: "Agregar movimiento" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();

      // Fill everything EXCEPT fecha: the negative path under test.
      await dialog.getByLabel("Tipo").selectOption({ label: "Trámite" });
      await dialog.getByLabel("Detalle").fill(detalle);
      await dialog.getByRole("button", { name: "Agregar movimiento" }).click();

      // Inline, field-level error — the dialog stays open on top of it.
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("alert")).toHaveText(
        "Elegí la fecha del movimiento.",
      );
      await expect(
        page.getByRole("listitem").filter({ hasText: detalle }),
      ).toHaveCount(0);
      const dbRows = await restGet<{ id: string }[]>(
        `movements?detalle=eq.${encodeURIComponent(detalle)}&select=id`,
      );
      expect(dbRows, "an invalid submit never writes a row").toHaveLength(0);

      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await guard.assertClean();
    } finally {
      await sweepE2EMovements();
    }
  });
});

test.describe("M2 states", () => {
  test("M2-E2 error panel with Reintentar recovers the list", async ({
    page,
  }) => {
    const guard = guardPage(page, {
      ignoreConsole: (text) => text.includes("Failed to load resource"),
    });
    const handler = (route: Route) =>
      route.request().url().includes("/rest/v1/movements")
        ? route.abort("internetdisconnected")
        : route.continue();
    await page.route(MOVEMENTS_REST, handler);

    await gotoMovimientos(page);
    await expect(
      page.getByText("No pudimos cargar los movimientos."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();

    await page.unroute(MOVEMENTS_REST, handler);
    await page.getByRole("button", { name: "Reintentar" }).click();
    await expect(
      page.getByText("No pudimos cargar los movimientos."),
    ).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Movimientos" })).toBeVisible();
    await expect(page.getByText(/Mostrando \d+ de \d+ movimientos/)).toBeVisible();
    await guard.assertClean();
  });

  test("M2-E3 empty state + first-movement CTA", async ({ page }) => {
    const guard = guardPage(page);
    await sweepE2EMovements();
    // The seeded case ships no movements; a human row would make the empty
    // state unobservable, so skip instead of asserting a lie.
    const existing = await restGet<{ id: string }[]>(
      `movements?case_id=eq.${SEED.gomezId}&select=id`,
    );
    test.skip(existing.length > 0, "the case already has manual movements");

    await gotoMovimientos(page);
    await expect(page.getByText("Todavía no hay movimientos")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Agregar el primer movimiento" }),
    ).toBeVisible();
    // The copy must distinguish this manual log from the portal's Actuaciones.
    await expect(page.getByText(/no lo sincroniza el portal judicial/)).toBeVisible();
    await expectNoAxeViolations(page, "movimientos empty state");
    await guard.assertClean();
  });

  test("M2-E4 keyboard: Enter opens the dialog, Esc hands focus back", async ({
    page,
  }) => {
    const guard = guardPage(page);
    await gotoMovimientos(page);

    const agregar = page.getByRole("button", { name: "Agregar movimiento" });
    await expect(agregar).toBeEnabled();
    await agregar.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(agregar).toBeFocused();
    await guard.assertClean();
  });
});

test.describe("M2 mobile 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("movimientos tab fits 390 px with no horizontal scroll", async ({
    page,
  }) => {
    const guard = guardPage(page);
    await gotoMovimientos(page);
    await expect(
      page.getByRole("button", { name: "Agregar movimiento" }),
    ).toBeEnabled();

    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    );
    expect(fits, "no horizontal scroll at 390 px").toBe(true);

    await expectNoAxeViolations(page, "movimientos at 390");
    await guard.assertClean();
  });
});
