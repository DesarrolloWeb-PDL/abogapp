"use client";

import { useEffect, useState } from "react";
import type { CalendarEvent } from "@/lib/data";
import { formatDate } from "@/lib/format";
import {
  AGENDA_MONTH_NAMES,
  AGENDA_WEEKDAY_SHORT,
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

/**
 * The four period views' grids (S17 T4): the shared 24-hour time grid
 * behind Día (one column) and Semana (seven columns, red now-line +
 * "Inhábil" labels), the Mes grid ("+N más" overflow opens that day) and
 * the Año heat map (dots per day). Rendering only — event popovers and the
 * Día free-slot drag-create ("Libre de… · arrastrá para crear") belong to
 * T5, so nothing here is draggable and event blocks are static content.
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
}

/**
 * The 24-hour day/week grid: hour gutter, one column per day, events
 * absolutely positioned by `agendaEventPlacement` and split into lanes by
 * `agendaEventLanes`. The red now-line (recon: "Week red now-line") sits
 * over the columns for the current day's week only — decorative, so it is
 * computed after mount and never disagrees with the SSR markup.
 */
export function AgendaTimeGrid({
  mode,
  anchor,
  events,
  today,
  toggles,
  nonWorkingDays,
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
            className="absolute inset-x-0 z-10 h-0.5 bg-danger"
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
                {lanes.map((lane, laneIndex) => {
                  const width = 100 / lanes.length;
                  return lane.map((event) => {
                    const placement = agendaEventPlacement(event, day);
                    if (!placement) return null;
                    return (
                      <div
                        key={event.id}
                        className="absolute z-0 overflow-hidden rounded-sm border-l-2 border-accent bg-accent-tint px-1.5 py-0.5 text-xs leading-snug text-text"
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
                      </div>
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

/* ----------------------------------------------------------- month grid -- */

interface AgendaMonthGridProps extends AgendaGridProps {
  anchor: string;
  /** "+N más" opens that day in Día view (the T5 popover comes later). */
  onOpenDay: (day: string) => void;
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
            {AGENDA_WEEKDAY_SHORT.map((name) => (
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
                        <div key={event.id} className="truncate px-1 text-xs text-text">
                          <span className="tabular-nums text-text-muted">
                            {agendaClock(event.startAt)}
                          </span>{" "}
                          {event.title}
                        </div>
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
                  {AGENDA_WEEKDAY_SHORT.map((name) => (
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
