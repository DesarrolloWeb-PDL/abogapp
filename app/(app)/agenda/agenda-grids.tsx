"use client";

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { CalendarEvent } from "@/lib/data";
import { formatDate } from "@/lib/format";
import {
  AGENDA_MONTH_NAMES,
  AGENDA_WEEKDAY_SHORT,
  AGENDA_WEEKDAY_SHORT_MONDAY,
  agendaBucketByDay,
  agendaClock,
  agendaDayShaded,
  agendaEventLanes,
  agendaEventPlacement,
  agendaHeatLevel,
  agendaMonthGrid,
  agendaShowsInhabilLabel,
  agendaWeekDays,
  agendaYearMonths,
  type AgendaDayToggles,
  type AgendaMonthCell,
} from "./agenda-periods";
import {
  formatSlotHint,
  slotRangeFromOffsets,
  type SlotRange,
} from "./agenda-event-editor";

/**
 * The four period views' grids (S17 T4): the shared 24-hour time grid
 * behind Día (one column) and Semana (seven columns, red now-line +
 * "Inhábil" labels), the Mes grid ("+N más" overflow opens that day) and
 * the Año heat map (dots per day). Rendering only — event blocks are
 * static content and the detail popover belongs to the panel. T5a adds
 * the Día free-slot layer below ("Libre de… · arrastrá para crear"):
 * hover hints the snapped slot, a drag (or a plain click) hands the
 * 15-minute-snapped range to the panel, Enter is the keyboard fallback.
 *
 * Layout values Tailwind cannot express (grid template, %/px tops) travel
 * as inline styles; every colour is a theme role. Day state (weekend
 * shading / "Inhábil") comes from the pure predicates in agenda-periods
 * fed by the loaded `nonWorkingDays` set — holidays are never hardcoded.
 */

const HOUR_PX = 44;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES_PER_DAY = 24 * 60;
/** ART = UTC−3, no DST since 2009 (calendar.ts ART_OFFSET_MS, duplicated
 *  so this component stays a leaf of the pure module). */
const ART_OFFSET_MS = -3 * 60 * 60 * 1000;

/** Year heat-dot ramp — static strings so Tailwind extracts every stop. */
const HEAT_CLASSES: Record<0 | 1 | 2 | 3, string> = {
  0: "",
  1: "bg-accent/30",
  2: "bg-accent/60",
  3: "bg-accent",
};

interface AgendaGridProps {
  events: readonly CalendarEvent[];
  /** The current ART day (today markers + the now-line). */
  today: string;
  toggles: AgendaDayToggles;
  nonWorkingDays: ReadonlySet<string>;
}

