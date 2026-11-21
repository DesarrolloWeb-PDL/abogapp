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
 * the weekend/inhábil toggles and the "+N más" overflow. The T5a block
 * covers create/edit/detail-popover, and this unit finishes it with
 * Duplicar, Eliminar-with-confirm and the Día free-slot drag-create.
 * Fixtures seed
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
  caseId?: string;
  notes?: string;
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
    ...(options.caseId ? { case_id: options.caseId } : {}),
    ...(options.notes ? { notes: options.notes } : {}),
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

      // Month grid headers are Monday-first (columns come from agendaMonthGrid);
      // scope to the month table via its "+N más" overflow, not the mini-month.
      const monthTable = page
        .locator("table")
        .filter({ has: page.getByRole("button", { name: /\+\d+ más/ }) })
        .first();
      await expect(
        monthTable.getByRole("columnheader").first(),
      ).toHaveText("lun");

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

      // …and drops to the plain surface with the toggle off. Scoped to the
      // top-bar group: T5b mirrors this state in the left panel's own
      // "Fines de semana" checkbox (same label, other landmark).
      const topToggles = page.getByRole("group", {
        name: "Visibilidad de días",
      });
      await topToggles.getByLabel("Fines de semana").uncheck();
      await expect
        .poll(() => bg(satHeader))
        .toBe(plainBg);
      await topToggles.getByLabel("Fines de semana").check();
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
    // T5b: below lg the left panel hides behind its icon (recon: "narrow:
    // left panel hidden behind icon") — search included.
    const toggle = page.getByRole("button", { name: /panel de la agenda/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Buscar eventos")).toBeHidden();
    // The empty copy renders only after the client fetch — hydration proof.
    await expect(
      page.getByText("Todavía no hay eventos en los próximos 30 días."),
    ).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("Buscar eventos")).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Buscar eventos")).toBeHidden();
    // Ctrl+K while hidden: reveal the panel AND land on the search (the
    // deferred-focus path; the wide direct path is covered in S17-15).
    await page.keyboard.press("Control+k");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("Buscar eventos")).toBeFocused();
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

/* ------------------------------------------- T5a: create / edit / popover -- */

