"use client";

import Link from "next/link";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  UPCOMING_DAYS,
  listEventCategories,
  listEvents,
  listEventsByCase,
  listUpcomingEvents,
  loadNonWorkingDays,
  nonWorkingDays,
  type CalendarEvent,
  type EventCategory,
} from "@/lib/data";
import { toArtIsoDate } from "@/lib/data/calendar";
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
import {
  agendaPeriodTitle,
  agendaPeriodWindow,
  agendaShortcutAction,
  availableAgendaViews,
  clampAgendaView,
  shiftAgendaPeriod,
  type AgendaDayToggles,
  type AgendaViewKind,
} from "./agenda-periods";
import {
  defaultEventFormValues,
  slotFormValues,
  type EventFormValues,
  type SlotRange,
} from "./agenda-event-editor";
import { AgendaEventForm } from "./agenda-event-form";
import { AgendaEventPopover } from "./agenda-event-popover";
import { AgendaTimeGrid, AgendaMonthGrid, AgendaYearGrid } from "./agenda-grids";
import { AgendaTopBar, useAgendaNarrowViewport } from "./agenda-top-bar";

/**
 * Agenda Lista panel (S17) — the list surface shared by `/agenda` (T2,
 * whole study) and the case-detail Agenda tab (T3, scoped version opening
 * in Lista). `caseId` picks the reader: absent → listUpcomingEvents (the
 * study window), present → listEventsByCase (same window pinned to the
 * route's expediente). One panel, one copy, two scopes — never a fork.
 *
 * T4 added the top bar on top of that: the Día/Semana/Mes/Año/Lista
 * selector (D/S/M/A/L + H shortcuts), ‹ › period navigation with Hoy, and
 * the Fines de semana / Días inhábiles toggles. The view defaults to Lista
 * on BOTH surfaces (recon: the case tab "opens in Lista") and clamps to
 * Lista/Día below 768px (recon: "mobile: Lista or Día only (no Año)").
 * Period views read `listEvents` over `agendaPeriodWindow`'s bounds —
 * adjacent periods tile, so ‹ › never gaps or duplicates a row.
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
 * TODO(gap), T6 seeds them), so nothing here invents them. The toggles
 * shade weekends and dated non-working days from `nonWorkingDays` (loaded
 * once per mount) — holidays are never hardcoded here either.
 *
 * The page header (h1 + subtitle) belongs to the caller: the tab renders
 * its own h2 under the case's h1, this panel never owns an heading level.
 * The top bar's period title IS this panel's h2.
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

  // --- T4 period views -------------------------------------------------
  // The rendered view is DERIVED: rawView survives a resize that outlaws
  // it (back to wide → the old view returns), while the narrow screen only
  // ever shows Lista/Día (recon: "mobile: Lista or Día only (no Año)").
  const narrow = useAgendaNarrowViewport();
  const [rawView, setRawView] = useState<AgendaViewKind>("lista");
  const view = clampAgendaView(rawView, narrow);
  const views = availableAgendaViews(narrow);
  // The anchor is an ART day: ‹ › shift it per view, H resets it to today.
  // Both surfaces boot on Lista with today's anchor (recon: case tab
  // "opens in Lista"). SSR and hydration agree unless the ART date rolls
  // over between the two renders — the same window every "today" widget
  // accepts, and the grids themselves only render after the first fetch
  // (purely client-side), so they never hydrate.
  const [anchor, setAnchor] = useState<string>(() => toArtIsoDate(new Date()));
  const [showWeekends, setShowWeekends] = useState(true);
  const [showNonWorkingDays, setShowNonWorkingDays] = useState(true);
  // Dated non-working days (feria/feriado/studio rows): the shared module
  // set already holds the static feria until loadNonWorkingDays() answers;
  // a copy (not the live set) so a load always re-renders the grids.
  const [inhabilDays, setInhabilDays] = useState<ReadonlySet<string>>(
    () => new Set(nonWorkingDays),
  );
  // --- T5a: event popover + create/edit form -----------------------------
  // Popover = {event, trigger element}; editor = create (prefilled values:
  // `C`/top-bar → the day default, a Día free slot → its range) or edit
  // (the row itself). Both live here so `/agenda` and the case tab share
  // one copy of every handler (the AgendaPanel discipline).
  const [popover, setPopover] = useState<{
    event: CalendarEvent;
    anchor: HTMLElement;
  } | null>(null);
  const [editor, setEditor] = useState<
    | { mode: "create"; values: EventFormValues }
    | { mode: "edit"; event: CalendarEvent }
    | null
  >(null);
  const { toast } = useToast();

  /** Stable identity: the popover subscribes its document listeners once. */
  const closePopover = useCallback(() => setPopover(null), []);

  function openPopover(event: CalendarEvent, anchor: HTMLElement) {
    setPopover({ event, anchor });
  }

  /** Create prefilled with the anchor day (recon `C` + top-bar button). */
  function openCreate() {
    setPopover(null);
    setEditor({
      mode: "create",
      values: defaultEventFormValues({
        day: anchor,
        caseId: caseId ?? "",
      }),
    });
  }

  /** Día free-slot (drag/click on the grid's layer): prefill from the
   *  snapped range; the keyboard fallback arrives without a range and
   *  takes the day default, exactly like `C`. */
  function openCreateSlot(day: string, range?: SlotRange) {
    setPopover(null);
    const slot = range
      ? slotFormValues(day, range.start, range.end, caseId ?? "")
      : null;
    setEditor({
      mode: "create",
      values: slot ?? defaultEventFormValues({ day, caseId: caseId ?? "" }),
    });
  }

  function openEdit(event: CalendarEvent) {
    setPopover(null);
    setEditor({ mode: "edit", event });
  }

  /** After any save: close the form, toast, refetch with current criteria. */
  function handleSaved(mode: "create" | "edit") {
    setEditor(null);
    toast(
      mode === "create"
        ? "Creaste el evento."
        : "Actualizamos el evento.",
    );
    fetchEvents({ search: debouncedSearch, sources, categoryIds });
  }

  const dayToggles: AgendaDayToggles = {
    weekends: showWeekends,
    nonWorkingDays: showNonWorkingDays,
  };

  const fetchEvents = useCallback(
    (snapshot: AgendaFilters) => {
      const requestId = ++requestRef.current;
      // The effect only starts the reads; state resolves through the promise
      // callbacks (react-hooks/set-state-in-effect forbids sync setState
      // here). The "load" marker runs one microtask later — microtasks drain
      // before any network answer can land, so a ready list always flips to
      // `refreshing` before its rows are swapped.
      Promise.resolve().then(() => {
        if (requestId === requestRef.current) {
          dispatch({ type: "load" });
          // A refetch invalidates any open detail popover: its trigger may
          // unmount (view/anchor/filters changed) and its row may be stale.
          setPopover(null);
        }
      });
      const criteria = toEventListFilter(snapshot);
      // Lista keeps the driver's upcoming window; the period views read
      // their own half-open bounds (adjacent periods tile — ‹ › never gaps
      // or duplicates a row), both scopes pinned by caseId when present.
      const period = agendaPeriodWindow(view, anchor);
      const read = period
        ? listEvents({
            ...criteria,
            ...(caseId ? { caseId } : {}),
            from: period.from,
            to: period.to,
          })
        : caseId
          ? listEventsByCase(caseId, criteria)
          : listUpcomingEvents(criteria);
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
    [caseId, view, anchor],
  );

  // Categories load once per mount; a failure only hides the (still empty
  // until T6) category UI — it must never take the agenda down with it.
  const fetchCategories = useCallback(() => {
    listEventCategories()
      .then((rows) => setCategories(rows))
      .catch(() => setCategories([]));
  }, []);

  // Dated non-working days load once per mount too; a failure keeps the
  // static feria set already in hand (the grids degrade, never crash).
  const fetchNonWorkingDays = useCallback(() => {
    loadNonWorkingDays()
      .then((days) => setInhabilDays(new Set(days)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetchCategories();
    fetchNonWorkingDays();
  }, [fetchCategories, fetchNonWorkingDays]);

  // D/S/M/A/L + H (recon shortcuts) + C = Nuevo evento (T5a). Quiet while a
  // modifier is held or the user is typing (the search box keeps every
  // letter), while the create/edit form owns the screen (its buttons are
  // legitimate key targets too), and a narrow screen refuses unavailable
  // views. The handler re-subscribes when the guard inputs change.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (editor) return;
      const action = agendaShortcutAction(event, document.activeElement, narrow);
      if (!action) return;
      event.preventDefault();
      if (action.type === "create") {
        openCreate();
        return;
      }
      if (action.type === "today") {
        setAnchor(toArtIsoDate(new Date()));
        return;
      }
      setRawView(action.view);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openCreate reads anchor from this render's closure; re-subscribing on editor/anchor keeps the guard and prefill fresh.
  }, [narrow, editor, anchor]);

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
    fetchNonWorkingDays();
    fetchEvents({ search: debouncedSearch, sources, categoryIds });
  }

  const periodTitle = agendaPeriodTitle(view, anchor, UPCOMING_DAYS);
  // Rendered only inside the grids (post-fetch), but kept here so both
  // surfaces read the same clock.
  const today = toArtIsoDate(new Date());

  function goPrev() {
    setAnchor((prev) => shiftAgendaPeriod(view, prev, -1));
  }

  function goNext() {
    setAnchor((prev) => shiftAgendaPeriod(view, prev, 1));
  }

  /** The month grid's "+N más": open that day in Día view (T5 adds the
   *  event popover on top; the overflow itself is recon-documented). */
  function openDay(day: string) {
    setAnchor(day);
    setRawView("dia");
  }

  const ready = state.status === "ready" ? state : null;
  const active = agendaFiltersActive(filters);
  // One clear control at a time: the empty panel owns the button when
  // nothing matches, so "Limpiar filtros" is never rendered twice.
  const showBarClear = active && ready !== null && ready.events.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <AgendaTopBar
        view={view}
        views={views}
        title={periodTitle}
        navDisabled={view === "lista"}
        showWeekends={showWeekends}
        showNonWorkingDays={showNonWorkingDays}
        onSwitchView={setRawView}
        onPrev={goPrev}
        onNext={goNext}
        onToday={() => setAnchor(toArtIsoDate(new Date()))}
        onToggleWeekends={setShowWeekends}
        onToggleNonWorkingDays={setShowNonWorkingDays}
        onNewEvent={openCreate}
      />

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
            {view === "lista"
              ? `Todavía no hay eventos en los próximos ${UPCOMING_DAYS} días.`
              : "No hay eventos en este período."}
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

          {view === "lista" &&
            groupByDay(ready.events).map((group) => (
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
                      <button
                        type="button"
                        onClick={(clickEvent) =>
                          openPopover(event, clickEvent.currentTarget)
                        }
                        className="cursor-pointer rounded-sm text-left text-base font-semibold text-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {event.title}
                      </button>
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

          {(view === "dia" || view === "semana") && (
            <AgendaTimeGrid
              mode={view}
              anchor={anchor}
              events={ready.events}
              today={today}
              toggles={dayToggles}
              nonWorkingDays={inhabilDays}
              onSelectEvent={openPopover}
              onCreateSlot={openCreateSlot}
            />
          )}

          {view === "mes" && (
            <AgendaMonthGrid
              anchor={anchor}
              events={ready.events}
              today={today}
              toggles={dayToggles}
              nonWorkingDays={inhabilDays}
              onOpenDay={openDay}
              onSelectEvent={openPopover}
            />
          )}

          {view === "anio" && (
            <AgendaYearGrid
              anchor={anchor}
              events={ready.events}
              today={today}
              toggles={dayToggles}
              nonWorkingDays={inhabilDays}
            />
          )}
        </div>
      )}

      {/* T5a overlays: the detail popover (anchored to its trigger) and the
          create/edit form; one copy of each serves /agenda and the case tab. */}
      {popover && (
        <AgendaEventPopover
          event={popover.event}
          anchor={popover.anchor}
          categories={categories}
          onClose={closePopover}
          onEdit={openEdit}
          onChanged={() =>
            fetchEvents({ search: debouncedSearch, sources, categoryIds })
          }
        />
      )}

      {editor && (
        <AgendaEventForm
          key={editor.mode === "edit" ? editor.event.id : "create"}
          event={editor.mode === "edit" ? editor.event : undefined}
          initialValues={editor.mode === "create" ? editor.values : undefined}
          onClose={() => setEditor(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
