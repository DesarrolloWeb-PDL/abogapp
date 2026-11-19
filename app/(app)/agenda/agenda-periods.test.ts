import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/data";
import {
  AGENDA_MONTH_NAMES,
  AGENDA_VIEWS,
  AGENDA_VIEW_LABELS,
  AGENDA_VIEW_SHORTCUTS,
  agendaBucketByDay,
  agendaClock,
  agendaDayShaded,
  agendaEventLanes,
  agendaEventPlacement,
  agendaHeatLevel,
  agendaMonthGrid,
  agendaPeriodTitle,
  agendaPeriodWindow,
  agendaShortcutAction,
  agendaShowsInhabilLabel,
  agendaWeekendShaded,
  agendaWeekDays,
  agendaWeekStart,
  agendaYearMonths,
  availableAgendaViews,
  clampAgendaView,
  isAgendaDay,
  isoWeekNumber,
  shiftAgendaPeriod,
} from "./agenda-periods";

/**
 * Pure helpers behind the T4 period views (S17): view vocabulary +
 * mobile availability, the D/S/M/A/L + H keyboard map, period math (bounds,
 * navigation, titles incl. the "Semana N" label), the weekend/inhábil
 * toggle predicates and the grid bucketing/lanes the day/week/month/year
 * views render from. Node-only (no jsdom): every function here is
 * side-effect free, and the interaction contract travels to
 * e2e/s17-agenda.spec.ts.
 */

/** CalendarEvent factory: only id/startAt/endAt matter for grid logic. */
function makeEvent(
  overrides: Partial<CalendarEvent> & Pick<CalendarEvent, "id" | "startAt">,
): CalendarEvent {
  const parsed = Date.parse(overrides.startAt);
  return {
    studyId: "study-1",
    caseId: null,
    caseCaratula: "",
    categoryId: null,
    category: null,
    title: `Evento ${overrides.id}`,
    endAt: Number.isNaN(parsed)
      ? "end-invalid"
      : new Date(parsed + 60 * 60 * 1000).toISOString(),
    location: "",
    notes: "",
    source: "manual",
    createdAt: "2026-11-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("view vocabulary", () => {
  it("exposes the five recon views in selector order", () => {
    expect([...AGENDA_VIEWS]).toEqual(["dia", "semana", "mes", "anio", "lista"]);
  });

  it("labels every view in Spanish (recon selector copy)", () => {
    expect(AGENDA_VIEW_LABELS).toEqual({
      dia: "Día",
      semana: "Semana",
      mes: "Mes",
      anio: "Año",
      lista: "Lista",
    });
    for (const view of AGENDA_VIEWS) {
      expect(AGENDA_VIEW_LABELS[view].trim()).not.toBe("");
    }
  });

  it("maps the recon shortcuts D/S/M/A/L (lowercase single keys)", () => {
    expect(AGENDA_VIEW_SHORTCUTS).toEqual({
      dia: "d",
      semana: "s",
      mes: "m",
      anio: "a",
      lista: "l",
    });
  });
});

describe("availableAgendaViews / clampAgendaView", () => {
  it("offers every view on wide screens", () => {
    expect([...availableAgendaViews(false)]).toEqual([
      "dia",
      "semana",
      "mes",
      "anio",
      "lista",
    ]);
  });

  it("narrows to Lista or Día only (recon: mobile has no Año)", () => {
    expect([...availableAgendaViews(true)]).toEqual(["dia", "lista"]);
  });

  it("clamps an unavailable narrow view to the mobile default (lista)", () => {
    expect(clampAgendaView("anio", true)).toBe("lista");
    expect(clampAgendaView("mes", true)).toBe("lista");
    expect(clampAgendaView("semana", true)).toBe("lista");
  });

  it("keeps available views untouched in both widths", () => {
    expect(clampAgendaView("dia", true)).toBe("dia");
    expect(clampAgendaView("lista", true)).toBe("lista");
    expect(clampAgendaView("anio", false)).toBe("anio");
  });
});