test.describe("S17 T5a — event create, edit and detail popover", () => {
  test("S17-8 C and Nuevo evento open the create form; an empty title refuses inline and a save lands the row", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const stamp = Date.now();
    const title = `E2E agenda ${stamp} creado`;

    try {
      await cleanSeededEvents();
      await page.goto("/agenda");
      // Hydration roundtrip BEFORE the first keystroke (L8 gotcha: keys
      // pressed before the listener attaches are silently dropped).
      await expect(
        page.getByRole("button", { name: "Lista", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: "Nuevo evento" })).toHaveAttribute(
        "aria-keyshortcuts",
        "C",
      );

      // C opens the form and the datetime fields arrive prefilled (today,
      // next whole hour — never empty, never in the past).
      await page.keyboard.press("c");
      const dialog = page.getByRole("dialog", { name: "Nuevo evento" });
      await expect(dialog).toBeVisible();
      await expect(page.getByLabel("Inicio", { exact: true })).toHaveValue(
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
      );
      await expect(page.getByLabel("Fin", { exact: true })).toHaveValue(
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
      );
      await expect(page.getByLabel("Título", { exact: true })).toBeFocused();

      // Empty title → the inline Spanish field error, nothing is written.
      await dialog.getByRole("button", { name: "Crear evento" }).click();
      await expect(page.getByText("Poné un título para el evento.")).toBeVisible();
      await expect(dialog).toBeVisible();

      // Fill + save → success toast, dialog closes, the row shows up.
      await page.getByLabel("Título", { exact: true }).fill(title);
      await expectNoAxeViolations(page, "/agenda create form (T5a)");
      await dialog.getByRole("button", { name: "Crear evento" }).click();
      await expect(page.getByText("Creaste el evento.")).toBeVisible();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: title, exact: true }),
      ).toBeVisible();

      // The top-bar affordance opens the same form, blank again; Esc closes.
      await page.getByRole("button", { name: "Nuevo evento" }).click();
      await expect(page.getByRole("dialog", { name: "Nuevo evento" })).toBeVisible();
      await expect(page.getByLabel("Título", { exact: true })).toHaveValue("");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);

      await guard.assertClean();
    } finally {
      await cleanSeededEvents();
    }
  });

  test("S17-9 detail popover from a Lista row shows the event, then Editar round-trips the title", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const stamp = Date.now();
    const title = `E2E agenda ${stamp} edición`;
    const newTitle = `E2E agenda ${stamp} editado`;
    const artToday = toArtDate(new Date().toISOString());
    const scope = await agendaScope();

    try {
      await cleanSeededEvents();
      await seedEvent(scope, {
        title,
        startAt: `${artToday}T14:00:00.000-03:00`,
        location: "Secretaría 4",
        notes: "Traer la cédula.",
        caseId: SEED.gomezId,
      });

      await page.goto("/agenda");
      await expect(
        page.getByRole("button", { name: "Lista", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");

      // The row title is the popover trigger.
      await page.getByRole("button", { name: title, exact: true }).click();
      const popover = page.getByRole("dialog", {
        name: `Detalle del evento: ${title}`,
      });
      await expect(popover).toBeVisible();
      // Content: ART time, location + map link, expediente link, notes.
      await expect(popover.getByText(/· 14:00 a 15:00/)).toBeVisible();
      await expect(popover.getByText("Traer la cédula.")).toBeVisible();
      await expect(
        popover.getByRole("link", { name: "Abrir en el mapa" }),
      ).toHaveAttribute("href", /google\.com\/maps\/search/);
      await expect(
        popover.getByRole("link", { name: SEED.caseGomez }),
      ).toHaveAttribute("href", `/expedientes/${SEED.gomezId}`);
      // No categories until T6: the color action hides itself (never invents).
      await expect(
        popover.getByRole("button", { name: "Cambiar color" }),
      ).toHaveCount(0);
      await expectNoAxeViolations(page, "/agenda detail popover (T5a)");

      // Editar → prefilled form → save → toast + the updated row.
      await popover.getByRole("button", { name: "Editar" }).click();
      const editDialog = page.getByRole("dialog", { name: "Editar evento" });
      await expect(editDialog).toBeVisible();
      await expect(page.getByLabel("Título", { exact: true })).toHaveValue(title);
      await expect(page.getByLabel("Inicio", { exact: true })).toHaveValue(
        new RegExp(`${artToday}T14:00`),
      );
      await page.getByLabel("Título", { exact: true }).fill(newTitle);
      await editDialog.getByRole("button", { name: "Guardar cambios" }).click();
      await expect(page.getByText("Actualizamos el evento.")).toBeVisible();
      await expect(editDialog).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: newTitle, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: title, exact: true }),
      ).toHaveCount(0);

      // Esc on a freshly reopened popover closes it and restores focus.
      await page.getByRole("button", { name: newTitle, exact: true }).click();
      await expect(
        page.getByRole("dialog", { name: `Detalle del evento: ${newTitle}` }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: newTitle, exact: true }),
      ).toBeFocused();

      await guard.assertClean();
    } finally {
      await cleanSeededEvents();
    }
  });

  test("S17-10 read-only audiencia popover: source action instead of edits, ⋯ without GCal/Assistant", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const stamp = Date.now();
    const title = `E2E agenda ${stamp} lectura`;
    const artToday = toArtDate(new Date().toISOString());
    const scope = await agendaScope();
    let hearingId: string | null = null;

    try {
      await cleanSeededEvents();
      hearingId = await seedHearing(
        scope,
        new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      );
      await seedEvent(scope, {
        title,
        startAt: `${artToday}T14:00:00.000-03:00`,
        source: "audiencia",
        hearingId,
        caseId: SEED.gomezId,
      });

      await page.goto("/agenda");
      await expect(
        page.getByRole("button", { name: "Lista", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");

      await page.getByRole("button", { name: title, exact: true }).click();
      const popover = page.getByRole("dialog", {
        name: `Detalle del evento: ${title}`,
      });
      await expect(popover).toBeVisible();
      // Source badge + the recon's single action; the edit family is absent.
      await expect(popover.getByText("Audiencia", { exact: true })).toBeVisible();
      await expect(
        popover.getByRole("link", { name: "Ver audiencia" }),
      ).toHaveAttribute("href", `/expedientes/${SEED.gomezId}`);
      await expect(popover.getByRole("button", { name: "Editar" })).toHaveCount(0);
      await expect(
        popover.getByRole("button", { name: "Cambiar color" }),
      ).toHaveCount(0);
      // The copy/delete family is manual-only too: read-only sources never
      // offer Duplicar/Eliminar (the driver's source guard is the backstop
      // behind this UI gate).
      await expect(
        popover.getByRole("button", { name: "Duplicar", exact: true }),
      ).toHaveCount(0);
      await expect(
        popover.getByRole("button", { name: "Eliminar", exact: true }),
      ).toHaveCount(0);

      // ⋯ menu: Copiar enlace + Ver el expediente exist; Google Calendar and
      // the Assistant are absent (no credentials / no assistant surface).
      const menuTrigger = popover.getByRole("button", {
        name: `Más acciones del evento ${title}`,
      });
      await menuTrigger.click();
      const menu = page.getByRole("menu");
      await expect(menu.getByRole("menuitem", { name: "Copiar enlace" })).toBeVisible();
      await expect(
        menu.getByRole("menuitem", { name: "Ver el expediente" }),
      ).toBeVisible();
      await expect(
        menu.getByRole("menuitem", { name: "Abrir en Google Calendar" }),
      ).toHaveCount(0);
      await expect(
        menu.getByRole("menuitem", { name: "Preguntar al Asistente IA" }),
      ).toHaveCount(0);
      await expectNoAxeViolations(page, "/agenda popover read-only (T5a)");

      // Esc peels one layer at a time: the menu first, the popover second.
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(popover).toBeVisible();

      // Copiar enlace copies THIS view's URL (no per-event permalink exists)
      // and confirms with a toast.
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await menuTrigger.click();
      await page.getByRole("menuitem", { name: "Copiar enlace" }).click();
      await expect(page.getByText("Copiamos el enlace.")).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);

      await guard.assertClean();
    } finally {
      await cleanSeededEvents();
      if (hearingId) await restSend("DELETE", `hearings?id=eq.${hearingId}`);
    }
  });

  test("S17-11 a Día view event block opens the same detail popover", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const stamp = Date.now();
    const title = `E2E agenda ${stamp} bloque`;
    const artToday = toArtDate(new Date().toISOString());
    const scope = await agendaScope();

    try {
      await cleanSeededEvents();
      await seedEvent(scope, {
        title,
        startAt: `${artToday}T14:00:00.000-03:00`,
      });

      await page.goto("/agenda");
      // Hydration roundtrip (L8 gotcha): the seeded row renders only after
      // the panel's mount effects ran, so the keydown listener that owns
      // the "d" shortcut is attached by the time the key is pressed.
      await expect(
        page.getByRole("button", { name: title, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Lista", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("d");
      await expect(page.getByRole("button", { name: "Día", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      // The absolutely positioned time-grid block is a real button now.
      await page.getByRole("button", { name: /14:00/ }).click();
      await expect(
        page.getByRole("dialog", { name: `Detalle del evento: ${title}` }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);

      await guard.assertClean();
    } finally {
      await cleanSeededEvents();
    }
  });

  test("S17-12 Duplicar copies the manual event; Eliminar confirms, refuses and retries", async ({
    page,
  }) => {
    const guard = guardPage(page, {
      ignoreConsole: (text) => text.includes("Failed to load resource"),
      ignoreResponse: (url) => url.includes("/rest/v1/events"),
    });
    const stamp = Date.now();
    const title = `E2E agenda ${stamp} duplicar`;
    const artToday = toArtDate(new Date().toISOString());
    const scope = await agendaScope();

    try {
      await cleanSeededEvents();
      await seedEvent(scope, {
        title,
        startAt: `${artToday}T14:00:00.000-03:00`,
        location: "Secretaría 6",
        notes: "Traer el escrito.",
        caseId: SEED.gomezId,
      });

      await page.goto("/agenda");
      await expect(
        page.getByRole("button", { name: "Lista", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      const rows = page.getByRole("button", { name: title, exact: true });
      await expect(rows).toHaveCount(1);

      // Duplicar: offered on manual rows, and the copy carries every field
      // the user then edits (title/time/location/notes/expediente).
      await rows.click();
      const popover = page.getByRole("dialog", {
        name: `Detalle del evento: ${title}`,
      });
      // exact: true — the ⋯ trigger's label embeds the title, and substring
      // matching would let "duplicar" hit both it and the real button.
      await expect(
        popover.getByRole("button", { name: "Duplicar", exact: true }),
      ).toBeVisible();
      await expect(
        popover.getByRole("button", { name: "Eliminar", exact: true }),
      ).toBeVisible();
      await expectNoAxeViolations(page, "/agenda duplicate/delete actions (T5a)");
      await popover
        .getByRole("button", { name: "Duplicar", exact: true })
        .click();
      await expect(page.getByText("Duplicamos el evento.")).toBeVisible();
      await expect(rows).toHaveCount(2);

      const copies = await restGet<
        { location: string; notes: string; case_id: string | null; start_at: string }[]
      >(
        `events?title=eq.${encodeURIComponent(title)}` +
          "&select=location,notes,case_id,start_at",
      );
      expect(copies).toHaveLength(2);
      for (const copy of copies) {
        expect(copy.location).toBe("Secretaría 6");
        expect(copy.notes).toBe("Traer el escrito.");
        expect(copy.case_id).toBe(SEED.gomezId);
        expect(Date.parse(copy.start_at)).toBe(
          Date.parse(`${artToday}T14:00:00.000-03:00`),
        );
      }

      // Eliminar: the confirm modal asks first; Cancelar keeps both rows.
      await rows.first().click();
      const confirm = page.getByRole("dialog", { name: "Eliminar evento" });
      await popover.getByRole("button", { name: "Eliminar", exact: true }).click();
      await expect(confirm).toBeVisible();
      await expect(confirm).toContainText(
        `¿Seguro que querés eliminar «${title}»?`,
      );
      await expect(confirm).toContainText("Esta acción no se puede deshacer.");
      await expectNoAxeViolations(page, "/agenda delete confirm (T5a)");
      await confirm.getByRole("button", { name: "Cancelar" }).click();
      await expect(confirm).toHaveCount(0);
      await expect(rows).toHaveCount(2);

      // A refused delete keeps the dialog open so the user can retry.
      const eventsPattern = "**/rest/v1/events*";
      await page.route(eventsPattern, (route) =>
        route.request().method() === "DELETE"
          ? route.fulfill({
              status: 500,
              contentType: "application/json",
              body: JSON.stringify({ message: "forced refusal for S17 T5a" }),
            })
          : route.continue(),
      );
      await popover
        .getByRole("button", { name: "Eliminar", exact: true })
        .click();
      await expect(confirm).toBeVisible();
      await confirm.getByRole("button", { name: "Eliminar", exact: true }).click();
      await expect(
        page.getByText(
          "No pudimos completar la operación. Probá otra vez en unos minutos.",
        ),
      ).toBeVisible();
      await expect(confirm).toBeVisible();
      await expect(rows).toHaveCount(2);

      await page.unroute(eventsPattern);
      await confirm.getByRole("button", { name: "Eliminar", exact: true }).click();
      await expect(page.getByText("Eliminamos el evento.")).toBeVisible();
      await expect(confirm).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(rows).toHaveCount(1);

      await guard.assertClean();
    } finally {
      await cleanSeededEvents();
    }
  });

  test("S17-13 Día free slot: hover hint, drag creates the range, Enter falls back", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const scope = await agendaScope();
    const artToday = toArtDate(new Date().toISOString());

    try {
      await cleanSeededEvents();
      // One row so the Día grid renders at all (an empty period shows the
      // empty state instead of the grid).
      const title = `E2E agenda ${Date.now()} slot`;
      await seedEvent(scope, {
        title,
        startAt: `${artToday}T14:00:00.000-03:00`,
      });

      await page.goto("/agenda");
      // Hydration roundtrip (L8 gotcha): the row renders only after the
      // panel's mount effects ran, so the "d" shortcut listener is live.
      await expect(
        page.getByRole("button", { name: title, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Lista", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("d");
      await expect(
        page.getByRole("button", { name: "Día", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByText("23:00")).toBeVisible(); // the hour gutter

      const layer = page.getByRole("button", {
        name: "Horario libre: crear un evento",
      });
      await expect(layer).toBeVisible();
      // The view switch kicks off a refetch whose transient refresh bar
      // (2px + gap-4) sits directly above the grid: when it disappears the
      // column shifts up ~18 px, so the gesture coordinates are measured
      // only after the refresh settles — otherwise the same press lands
      // one slot (15 min) off.
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      await expectNoAxeViolations(page, "/agenda Día free slot (T5a)");
      await layer.evaluate((element) =>
        element.scrollIntoView({ block: "center" }),
      );
      const box = await layer.boundingBox();
      expect(box, "the Día column has a box").not.toBeNull();
      const column = box as NonNullable<typeof box>;
      // Two free points at fixed minutes of the 24-hour column (the drag
      // math snaps to 15 minutes; these sit well inside their slots).
      const minutesToY = (minutes: number) =>
        column.y + (column.height * minutes) / 1440;
      const x = column.x + column.width / 2;
      const yStart = minutesToY(9 * 60 + 30); // 09:30
      const yEnd = minutesToY(13 * 60 + 15); // 13:15
      const viewport = page.viewportSize();
      expect(viewport).not.toBeNull();
      expect(yStart, "start point inside the viewport").toBeGreaterThan(0);
      expect(yEnd, "end point inside the viewport").toBeLessThan(
        (viewport as NonNullable<typeof viewport>).height,
      );

      // Hover announces the snapped slot in the recon's wording.
      await page.mouse.move(x, yStart);
      await expect(
        page.getByText("Libre de 09:30 · arrastrá para crear"),
      ).toBeVisible();

      // Drag 09:30 → 13:15: the create form arrives with THAT range.
      await page.mouse.down();
      await page.mouse.move(x, yEnd, { steps: 6 });
      await page.mouse.up();
      const dialog = page.getByRole("dialog", { name: "Nuevo evento" });
      await expect(dialog).toBeVisible();
      await expect(page.getByLabel("Inicio", { exact: true })).toHaveValue(
        `${artToday}T09:30`,
      );
      await expect(page.getByLabel("Fin", { exact: true })).toHaveValue(
        `${artToday}T13:15`,
      );
      await expect(page.getByLabel("Título", { exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);

      // Keyboard fallback: Enter on the focused free slot opens the same
      // form with the day's default prefill — never an empty range.
      await layer.focus();
      await page.keyboard.press("Enter");
      await expect(dialog).toBeVisible();
      await expect(page.getByLabel("Inicio", { exact: true })).toHaveValue(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
      );
      await expect(page.getByLabel("Fin", { exact: true })).toHaveValue(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
      );
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);

      await guard.assertClean();
    } finally {
      await cleanSeededEvents();
    }
  });
});

/* ---------------------------------------- T5b: left panel (mini-month) ---- */

test.describe("S17 T5b — left panel mini-month", () => {
  test("S17-15 dots, Ctrl+K focus, month nav and day click open Día", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const stamp = Date.now();
    const scope = await agendaScope();
    const artToday = toArtDate(new Date().toISOString());
    const day15 = `${artToday.slice(0, 7)}-15`;
    const day15Slash = `${day15.slice(8, 10)}/${day15.slice(5, 7)}/${day15.slice(0, 4)}`;
    const title = `E2E agenda ${stamp} mini`;
    const panel = page.getByRole("complementary", {
      name: "Panel de la agenda",
    });

    try {
      await cleanSeededEvents();
      // Day 15 of the current month: outside the Lista window whenever
      // today > the 5th, so the dot proves the mini-month reads its OWN
      // month (same filters) instead of borrowing the list's rows.
      await seedEvent(scope, {
        title,
        startAt: `${day15}T14:00:00.000-03:00`,
      });

      await page.goto("/agenda");
      // The dot needs hydration + the mini fetch → it doubles as the
      // hydration proof before any keyboard use (L8 gotcha).
      const dayButton = panel.getByRole("button", {
        name: new RegExp(`${day15Slash}, 1 evento`),
      });
      await expect(dayButton).toBeVisible();

      // Ctrl+K focuses the panel search in place (wide direct-focus path).
      await page.keyboard.press("Control+k");
      await expect(page.getByLabel("Buscar eventos")).toBeFocused();

      // The mini-month nav steps the anchor's month (title round-trip);
      // the dot returns because the month read refetches.
      await panel.getByRole("button", { name: "Mes anterior" }).click();
      await expect(
        panel.getByText(prevMonthHeading(artToday), { exact: true }),
      ).toBeVisible();
      await panel.getByRole("button", { name: "Mes siguiente" }).click();
      await expect(
        panel.getByText(monthHeading(artToday), { exact: true }),
      ).toBeVisible();
      await expect(dayButton).toBeVisible();

      // Clicking a day opens it in Día view (the "+N más" semantics).
      await dayButton.click();
      await expect(
        page.getByRole("button", { name: "Día", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        page.getByRole("heading", { name: new RegExp(day15Slash) }),
      ).toBeVisible();
      // The grid block's name carries the ART clock prefix (S17-11 pattern).
      await expect(
        page.getByRole("button", { name: `14:00 ${title}`, exact: true }),
      ).toBeVisible();

      await expectNoAxeViolations(page, "/agenda mini-month (T5b)");
      await guard.assertClean();
    } finally {
      await cleanSeededEvents();
    }
  });

  test("S17-16 hatched inhábiles carry a legend; both weekend checkboxes stay in sync", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const stamp = Date.now();
    const scope = await agendaScope();
    const artToday = toArtDate(new Date().toISOString());
    const hatchDay = `${artToday.slice(0, 7)}-15`;
    const hatchSlash = `${hatchDay.slice(8, 10)}/${hatchDay.slice(5, 7)}/${hatchDay.slice(0, 4)}`;
    const panel = page.getByRole("complementary", {
      name: "Panel de la agenda",
    });
    const topToggles = page.getByRole("group", {
      name: "Visibilidad de días",
    });
    // Tolerates a stray event on the same day: date, optional count, hatch.
    const hatchButton = panel.getByRole("button", {
      name: new RegExp(`${hatchSlash}(, \\d+ eventos?)?, día inhábil`),
    });
    const legend = panel.getByText("Día inhábil", { exact: true });

    // Pre-clean (crashed-run leftovers) before inserting the studio day.
    await restSend(
      "DELETE",
      `calendar_days?study_id=eq.${scope.study_id}&day=eq.${hatchDay}`,
    );
    try {
      await cleanSeededEvents();
      await restSend("POST", "calendar_days", {
        study_id: scope.study_id,
        day: hatchDay,
        kind: "inhabil",
        name: `E2E agenda panel ${stamp}`,
      });

      await page.goto("/agenda");
      // The empty copy renders only after the client fetch → hydration
      // proof before touching controls (static Jan/Jul feria could make
      // the hatch itself render server-side).
      await expect(
        page.getByText("Todavía no hay eventos en los próximos 30 días."),
      ).toBeVisible();
      await expect(hatchButton).toBeVisible();
      await expect(legend).toBeVisible();

      // The top-bar Días inhábiles toggle gates the hatch AND its legend.
      await page.getByLabel("Días inhábiles").uncheck();
      await expect(hatchButton).toHaveCount(0);
      await expect(legend).toHaveCount(0);
      await page.getByLabel("Días inhábiles").check();
      await expect(hatchButton).toBeVisible();
      await expect(legend).toBeVisible();

      // The panel's Fines de semana mirrors the top-bar toggle (one state).
      const panelWeekend = panel.getByLabel("Fines de semana");
      const topWeekend = topToggles.getByLabel("Fines de semana");
      await expect(panelWeekend).toBeChecked();
      await panelWeekend.uncheck();
      await expect(topWeekend).not.toBeChecked();
      await topWeekend.check();
      await expect(panelWeekend).toBeChecked();

      await expectNoAxeViolations(page, "/agenda hatch legend (T5b)");
      await guard.assertClean();
    } finally {
      await restSend(
        "DELETE",
        `calendar_days?study_id=eq.${scope.study_id}&day=eq.${hatchDay}`,
      );
    }
  });
});
