"use client";

import Link from "next/link";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SkeletonRows } from "@/components/ui/skeleton";
import {
  UPCOMING_DAYS,
  listEventCategories,
  listEventsByCase,
  listUpcomingEvents,
  type EventCategory,
} from "@/lib/data";
import {
  DEFAULT_AGENDA_FILTERS,
  SOURCE_FILTER_OPTIONS,
  SOURCE_LABELS,
  agendaFiltersActive,
  agendaLoadReducer,
  buildFilterChips,
  formatDayHeading,
  formatTimeRange,
  groupByDay,
  sourceTone,
  toEventListFilter,
  toggleValue,
  type AgendaFilterChip,
  type AgendaFilters,
} from "./agenda-list";

/**
 * Agenda Lista panel (S17) — the list surface shared by `/agenda` (T2,
 * whole study) and the case-detail Agenda tab (T3, scoped version opening
 * in Lista). `caseId` picks the reader: absent → listUpcomingEvents (the
 * study window), present → listEventsByCase (same window pinned to the
 * route's expediente). One panel, one copy, two scopes — never a fork.
 *
 * Load discipline follows the notificaciones page: the effect only starts
 * reads and every state write lands in a promise callback
 * (react-hooks/set-state-in-effect); a request token discards any answer
 * that is no longer the newest one. Once rows are on screen a refresh never
 * replaces them with a spinner — the reducer keeps them visible under a
 * thin top bar (recon: "previous period stays visible … while next loads").
 *
 * Category checkboxes render only while `listEventCategories()` returns
 * rows: the six default names/11 colors are an evidence gap (init.sql
 * TODO(gap), T6 seeds them), so nothing here invents them.
 *
 * The page header (h1 + subtitle) belongs to the caller: the tab renders
 * its own h2 under the case's h1, this panel never owns an heading level.
 */