describe("agendaShortcutAction", () => {
  const key = (k: string, extra: Partial<KeyboardEvent> = {}) => ({
    key: k,
    ...extra,
  });

  it("maps D/S/M/A/L to the view actions (wide)", () => {
    expect(agendaShortcutAction(key("d"), null, false)).toEqual({
      type: "view",
      view: "dia",
    });
    expect(agendaShortcutAction(key("s"), null, false)).toEqual({
      type: "view",
      view: "semana",
    });
    expect(agendaShortcutAction(key("m"), null, false)).toEqual({
      type: "view",
      view: "mes",
    });
    expect(agendaShortcutAction(key("a"), null, false)).toEqual({
      type: "view",
      view: "anio",
    });
    expect(agendaShortcutAction(key("l"), null, false)).toEqual({
      type: "view",
      view: "lista",
    });
  });

  it("accepts uppercase keys and maps H to Hoy", () => {
    expect(agendaShortcutAction(key("D"), null, false)).toEqual({
      type: "view",
      view: "dia",
    });
    expect(agendaShortcutAction(key("H"), null, false)).toEqual({
      type: "today",
    });
  });

  it("ignores keys while a modifier is held (browser shortcuts stay ours)", () => {
    expect(agendaShortcutAction(key("d", { ctrlKey: true }), null, false)).toBeNull();
    expect(agendaShortcutAction(key("d", { metaKey: true }), null, false)).toBeNull();
    expect(agendaShortcutAction(key("d", { altKey: true }), null, false)).toBeNull();
  });

  it("ignores keys typed into form fields and editable targets", () => {
    expect(
      agendaShortcutAction(key("d"), { tagName: "INPUT" }, false),
    ).toBeNull();
    expect(
      agendaShortcutAction(key("d"), { tagName: "textarea" }, false),
    ).toBeNull();
    expect(agendaShortcutAction(key("d"), { tagName: "SELECT" }, false)).toBeNull();
    expect(
      agendaShortcutAction(key("d"), { tagName: "DIV", isContentEditable: true }, false),
    ).toBeNull();
    // A plain (non-editable) target still fires.
    expect(
      agendaShortcutAction(key("d"), { tagName: "BUTTON" }, false),
    ).toEqual({ type: "view", view: "dia" });
  });

  it("refuses unavailable views on narrow screens but keeps Día/Lista/Hoy", () => {
    expect(agendaShortcutAction(key("s"), null, true)).toBeNull();
    expect(agendaShortcutAction(key("m"), null, true)).toBeNull();
    expect(agendaShortcutAction(key("a"), null, true)).toBeNull();
    expect(agendaShortcutAction(key("d"), null, true)).toEqual({
      type: "view",
      view: "dia",
    });
    expect(agendaShortcutAction(key("l"), null, true)).toEqual({
      type: "view",
      view: "lista",
    });
    expect(agendaShortcutAction(key("h"), null, true)).toEqual({ type: "today" });
  });

  it("returns null for unrelated keys", () => {
    expect(agendaShortcutAction(key("z"), null, false)).toBeNull();
    expect(agendaShortcutAction(key("Enter"), null, false)).toBeNull();
    expect(agendaShortcutAction(key("F2"), null, false)).toBeNull();
    expect(agendaShortcutAction(key("ArrowLeft"), null, false)).toBeNull();
  });
});

describe("agendaPeriodWindow", () => {
  it("resolves Día to the ART day [midnight, next midnight)", () => {
    expect(agendaPeriodWindow("dia", "2026-11-25")).toEqual({
      from: "2026-11-25T03:00:00.000Z",
      to: "2026-11-26T03:00:00.000Z",
    });
  });

  it("resolves Semana to the Monday-started week", () => {
    // 2026-11-25 is a Wednesday → the week runs Mon 23 → Mon 30.
    expect(agendaPeriodWindow("semana", "2026-11-25")).toEqual({
      from: "2026-11-23T03:00:00.000Z",
      to: "2026-11-30T03:00:00.000Z",
    });
  });

  it("resolves Mes to the full calendar month", () => {
    expect(agendaPeriodWindow("mes", "2026-11-25")).toEqual({
      from: "2026-11-01T03:00:00.000Z",
      to: "2026-12-01T03:00:00.000Z",
    });
    expect(agendaPeriodWindow("mes", "2026-02-10")).toEqual({
      from: "2026-02-01T03:00:00.000Z",
      to: "2026-03-01T03:00:00.000Z",
    });
  });

  it("resolves Año to the full calendar year", () => {
    expect(agendaPeriodWindow("anio", "2026-11-25")).toEqual({
      from: "2026-01-01T03:00:00.000Z",
      to: "2027-01-01T03:00:00.000Z",
    });
  });

  it("returns null for Lista (the driver fills the upcoming window) and invalid anchors", () => {
    expect(agendaPeriodWindow("lista", "2026-11-25")).toBeNull();
    expect(agendaPeriodWindow("mes", "nope")).toBeNull();
    expect(agendaPeriodWindow("mes", "2026-13-01")).toBeNull();
    expect(agendaPeriodWindow("mes", "2026-02-30")).toBeNull();
  });
});

