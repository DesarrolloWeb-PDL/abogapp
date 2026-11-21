/**
 * Pure helpers behind the T4 period views (S17): the view vocabulary and
 * its mobile availability, the D/S/M/A/L + H keyboard map, period math
 * (bounds for the driver reads, ‹ › navigation, titles incl. the recon's
 * "Semana 43" ISO-week label), the Fines de semana / Días inhábiles
 * toggle predicates (weekend branch vs. the dated `nonWorkingDays` set —
 * holidays are never hardcoded here), and the grid bucketing/lanes the
 * Día/Semana/Mes/Año views render from.
 *
 * Everything here is side-effect free on purpose: vitest is node-only (no
 * jsdom/RTL), so the interaction contract travels to e2e/s17-agenda.spec.ts
 * and only this logic gets unit tests. Date arithmetic leans on the shared
 * leaf helpers (`@/lib/plazos` addDays/isWeekend, `formatDate`,
 * `formatDayHeading`) so the agenda can never disagree with the plazos
 * engine about what a day is.
 *
 * Anchor contract: `anchor` is an ART calendar day (`YYYY-MM-DD`), derived
 * from `toArtIsoDate(new Date())` and only ever moved by addDays/shift
 * helpers — every entry point re-validates with `isAgendaDay` anyway, so a
 * corrupt anchor degrades (null window / "Sin fecha" / unchanged anchor)
 * instead of throwing.
 */

import type { CalendarEvent } from "@/lib/data";
import { addDays, isWeekend } from "@/lib/plazos";
import { formatDate } from "@/lib/format";
import { formatDayHeading } from "./agenda-list";

/* ------------------------------------------------------------- views ---- */

/** The five recon views, in selector order. */
export const AGENDA_VIEWS = ["dia", "semana", "mes", "anio", "lista"] as const;
export type AgendaViewKind = (typeof AGENDA_VIEWS)[number];

/** Recon: "mobile: Lista or Día only (no Año)" — the narrow-screen set. */
export const AGENDA_NARROW_VIEWS = ["dia", "lista"] as const;

/** Selector labels (recon copy: Día/Semana/Mes/Año/Lista). */
export const AGENDA_VIEW_LABELS: Record<AgendaViewKind, string> = {
  dia: "Día",
  semana: "Semana",
  mes: "Mes",
  anio: "Año",
  lista: "Lista",
};

/** Recon shortcuts for the view selector: D/S/M/A/L (lowercase keys). */
export const AGENDA_VIEW_SHORTCUTS: Record<AgendaViewKind, string> = {
  dia: "d",
  semana: "s",
  mes: "m",
  anio: "a",
  lista: "l",
};

/** Views reachable at the given width (narrow = below the md 768px shell). */
export function availableAgendaViews(
  narrow: boolean,
): readonly AgendaViewKind[] {
  return narrow ? AGENDA_NARROW_VIEWS : AGENDA_VIEWS;
}

/**
 * The view actually rendered at this width: a view selected while wide can
 * survive a resize into narrow only by falling back to the mobile default
 * (Lista — the slice-order rationale's "mobile-narrow default").
 */
export function clampAgendaView(
  view: AgendaViewKind,
  narrow: boolean,
): AgendaViewKind {
  const narrowViews: readonly AgendaViewKind[] = AGENDA_NARROW_VIEWS;
  return narrow && !narrowViews.includes(view) ? "lista" : view;
}

/* ---------------------------------------------------------- shortcuts ---- */

/** The minimal key-event shape the pure map reads (tests pass plain objects). */
export interface AgendaShortcutKeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/** The minimal event-target shape the typing guard reads. */
export interface AgendaShortcutTarget {
  tagName?: string;
  isContentEditable?: boolean;
}

export type AgendaShortcutAction =
  | { type: "view"; view: AgendaViewKind }
  | { type: "today" }
  | { type: "create" };