/** `Date#getUTCDay` of a validated grid day (0 = domingo). */
function weekdayIndexOf(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

/** Fraction (0–1) of the ART day elapsed right now. */
function nowDayFraction(): number {
  const art = new Date(Date.now() + ART_OFFSET_MS);
  return (art.getUTCHours() * 60 + art.getUTCMinutes()) / MINUTES_PER_DAY;
}

/* ------------------------------------------------------------ time grid -- */

interface AgendaTimeGridProps extends AgendaGridProps {
  /** Día renders one column; Semana the seven days of the anchor's week. */
  mode: "dia" | "semana";
  anchor: string;
  /** Opens the detail popover for a clicked event block (T5a). */
  onSelectEvent?: (event: CalendarEvent, trigger: HTMLElement) => void;
  /** Día free-slot (T5a): the panel opens the create form for the dragged
   *  or clicked range; an absent range is the keyboard fallback (the day's
   *  default prefill). Semana never wires it — recon documents Día only. */
  onCreateSlot?: (day: string, range?: SlotRange) => void;
}

/**
 * The 24-hour day/week grid: hour gutter, one column per day, events
 * absolutely positioned by `agendaEventPlacement` and split into lanes by
 * `agendaEventLanes`. The red now-line (recon: "Week red now-line") sits
 * over the columns for the current day's week only — decorative, so it is
 * computed after mount and never disagrees with the SSR markup, and it
 * never takes a pointer (a 2px line must not swallow presses on the layer
 * or the event blocks under it).
 */
export function AgendaTimeGrid({
  mode,
  anchor,
  events,
  today,
  toggles,
  nonWorkingDays,
  onSelectEvent,
  onCreateSlot,
}: AgendaTimeGridProps) {
  const days = mode === "dia" ? [anchor] : agendaWeekDays(anchor);
  const bucketed = agendaBucketByDay(events, days);
  const todayIndex = days.indexOf(today);
  const [nowFraction, setNowFraction] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setNowFraction(nowDayFraction());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const columns = `3.5rem repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div
        className="grid border-b border-border"
        style={{ gridTemplateColumns: columns }}
      >
        <div aria-hidden="true" />
        {days.map((day) => {
          const label = agendaShowsInhabilLabel(day, toggles, nonWorkingDays);
          const shaded = agendaDayShaded(day, toggles, nonWorkingDays);
          const dayNumber = Number(day.slice(8, 10));
          return (
            <div
              key={day}
              className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-l border-border px-2 py-1.5 ${
                shaded ? "bg-bg" : ""
              }`}
            >
              {/* The today marker rides on the text (accent), never over
                  the shading class, so the weekend toggle stays observable. */}
              <span
                className={`text-sm font-medium ${
                  day === today ? "text-accent" : "text-text"
                }`}
              >
                {AGENDA_WEEKDAY_SHORT[weekdayIndexOf(day)]} {dayNumber}
              </span>
              {label && (
                <span className="text-xs text-text-muted">Inhábil</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="relative" style={{ height: HOUR_PX * 24 }}>
        {nowFraction !== null && todayIndex !== -1 && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-danger"
            style={{ top: `${nowFraction * 100}%` }}
          />
        )}
        <div className="grid h-full" style={{ gridTemplateColumns: columns }}>
          <div className="relative border-r border-border">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className={`relative ${hour > 0 ? "border-t border-border" : ""}`}
                style={{ height: HOUR_PX }}
              >
                <span className="absolute right-1.5 top-1 text-xs tabular-nums text-text-muted">
                  {String(hour).padStart(2, "0")}:00
                </span>
              </div>
            ))}
          </div>

          {days.map((day) => {
            const lanes = agendaEventLanes(bucketed.get(day) ?? []);
            const shaded = agendaDayShaded(day, toggles, nonWorkingDays);
            return (
              <div
                key={day}
                className={`relative border-r border-border last:border-r-0 ${
                  shaded ? "bg-bg" : ""
                }`}
              >
                {HOURS.slice(1).map((hour) => (
                  <div
                    key={hour}
                    aria-hidden="true"
                    className="absolute inset-x-0 border-t border-border"
                    style={{ top: hour * HOUR_PX }}
                  />
                ))}
                {/* Día only: the free-slot layer sits under the event
                    buttons (same z, earlier DOM) so pressing a block still
                    opens its popover, while every free pixel drags. */}
                {mode === "dia" && onCreateSlot && (
                  <AgendaSlotLayer day={day} onCreateSlot={onCreateSlot} />
                )}
                {lanes.map((lane, laneIndex) => {
                  const width = 100 / lanes.length;
                  return lane.map((event) => {
                    const placement = agendaEventPlacement(event, day);
                    if (!placement) return null;
                    return (
                      <button
                        key={event.id}
                        type="button"
                        onClick={(clickEvent) =>
                          onSelectEvent?.(event, clickEvent.currentTarget)
                        }
                        className="absolute z-0 cursor-pointer overflow-hidden rounded-sm border-l-2 border-accent bg-accent-tint px-1.5 py-0.5 text-left text-xs leading-snug text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        style={{
                          top: `${placement.topPercent}%`,
                          height: `${placement.heightPercent}%`,
                          minHeight: 22,
                          left: `${laneIndex * width}%`,
                          width: `calc(${width}% - 2px)`,
                          ...(event.category
                            ? { borderLeftColor: event.category.color }
                            : {}),
                        }}
                      >
                        <span className="font-semibold tabular-nums">
                          {agendaClock(event.startAt)}
                        </span>{" "}
                        <span className="break-words">{event.title}</span>
                      </button>
                    );
                  });
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- free-slot layer -- */

interface AgendaSlotLayerProps {
  day: string;
  onCreateSlot: (day: string, range?: SlotRange) => void;
}

/**
 * The Día free-slot surface (S17 T5a): one focusable layer over the day's
 * free space. Hover announces the snapped slot ("Libre de… · arrastrá para
 * crear"), a drag paints the selection band and hands the 15-minute-
 * snapped range to the panel, a plain click does the same for a single
 * slot, and Enter/Space — a native button click with no pointer behind it
 * (detail === 0) — opens the form with the day's default prefill: the
 * keyboard fallback.
 *
 * The gesture stays on this element through `setPointerCapture`, so a
 * drag crossing an event block never steals the range; a follow-up click
 * after a pointer gesture is swallowed once by `handledPointerRef` so one
 * gesture opens exactly one form. `touch-pan-y` keeps the page scrollable
 * on touch (a tap still creates the tapped slot; vertical pans scroll).
 */
function AgendaSlotLayer({ day, onCreateSlot }: AgendaSlotLayerProps) {
  const startYRef = useRef<number | null>(null);
  const handledPointerRef = useRef(false);
  const [hint, setHint] = useState<{ top: number; text: string } | null>(null);
  const [selection, setSelection] = useState<{
    top: number;
    height: number;
  } | null>(null);

  /** Pointer Y clamped into the column, in px from its top. */
  function columnY(element: HTMLElement, clientY: number): number {
    const rect = element.getBoundingClientRect();
    return Math.min(Math.max(clientY - rect.top, 0), rect.height);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    handledPointerRef.current = false;
    startYRef.current = columnY(event.currentTarget, event.clientY);
    setHint(null);
    setSelection(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const element = event.currentTarget;
    const y = columnY(element, event.clientY);
    const startY = startYRef.current;
    if (startY !== null) {
      setSelection({ top: Math.min(startY, y), height: Math.abs(y - startY) });
      return;
    }
    const rect = element.getBoundingClientRect();
    if (!(rect.height > 0)) return; // unmounting: never render a NaN hint
    setHint({
      top: y,
      text: formatSlotHint((y / rect.height) * MINUTES_PER_DAY),
    });
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const startY = startYRef.current;
    if (startY === null) return;
    startYRef.current = null;
    const rect = event.currentTarget.getBoundingClientRect();
    const endY = columnY(event.currentTarget, event.clientY);
    setSelection(null);
    setHint(null);
    handledPointerRef.current = true;
    onCreateSlot(day, slotRangeFromOffsets(startY, endY, rect.height));
  }

  function handlePointerCancel() {
    startYRef.current = null;
    setSelection(null);
    setHint(null);
  }

  function handlePointerLeave() {
    if (startYRef.current === null) setHint(null);
  }

  function handleClick(event: ReactMouseEvent<HTMLButtonElement>) {
    if (handledPointerRef.current) {
      handledPointerRef.current = false;
      return; // the pointer gesture above already opened the form
    }
    if (event.detail !== 0) return; // pointer presses never reach this path
    onCreateSlot(day); // keyboard activation: the day's default prefill
  }

  return (
    <>
      <button
        type="button"
        aria-label="Horario libre: crear un evento"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerLeave}
        onClick={handleClick}
        className="absolute inset-0 z-0 cursor-crosshair touch-pan-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      />
      {selection && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 z-10 bg-accent/30"
          style={{ top: `${selection.top}px`, height: `${selection.height}px` }}
        />
      )}
      {hint && (
        <span
          className="pointer-events-none absolute left-1 z-10 -translate-y-1/2 rounded-sm bg-accent px-1.5 py-0.5 text-xs font-medium text-on-accent shadow-pop"
          style={{ top: `${hint.top}px` }}
        >
          {hint.text}
        </span>
      )}
    </>
  );
}

/* ----------------------------------------------------------- month grid -- */

interface AgendaMonthGridProps extends AgendaGridProps {
  anchor: string;
  /** "+N más" opens that day in Día view. */
  onOpenDay: (day: string) => void;
  /** Opens the detail popover for a clicked event line (T5a). */
  onSelectEvent?: (event: CalendarEvent, trigger: HTMLElement) => void;
}

/**
 * The Mes grid: 6 Monday-first weeks, up to two events per cell, then the
 * recon's "+N más" overflow button, weekend/inhábil shading and the
 * "Inhábil" label. Out-of-month days stay muted (the neighbouring months'
 * rows are not this period).
 */
export function AgendaMonthGrid({
  anchor,
  events,
  today,
  toggles,
  nonWorkingDays,
  onOpenDay,
  onSelectEvent,
}: AgendaMonthGridProps) {
  const cells = agendaMonthGrid(anchor);
  const bucketed = agendaBucketByDay(
    events,
    cells.map((cell) => cell.day),
  );
  const weeks: AgendaMonthCell[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }

  return (
    <div className="overflow-hidden rounded-lg bg-surface">
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr>
            {AGENDA_WEEKDAY_SHORT_MONDAY.map((name) => (
              <th
                key={name}
                scope="col"
                className="border-b border-border px-1 py-1.5 text-xs font-medium uppercase text-text-muted"
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
                const dayEvents = bucketed.get(cell.day) ?? [];
                const shaded = agendaDayShaded(
                  cell.day,
                  toggles,
                  nonWorkingDays,
                );
                const label = agendaShowsInhabilLabel(
                  cell.day,
                  toggles,
                  nonWorkingDays,
                );
                const dayNumber = Number(cell.day.slice(8, 10));
                const overflow = dayEvents.length - 2;
                return (
                  <td
                    key={cell.day}
                    className={`h-24 border border-border p-1 align-top ${
                      shaded ? "bg-bg" : ""
                    } ${cell.inMonth ? "" : "text-text-muted"}`}
                  >
                    <div className="flex h-full flex-col gap-0.5">
                      {cell.day === today ? (
                        <span className="inline-flex size-6 items-center justify-center self-start rounded-pill bg-accent text-xs font-semibold text-on-accent">
                          {dayNumber}
                        </span>
                      ) : (
                        <span className="px-1 text-xs font-medium text-text">
                          {dayNumber}
                        </span>
                      )}
                      {label && (
                        <span className="px-1 text-xs text-text-muted">
                          Inhábil
                        </span>
                      )}
                      {dayEvents.slice(0, 2).map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          onClick={(clickEvent) =>
                            onSelectEvent?.(event, clickEvent.currentTarget)
                          }
                          className="w-full truncate px-1 text-left text-xs text-text cursor-pointer hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <span className="tabular-nums text-text-muted">
                            {agendaClock(event.startAt)}
                          </span>{" "}
                          {event.title}
                        </button>
                      ))}
                      {overflow > 0 && (
                        <button
                          type="button"
                          onClick={() => onOpenDay(cell.day)}
                          aria-label={`+${overflow} más — abrir el día ${formatDate(cell.day)}`}
                          className="mt-auto self-start rounded-sm px-1 text-xs font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          +{overflow} más
                        </button>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------ year grid -- */

interface AgendaYearGridProps extends AgendaGridProps {
  anchor: string;
}

/**
 * The Año heat map: twelve mini-months with a dot per day whose opacity
 * ramps with the event count (`agendaHeatLevel`). Weekends/inhábiles get
 * the same shading branch as every other grid — no labels here, the cells
 * are too small for the word to stay readable.
 */
export function AgendaYearGrid({
  anchor,
  events,
  today,
  toggles,
  nonWorkingDays,
}: AgendaYearGridProps) {
  const months = agendaYearMonths(anchor);
  // Adjacent month grids repeat boundary days; the bucketer dedupes.
  const bucketed = agendaBucketByDay(
    events,
    months.flatMap((month) =>
      agendaMonthGrid(month).map((cell) => cell.day),
    ),
  );
  const year = anchor.slice(0, 4);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {months.map((month, monthIndex) => {
        const cells = agendaMonthGrid(month);
        const weeks: AgendaMonthCell[][] = [];
        for (let index = 0; index < cells.length; index += 7) {
          weeks.push(cells.slice(index, index + 7));
        }
        return (
          <section
            key={month}
            className="rounded-lg border border-border bg-surface p-3"
          >
            <h3 className="mb-1.5 text-sm font-semibold text-text">
              {AGENDA_MONTH_NAMES[monthIndex]} {year}
            </h3>
            <table className="w-full table-fixed border-collapse">
              <thead>
                <tr>
                  {AGENDA_WEEKDAY_SHORT_MONDAY.map((name) => (
                    <th
                      key={name}
                      scope="col"
                      className="pb-1 text-xs font-medium text-text-muted"
                    >
                      {name.slice(0, 2)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((week) => (
                  <tr key={week[0].day}>
                    {week.map((cell) => {
                      if (!cell.inMonth) {
                        return <td key={cell.day} className="p-0" />;
                      }
                      const count = bucketed.get(cell.day)?.length ?? 0;
                      const heat = agendaHeatLevel(count);
                      const shaded = agendaDayShaded(
                        cell.day,
                        toggles,
                        nonWorkingDays,
                      );
                      const dayNumber = Number(cell.day.slice(8, 10));
                      return (
                        <td key={cell.day} className="p-0">
                          <div
                            className={`flex flex-col items-center justify-center gap-0.5 py-1 ${
                              shaded ? "bg-bg" : ""
                            }`}
                          >
                            {cell.day === today ? (
                              <span className="inline-flex size-5 items-center justify-center rounded-pill bg-accent text-xs font-semibold text-on-accent">
                                {dayNumber}
                              </span>
                            ) : (
                              <span className="text-xs text-text">
                                {dayNumber}
                              </span>
                            )}
                            {heat > 0 && (
                              <span
                                aria-hidden="true"
                                className={`size-1.5 rounded-pill ${HEAT_CLASSES[heat]}`}
                              />
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
