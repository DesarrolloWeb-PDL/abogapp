import { test, expect, type Page } from "@playwright/test";
import { SEED, expectNoAxeViolations, guardPage, restGet, restSend } from "./helpers";

/**
 * S17 slice 1 — `/agenda` Lista view (T2): the sidebar entry, the
 * "Próximos 30 días" window with search + source filters, the recon's
 * verbatim empty copy with active-filter chips + Limpiar filtros, the
 * error + Reintentar path (a forced 500 on the events REST request) and
 * the 390 px layout.
 *
 * Fixtures seed through the same REST seam the M2 specs use (demo token +
 * `events_member` RLS), prefixed `E2E agenda %` so a crashed run can
 * pre-clean; cleanup runs in `finally`. The audiencia row needs a real
 * `hearings` parent because init.sql's `chk_event_source_fk` ties
 * source='audiencia' to a hearing_id.
 */

interface StudyScope {
  study_id: string;
}

/** The demo study id — derived from an RLS-visible row, never hard-coded. */
async function agendaScope(): Promise<StudyScope> {
  const [row] = await restGet<StudyScope[]>("cases?select=study_id&limit=1");
  if (!row) throw new Error("no case row to derive the study scope from");
  return row;
}

/** Drop every event this spec ever wrote (crashed-run leftovers included). */
async function cleanSeededEvents(): Promise<void> {
  await restSend(
    "DELETE",
    `events?title=like.${encodeURIComponent("E2E agenda %")}`,
  );
}

interface SeedEventOptions {
  title: string;
  startAt: string;
  endAt?: string;
  source?: "manual" | "audiencia";
  hearingId?: string;
  location?: string;
}

async function seedEvent(
  scope: StudyScope,
  options: SeedEventOptions,
): Promise<string> {
  const endAt =
    options.endAt ??
    new Date(Date.parse(options.startAt) + 60 * 60 * 1000).toISOString();
  const [row] = await restSend<{ id: string }[]>("POST", "events", {
    study_id: scope.study_id,
    title: options.title,
    start_at: options.startAt,
    end_at: endAt,
    source: options.source ?? "manual",
    ...(options.hearingId ? { hearing_id: options.hearingId } : {}),
    ...(options.location ? { location: options.location } : {}),
  });
  return row.id;
}

/** hearings.case_id has a composite FK (case_id, study_id) → seeded case. */
async function seedHearing(scope: StudyScope, fecha: string): Promise<string> {
  const [row] = await restSend<{ id: string }[]>("POST", "hearings", {
    study_id: scope.study_id,
    case_id: SEED.gomezId,
    fecha,
    tipo: "presencial",
  });
  return row.id;
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(fits, "no horizontal scroll at 390 px").toBe(true);
}

