/**
 * Pure helpers behind the `/agenda` Lista view (S17, T2 slice 1): the
 * filter set the left panel grew into (search + source overlays +
 * category checkboxes — T5b renders it in agenda-left-panel.tsx), the chips
 * the empty state renders, the load reducer that keeps the previous list
 * visible while a refresh runs (recon: "previous period stays visible with
 * a thin top bar"), the T5b Ctrl+K search map, and the ART day/time
 * formatting for the rows.
 *
 * Everything here is side-effect free on purpose: vitest is node-only (no
 * jsdom/RTL), so the interaction contract travels to e2e and only this
 * logic gets unit tests. Data reads live in lib/data/events.ts (T1) — this
 * module never talks to a driver.
 *
 * Evidence gaps honored: the six default category names / eleven colors
 * are not in the recon, so the category chip label falls back to a generic
 * word when a selected category no longer exists, and the view hides the
 * whole category UI while `listEventCategories()` answers [] (until T6).
 */

import type { BadgeTone } from "@/components/ui/badge";
import type {
  CalendarEvent,
  EventCategory,
  EventListFilter,
  EventSource,
} from "@/lib/data";
import { toArtIsoDate } from "@/lib/data/calendar";
import { formatDate } from "@/lib/format";

/** The filter set the T5b left panel renders (list-level criteria only). */
export interface AgendaFilters {
  /** Free text over title/location/notes/caratula (lib/search matching). */
  search: string;
  /** Source overlays (recon left panel: Audiencias / Vencimientos). */
  sources: EventSource[];
  /** Category checkbox selection; empty = every category. */
  categoryIds: string[];
}

export const DEFAULT_AGENDA_FILTERS: AgendaFilters = {
  search: "",
  sources: [],
  categoryIds: [],
};

/** The two source overlays the recon's left panel names for this slice. */
export const SOURCE_FILTER_OPTIONS: ReadonlyArray<{
  value: EventSource;
  label: string;
}> = [
  { value: "audiencia", label: "Audiencias" },
  { value: "vencimiento", label: "Vencimientos" },
];

/** Badge copy per `events.source` check-constraint value (fresh words). */
export const SOURCE_LABELS: Record<EventSource, string> = {
  manual: "Manual",
  audiencia: "Audiencia",
  vencimiento: "Vencimiento",
  dia_inhabil: "Día inhábil",
};

/** Badge tone per source; colour is always paired with the label word. */
export function sourceTone(source: EventSource): BadgeTone {
  switch (source) {
    case "audiencia":
      return "info";
    case "vencimiento":
      return "warning";
    default:
      return "neutral";
  }
}

/** True when at least one criterion would narrow the list. */
export function agendaFiltersActive(filters: AgendaFilters): boolean {
  return (
    filters.search.trim() !== "" ||
    filters.sources.length > 0 ||
    filters.categoryIds.length > 0
  );
}

/** The data-layer read criteria behind the visible controls. Absent/EMPTY
 *  criteria never filter (applyEventFilters discipline). */
export function toEventListFilter(filters: AgendaFilters): EventListFilter {
  return {
    query: filters.search.trim() || undefined,
    sources: filters.sources.length ? filters.sources : undefined,
    categoryIds: filters.categoryIds.length ? filters.categoryIds : undefined,
  };
}

/** Add/remove one value (checkbox toggle) without duplicates. */
export function toggleValue<T>(list: readonly T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((entry) => entry !== value)
    : [...list, value];
}

/** One active filter rendered as a removable chip in the empty state. */
export interface AgendaFilterChip {
  /** Stable React key = the chip's identity. */
  key: string;
  /** Visible chip copy (fresh wording). */
  label: string;
  /** The filter set AFTER removing exactly this chip. */
  filters: AgendaFilters;
}

/**
 * One chip per active criterion; removing a chip clears that criterion and
 * nothing else (recon empty state: active-filter chips + Limpiar filtros).
 */
export function buildFilterChips(
  filters: AgendaFilters,
  categories: readonly EventCategory[] = [],
): AgendaFilterChip[] {
  const chips: AgendaFilterChip[] = [];

  const search = filters.search.trim();
  if (search) {
    chips.push({
      key: "search",
      label: `Búsqueda: ${search}`,
      filters: { ...filters, search: "" },
    });
  }

  for (const source of filters.sources) {
    const option = SOURCE_FILTER_OPTIONS.find((entry) => entry.value === source);
    chips.push({
      key: `source:${source}`,
      label: option?.label ?? SOURCE_LABELS[source],
      filters: {
        ...filters,
        sources: filters.sources.filter((entry) => entry !== source),
      },
    });
  }

  for (const categoryId of filters.categoryIds) {
    const category = categories.find((entry) => entry.id === categoryId);
    chips.push({
      key: `category:${categoryId}`,
      // A deleted category keeps its chip honest (clears by id regardless).
      label: category?.name ?? "Categoría sin nombre",
      filters: {
        ...filters,
        categoryIds: filters.categoryIds.filter((entry) => entry !== categoryId),
      },
    });
  }

  return chips;
}

