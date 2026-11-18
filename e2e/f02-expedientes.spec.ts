import { test, expect, type Route } from "@playwright/test";
import {
  SEED,
  expectNoAxeViolations,
  guardPage,
  tabUntil,
} from "./helpers";

/**
 * F02 — Expedientes list (S07) + case detail (S08): seeded content, search
 * states, deep links, loading/error/offline/expired-session behaviour.
 */

const CASES_REST = /\/rest\/v1\/cases(\?|$)/;

function slowCases(delayMs: number) {
  return async (route: Route) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.continue();
  };
}

test.describe("F02 case list and detail", () => {
  test("F02-H1 seeded list opens the case detail with plazo badge", async ({
    page,
  }) => {
    const guard = guardPage(page);
    await page.goto("/expedientes");

    await expect(
      page.getByRole("heading", { name: "Expedientes", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: SEED.caseGomez })).toBeVisible();
    await expect(page.getByRole("link", { name: SEED.casePerez })).toBeVisible();

    // Footer counter: every shown row is a real row (X of X, ≥ the 2 seeds).
    const footerText = await page
      .getByText(/Mostrando \d+ de \d+ expedientes/)
      .textContent();
    const match = /Mostrando (\d+) de (\d+) expedientes/.exec(footerText ?? "");
    expect(match, `footer counter: ${footerText}`).not.toBeNull();
    expect(Number(match![1])).toBe(Number(match![2]));
    expect(Number(match![1])).toBeGreaterThanOrEqual(2);

    // BUG-005: stage-less cases show the labelled "Sin etapa" chip — never
    // an empty pill (the seeded cases have no case_stages link).
    await expect(
      page.getByRole("cell", { name: "Sin etapa" }).first(),
    ).toBeVisible();

    await page.getByRole("link", { name: SEED.caseGomez }).click();
    await expect(
      page.getByRole("heading", { name: SEED.caseGomez }),
    ).toBeVisible();
    // BUG-005 (detail header) — same fallback as "Sin fuero" / "Sin número".
    // Next 16 keeps the previous page mounted, hidden with display:none
    // (Activity, see preserving-ui-state.md), so text queries filter to the
    // visible chip of THIS screen instead of matching the hidden list copy.
    await expect(
      page.getByText("Sin etapa", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    // BUG-006: the "Última actividad" card falls back like its sibling card
    // ("Información del expediente" prints "Responsable —").
    await expect(
      page.getByText("Responsable: —").filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Información del expediente" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Próximos plazos" }),
    ).toBeVisible();
    // Seeded plazo: 10 días hábiles desde 2026-11-02 → 16/11/2026 (ART).
    await expect(page.getByText(SEED.gomezPlazoBadge)).toBeVisible();
    await expect(page.getByRole("link", { name: "Resumen" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Pruebas" })).toBeVisible();
    await expectNoAxeViolations(page, "/expedientes/[id] (F02-E15)");

    // Back to the list for its own axe scan (scans run last so a
    // violation can never mask the functional assertions above).
    await page.goBack();
    await expect(
      page.getByRole("heading", { name: "Expedientes", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: SEED.caseGomez })).toBeVisible();
    await expectNoAxeViolations(page, "/expedientes (F02-E15)");
    await guard.assertClean();
  });

  test("F02-E1 empty search shows no-results + Limpiar búsqueda", async ({
    page,
  }) => {
    const guard = guardPage(page);
    await page.goto("/expedientes");
    await page.getByLabel("Buscar expedientes").fill("zzzzzzz-no-existe");

    await expect(
      page.getByText("No encontramos coincidencias con tu búsqueda"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Limpiar búsqueda" }).click();
    await expect(page.getByRole("link", { name: SEED.caseGomez })).toBeVisible();
    await guard.assertClean();
  });

  test("F02-E2 very long search string does not crash the list", async ({
    page,
  }) => {
    const guard = guardPage(page);
    await page.goto("/expedientes");
    await page.getByLabel("Buscar expedientes").fill("x".repeat(1000));

    await expect(
      page.getByText("No encontramos coincidencias con tu búsqueda"),
    ).toBeVisible();
    await guard.assertClean();
  });

  test("F02-E3 accent/typo tolerant search + emoji query", async ({ page }) => {
    const guard = guardPage(page);
    await page.goto("/expedientes");
    const search = page.getByLabel("Buscar expedientes");

    // Must-row (features.csv): "accent and typo tolerant search".
    await search.fill("gomez"); // unaccented
    await expect(page.getByRole("link", { name: SEED.caseGomez })).toBeVisible();

    await search.fill("gomezz"); // typo
    await expect(page.getByRole("link", { name: SEED.caseGomez })).toBeVisible();

    // Emoji query: clean empty state, no crash.
    await search.fill("🚀");
    await expect(
      page.getByText("No encontramos coincidencias con tu búsqueda"),
    ).toBeVisible();
    await guard.assertClean();
  });

  test("F02-E4 list open in two tabs stays independent", async ({
    page,
    context,
  }) => {
    const guard = guardPage(page);
    const page2 = await context.newPage();
    const guard2 = guardPage(page2);

    await page.goto("/expedientes");
    await page2.goto("/expedientes");
    await expect(page2.getByRole("link", { name: SEED.casePerez })).toBeVisible();

    await page.getByRole("link", { name: SEED.caseGomez }).click();
    await expect(
      page.getByRole("heading", { name: SEED.caseGomez }),
    ).toBeVisible();
    // The other tab is untouched by the navigation in this one.
    await expect(page2.getByRole("link", { name: SEED.casePerez })).toBeVisible();
    await expect(
      page2.getByRole("heading", { name: "Expedientes", exact: true }),
    ).toBeVisible();

    await page2.close();
    await guard.assertClean();
    await guard2.assertClean();
  });

  test("F02-E6 back button returns to the list", async ({ page }) => {
    const guard = guardPage(page);
    await page.goto("/expedientes");
    await page.getByRole("link", { name: SEED.caseGomez }).click();
    await expect(
      page.getByRole("heading", { name: SEED.caseGomez }),
    ).toBeVisible();

    await page.goBack();
    await expect(
      page.getByRole("heading", { name: "Expedientes", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: SEED.casePerez })).toBeVisible();
    await guard.assertClean();
  });

  test("F02-E7 refresh keeps the ?tab= deep link", async ({ page }) => {
    const guard = guardPage(page);
    await page.goto(`/expedientes/${SEED.gomezId}`);
    await expect(
      page.getByRole("heading", { name: "Próximos plazos" }),
    ).toBeVisible();

    await page.getByRole("link", { name: "Pruebas" }).click();
    await expect(page).toHaveURL(/tab=pruebas/);

    await page.reload();
    await expect(page).toHaveURL(/tab=pruebas/);
    await expect(page.getByRole("link", { name: "Agregar prueba" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Próximos plazos" }),
    ).toHaveCount(0); // Resumen card is not on the Pruebas tab
    await guard.assertClean();
  });

  test("F02-E8 slow network shows the loading skeleton first", async ({
    page,
  }) => {
    const guard = guardPage(page);
    await page.route(CASES_REST, slowCases(3000));

    await page.goto("/expedientes");
    // The loading block announces itself with role="status" (sr-only text).
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page.getByRole("link", { name: SEED.caseGomez })).toBeVisible({
      timeout: 15_000,
    });
    await guard.assertClean();
  });

  test("F02-E9 offline data → error state, Reintentar recovers", async ({
    page,
  }) => {
    // The aborted fetch logs a browser resource error: expected here.
    const guard = guardPage(page, {
      ignoreConsole: (text) => text.includes("Failed to load resource"),
    });
    const abort = (route: Route) => route.abort("internetdisconnected");
    await page.route(CASES_REST, abort);

    await page.goto("/expedientes");
    await expect(
      page.getByText("No pudimos cargar los expedientes."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();

    await page.unroute(CASES_REST, abort);
    await page.getByRole("button", { name: "Reintentar" }).click();
    await expect(page.getByRole("link", { name: SEED.caseGomez })).toBeVisible();
    await guard.assertClean();
  });

  test("F02-E10 expired session bounces the detail to /login", async ({
    page,
    context,
  }) => {
    // A last data read from the still-mounted page may get the expected 401
    // after clearCookies; that is the session gate working, not a defect.
    const guard = guardPage(page, {
      ignoreConsole: (text) => text.includes("status of 401"),
    });
    // Already signed in through the project storageState — no login() here
    // (the auth pages redirect signed-in users away, see AU01).
    await page.goto(`/expedientes/${SEED.gomezId}`);
    await expect(
      page.getByRole("heading", { name: SEED.caseGomez }),
    ).toBeVisible();
    await context.clearCookies();
    await page.goto(`/expedientes/${SEED.gomezId}`);
    await expect(page).toHaveURL(/\/login/);
    await guard.assertClean();
  });

  test("F02-E14 keyboard-only: Tab to a carátula, Enter opens it", async ({
    page,
  }) => {
    const guard = guardPage(page);
    await page.goto("/expedientes");
    // The list must be loaded before tabbing, or the presses only walk
    // the sidebar (flaky otherwise).
    await expect(page.getByRole("link", { name: SEED.caseGomez })).toBeVisible();

    // Target ANY row's carátula link (/expedientes/{uuid}), never the
    // sidebar (/expedientes) or the create form (/expedientes/nueva).
    // The stop budget counts up to the FIRST row: S07 rows add three
    // controls each (checkbox, star, ⋯ menu) and the dev database may
    // carry rows from earlier runs, so pinning a row index would only
    // re-break as the list grows.
    const reached = await tabUntil(
      page,
      () => {
        const el = document.activeElement as HTMLAnchorElement | null;
        if (el?.tagName !== "A") return false;
        const href = el.getAttribute("href") ?? "";
        return /^\/expedientes\/[0-9a-f-]{36}$/i.test(href);
      },
      60,
    );
    expect(reached, "carátula link reachable by keyboard").toBe(true);
    const caratula = await page.evaluate(
      () => (document.activeElement as HTMLAnchorElement).textContent ?? "",
    );
    await page.keyboard.press("Enter");

    await expect(page.getByRole("heading", { name: caratula })).toBeVisible();
    await expectNoAxeViolations(page, "detail via keyboard (F02-E14/E15)");
    await guard.assertClean();
  });

  test("F02-N3 unknown case id → missing state, no crash", async ({ page }) => {
    const guard = guardPage(page);
    // Valid-UUID-but-absent id: a non-UUID string makes PostgREST answer a
    // uuid-cast error (generic error state) — that variant is noted in
    // replica/bugs.md "to check" instead of asserted here.
    await page.goto("/expedientes/00000000-0000-4000-8000-000000000000");
    await expect(
      page.getByText(
        "No encontramos este expediente. Puede que se haya eliminado.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Volver a expedientes" }),
    ).toBeVisible();
    await guard.assertClean();
  });
});

test.describe("F02-E12 cross-time-zone render", () => {
  test.use({ timezoneId: "Europe/Madrid" });

  test("deadline badge does not shift outside ART", async ({ page }) => {
    const guard = guardPage(page);
    await page.goto(`/expedientes/${SEED.gomezId}`);
    // Date-only plazos render by string split: no UTC-midnight day shift.
    await expect(page.getByText(SEED.gomezPlazoBadge)).toBeVisible();
    await guard.assertClean();
  });
});