test.describe("S17 — /agenda Lista view (T2 slice 1)", () => {
  test("S17-1 sidebar Agenda entry opens /agenda with the plain empty state", async ({
    page,
  }) => {
    const guard = guardPage(page);
    await cleanSeededEvents();

    await page.goto("/expedientes");
    const sidebar = page.getByRole("navigation", {
      name: "Navegación principal",
    });
    const agendaLink = sidebar.getByRole("link", { name: "Agenda" });
    await expect(agendaLink).toBeVisible();

    await agendaLink.click();
    await page.waitForURL("**/agenda");
    await expect(
      page.getByRole("heading", { name: "Agenda", exact: true }),
    ).toBeVisible();

    // No events and no active filters → the fresh plain empty copy, never
    // the "con estos filtros" wording (that copy belongs to a narrowed list).
    await expect(
      page.getByText("Todavía no hay eventos en los próximos 30 días."),
    ).toBeVisible();
    await expect(
      page.getByText("No hay eventos con estos filtros"),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Limpiar filtros" })).toHaveCount(
      0,
    );
    // The sidebar entry marks itself as the current page.
    await expect(agendaLink).toHaveAttribute("aria-current", "page");

    await expectNoAxeViolations(page, "/agenda empty state");
    await guard.assertClean();
  });

  test("S17-2 upcoming list, search + source filters, chips and Limpiar", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const stamp = Date.now();
    const scope = await agendaScope();
    // The distinguishing word goes LAST: searchMatches fuzzy-matches the
    // query's last token, so a shared trailing token (the stamp) would make
    // every row match every search.
    const manualTitle = `E2E agenda ${stamp} manual`;
    const hearingTitle = `E2E agenda ${stamp} audiencia`;
    const outsideTitle = `E2E agenda ${stamp} lejano`;
    const manualStart = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const hearingStart = new Date(
      Date.now() + 2 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const outsideStart = new Date(
      Date.now() + 45 * 24 * 60 * 60 * 1000,
    ).toISOString();
    let hearingId: string | null = null;

    try {
      await cleanSeededEvents();
      hearingId = await seedHearing(scope, hearingStart);
      await seedEvent(scope, {
        title: manualTitle,
        startAt: manualStart,
        location: "Secretaría 5",
      });
      await seedEvent(scope, {
        title: hearingTitle,
        startAt: hearingStart,
        source: "audiencia",
        hearingId,
      });
      await seedEvent(scope, { title: outsideTitle, startAt: outsideStart });

      await page.goto("/agenda");
      await expect(
        page.getByRole("heading", { name: "Agenda", exact: true }),
      ).toBeVisible();

      // The window shows the two upcoming rows in chronological order and
      // never the +45 days row (Próximos 30 días semantics).
      const items = page.getByRole("listitem");
      await expect(items).toHaveCount(2);
      await expect(items.nth(0)).toContainText(manualTitle);
      await expect(items.nth(1)).toContainText(hearingTitle);
      await expect(page.getByText(outsideTitle)).toHaveCount(0);
      // The audiencia row carries the source badge (word, never colour alone).
      // Exact match: the seeded title also contains the word "audiencia".
      await expect(
        items.nth(1).getByText("Audiencia", { exact: true }),
      ).toBeVisible();

      // Search narrows to the one row that mentions the phrase.
      const search = page.getByLabel("Buscar eventos");
      await search.fill(hearingTitle);
      await expect(items).toHaveCount(1);
      await expect(items.nth(0)).toContainText(hearingTitle);

      // No match → the recon verbatim copy + the active chip + Limpiar.
      await search.fill("zzzzagendaxyz");
      await expect(items).toHaveCount(0);
      await expect(
        page.getByText("No hay eventos con estos filtros"),
      ).toBeVisible();
      const searchChip = page.getByRole("button", {
        name: "Búsqueda: zzzzagendaxyz",
      });
      await expect(searchChip).toBeVisible();

      // Removing the chip clears exactly the search and restores the rows.
      await searchChip.click();
      await expect(search).toHaveValue("");
      await expect(items).toHaveCount(2);

      // Source overlay: Audiencias narrows to the audiencia row only.
      await page.getByLabel("Audiencias").check();
      await expect(items).toHaveCount(1);
      await expect(items.nth(0)).toContainText(hearingTitle);
      await page.getByLabel("Audiencias").uncheck();
      await expect(items).toHaveCount(2);

      // Vencimientos with no matching row → verbatim copy + chip + Limpiar.
      await page.getByLabel("Vencimientos").check();
      await expect(items).toHaveCount(0);
      await expect(
        page.getByText("No hay eventos con estos filtros"),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Vencimientos" }),
      ).toBeVisible();

      // Limpiar restores the full window and empties every criterion.
      await page.getByRole("button", { name: "Limpiar filtros" }).click();
      await expect(items).toHaveCount(2);
      await expect(page.getByLabel("Audiencias")).not.toBeChecked();
      await expect(page.getByLabel("Vencimientos")).not.toBeChecked();
      await expect(search).toHaveValue("");

      await expectNoAxeViolations(page, "/agenda filtered list");
      await guard.assertClean();
    } finally {
      await cleanSeededEvents();
      if (hearingId) await restSend("DELETE", `hearings?id=eq.${hearingId}`);
    }
  });

  test("S17-3 a failed read shows the recon error copy and Reintentar recovers", async ({
    page,
  }) => {
    const guard = guardPage(page, {
      ignoreConsole: (text) => text.includes("Failed to load resource"),
      ignoreResponse: (url) => url.includes("/rest/v1/events"),
    });
    const eventsPattern = "**/rest/v1/events*";
    await page.route(eventsPattern, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "forced failure for S17 slice 1" }),
      }),
    );

    await page.goto("/agenda");
    await expect(
      page.getByRole("heading", { name: "Agenda", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("No pudimos cargar la agenda")).toBeVisible();
    const retry = page.getByRole("button", { name: "Reintentar" });
    await expect(retry).toBeVisible();

    // Restore the transport and retry: the list loads (empty on this demo).
    await page.unroute(eventsPattern);
    await retry.click();
    await expect(
      page.getByText("Todavía no hay eventos en los próximos 30 días."),
    ).toBeVisible();
    await expect(retry).toHaveCount(0);

    await expectNoAxeViolations(page, "/agenda error state");
    await guard.assertClean();
  });
});

test.describe("S17 mobile 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("S17-4 /agenda fits 390 px with the mobile shell", async ({ page }) => {
    const guard = guardPage(page);
    await cleanSeededEvents();

    await page.goto("/agenda");
    await expect(
      page.getByRole("heading", { name: "Agenda", exact: true }),
    ).toBeVisible();
    // The bottom bar replaces the sidebar below 768 px (recon S38 shell).
    await expect(
      page.getByRole("navigation", { name: "Navegación principal" }),
    ).toBeVisible();
    await expect(page.getByLabel("Buscar eventos")).toBeVisible();
    await expect(
      page.getByText("Todavía no hay eventos en los próximos 30 días."),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoAxeViolations(page, "/agenda at 390");
    await guard.assertClean();
  });
});