const CHECKBOX_CLASSES =
  "size-5 rounded-sm border-border-input accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const LINK_CLASSES =
  "font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const CHIP_CLASSES =
  "inline-flex min-h-9 items-center gap-1.5 rounded-pill border border-border-input bg-surface px-3 py-1 text-sm text-text hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function AgendaPanel({ caseId }: { caseId?: string }) {
  const [state, dispatch] = useReducer(agendaLoadReducer, {
    status: "loading",
  });
  const [filters, setFilters] = useState<AgendaFilters>(DEFAULT_AGENDA_FILTERS);
  // The search box debounces: every keystroke would otherwise refetch.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categories, setCategories] = useState<EventCategory[]>([]);
  // Newest-request token: only the latest read may write state.
  const requestRef = useRef(0);

  const fetchEvents = useCallback(
    (snapshot: AgendaFilters) => {
      const requestId = ++requestRef.current;
      // The effect only starts the reads; state resolves through the promise
      // callbacks (react-hooks/set-state-in-effect forbids sync setState
      // here). The "load" marker runs one microtask later — microtasks drain
      // before any network answer can land, so a ready list always flips to
      // `refreshing` before its rows are swapped.
      Promise.resolve().then(() => {
        if (requestId === requestRef.current) dispatch({ type: "load" });
      });
      // Same window, one scope: the case tab pins it to its expediente
      // (listEventsByCase), /agenda reads the whole study.
      const read = caseId
        ? listEventsByCase(caseId, toEventListFilter(snapshot))
        : listUpcomingEvents(toEventListFilter(snapshot));
      read
        .then((events) => {
          if (requestId !== requestRef.current) return;
          dispatch({ type: "success", events });
        })
        .catch(() => {
          if (requestId !== requestRef.current) return;
          dispatch({ type: "failure" });
        });
    },
    [caseId],
  );

  // Categories load once per mount; a failure only hides the (still empty
  // until T6) category UI — it must never take the agenda down with it.
  const fetchCategories = useCallback(() => {
    listEventCategories()
      .then((rows) => setCategories(rows))
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const { sources, categoryIds } = filters;
  useEffect(() => {
    fetchEvents({ search: debouncedSearch, sources, categoryIds });
  }, [debouncedSearch, sources, categoryIds, fetchEvents]);

  // Debounce the search box (300ms); checkboxes apply on the next tick.
  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedSearch(filters.search),
      300,
    );
    return () => clearTimeout(timer);
  }, [filters.search]);

  function updateFilters(patch: Partial<AgendaFilters>) {
    setFilters((prev) => ({ ...prev, ...patch }));
  }

  function clearFilters() {
    setFilters(DEFAULT_AGENDA_FILTERS);
    setDebouncedSearch("");
  }

  /** Remove exactly one chip's criterion; the search chip also cancels its
   *  pending debounce so the list restores immediately. */
  function removeChip(chip: AgendaFilterChip) {
    setFilters(chip.filters);
    if (!chip.filters.search.trim()) setDebouncedSearch("");
  }

  function retry() {
    fetchCategories();
    fetchEvents({ search: debouncedSearch, sources, categoryIds });
  }

  const ready = state.status === "ready" ? state : null;
  const active = agendaFiltersActive(filters);
  // One clear control at a time: the empty panel owns the button when
  // nothing matches, so "Limpiar filtros" is never rendered twice.
  const showBarClear = active && ready !== null && ready.events.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-2 sm:max-w-lg">
          <span className="text-sm font-semibold text-text">
            Buscar eventos
          </span>
          <Input
            type="search"
            value={filters.search}
            onChange={(event) => updateFilters({ search: event.target.value })}
            placeholder="Título, lugar, notas o expediente"
          />
        </label>

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-semibold text-text">
            Tipos de evento
          </legend>
          <div className="flex flex-wrap items-center gap-x-4">
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
                    updateFilters({
                      sources: toggleValue(filters.sources, option.value),
                    })
                  }
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Dormant until T6 seeds the evidenced defaults ([] = hidden). */}
        {categories.length > 0 && (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-semibold text-text">
              Categorías
            </legend>
            <div className="flex flex-wrap items-center gap-x-4">
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
                      updateFilters({
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

        {showBarClear && (
          <Button variant="secondary" onClick={clearFilters}>
            Limpiar filtros
          </Button>
        )}
      </div>

      {state.status === "loading" && (
        <div
          className="rounded-lg border border-border bg-surface p-4"
          aria-busy="true"
        >
          <p role="status" className="sr-only">
            Cargando eventos
          </p>
          <SkeletonRows rows={5} />
        </div>
      )}

      {state.status === "error" && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-border bg-surface px-6 py-12 text-center">
          <p className="text-base text-text-muted">
            No pudimos cargar la agenda
          </p>
          <Button variant="secondary" onClick={retry}>
            Reintentar
          </Button>
        </div>
      )}

      {ready !== null && ready.events.length === 0 && active && (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface px-6 py-12 text-center">
          <p className="text-base text-text-muted">
            No hay eventos con estos filtros
          </p>
          <div
            role="group"
            aria-label="Filtros activos"
            className="flex flex-wrap justify-center gap-2"
          >
            {buildFilterChips(filters, categories).map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => removeChip(chip)}
                aria-label={`Quitar filtro ${chip.label}`}
                className={CHIP_CLASSES}
              >
                {chip.label}
                <X aria-hidden="true" className="size-3.5" />
              </button>
            ))}
          </div>
          <Button variant="secondary" onClick={clearFilters}>
            Limpiar filtros
          </Button>
        </div>
      )}

      {ready !== null && ready.events.length === 0 && !active && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-surface px-6 py-12 text-center">
          <p className="text-base text-text-muted">
            Todavía no hay eventos en los próximos {UPCOMING_DAYS} días.
          </p>
        </div>
      )}

      {ready !== null && ready.events.length > 0 && (
        <div
          className="flex flex-col gap-4"
          aria-busy={ready.refreshing || undefined}
        >
          {ready.refreshing && (
            <>
              <div
                aria-hidden="true"
                className="h-0.5 w-full overflow-hidden rounded-pill bg-border"
              >
                <div className="h-full w-1/3 animate-pulse rounded-pill bg-accent" />
              </div>
              <p role="status" className="sr-only">
                Actualizando los eventos
              </p>
            </>
          )}

          {groupByDay(ready.events).map((group) => (
            <section key={group.day} className="flex flex-col gap-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">
                {formatDayHeading(group.day)}
              </h2>
              <ul className="flex flex-col gap-3">
                {group.events.map((event) => (
                  <li
                    key={event.id}
                    className="flex min-h-11 flex-col gap-1.5 rounded-lg border border-border bg-surface px-4 py-4 shadow-card"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
                      <span className="tabular-nums">
                        {formatTimeRange(event.startAt, event.endAt)}
                      </span>
                      {event.source !== "manual" && (
                        <Badge tone={sourceTone(event.source)}>
                          {SOURCE_LABELS[event.source]}
                        </Badge>
                      )}
                      {event.category && (
                        <Badge tone="neutral">
                          <span
                            aria-hidden="true"
                            className="size-1.5 rounded-full"
                            style={{ backgroundColor: event.category.color }}
                          />
                          {event.category.name}
                        </Badge>
                      )}
                    </div>
                    <p className="text-base font-semibold text-text">
                      {event.title}
                    </p>
                    {event.location && (
                      <p className="text-base text-text-muted">
                        {event.location}
                      </p>
                    )}
                    {event.caseId && event.caseCaratula && (
                      <Link
                        href={`/expedientes/${event.caseId}`}
                        className={LINK_CLASSES}
                      >
                        {event.caseCaratula}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
