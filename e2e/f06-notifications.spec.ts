import { test, expect, type Page, type Route } from "@playwright/test";
import {
  SEED,
  expectNoAxeViolations,
  guardPage,
  tabUntil,
} from "./helpers";

/**
 * F06 — notificaciones (S21): page states, mark-read, deep link, slow /
 * offline / forced-error handling, session gate and keyboard path.
 */

const NOTIF_REST = /\/rest\/v1\/notifications(\?|$)/;

async function unreadCount(page: Page): Promise<number> {
  const subtitle = page.getByText(
    /Tenés \d+ notificaciones sin leer\.|Estás al día con las novedades de tu estudio\./,
  );
  await expect(subtitle).toBeVisible();
  const match = /Tenés (\d+) notificaciones sin leer\./.exec(
    (await subtitle.textContent()) ?? "",
  );
  return match ? Number(match[1]) : 0;
}

test.describe("F06 notifications page", () => {
  test("F06-H1/E1/E3/E5/E6/E7 render, mark-all, deep link, refresh", async ({
    page,
  }) => {
    const guard = guardPage(page);
    await page.goto("/notificaciones");

    await expect(
      page.getByRole("heading", { name: "Notificaciones" }),
    ).toBeVisible();
    // M2 pagination: 50+ rows now live behind "Cargar más", and the seed row
    // is the oldest of them — the S21 search narrows the list to it.
    await page.getByLabel("Buscar notificaciones").fill("informe pericial");
    // Seeded row with its accents intact (F06-E3).
    await expect(page.getByText(SEED.notificationTitle)).toBeVisible();
    // Timestamps render as dd/mm/yyyy … (F06-E12, ART zone).
    await expect(page.getByText(/\d{2}\/\d{2}\/\d{4}/).first()).toBeVisible();

    const markAll = page.getByRole("button", { name: "Marcar todas como leídas" });
    const unread = await unreadCount(page);
    if (unread > 0) {
      // Double click must be harmless (F06-E5): one transition, one toast.
      await Promise.all([
        markAll.click(),
        markAll.click({ force: true, timeout: 2_000 }).catch(() => undefined),
      ]);
      await expect(
        page.getByText("Estás al día con las novedades de tu estudio."),
      ).toBeVisible();
      await expect(markAll).toBeDisabled();
      await expect(
        page.getByText("Listo: marcaste todas como leídas.").first(),
      ).toBeVisible();
    } else {
      await expect(markAll, "nothing to mark → disabled (F06-E1)").toBeDisabled();
      await expect(
        page.getByText("Estás al día con las novedades de tu estudio."),
      ).toBeVisible();
    }

    // Deep link (F06-H1/E6): the seeded row carries /expedientes/…?tab=pruebas.
    await page.getByText(SEED.notificationTitle).click();
    await page.waitForURL(/\/expedientes\/[^/]+\?tab=pruebas/);
    await expect(
      page.getByRole("link", { name: "Agregar prueba" }),
    ).toBeVisible();

    await page.goBack();
    await expect(
      page.getByRole("heading", { name: "Notificaciones" }),
    ).toBeVisible();
    await expect(page.getByText(SEED.notificationTitle)).toBeVisible();

    // Refresh keeps the DB-backed read state (F06-E7).
    await page.reload();
    await expect(page.getByText(SEED.notificationTitle)).toBeVisible();

    await expectNoAxeViolations(page, "/notificaciones (F06-E15)");
    await guard.assertClean();
  });

  test("F06-E4 two tabs converge on the DB read state", async ({
    page,
    context,
  }) => {
    const guard = guardPage(page);
    const page2 = await context.newPage();
    const guard2 = guardPage(page2);

    await page.goto("/notificaciones");
    await page2.goto("/notificaciones");
    await expect(
      page2.getByRole("heading", { name: "Notificaciones" }),
    ).toBeVisible();

    const unread = await unreadCount(page);
    if (unread > 0) {
      await page
        .getByRole("button", { name: "Marcar todas como leídas" })
        .click();
      await expect(
        page.getByText("Estás al día con las novedades de tu estudio."),
      ).toBeVisible();
    }

    await page2.reload();
    await expect(
      page2.getByText("Estás al día con las novedades de tu estudio."),
    ).toBeVisible();

    await page2.close();
    await guard.assertClean();
    await guard2.assertClean();
  });

  test("F06-E8/E9/N1 slow, offline and forced-500 states", async ({ page }) => {
    const guard = guardPage(page, {
      ignoreConsole: (text) => text.includes("Failed to load resource"),
      ignoreResponse: (url) => url.includes("/rest/v1/notifications"),
    });

    // E8: slow data → loading copy, then content.
    await page.route(NOTIF_REST, async (route: Route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      await route.continue();
    });
    await page.goto("/notificaciones");
    await expect(page.getByText("Cargando tus notificaciones…")).toBeVisible();
    // The seed row is page 3 of the paginated list: search narrows to it.
    await page.getByLabel("Buscar notificaciones").fill("informe pericial");
    await expect(page.getByText(SEED.notificationTitle)).toBeVisible({
      timeout: 15_000,
    });

    // E9: data endpoint down → typed error + Reintentar; retry recovers.
    const abortHandler = (route: Route) => route.abort("internetdisconnected");
    await page.unroute(NOTIF_REST);
    await page.route(NOTIF_REST, abortHandler);
    await page.reload();
    await expect(
      page.getByText("No pudimos cargar las notificaciones."),
    ).toBeVisible();
    await page.unroute(NOTIF_REST, abortHandler);

    // N1: forced 500 → same error panel, never a blank screen.
    const serverErrorHandler = (route: Route) =>
      route.fulfill({ status: 500, contentType: "text/plain", body: "boom" });
    await page.route(NOTIF_REST, serverErrorHandler);
    await page.reload();
    await expect(
      page.getByText("No pudimos cargar las notificaciones."),
    ).toBeVisible();
    await page.unroute(NOTIF_REST, serverErrorHandler);

    await page.getByRole("button", { name: "Reintentar" }).click();
    // Page 3 of the paginated list: narrow to the seed row with the search.
    await page.getByLabel("Buscar notificaciones").fill("informe pericial");
    await expect(page.getByText(SEED.notificationTitle)).toBeVisible();
    await guard.assertClean();
  });

  test("F06-E10 expired session bounces to /login", async ({
    page,
    context,
  }) => {
    // Expected 401 from a last read fired after clearCookies (session gate).
    const guard = guardPage(page, {
      ignoreConsole: (text) => text.includes("status of 401"),
    });
    // Already signed in via storageState — no login() (auth pages redirect
    // signed-in users to /expedientes).
    await page.goto("/notificaciones");
    await expect(
      page.getByRole("heading", { name: "Notificaciones" }),
    ).toBeVisible();
    await context.clearCookies();
    await page.goto("/notificaciones");
    await expect(page).toHaveURL(/\/login/);
    await guard.assertClean();
  });

  test("F06-E14 keyboard: bell → page → notification → case", async ({
    page,
  }) => {
    const guard = guardPage(page);
    await page.goto("/expedientes");
    // Load the notification list BEFORE tabbing (see F02-E14).
    const seededRow = page
      .getByRole("link", { name: new RegExp(SEED.notificationTitle.slice(0, 12)) })
      .first();

    const reachedBell = await tabUntil(
      page,
      () =>
        document.activeElement
          ?.getAttribute("aria-label")
          ?.startsWith("Notificaciones") ?? false,
      30,
    );
    expect(reachedBell, "bell reachable by keyboard").toBe(true);
    // Enter on the bell opens the dropdown panel (M2 T3); the full page is
    // reached through the panel's footer link, still with the keyboard only.
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Notificaciones" }),
    ).toBeVisible();
    const reachedFooter = await tabUntil(
      page,
      () => {
        const active = document.activeElement as HTMLAnchorElement | null;
        return (
          active?.tagName === "A" &&
          (active.textContent ?? "").trim() === "Ver la lista completa"
        );
      },
      60,
    );
    expect(reachedFooter, "panel footer link reachable by keyboard").toBe(
      true,
    );
    await page.keyboard.press("Enter");
    await page.waitForURL("**/notificaciones");
    await expect(
      page.getByRole("heading", { name: "Notificaciones" }),
    ).toBeVisible();
    // The seed row sits behind pagination: search first, then tab to it.
    await page.getByLabel("Buscar notificaciones").fill("informe pericial");
    await expect(seededRow).toBeVisible();

    const reachedRow = await tabUntil(
      page,
      () => {
        const active = document.activeElement as HTMLAnchorElement | null;
        return (
          active?.tagName === "A" &&
          (active.getAttribute("href") ?? "").startsWith("/expedientes/")
        );
      },
      30,
    );
    expect(reachedRow, "notification row reachable by keyboard").toBe(true);
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/expedientes\/[^/]+/);
    // The seeded notification deep-links to ?tab=pruebas (S21 behaviour),
    // so the Pruebas tab — not the Resumen cards — must render.
    await expect(page.getByRole("link", { name: "Agregar prueba" })).toBeVisible();
    await guard.assertClean();
  });
});
