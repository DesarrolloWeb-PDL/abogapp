"use client";

import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CalendarEvent, EventCategory } from "@/lib/data";
import {
  SOURCE_FILTER_OPTIONS,
  formatDayHeading,
  toggleValue,
  type AgendaFilters,
} from "./agenda-list";
import { agendaPeriodTitle, type AgendaDayToggles } from "./agenda-periods";
import {
  MINI_WEEKDAY_HEADERS,
  buildMiniMonth,
  miniMonthMoveFocus,
  type MiniMonthDay,
} from "./agenda-mini-month";

/**
 * The S17 left panel (T5b): search (Ctrl+K), the mini-month calendar with
 * event dots + hatched non-working days, and the checkbox block (sources +
 * Fines de semana + categories). Narrow: hidden behind an icon toggle
 * (recon: "narrow: left panel hidden behind icon"); from `lg` up it is a
 * persistent 260px column (`w-65`), because 260px + the 240px sidebar only
 * leaves the grids a usable width at ≥1024px.
 *
 * Presentational on purpose: filters, categories, toggles, anchor and the
 * dot events all live in AgendaPanel (one copy of every handler); this
 * component owns only the roving focus day of the mini-month grid. Day
 * clicks reuse the month-grid's `openDay` semantics (jump to that day in
 * Día view), and the month ‹ › step the anchor itself, so the mini-month
 * can never drift from the main view (single source of truth).
 *
 * The category block stays hidden while `listEventCategories()` answers []:
 * the six default names/11 colours are an evidence gap (init.sql TODO, T6
 * seeds them), so nothing here invents them.
 */

const CHECKBOX_CLASSES =
  "size-5 rounded-sm border-border-input accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/**
 * Inhábil hatch (design: "inhábil hatch `border`", "hatched days bg+border"):
 * stripes drawn with the BORDER token over the cell's bg — colours are token
 * variables, never raw hex; the 1px stops are pattern geometry Tailwind
 * cannot express (same inline-style precedent as the grids' HOUR_PX).
 */
const HATCH_STYLE: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, var(--ds-border) 0 1px, transparent 1px 4px)",
};

interface AgendaLeftPanelProps {
  /** Narrow open state (wide shows the panel regardless, via CSS). */
  open: boolean;
  filters: AgendaFilters;
  categories: readonly EventCategory[];
  /** Show the panel's Limpiar button (never together with the empty state's). */
  showClear: boolean;
  /** The two day toggles — same state the top bar steers. */
  toggles: AgendaDayToggles;
  nonWorkingDays: ReadonlySet<string>;
  /** The main anchor: the mini-month shows ITS month (and steps with it). */
  anchor: string;
  /** Current ART day, for the today pill. */
  today: string;
  /** Events fetched for the displayed month (already filter-applied). */
  miniEvents: readonly CalendarEvent[];
  onToggleOpen: () => void;
  onFiltersChange: (patch: Partial<AgendaFilters>) => void;
  onToggleWeekends: (checked: boolean) => void;
  /** Day click → openDay (the "+N más" semantics: that day in Día view). */
  onOpenDay: (day: string) => void;
  /** Mini-month ‹ › → step the anchor by one month. */
  onShiftMonth: (direction: -1 | 1) => void;
  onClear: () => void;
}

/** The accessible label of one day button: full date + count + hatch text. */
function dayLabel(cell: MiniMonthDay): string {
  const parts = [formatDayHeading(cell.day)];
  if (cell.eventCount > 0) {
    parts.push(
      `${cell.eventCount} ${cell.eventCount === 1 ? "evento" : "eventos"}`,
    );
  }
  if (cell.hatched) parts.push("día inhábil");
  return parts.join(", ");
}

