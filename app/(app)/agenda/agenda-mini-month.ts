/**
 * Pure helpers behind the T5b left panel's mini-month (S17): the 42-cell
 * derivation with event dots, weekend shading and hatched non-working days
 * from the loaded `nonWorkingDays` set (holidays are never hardcoded), the
 * roving-focus arrow map for the day buttons, and the read criteria the dot
 * fetch feeds through the SAME `applyEventFilters` pipeline the Lista view
 * uses (search + sources + categories + case scope + month window).
 *
 * Everything here is side-effect free on purpose: vitest is node-only (no
 * jsdom/RTL), so the interaction contract travels to e2e/s17-agenda.spec.ts
 * and only this logic gets unit tests. Rendering lives in
 * agenda-left-panel.tsx; the panel state/fetches stay in agenda-panel.tsx
 * (the "one copy of every handler" AgendaPanel discipline).
 *
 * Dot colours: one dot per DISTINCT colour (capped), so a busy day stays
 * readable in a ~30px cell; `null` means an uncategorized event (the neutral
 * token dot) — the six default categories/11 colours are an evidence gap
 * (init.sql TODO, T6 seeds them), so nothing here invents them.
 */

import type { CalendarEvent, EventListFilter } from "@/lib/data";
import {
  AGENDA_WEEKDAY_SHORT_MONDAY,
  agendaBucketByDay,
  agendaMonthGrid,
  agendaPeriodWindow,
  agendaShowsInhabilLabel,
  agendaWeekendShaded,
  type AgendaDayToggles,
} from "./agenda-periods";
import { toEventListFilter, type AgendaFilters } from "./agenda-list";

/** Max dots rendered per mini-month cell (the cell is ~30px wide). */
export const MINI_MONTH_MAX_DOTS = 3;

/**
 * Monday-first short weekdays for the Monday-started `agendaMonthGrid`
 * columns — shared with the Mes/Año grid headers (single vocabulary).
 */
export const MINI_WEEKDAY_HEADERS: readonly string[] = AGENDA_WEEKDAY_SHORT_MONDAY;

/** One mini-month day cell as the panel derives it (never rendered raw). */
export interface MiniMonthDay {
  /** ART calendar day (`YYYY-MM-DD`). */
  day: string;
  /** False for the leading/trailing days of the adjacent months. */
  inMonth: boolean;
  isToday: boolean;
  /** Weekend shaded by the Fines de semana toggle (same state as the top bar). */
  weekendShaded: boolean;
  /** Dated non-working day hatched by the Días inhábiles toggle. */
  hatched: boolean;
  /** Full count for the cell's accessible label (may exceed the dot cap). */
  eventCount: number;
  /** Distinct colours, capped at MINI_MONTH_MAX_DOTS; null = uncategorized. */
  dotColors: (string | null)[];
}

export interface MiniMonthOptions {
  /** Current ART day (`YYYY-MM-DD`). */
  today: string;
  toggles: AgendaDayToggles;
  nonWorkingDays: ReadonlySet<string>;
}

/**
 * The 42 cells of the mini-month for `anchor`'s month: agendaMonthGrid's
 * layout (Monday-first, fixed six rows) enriched with per-day state from the
 * SAME predicates the big grids use (`agendaWeekendShaded`,
 * `agendaShowsInhabilLabel`) plus the dots of the already-filtered events
 * the caller fetched for this month. Invalid anchor → [] (never throws).
 */
export function buildMiniMonth(
  anchor: string,
  events: readonly CalendarEvent[],
  options: MiniMonthOptions,
): MiniMonthDay[] {
  const cells = agendaMonthGrid(anchor);
  if (cells.length === 0) return [];
  const bucketed = agendaBucketByDay(
    events,
    cells.map((cell) => cell.day),
  );
  return cells.map((cell) => {
    const dayEvents = bucketed.get(cell.day) ?? [];
    const dotColors: (string | null)[] = [];
    for (const event of dayEvents) {
      const color = event.category?.color ?? null;
      if (!dotColors.includes(color)) dotColors.push(color);
      if (dotColors.length >= MINI_MONTH_MAX_DOTS) break;
    }
    return {
      day: cell.day,
      inMonth: cell.inMonth,
      isToday: cell.day === options.today,
      weekendShaded: agendaWeekendShaded(cell.day, options.toggles),
      hatched: agendaShowsInhabilLabel(
        cell.day,
        options.toggles,
        options.nonWorkingDays,
      ),
      eventCount: dayEvents.length,
      dotColors,
    };
  });
}

/**
 * Roving-focus arrow map for the 42-cell grid: Left/Right move one day,
 * Up/Down one week; edges clamp (null = no move, the caller keeps focus).
 * Enter/Space are the native button activation and never land here.
 */
export function miniMonthMoveFocus(
  currentDay: string,
  key: string,
  cells: readonly { day: string }[],
): string | null {
  const index = cells.findIndex((cell) => cell.day === currentDay);
  if (index < 0) return null;
  let next: number;
  switch (key) {
    case "ArrowLeft":
      next = index - 1;
      break;
    case "ArrowRight":
      next = index + 1;
      break;
    case "ArrowUp":
      next = index - 7;
      break;
    case "ArrowDown":
      next = index + 7;
      break;
    default:
      return null;
  }
  if (next < 0 || next >= cells.length) return null;
  return cells[next].day;
}

/**
 * The mini-month dot fetch criteria: the panel's filters through
 * `toEventListFilter` (the same mapping the list read uses) plus the
 * displayed month's window and the optional case scope (case-detail tab).
 * Invalid anchor → null: the caller skips the read instead of asking the
 * driver for garbage bounds.
 */
export function miniMonthEventFilter(
  filters: AgendaFilters,
  caseId: string | undefined,
  anchor: string,
): EventListFilter | null {
  const bounds = agendaPeriodWindow("mes", anchor);
  if (!bounds) return null;
  return {
    ...toEventListFilter(filters),
    ...(caseId ? { caseId } : {}),
    from: bounds.from,
    to: bounds.to,
  };
}