const SHORTCUT_VIEW_KEYS: Record<string, AgendaViewKind> = Object.fromEntries(
  AGENDA_VIEWS.map((view) => [AGENDA_VIEW_SHORTCUTS[view], view]),
);

const SHORTCUT_EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * The keyboard map: D/S/M/A/L switch views, H jumps to Hoy, C opens the
 * "Nuevo evento" form (recon shortcuts row; not a view, so the narrow
 * clamp never refuses it). It stays quiet while a modifier is held
 * (browser shortcuts remain the browser's) and while the user is typing
 * (the search box must keep every letter), and it refuses views the narrow
 * screen does not offer.
 */
export function agendaShortcutAction(
  event: AgendaShortcutKeyEvent,
  target: AgendaShortcutTarget | null,
  narrow: boolean,
): AgendaShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (target) {
    const tag = (target.tagName ?? "").toUpperCase();
    if (SHORTCUT_EDITABLE_TAGS.has(tag)) return null;
    if (target.isContentEditable) return null;
  }

  const key = event.key.toLowerCase();
  if (key === "h") return { type: "today" };
  if (key === "c") return { type: "create" };
  const view = SHORTCUT_VIEW_KEYS[key];
  if (!view) return null;
  if (narrow && !availableAgendaViews(true).includes(view)) return null;
  return { type: "view", view };
}

/* ------------------------------------------------------ period window ---- */

export interface AgendaPeriodWindow {
  /** Inclusive overlap bound (ISO instant, ART day start = 03:00Z). */
  from: string;
  /** Exclusive overlap bound (ISO instant). */
  to: string;
}

/** ART day start for a validated day; null when the day is not real. */
function artDayStart(day: string): string | null {
  if (!isAgendaDay(day)) return null;
  return new Date(`${day}T00:00:00.000-03:00`).toISOString();
}

const DAY_MS = 24 * 60 * 60 * 1000;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** `YYYY-MM-DD` shifted by whole months, clamping the day (Jan 31 → Feb 28). */
function shiftMonthDay(day: string, months: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const daysInTarget = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const clamped = Math.min(date, daysInTarget);
  return `${target.getUTCFullYear()}-${pad2(target.getUTCMonth() + 1)}-${pad2(clamped)}`;
}

/** The `[startDay, endDay)` span each view navigates; null for Lista. */
function periodSpan(
  view: AgendaViewKind,
  anchor: string,
): { start: string; end: string } | null {
  if (!isAgendaDay(anchor)) return null;
  switch (view) {
    case "dia":
      return { start: anchor, end: addDays(anchor, 1) };
    case "semana": {
      const start = agendaWeekStart(anchor);
      return { start, end: addDays(start, 7) };
    }
    case "mes": {
      const start = `${anchor.slice(0, 7)}-01`;
      return { start, end: shiftMonthDay(start, 1) };
    }
    case "anio": {
      const start = `${anchor.slice(0, 4)}-01-01`;
      return { start, end: shiftMonthDay(start, 12) };
    }
    case "lista":
      return null;
  }
}

/**
 * The window `listEvents` reads for a period view (recon: adjacent periods
 * tile without a gap or a duplicate). Null means "no period": Lista lets
 * `listUpcomingEvents` fill its own upcoming window, and an invalid anchor
 * never reaches the driver.
 */
export function agendaPeriodWindow(
  view: AgendaViewKind,
  anchor: string,
): AgendaPeriodWindow | null {
  const span = periodSpan(view, anchor);
  if (!span) return null;
  const from = artDayStart(span.start);
  const to = artDayStart(span.end);
  return from && to ? { from, to } : null;
}

/* ---------------------------------------------------- period nav/title -- */

export type AgendaPeriodDirection = -1 | 1;

/**
 * One ‹ › step for the view: day ±1, week ±7, month ±1 (clamped),
 * year ±12 months (Feb 29 → Feb 28). Lista keeps its anchor (the nav is
 * disabled there) and a corrupt anchor never moves.
 */
