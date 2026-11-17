import { test, expect, type Page } from "@playwright/test";
import {
  SEED,
  expectNoAxeViolations,
  guardPage,
} from "./helpers";

/**
 * Mobile shell (S38) at the recon's <768 px breakpoint: bottom bar replaces
 * the sidebar, screens fit 390 px with no horizontal document scroll, and
 * the axe scan runs at mobile width too.
 */

async function expectNoHorizontalScroll(page: Page) {
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(fits, "no horizontal scroll at 390 px").toBe(true);
}

test.describe("mobile width 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("F02-E13 list with bottom bar, no horizontal scroll", async ({
    page,
  }) => {
    const guard = guardPage(page);
    await page.goto("/expedientes");

    const bottomBar = page.getByRole("navigation", {
      name: "Navegación principal",
    });
    await expect(bottomBar).toBeVisible();
    await expect(bottomBar.getByRole("link", { name: "Expedientes" })).toBeVisible();
    await expect(bottomBar.getByRole("link", { name: "Bandeja" })).toBeVisible();
    await expect(bottomBar.getByRole("link", { name: "Avisos" })).toBeVisible();

    // The desktop sidebar (and its controls) is gone below 768 px.
    await expect(
      page.getByRole("button", { name: "Cerrar sesión" }),
    ).toHaveCount(0);

    await expect(page.getByRole("link", { name: SEED.caseGomez })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoAxeViolations(page, "/expedientes at 390");
    await guard.assertClean();
  });

  test("F06-E13 Avisos opens notificaciones at 390", async ({ page }) => {
    const guard = guardPage(page);
    await page.goto("/expedientes");
    await page
      .getByRole("navigation", { name: "Navegación principal" })
      .getByRole("link", { name: "Avisos" })
      .click();

    await page.waitForURL("**/notificaciones");
    await expect(
      page.getByRole("heading", { name: "Notificaciones" }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoAxeViolations(page, "/notificaciones at 390");
    await guard.assertClean();
  });

  test("WA01-E13 bandeja fits 390", async ({ page }) => {
    const guard = guardPage(page);
    await page.goto("/bandeja");
    await expect(
      page.getByRole("heading", { name: "Bandeja WhatsApp" }),
    ).toBeVisible();
    await expect(page.getByText("Marina Duarte")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await guard.assertClean();
  });

  test("F03-E13 add-prueba form fits 390", async ({ page }) => {
    const guard = guardPage(page);
    await page.goto(`/expedientes/${SEED.gomezId}/pruebas/nueva`);
    await expect(
      page.getByRole("heading", { name: "Agregar prueba" }),
    ).toBeVisible();
    await expect(page.getByLabel("Título")).toBeVisible();
    await expect(page.getByLabel("Fecha efectiva")).toBeVisible();
    await expect(
      page.getByRole("radiogroup", { name: "Unidad" }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoAxeViolations(page, "add-prueba form at 390");
    await guard.assertClean();
  });
});