export function AgendaLeftPanel({
  open,
  filters,
  categories,
  showClear,
  toggles,
  nonWorkingDays,
  anchor,
  today,
  miniEvents,
  onToggleOpen,
  onFiltersChange,
  onToggleWeekends,
  onOpenDay,
  onShiftMonth,
  onClear,
}: AgendaLeftPanelProps) {
  const cells = buildMiniMonth(anchor, miniEvents, {
    today,
    toggles,
    nonWorkingDays,
  });
  const weeks: MiniMonthDay[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }

  // Roving tabindex: the last arrow-focused day stays the tab stop while it
  // belongs to the displayed grid; otherwise fall back to the anchor day,
  // then today, then the first day of the month (no effect → no
  // set-state-in-effect escape needed when the month steps).
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const fallbackDay =
    cells.find((cell) => cell.day === anchor)?.day ??
    cells.find((cell) => cell.isToday)?.day ??
    cells.find((cell) => cell.inMonth)?.day ??
    cells[0]?.day ??
    null;
  const activeDay =
    focusDay && cells.some((cell) => cell.day === focusDay)
      ? focusDay
      : fallbackDay;
  const gridRef = useRef<HTMLTableElement>(null);

  function handleGridKeyDown(event: ReactKeyboardEvent<HTMLTableElement>) {
    const target = event.target as HTMLElement;
    const currentDay = target.getAttribute("data-day");
    if (!currentDay) return;
    const next = miniMonthMoveFocus(currentDay, event.key, cells);
    if (event.key.startsWith("Arrow")) event.preventDefault(); // no page scroll at the edges
    if (!next) return;
    setFocusDay(next);
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)
      ?.focus();
  }

  const monthTitle = agendaPeriodTitle("mes", anchor, 0).main;
  const hasHatch = cells.some((cell) => cell.hatched);

  return (
    <div className="flex w-full flex-col gap-3 lg:w-65 lg:shrink-0">
      {/* Narrow only: the icon that hides/shows the panel (recon S17). */}
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        aria-controls="agenda-left-panel"
        aria-label={
          open ? "Ocultar panel de la agenda" : "Mostrar panel de la agenda"
        }
        title={open ? "Ocultar panel de la agenda" : "Mostrar panel de la agenda"}
        className="inline-flex min-h-11 min-w-11 items-center justify-center self-start rounded-md border border-border-input bg-surface px-3 text-text hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:hidden"
      >
        {open ? (
          <PanelLeftClose aria-hidden="true" className="size-5" />
        ) : (
          <PanelLeftOpen aria-hidden="true" className="size-5" />
        )}
      </button>

      <aside
        id="agenda-left-panel"
        aria-label="Panel de la agenda"
        className={[open ? "flex" : "hidden", "flex-col gap-4 lg:flex"].join(
          " ",
        )}
      >
        <label className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-text">
            Buscar eventos
          </span>
          <Input
            id="agenda-search"
            type="search"
            aria-keyshortcuts="Control+K"
            placeholder="Título, lugar, notas o expediente"
            value={filters.search}
            onChange={(event) => onFiltersChange({ search: event.target.value })}
          />
        </label>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-1">
            <Button
              variant="secondary"
              size="sm"
              aria-label="Mes anterior"
              onClick={() => onShiftMonth(-1)}
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
            </Button>
            <p className="text-sm font-semibold text-text">{monthTitle}</p>
            <Button
              variant="secondary"
              size="sm"
              aria-label="Mes siguiente"
              onClick={() => onShiftMonth(1)}
            >
              <ChevronRight aria-hidden="true" className="size-4" />
            </Button>
          </div>

          <table
            ref={gridRef}
            onKeyDown={handleGridKeyDown}
            className="w-full table-fixed border-collapse"
          >
            <thead>
              <tr>
                {MINI_WEEKDAY_HEADERS.map((name) => (
                  <th
                    key={name}
                    scope="col"
                    className="pb-1 text-xs font-medium uppercase text-text-muted"
                  >
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week[0].day}>
                  {week.map((cell) => {
                    // Zero-padded, like formatDate's dd contract: WCAG 2.5.3
                    // (axe label-content-name-mismatch) tokenizes the name —
                    // the visible "01" must match the aria-label's "01", while
                    // a bare "1" matches neither "01" nor "11".
                    const dayNumber = cell.day.slice(8, 10);
                    return (
                      <td key={cell.day} className="p-0">
                        <button
                          type="button"
                          data-day={cell.day}
                          tabIndex={cell.day === activeDay ? 0 : -1}
                          aria-label={dayLabel(cell)}
                          onClick={() => {
                            setFocusDay(cell.day);
                            onOpenDay(cell.day);
                          }}
                          className={[
                            "flex w-full flex-col items-center gap-0.5 rounded-sm px-0.5 py-1",
                            "hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                            cell.weekendShaded || cell.hatched ? "bg-bg" : "",
                            cell.inMonth ? "text-text" : "text-text-muted",
                          ].join(" ")}
                          style={cell.hatched ? HATCH_STYLE : undefined}
                        >
                          {cell.isToday ? (
                            <span className="inline-flex size-5 items-center justify-center rounded-pill bg-accent text-xs font-semibold text-on-accent">
                              {dayNumber}
                            </span>
                          ) : (
                            <span className="text-xs font-medium">
                              {dayNumber}
                            </span>
                          )}
                          <span
                            aria-hidden="true"
                            className="flex justify-center gap-0.5"
                          >
                            {cell.dotColors.map((color, index) => (
                              <span
                                key={index}
                                className={[
                                  "size-1.5 rounded-pill",
                                  color === null ? "bg-text-muted" : "",
                                ].join(" ")}
                                style={
                                  color === null
                                    ? undefined
                                    : { backgroundColor: color }
                                }
                              />
                            ))}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Design a11y: hatched non-working days carry a legend + text
              (the day's label repeats "día inhábil" for screen readers). */}
          {hasHatch && (
            <p className="flex items-center gap-2 text-xs text-text-muted">
              <span
                aria-hidden="true"
                className="inline-block size-3 rounded-sm border border-border"
                style={HATCH_STYLE}
              />
              Día inhábil
            </p>
          )}
        </div>

        {/* Dormant until T6 seeds the evidenced defaults ([] = hidden). */}
        {categories.length > 0 && (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-semibold text-text">
              Categorías
            </legend>
            <div className="flex flex-col gap-1">
              {categories.map((category) => (
                <label
                  key={category.id}
                  className="flex min-h-11 cursor-pointer items-center gap-2 text-base text-text"
                >
                  <input
                    type="checkbox"
                    className={CHECKBOX_CLASSES}
                    checked={filters.categoryIds.includes(category.id)}
                    onChange={() =>
                      onFiltersChange({
                        categoryIds: toggleValue(
                          filters.categoryIds,
                          category.id,
                        ),
                      })
                    }
                  />
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-pill"
                    style={{ backgroundColor: category.color }}
                  />
                  {category.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-semibold text-text">
            Tipos de evento
          </legend>
          <div className="flex flex-col gap-1">
            {SOURCE_FILTER_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex min-h-11 cursor-pointer items-center gap-2 text-base text-text"
              >
                <input
                  type="checkbox"
                  className={CHECKBOX_CLASSES}
                  checked={filters.sources.includes(option.value)}
                  onChange={() =>
                    onFiltersChange({
                      sources: toggleValue(filters.sources, option.value),
                    })
                  }
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Weekend visibility: the SAME state the top-bar toggle steers
            (recon: "Audiencias/Vencimientos/Fines de semana … consistent
            with the top-bar toggle"), so both checkboxes stay in sync. */}
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-base text-text">
          <input
            type="checkbox"
            className={CHECKBOX_CLASSES}
            checked={toggles.weekends}
            onChange={(event) => onToggleWeekends(event.target.checked)}
          />
          Fines de semana
        </label>

        {showClear && (
          <Button variant="secondary" onClick={onClear}>
            Limpiar filtros
          </Button>
        )}
      </aside>
    </div>
  );
}