export function shiftAgendaPeriod(
  view: AgendaViewKind,
  anchor: string,
  direction: AgendaPeriodDirection,
): string {
  if (!isAgendaDay(anchor)) return anchor;
  switch (view) {
    case "dia":
      return addDays(anchor, direction);
    case "semana":
      return addDays(anchor, 7 * direction);
    case "mes":
      return shiftMonthDay(anchor, direction);
    case "anio":
      return shiftMonthDay(anchor, 12 * direction);
    case "lista":
      return anchor;
  }
}

export interface AgendaPeriodTitle {
  /** The heading text (dates in the app's dd/mm/yyyy contract). */
  main: string;
  /** The recon's "Semana 43" label — ISO-8601 week, Semana only. */
  badge?: string;
}

function capitalize(word: string): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

/**
 * The top-bar period title. Día reuses the shared weekday heading so the
 * bar and the list grouping can never disagree; Semana carries the ISO week
 * badge; Lista states the driver's upcoming horizon.
 */
export function agendaPeriodTitle(
  view: AgendaViewKind,
  anchor: string,
  upcomingDays: number,
): AgendaPeriodTitle {
  if (view === "lista") return { main: `Próximos ${upcomingDays} días` };
  if (!isAgendaDay(anchor)) return { main: "Sin fecha" };
  switch (view) {
    case "dia":
      return { main: formatDayHeading(anchor) };
    case "semana": {
      const start = agendaWeekStart(anchor);
      const end = addDays(start, 6);
      return {
        main: `${formatDate(start)} – ${formatDate(end)}`,
        badge: `Semana ${isoWeekNumber(start)}`,
      };
    }
    case "mes": {
      const [year, month] = anchor.split("-");
      return { main: `${capitalize(AGENDA_MONTH_NAMES[Number(month) - 1])} ${year}` };
    }
    case "anio":
      return { main: anchor.slice(0, 4) };
  }
}

/* ------------------------------------------------------------- dates ---- */

/**
 * Is `day` a real `YYYY-MM-DD` calendar date? Roundtrip discipline
 * (formatDayHeading): V8 overflows impossible days (2026-02-30 → Mar 2),
 * so parsing alone is not enough — the string must survive the roundtrip.
 */
export function isAgendaDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const noon = new Date(`${day}T12:00:00Z`);
  return (
    !Number.isNaN(noon.getTime()) && noon.toISOString().slice(0, 10) === day
  );
}