describe("shiftAgendaPeriod", () => {
  it("moves Día one day at a time across month boundaries", () => {
    expect(shiftAgendaPeriod("dia", "2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftAgendaPeriod("dia", "2026-12-01", -1)).toBe("2026-11-30");
  });

  it("moves Semana seven days", () => {
    expect(shiftAgendaPeriod("semana", "2026-11-25", 1)).toBe("2026-12-02");
    expect(shiftAgendaPeriod("semana", "2026-11-25", -1)).toBe("2026-11-18");
  });

  it("moves Mes one month, clamping the day and rolling the year", () => {
    expect(shiftAgendaPeriod("mes", "2026-11-15", 1)).toBe("2026-12-15");
    expect(shiftAgendaPeriod("mes", "2026-12-15", 1)).toBe("2027-01-15");
    expect(shiftAgendaPeriod("mes", "2026-12-15", -1)).toBe("2026-11-15");
    // Jan 31 → Feb 28 (2026 is not a leap year).
    expect(shiftAgendaPeriod("mes", "2026-01-31", 1)).toBe("2026-02-28");
  });

  it("moves Año one year, clamping Feb 29", () => {
    expect(shiftAgendaPeriod("anio", "2027-06-10", -1)).toBe("2026-06-10");
    expect(shiftAgendaPeriod("anio", "2028-02-29", 1)).toBe("2029-02-28");
    expect(shiftAgendaPeriod("anio", "2026-11-25", 1)).toBe("2027-11-25");
  });

  it("leaves Lista and invalid anchors unchanged (nav is disabled there)", () => {
    expect(shiftAgendaPeriod("lista", "2026-11-25", 1)).toBe("2026-11-25");
    expect(shiftAgendaPeriod("lista", "2026-11-25", -1)).toBe("2026-11-25");
    expect(shiftAgendaPeriod("mes", "nope", 1)).toBe("nope");
  });
});

describe("agendaPeriodTitle", () => {
  it("titles Día with the shared weekday heading", () => {
    expect(agendaPeriodTitle("dia", "2026-11-25", 30)).toEqual({
      main: "Miércoles 25/11/2026",
    });
  });

  it("titles Semana with its date range plus the ISO 'Semana N' badge", () => {
    expect(agendaPeriodTitle("semana", "2026-11-25", 30)).toEqual({
      main: "23/11/2026 – 29/11/2026",
      badge: "Semana 48",
    });
  });

  it("titles Mes in Spanish and Año as the bare year", () => {
    expect(agendaPeriodTitle("mes", "2026-11-25", 30)).toEqual({
      main: "Noviembre 2026",
    });
    expect(agendaPeriodTitle("anio", "2026-11-25", 30)).toEqual({
      main: "2026",
    });
  });

  it("titles Lista from the driver's upcoming horizon", () => {
    expect(agendaPeriodTitle("lista", "2026-11-25", 30)).toEqual({
      main: "Próximos 30 días",
    });
    expect(agendaPeriodTitle("lista", "2026-11-25", 7)).toEqual({
      main: "Próximos 7 días",
    });
  });

  it("degrades safely for an invalid anchor", () => {
    expect(agendaPeriodTitle("mes", "nope", 30)).toEqual({ main: "Sin fecha" });
    expect(agendaPeriodTitle("semana", "2026-02-30", 30)).toEqual({
      main: "Sin fecha",
    });
  });
});

describe("isAgendaDay / agendaWeekStart / isoWeekNumber", () => {
  it("accepts only real YYYY-MM-DD dates (roundtrip discipline)", () => {
    expect(isAgendaDay("2026-11-25")).toBe(true);
    expect(isAgendaDay("nope")).toBe(false);
    expect(isAgendaDay("2026-13-01")).toBe(false);
    expect(isAgendaDay("2026-02-30")).toBe(false); // V8 overflows it to Mar 2
    expect(isAgendaDay("")).toBe(false);
  });

  it("starts the week on Monday (ISO)", () => {
    expect(agendaWeekStart("2026-11-25")).toBe("2026-11-23"); // Wed
    expect(agendaWeekStart("2026-11-23")).toBe("2026-11-23"); // Mon
    expect(agendaWeekStart("2026-11-29")).toBe("2026-11-23"); // Sun
  });

  it("computes ISO-8601 week numbers (the 'Semana 43' label)", () => {
    expect(isoWeekNumber("2026-01-01")).toBe(1);
    expect(isoWeekNumber("2025-12-29")).toBe(1); // Monday of week 1 of 2026
    expect(isoWeekNumber("2026-10-19")).toBe(43); // recon's evidenced week
    expect(isoWeekNumber("2026-11-23")).toBe(48);
    expect(isoWeekNumber("2026-12-31")).toBe(53); // 2026 is a 53-week year
  });
});

describe("agendaMonthGrid", () => {
  it("lays out 42 cells starting on the Monday on/before the 1st", () => {
    const cells = agendaMonthGrid("2026-11-15");
    expect(cells).toHaveLength(42);
    expect(cells[0].day).toBe("2026-10-26"); // Monday
    expect(cells[41].day).toBe("2026-12-06"); // Sunday
    expect(cells[0].inMonth).toBe(false);
    expect(cells[6].day).toBe("2026-11-01");
    expect(cells[6].inMonth).toBe(true);
    // November 2026 has 30 days; cells run in week order.
    expect(cells.filter((cell) => cell.inMonth)).toHaveLength(30);
    for (let i = 0; i < cells.length; i += 1) {
      const dow = (new Date(`${cells[i].day}T12:00:00Z`).getUTCDay() + 6) % 7;
      expect(dow).toBe(i % 7); // column 0 is always a Monday
    }
  });

  it("returns an empty grid for an invalid anchor", () => {
    expect(agendaMonthGrid("nope")).toEqual([]);
  });

  it("agendaWeekDays lists Monday..Sunday of the anchor's week", () => {
    expect(agendaWeekDays("2026-11-25")).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ]);
    expect(agendaWeekDays("nope")).toEqual([]);
  });

  it("agendaYearMonths lists the twelve month anchors of the year", () => {
    const months = agendaYearMonths("2026-11-25");
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-01-01");
    expect(months[11]).toBe("2026-12-01");
    expect(agendaYearMonths("nope")).toEqual([]);
  });
});