/* ------------------------------------------------------------ load state -- */

export type AgendaLoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; events: CalendarEvent[]; refreshing: boolean };

export type AgendaLoadAction =
  /** A read starts: a ready list stays visible (thin top bar), else skeleton. */
  | { type: "load" }
  | { type: "success"; events: CalendarEvent[] }
  | { type: "failure" };

/**
 * The view's load machine. The one rule every transition honors: once rows
 * are on screen they are never replaced by a spinner — a refresh flips
 * `refreshing` (the thin top bar) and only the new answer swaps the rows;
 * an error state is terminal until the next load.
 */
export function agendaLoadReducer(
  state: AgendaLoadState,
  action: AgendaLoadAction,
): AgendaLoadState {
  switch (action.type) {
    case "load":
      return state.status === "ready"
        ? { ...state, refreshing: true }
        : { status: "loading" };
    case "success":
      return { status: "ready", events: action.events, refreshing: false };
    case "failure":
      return { status: "error" };
  }
}

/* ------------------------------------------------------------- rendering -- */

/** ART calendar day of an instant; "" when unparseable (BUG-004: a corrupt
 *  row must never crash a list — the window predicate already drops most,
 *  this guard covers the rest). */
function artDayOf(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? "" : toArtIsoDate(new Date(parsed));
}

export interface AgendaDayGroup {
  /** ART calendar day (`YYYY-MM-DD`) of the group's events' startAt. */
  day: string;
  events: CalendarEvent[];
}

/** Lista grouping: one section per ART day of `startAt`, input order kept
 *  (the driver already serves rows chronologically). */
export function groupByDay(events: readonly CalendarEvent[]): AgendaDayGroup[] {
  const groups: AgendaDayGroup[] = [];
  const byDay = new Map<string, AgendaDayGroup>();
  for (const event of events) {
    const day = artDayOf(event.startAt);
    let group = byDay.get(day);
    if (!group) {
      group = { day, events: [] };
      byDay.set(day, group);
      groups.push(group);
    }
    group.events.push(event);
  }
  return groups;
}

/** Weekdays in Spanish, fixed order (index = Date#getUTCDay). */
const WEEKDAYS = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];

/**
 * "Miércoles 25/11/2026" — deterministic on purpose: the date is split as
 * a string (lib/format discipline — no UTC-midnight drift) and the weekday
 * comes from ART noon's UTC weekday, so the output never depends on the
 * machine's time zone or on ICU version.
 */
export function formatDayHeading(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "Sin fecha";
  const noon = new Date(`${day}T12:00:00Z`);
  if (
    Number.isNaN(noon.getTime()) ||
    noon.toISOString().slice(0, 10) !== day
  ) {
    return "Sin fecha"; // e.g. 2026-13-01: well-shaped but not a real day
  }
  const weekday = WEEKDAYS[noon.getUTCDay()];
  const label = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}`;
  return `${label} ${formatDate(day)}`;
}

/** ART = UTC−3, no daylight saving since 2009 (calendar.ts ART_OFFSET_MS,
 *  module-private there; duplicated here so this pure module stays a leaf). */
const ART_OFFSET_MS = -3 * 60 * 60 * 1000;

/** ART wall clock `HH:MM` of an instant; null when unparseable. */
function artClock(iso: string): string | null {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  const art = new Date(parsed + ART_OFFSET_MS);
  const hours = String(art.getUTCHours()).padStart(2, "0");
  const minutes = String(art.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Row time line: "10:00 a 12:00" in ART, "Todo el día" for ranges of 24h
 * or more (días inhábiles are full-day rows), "—" when an instant is
 * corrupt (never throws — BUG-004 discipline).
 */
export function formatTimeRange(startAt: string, endAt: string): string {
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return "—";
  if (end - start >= 24 * 60 * 60 * 1000) return "Todo el día";
  const startClock = artClock(startAt);
  const endClock = artClock(endAt);
  if (!startClock || !endClock) return "—";
  return `${startClock} a ${endClock}`;
}

/* ------------------------------------------------------- search keys ---- */

/** The minimal key-event shape the Ctrl+K map reads (tests pass plain objects). */
export interface AgendaSearchKeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Ctrl+K / Cmd+K → focus the left-panel search (recon S17: "search
 * (Ctrl+K)"). The exact chord: no Alt (AltGr on es-AR layouts is ctrl+alt)
 * and no Shift, so the browser keeps its own modified bindings. The map is
 * pure so RED tests can pin it without a DOM.
 */
export function agendaSearchShortcut(event: AgendaSearchKeyEvent): boolean {
  if (event.altKey || event.shiftKey) return false;
  if (!event.ctrlKey && !event.metaKey) return false;
  return event.key.toLowerCase() === "k";
}