/** Monday of the ISO week containing `anchor` (invalid anchor → unchanged). */
export function agendaWeekStart(anchor: string): string {
  if (!isAgendaDay(anchor)) return anchor;
  const dow = (new Date(`${anchor}T12:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(anchor, -dow);
}

/** The seven ART days of the anchor's week, Monday first ([] when invalid). */
export function agendaWeekDays(anchor: string): string[] {
  if (!isAgendaDay(anchor)) return [];
  const start = agendaWeekStart(anchor);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

/** The twelve `YYYY-MM-01` month anchors of the anchor's year ([] when invalid). */
export function agendaYearMonths(anchor: string): string[] {
  if (!isAgendaDay(anchor)) return [];
  const year = anchor.slice(0, 4);
  return Array.from(
    { length: 12 },
    (_, month) => `${year}-${pad2(month + 1)}-01`,
  );
}

/**
 * ISO-8601 week number (Mon-based; week 1 holds the first Thursday) — the
 * math behind the recon's "Semana 43" label. Invalid input answers 0.
 */
export function isoWeekNumber(day: string): number {
  const date = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return 0;
  // Step to the week's nearest Thursday, then count from week 1's Thursday.
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(
    firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3,
  );
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
}

export interface AgendaMonthCell {
  /** The cell's ART calendar day (`YYYY-MM-DD`). */
  day: string;
  /** False for the leading/trailing days of the adjacent months. */
  inMonth: boolean;
}

/**
 * The month grid: 42 cells (6 Monday-first weeks) starting on the Monday
 * on/before the anchor's 1st — a fixed shape so rows never jump between
 * months. Invalid anchor → [].
 */
export function agendaMonthGrid(anchor: string): AgendaMonthCell[] {
  if (!isAgendaDay(anchor)) return [];
  const first = `${anchor.slice(0, 7)}-01`;
  const prefix = first.slice(0, 7);
  const start = agendaWeekStart(first);
  const cells: AgendaMonthCell[] = [];
  for (let index = 0; index < 42; index += 1) {
    const day = addDays(start, index);
    cells.push({ day, inMonth: day.slice(0, 7) === prefix });
  }
  return cells;
}

/* ----------------------------------------------------------- toggles ---- */

/** The two top-bar toggles (recon: Fines de semana / Días inhábiles). */
export interface AgendaDayToggles {
  weekends: boolean;
  nonWorkingDays: boolean;
}

/** Weekend branch: shading only, gated by its own toggle. */
export function agendaWeekendShaded(
  day: string,
  toggles: AgendaDayToggles,
): boolean {
  return toggles.weekends && isWeekend(day);
}

/**
 * Should the cell read as non-working? Two independent branches: the
 * weekend toggle shades Sat/Sun, the inhábiles toggle shades days present
 * in the loaded `nonWorkingDays` set (feria/feriado/studio rows — the
 * data layer's truth, never a hardcoded holiday list).
 */
export function agendaDayShaded(
  day: string,
  toggles: AgendaDayToggles,
  nonWorkingDays: ReadonlySet<string>,
): boolean {
  return (
    agendaWeekendShaded(day, toggles) ||
    (toggles.nonWorkingDays && nonWorkingDays.has(day))
  );
}

/**
 * The "Inhábil" label (recon week view): dated non-working rows only, with
 * the Días inhábiles toggle on — weekends are the other toggle's business.
 */
export function agendaShowsInhabilLabel(
  day: string,
  toggles: AgendaDayToggles,
  nonWorkingDays: ReadonlySet<string>,
): boolean {
  return toggles.nonWorkingDays && nonWorkingDays.has(day);
}

/** ART = UTC−3, no daylight saving since 2009 (calendar.ts ART_OFFSET_MS,
 *  module-private there; duplicated here so this pure module stays a leaf). */
const ART_OFFSET_MS = -3 * 60 * 60 * 1000;

/** ART wall clock `HH:MM` of an instant; null when unparseable. */
export function agendaClock(iso: string): string | null {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  const art = new Date(parsed + ART_OFFSET_MS);
  return `${pad2(art.getUTCHours())}:${pad2(art.getUTCMinutes())}`;
}

export interface AgendaEventPlacement {
  /** Top edge as a percentage of the 24-hour day column (0–100). */
  topPercent: number;
  /** Height as a percentage of the day column (0–100). */
  heightPercent: number;
}

/**
 * Where an event sits inside one day column of the Día/Semana time grid:
 * percentages of the 24-hour ART day, clamped to the column (a range
 * crossing midnight renders on every covered day, each with its slice).
 * Null when the event does not cover the day or an instant is corrupt.
 */
export function agendaEventPlacement(
  event: CalendarEvent,
  day: string,
): AgendaEventPlacement | null {
  const startIso = artDayStart(day);
  if (!startIso) return null;
  const dayStart = Date.parse(startIso);
  const dayEnd = dayStart + DAY_MS;
  const eventStart = Date.parse(event.startAt);
  const eventEnd = Date.parse(event.endAt);
  if (Number.isNaN(eventStart) || Number.isNaN(eventEnd)) return null;
  if (eventStart >= dayEnd || eventEnd <= dayStart) return null;
  const start = Math.max(eventStart, dayStart);
  const end = Math.min(eventEnd, dayEnd);
  if (end <= start) return null;
  return {
    topPercent: ((start - dayStart) / DAY_MS) * 100,
    heightPercent: ((end - start) / DAY_MS) * 100,
  };
}

/* -------------------------------------------------------------- grids ---- */

/**
 * Bucket events onto every ART day their range covers (the driver's window
 * comment: "a range crossing midnight renders on every covered day").
 * Corrupt instants drop (BUG-004); input order is kept inside a day.
 */
export function agendaBucketByDay(
  events: readonly CalendarEvent[],
  days: readonly string[],
): Map<string, CalendarEvent[]> {
  const bucketed = new Map<string, CalendarEvent[]>();
  for (const day of days) {
    // Adjacent grids overlap at their boundaries (year views repeat days);
    // bucket each distinct day exactly once.
    if (bucketed.has(day)) continue;
    const startIso = artDayStart(day);
    if (!startIso) continue;
    const dayStart = Date.parse(startIso);
    const dayEnd = dayStart + DAY_MS;
    for (const event of events) {
      const start = Date.parse(event.startAt);
      const end = Date.parse(event.endAt);
      if (Number.isNaN(start) || Number.isNaN(end)) continue;
      if (start >= dayEnd || end <= dayStart) continue;
      const list = bucketed.get(day);
      if (list) list.push(event);
      else bucketed.set(day, [event]);
    }
  }
  return bucketed;
}

/**
 * Greedy lane assignment for one day column: events start-to-end sorted,
 * each into the first lane whose last event has already ended (half-open
 * ranges, so back-to-back events share a lane). Corrupt instants sort last
 * and never throw — the grid has already dropped them, this only stays
 * honest for direct callers.
 */
export function agendaEventLanes(
  events: readonly CalendarEvent[],
): CalendarEvent[][] {
  interface Lane {
    events: CalendarEvent[];
    end: number;
  }
  const lanes: Lane[] = [];
  const startOf = (event: CalendarEvent): number => {
    const parsed = Date.parse(event.startAt);
    return Number.isNaN(parsed) ? Infinity : parsed;
  };
  const sorted = [...events].sort((a, b) => startOf(a) - startOf(b));
  for (const event of sorted) {
    const start = startOf(event);
    const parsedEnd = Date.parse(event.endAt);
    const end =
      Number.isNaN(parsedEnd) || parsedEnd < start ? start : parsedEnd;
    const lane = lanes.find((entry) => entry.end <= start);
    if (lane) {
      lane.events.push(event);
      lane.end = end;
    } else {
      lanes.push({ events: [event], end });
    }
  }
  return lanes.map((lane) => lane.events);
}

/** Year heat-dot ramp: 0 dots → 1 → 2 → 2 → 3 (4+ events at full heat). */
export function agendaHeatLevel(count: number): 0 | 1 | 2 | 3 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count < 4) return 2;
  return 3;
}

/* --------------------------------------------------------- vocabulary --- */

/** Spanish months, lowercase; titles capitalize the first letter. */
export const AGENDA_MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/** Short weekdays indexed by `Date#getUTCDay` (0 = domingo). */
export const AGENDA_WEEKDAY_SHORT = [
  "dom",
  "lun",
  "mar",
  "mié",
  "jue",
  "vie",
  "sáb",
] as const;

/**
 * Monday-first rotation of {@link AGENDA_WEEKDAY_SHORT} for every table whose
 * columns come from the Monday-started `agendaMonthGrid` (Mes/Año headers,
 * mini-month). `AGENDA_WEEKDAY_SHORT` itself stays `Date#getUTCDay`-ordered.
 */
export const AGENDA_WEEKDAY_SHORT_MONDAY = [
  ...AGENDA_WEEKDAY_SHORT.slice(1),
  AGENDA_WEEKDAY_SHORT[0],
] as const;