describe("weekend / inhábil toggle predicates", () => {
  const toggles = { weekends: true, nonWorkingDays: true };
  const off = { weekends: false, nonWorkingDays: false };
  const nonWorking = new Set(["2026-11-25", "2026-11-27"]);

  it("shades weekends only while the Fines de semana toggle is on", () => {
    expect(agendaWeekendShaded("2026-11-28", toggles)).toBe(true); // Saturday
    expect(agendaWeekendShaded("2026-11-29", toggles)).toBe(true); // Sunday
    expect(agendaWeekendShaded("2026-11-28", off)).toBe(false);
    expect(agendaWeekendShaded("2026-11-25", toggles)).toBe(false); // Wednesday
  });

  it("shades dated non-working days only while the Días inhábiles toggle is on", () => {
    expect(agendaDayShaded("2026-11-25", toggles, nonWorking)).toBe(true);
    expect(agendaDayShaded("2026-11-25", off, nonWorking)).toBe(false);
    // A plain Wednesday is shaded by neither branch.
    expect(agendaDayShaded("2026-11-26", toggles, nonWorking)).toBe(false);
    // A weekend NOT in the dated set is still shaded by the weekend branch.
    expect(agendaDayShaded("2026-11-28", off, nonWorking)).toBe(false);
    expect(
      agendaDayShaded("2026-11-28", { weekends: true, nonWorkingDays: false }, nonWorking),
    ).toBe(true);
  });

  it("labels 'Inhábil' only for dated non-working days with the toggle on", () => {
    expect(agendaShowsInhabilLabel("2026-11-25", toggles, nonWorking)).toBe(true);
    expect(agendaShowsInhabilLabel("2026-11-25", off, nonWorking)).toBe(false);
    expect(agendaShowsInhabilLabel("2026-11-26", toggles, nonWorking)).toBe(false);
    // Weekends are the other toggle's concern: no dated row, no label.
    expect(agendaShowsInhabilLabel("2026-11-28", toggles, nonWorking)).toBe(false);
  });
});

