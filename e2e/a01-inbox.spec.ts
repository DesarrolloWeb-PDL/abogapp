import { test, expect, type Route } from "@playwright/test";
import {
  SEED,
  WAIVE_SIDEBAR_LOGO,
  expectNoAxeViolations,
  guardPage,
  tabUntil,
} from "./helpers";

/**
 * WA02 — Bandeja WhatsApp (A01): list states from GET /api/wa/conversations
 * (loading, ready, error, no-results), filters, refresh, session gate, ART
 * timestamps and axe. The empty state needs a conversation-free database
 * (manual — see test-plan.md).
 */

const INBOX_API = /\/api\/wa\/conversations/;

test.describe("A01 inbox", () => {
  test("WA02-H1/H2/H3/E7/E12/E15 list, filters, refresh, axe", async ({
    page,
  }) => {
    const guard = guardPage(page);
    await page.goto("/bandeja");

    await expect(
      page.getByRole("heading", { name: "Bandeja WhatsApp" }),
    ).toBeVisible();

    // Seeded conversations under RLS.
    for (const contact of SEED.waContacts) {
      await expect(page.getByText(contact)).toBeVisible();
    }
    await expect(page.getByRole("listitem").first()).toBeVisible();

    // Filter tabs carry counts and expose aria-pressed (E14 territory).
    const todas = page.getByRole("button", { name: /^Todas \(\d+\)$/ });
    await expect(todas).toHaveAttribute("aria-pressed", "true");

    const cerradas = page.getByRole("button", { name: /^Cerradas \(\d+\)$/ });
    const countMatch = /(\d+)/.exec(await cerradas.textContent() ?? "");
    const cerradasCount = countMatch ? Number(countMatch[1]) : 0;
    await cerradas.click();
    await expect(cerradas).toHaveAttribute("aria-pressed", "true");
    await expect(todas).toHaveAttribute("aria-pressed", "false");

    if (cerradasCount === 0) {
      // H3: a filter with no matches shows the no-results state.
      await expect(
        page.getByText("No hay conversaciones con este filtro"),
      ).toBeVisible();
      await page.getByRole("button", { name: "Ver todas" }).click();
      await expect(todas).toHaveAttribute("aria-pressed", "true");
    } else {
      await expect(page.getByRole("listitem").first()).toBeVisible();
      await todas.click();
    }
    await expect(page.getByText("Marina Duarte")).toBeVisible();

    // E12: row timestamps render in ART (`16/11/26, 1:27 …` — es-AR omits
    // the leading zero on single-digit hours).
    await expect(
      page.getByText(/\d{2}\/\d{2}\/\d{2}, \d{1,2}:\d{2}/).first(),
    ).toBeVisible();

    // E7: refresh re-reads the route; the list survives.
    await page.reload();
    await expect(page.getByText("Marina Duarte")).toBeVisible();

    await expectNoAxeViolations(page, "/bandeja (WA02-E15)", [
      WAIVE_SIDEBAR_LOGO,
    ]);
    await guard.assertClean();
  });

  test("WA01-E8/E9/N1 slow, offline and forced-500 states", async ({ page }) => {
    const guard = guardPage(page, {
      ignoreConsole: (text) => text.includes("Failed to load resource"),
      ignoreResponse: (url) => url.includes("/api/wa/conversations"),
    });

    // E8: slow route → filters render, rows arrive after the delay
    // (the skeleton itself is aria-hidden — see bugs.md a11y note).
    await page.route(INBOX_API, async (route: Route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      await route.continue();
    });
    await page.goto("/bandeja");
    await expect(
      page.getByRole("button", { name: /^Todas \(\d+\)$/ }),
    ).toBeVisible();
    await expect(page.getByRole("list")).toHaveCount(0);
    await expect(page.getByRole("list")).toBeVisible({ timeout: 15_000 });

    // E9: endpoint unreachable → typed error + Reintentar.
    const abortHandler = (route: Route) => route.abort("internetdisconnected");
    await page.unroute(INBOX_API);
    await page.route(INBOX_API, abortHandler);
    await page.reload();
    await expect(page.getByText("No pudimos cargar la bandeja")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
    await page.unroute(INBOX_API, abortHandler);

    // N1: forced 500 → same error panel, never a blank thread.
    const serverErrorHandler = (route: Route) =>
      route.fulfill({ status: 500, contentType: "text/plain", body: "boom" });
    await page.route(INBOX_API, serverErrorHandler);
    await page.reload();
    await expect(page.getByText("No pudimos cargar la bandeja")).toBeVisible();
    await page.unroute(INBOX_API, serverErrorHandler);

    await page.getByRole("button", { name: "Reintentar" }).click();
    await expect(page.getByRole("list")).toBeVisible();
    await guard.assertClean();
  });

  test("WA02-E14 keyboard: filters toggle with Enter", async ({ page }) => {
    const guard = guardPage(page);
    await page.goto("/bandeja");

    const reachedFilter = await tabUntil(
      page,
      () => document.activeElement?.hasAttribute("aria-pressed") ?? false,
      30,
    );
    expect(reachedFilter, "filter tabs reachable by keyboard").toBe(true);
    await page.keyboard.press("Tab"); // Todas → Bot
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: /^Bot \(\d+\)$/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await guard.assertClean();
  });

  test("WA01-E10 expired session bounces /bandeja to /login", async ({
    page,
    context,
  }) => {
    // After clearCookies the still-mounted page may fire one last inbox
    // read, which the route correctly answers 401 — the expected signal here.
    const guard = guardPage(page, {
      ignoreConsole: (text) => text.includes("status of 401"),
    });
    // Already signed in via storageState — no login() here.
    await page.goto("/bandeja");
    await expect(
      page.getByRole("heading", { name: "Bandeja WhatsApp" }),
    ).toBeVisible();
    await context.clearCookies();
    await page.goto("/bandeja");
    await expect(page).toHaveURL(/\/login/);
    await guard.assertClean();
  });
});
