import { test, expect, type Page } from "@playwright/test";
import {
  SEED,
  expectNoAxeViolations,
  guardPage,
  restGet,
  restSend,
  toArtDate,
} from "./helpers";

/**
 * S17 — the shared studio calendar: slice 1 (T2) covers the Lista view,
 * its verbatim empty/error copy and the 390 px shell; the T4 block adds
 * the four period views, ‹ ›/Hoy navigation, the D/S/M/A/L + H shortcuts,
 * the weekend/inhábil toggles and the "+N más" overflow. Fixtures seed
 * through the same REST seam (demo token + `events_member` RLS), prefixed
 * `E2E agenda %` so a crashed run can pre-clean; cleanup runs in `finally`.
 * The audiencia row needs a real `hearings` parent because init.sql's
 * `chk_event_source_fk` ties source='audiencia' to a hearing_id.
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

/* ------------------------------------------- T4: period view helpers ---- */

const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

/** The panel's Mes title for an ART day ("Noviembre 2026"). */
function monthHeading(day: string): string {
  const [year, month] = day.split("-");
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

/** The same title one ‹ step earlier (Jan rolls to December, prev year). */
function prevMonthHeading(day: string): string {
  const [year, month] = day.split("-").map(Number);
  const prev = new Date(Date.UTC(year, month - 2, 1));
  return `${MONTHS[prev.getUTCMonth()]} ${prev.getUTCFullYear()}`;
}

test.describe("S17 T4 — period views, navigation, shortcuts", () => {
  test("S17-5 view selector, period navigation, shortcuts and the month overflow", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const stamp = Date.now();
    const scope = await agendaScope();
    const artToday = toArtDate(new Date().toISOString());
    const atHour = (hour: number) =>
      new Date(
        `${artToday}T${String(hour).padStart(2, "0")}:00:00.000-03:00`,
      ).toISOString();
    const overflowTitle = `E2E agenda ${stamp} overflow`;
    const year = artToday.slice(0, 4);
    const currentHeading = monthHeading(artToday);
    const previousHeading = prevMonthHeading(artToday);

    try {
      await cleanSeededEvents();
      // Three rows on ONE day: that month cell must overflow with "+N más".
      for (const hour of [10, 11, 12]) {
        await seedEvent(scope, {
          title: `${overflowTitle} ${hour}`,
          startAt: atHour(hour),
        });
      }

      await page.goto("/agenda");

      // Opens in Lista (both surfaces): all five views offered, ‹ › resting.
      await expect(
        page.getByRole("button", { name: "Lista", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      for (const label of ["Día", "Semana", "Mes", "Año"]) {
        await expect(
          page.getByRole("button", { name: label, exact: true }),
        ).toBeVisible();
      }
      await expect(
        page.getByRole("heading", { name: "Próximos 30 días", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Periodo anterior" }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Periodo siguiente" }),
      ).toBeDisabled();

      // Shortcut M → Mes with the Spanish period title.
      await page.keyboard.press("m");
      await expect(
        page.getByRole("button", { name: "Mes", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        page.getByRole("heading", { name: currentHeading, exact: true }),
      ).toBeVisible();

      // ‹ › walk one month each way (period navigation).
      await page.getByRole("button", { name: "Periodo anterior" }).click();
      await expect(
        page.getByRole("heading", { name: previousHeading, exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Periodo siguiente" }).click();
      await expect(
        page.getByRole("heading", { name: currentHeading, exact: true }),
      ).toBeVisible();

      // "+N más" (three rows on one day) opens that day in Día view.
      const overflowCell = page
        .locator("td")
        .filter({ hasText: `${overflowTitle} 10` })
        .first();
      const moreButton = overflowCell.getByRole("button", {
        name: /\+\d+ más/,
      });
      await expect(moreButton).toBeVisible();
      await expectNoAxeViolations(page, "/agenda Mes (T4)");
      await moreButton.click();
      await expect(
        page.getByRole("button", { name: "Día", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByText("23:00")).toBeVisible(); // the hour gutter

      // Semana shows the recon's ISO-week badge; Año the twelve mini-months.
      await page.getByRole("button", { name: "Semana", exact: true }).click();
      await expect(page.getByRole("heading", { name: /Semana \d+/ })).toBeVisible();
      await expectNoAxeViolations(page, "/agenda Semana (T4)");
      await page.getByRole("button", { name: "Año", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: year, exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { level: 3 })).toHaveCount(12);
      await expectNoAxeViolations(page, "/agenda Año (T4)");

      // ‹ steps a year back, H (Hoy) resets it, L returns to Lista.
      await page.getByRole("button", { name: "Periodo anterior" }).click();
      await expect(
        page.getByRole("heading", {
          name: String(Number(year) - 1),
          exact: true,
        }),
      ).toBeVisible();
      await page.keyboard.press("h");
      await expect(
        page.getByRole("heading", { name: year, exact: true }),
      ).toBeVisible();
      await page.keyboard.press("l");
      await expect(
        page.getByRole("button", { name: "Lista", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        page.getByRole("heading", { name: "Próximos 30 días", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Periodo anterior" }),
      ).toBeDisabled();

      await expectNoAxeViolations(page, "/agenda Lista after T4 round-trip");
      await guard.assertClean();
    } finally {
      await cleanSeededEvents();
    }
  });

  test("S17-6 week view: Inhábil label from the loaded set + weekend shading toggle", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const stamp = Date.now();
    const scope = await agendaScope();
    const artToday = toArtDate(new Date().toISOString());
    // Monday of the ART week, then its Wednesday (label day — always in the
    // displayed week, even when today is Sunday) and its Saturday/Friday.
    const monday = new Date(`${artToday}T12:00:00Z`);
    monday.setUTCDate(
      monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7),
    );
    const iso = (date: Date) => date.toISOString().slice(0, 10);
    const studioDay = new Date(monday);
    studioDay.setUTCDate(monday.getUTCDate() + 2); // Wednesday
    const saturday = new Date(monday);
    saturday.setUTCDate(monday.getUTCDate() + 5);
    const friday = new Date(monday);
    friday.setUTCDate(monday.getUTCDate() + 4);
    const eventTitle = `E2E agenda ${stamp} week`;

    // Pre-clean the studio row (crashed-run leftovers) before inserting.
    await restSend(
      "DELETE",
      `calendar_days?study_id=eq.${scope.study_id}&day=eq.${iso(studioDay)}`,
    );
    try {
      await cleanSeededEvents();
      await restSend("POST", "calendar_days", {
        study_id: scope.study_id,
        day: iso(studioDay),
        kind: "inhabil",
        name: `E2E agenda dia ${stamp}`,
      });
      // One row so the week grid renders at all (an empty period shows
      // the empty state instead of the grid).
      await seedEvent(scope, {
        title: eventTitle,
        startAt: `${artToday}T15:00:00.000-03:00`,
      });

      await page.goto("/agenda");
      // Roundtrips before the first keystroke: they give hydration time to
      // attach the panel's keydown listener (same pattern as S17-5).
      await expect(
        page.getByRole("heading", { name: "Próximos 30 días", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Lista", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("s"); // Semana shortcut
      await expect(
        page.getByRole("heading", { name: /Semana \d+/ }),
      ).toBeVisible();

      // The label comes from loadNonWorkingDays (the studio calendar_days
      // row), never a hardcoded holiday list.
      await expect(page.getByText("Inhábil", { exact: true })).toBeVisible();

      // Weekend shading: Saturday ≠ Friday while the toggle is on…
      // (the bg class lives on the header cell, one level above the text.)
      const satHeader = page
        .getByText(`sáb ${saturday.getUTCDate()}`, { exact: true })
        .locator("..");
      const friHeader = page
        .getByText(`vie ${friday.getUTCDate()}`, { exact: true })
        .locator("..");
      const bg = (header: typeof satHeader) =>
        header.evaluate((el) => getComputedStyle(el).backgroundColor);
      const shadedBg = await bg(satHeader);
      const plainBg = await bg(friHeader);
      expect(shadedBg).not.toBe(plainBg);

      // …and drops to the plain surface with the toggle off.
      await page.getByLabel("Fines de semana").uncheck();
      await expect
        .poll(() => bg(satHeader))
        .toBe(plainBg);
      await page.getByLabel("Fines de semana").check();
      await expect.poll(() => bg(satHeader)).not.toBe(plainBg);

      // The Días inhábiles toggle owns the "Inhábil" label.
      await page.getByLabel("Días inhábiles").uncheck();
      await expect(page.getByText("Inhábil", { exact: true })).toHaveCount(0);
      await page.getByLabel("Días inhábiles").check();
      await expect(page.getByText("Inhábil", { exact: true })).toBeVisible();

      await expectNoAxeViolations(page, "/agenda Semana toggles (T4)");
      await guard.assertClean();
    } finally {
      await cleanSeededEvents();
      await restSend(
        "DELETE",
        `calendar_days?study_id=eq.${scope.study_id}&day=eq.${iso(studioDay)}`,
      );
    }
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

  test("S17-7 only Día and Lista are offered at 390 px (no Año)", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const scope = await agendaScope();
    const artToday = toArtDate(new Date().toISOString());
    let seeded = false;

    try {
      await cleanSeededEvents();
      // One row so the Día grid has something to render below.
      await seedEvent(scope, {
        title: `E2E agenda ${Date.now()} mobile`,
        startAt: `${artToday}T16:00:00.000-03:00`,
      });
      seeded = true;

      await page.goto("/agenda");
      const diaButton = page.getByRole("button", { name: "Día", exact: true });
      const listaButton = page.getByRole("button", {
        name: "Lista",
        exact: true,
      });
      await expect(diaButton).toBeVisible();
      await expect(listaButton).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Semana", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Mes", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Año", exact: true }),
      ).toHaveCount(0);

      // A wide-only shortcut cannot strand the narrow screen on a view it
      // does not offer: A is refused, Lista stays put.
      await page.keyboard.press("a");
      await expect(listaButton).toHaveAttribute("aria-pressed", "true");

      // Día still switches and its time grid fits the viewport.
      await page.keyboard.press("d");
      await expect(diaButton).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByText("23:00")).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNoAxeViolations(page, "/agenda Día at 390");
      await guard.assertClean();
    } finally {
      if (seeded) await cleanSeededEvents();
    }
  });
});