describe("agendaBucketByDay", () => {
  const days = ["2026-11-24", "2026-11-25", "2026-11-26"];

  it("buckets an event on the ART day it starts", () => {
    // 13:00Z = 10:00 ART on 2026-11-25.
    const event = makeEvent({ id: "e1", startAt: "2026-11-25T13:00:00.000Z" });
    const bucketed = agendaBucketByDay([event], days);
    expect(bucketed.get("2026-11-25")).toEqual([event]);
    expect(bucketed.get("2026-11-24")).toBeUndefined();
    expect(bucketed.get("2026-11-26")).toBeUndefined();
  });

  it("places a range crossing ART midnight on every covered day", () => {
    // Starts 2026-11-24 23:00 ART, ends 2026-11-25 01:00 ART.
    const crossing = makeEvent({
      id: "cross",
      startAt: "2026-11-25T02:00:00.000Z",
      endAt: "2026-11-25T04:00:00.000Z",
    });
    const bucketed = agendaBucketByDay([crossing], days);
    expect(bucketed.get("2026-11-24")).toEqual([crossing]);
    expect(bucketed.get("2026-11-25")).toEqual([crossing]);
    expect(bucketed.has("2026-11-26")).toBe(false);
  });

  it("drops corrupt instants and keeps input order inside a day", () => {
    const corrupt = makeEvent({ id: "bad", startAt: "not-a-date" });
    const later = makeEvent({ id: "l", startAt: "2026-11-25T20:00:00.000Z" });
    const earlier = makeEvent({ id: "e", startAt: "2026-11-25T13:00:00.000Z" });
    const bucketed = agendaBucketByDay([later, earlier, corrupt], days);
    expect(bucketed.get("2026-11-25")).toEqual([later, earlier]); // no re-sort
    expect(bucketed.get("2026-11-24")).toBeUndefined();
  });

  it("excludes events that do not overlap any requested day", () => {
    const outside = makeEvent({ id: "out", startAt: "2026-12-25T13:00:00.000Z" });
    expect(agendaBucketByDay([outside], days).size).toBe(0);
  });

  it("buckets each day once even when the day list repeats (year grids)", () => {
    const event = makeEvent({ id: "e1", startAt: "2026-11-25T13:00:00.000Z" });
    const bucketed = agendaBucketByDay([event], ["2026-11-25", "2026-11-25"]);
    expect(bucketed.get("2026-11-25")).toEqual([event]);
  });
});

describe("agendaEventLanes", () => {
  const at = (start: string, end: string, id: string) =>
    makeEvent({ id, startAt: start, endAt: end });

  it("returns no lanes for an empty list", () => {
    expect(agendaEventLanes([])).toEqual([]);
  });

  it("keeps non-overlapping and touching events in one lane", () => {
    // Half-open ranges: an event ending at 11:00 does not overlap 11:00.
    const events = [
      at("2026-11-25T13:00:00.000Z", "2026-11-25T14:00:00.000Z", "a"),
      at("2026-11-25T14:00:00.000Z", "2026-11-25T15:00:00.000Z", "b"),
    ];
    expect(agendaEventLanes(events)).toEqual([events]);
  });

  it("splits overlapping events into side-by-side lanes", () => {
    const a = at("2026-11-25T13:00:00.000Z", "2026-11-25T15:00:00.000Z", "a");
    const b = at("2026-11-25T14:00:00.000Z", "2026-11-25T16:00:00.000Z", "b");
    const c = at("2026-11-25T15:00:00.000Z", "2026-11-25T17:00:00.000Z", "c");
    const lanes = agendaEventLanes([b, a, c]); // shuffled input
    expect(lanes).toHaveLength(2);
    expect(lanes[0]).toEqual([a, c]); // c starts exactly when a ends
    expect(lanes[1]).toEqual([b]);
  });

  it("never throws on a corrupt instant and keeps every event", () => {
    const good = at("2026-11-25T13:00:00.000Z", "2026-11-25T14:00:00.000Z", "g");
    const corrupt = makeEvent({ id: "bad", startAt: "not-a-date" });
    const lanes = agendaEventLanes([corrupt, good]);
    const flat = lanes.flat();
    expect(flat).toHaveLength(2);
    expect(flat).toContain(good);
    expect(flat).toContain(corrupt);
  });
});

describe("agendaHeatLevel", () => {
  it("ramps the year heat dots from none to full", () => {
    expect(agendaHeatLevel(0)).toBe(0);
    expect(agendaHeatLevel(1)).toBe(1);
    expect(agendaHeatLevel(2)).toBe(2);
    expect(agendaHeatLevel(3)).toBe(2);
    expect(agendaHeatLevel(4)).toBe(3);
    expect(agendaHeatLevel(50)).toBe(3);
  });
});

describe("agendaEventPlacement", () => {
  it("positions an event as a percentage of the ART day", () => {
    // 10:00–11:00 ART on 2026-11-25 (13:00Z–14:00Z).
    const event = makeEvent({
      id: "e",
      startAt: "2026-11-25T13:00:00.000Z",
      endAt: "2026-11-25T14:00:00.000Z",
    });
    const placement = agendaEventPlacement(event, "2026-11-25");
    expect(placement).not.toBeNull();
    expect(placement?.topPercent).toBeCloseTo((10 / 24) * 100, 5);
    expect(placement?.heightPercent).toBeCloseTo((1 / 24) * 100, 5);
  });

  it("clamps a range crossing ART midnight into the day", () => {
    // Starts 2026-11-24 23:00 ART, ends 2026-11-25 01:00 ART.
    const crossing = makeEvent({
      id: "c",
      startAt: "2026-11-25T02:00:00.000Z",
      endAt: "2026-11-25T04:00:00.000Z",
    });
    const placement = agendaEventPlacement(crossing, "2026-11-25");
    expect(placement?.topPercent).toBe(0);
    expect(placement?.heightPercent).toBeCloseTo((1 / 24) * 100, 5);
  });

  it("returns null outside the day, for corrupt instants or an invalid day", () => {
    const outside = makeEvent({ id: "o", startAt: "2026-12-25T13:00:00.000Z" });
    expect(agendaEventPlacement(outside, "2026-11-25")).toBeNull();
    const corrupt = makeEvent({ id: "bad", startAt: "not-a-date" });
    expect(agendaEventPlacement(corrupt, "2026-11-25")).toBeNull();
    expect(agendaEventPlacement(outside, "nope")).toBeNull();
  });
});

describe("agendaClock", () => {
  it("renders the ART wall clock of an instant", () => {
    expect(agendaClock("2026-11-25T13:00:00.000Z")).toBe("10:00");
    expect(agendaClock("2026-11-25T03:00:00.000Z")).toBe("00:00");
    expect(agendaClock("2026-11-25T23:59:00.000Z")).toBe("20:59");
  });

  it("answers null for corrupt instants (never throws)", () => {
    expect(agendaClock("not-a-date")).toBeNull();
  });
});

describe("month names", () => {
  it("lists the twelve Spanish months in order", () => {
    expect(AGENDA_MONTH_NAMES).toHaveLength(12);
    expect(AGENDA_MONTH_NAMES[0]).toBe("enero");
    expect(AGENDA_MONTH_NAMES[10]).toBe("noviembre");
    expect(AGENDA_MONTH_NAMES[11]).toBe("diciembre");
  });
});
