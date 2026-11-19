"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  NOTIFICATION_CATEGORIES,
  listNotifications,
  listNotificationsPage,
  markNotificationRead,
  unreadCount,
  type NotificationEstado,
} from "@/lib/data";
import type { AppNotification } from "@/lib/types";
import {
  DEFAULT_NOTIF_FILTERS,
  loadNotifFilters,
  notifFiltersActive,
  persistNotifFilters,
  type NotifFilters,
} from "./filters";
import { PreferenciasModal } from "./preferencias-modal";

/**
 * Notifications page (S21 + M2): reads the data layer, never the seed
 * directly, so the count here is the same number the header badge shows.
 * Read-on-click with deep links, mark-all through `markNotificationRead`
 * over the FULL list (pagination must not truncate it), unread state
 * carried by weight + dot (never colour alone).
 *
 * M2 slice: search (accent/typo tolerant via lib/search), estado and
 * categoria filters, "Cargar más" 20 rows at a time with a "Mostrando X de
 * Y" footer, filters persisted per browser (sessionStorage) and the
 * Preferencias dialog. A refetch keeps the previous rows visible (they are
 * replaced when the answer lands); a request token discards any response
 * that is no longer the newest one, so filter changes can never be
 * overwritten by a slower earlier read.
 */

const CATEGORY_TONE: Record<
  AppNotification["categoria"],
  "neutral" | "info" | "warning" | "accent"
> = {
  Plazos: "warning",
  Expedientes: "info",
  Sistema: "neutral",
  Equipo: "accent",
};

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      items: AppNotification[];
      total: number;
      hasMore: boolean;
      loadingMore: boolean;
    };

/** Identity of the filter set a page of rows was read with. */
function filterKey(filters: NotifFilters): string {
  return `${filters.search} ${filters.estado} ${filters.categoria}`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function NotificacionesView() {
  const { toast } = useToast();
  // Explicit label ids: a wrapping <label> would fold the option texts into
  // the select's accessible name (the S30/expedientes pattern uses htmlFor).
  const estadoId = useId();
  const categoriaId = useId();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [unread, setUnread] = useState(0);
  const [filters, setFilters] = useState<NotifFilters>(DEFAULT_NOTIF_FILTERS);
  // The search box debounces: every keystroke would otherwise refetch.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [prefsOpen, setPrefsOpen] = useState(false);

  // Newest-request token: only the latest read may write state.
  const requestRef = useRef(0);
  // Filter identity the visible rows belong to (guards "Cargar más" against
  // appending at a stale offset while a refetch is still in flight).
  const resolvedKeyRef = useRef("");

  const fetchPage = useCallback((snapshot: NotifFilters) => {
    const requestId = ++requestRef.current;
    const key = filterKey(snapshot);
    // The effect only starts the reads; state resolves through the promise
    // callbacks (react-hooks/set-state-in-effect forbids sync setState here).
    Promise.all([
      listNotificationsPage({
        search: snapshot.search,
        estado: snapshot.estado,
        categoria: snapshot.categoria,
      }),
      unreadCount(),
    ])
      .then(([page, count]) => {
        if (requestId !== requestRef.current) return;
        resolvedKeyRef.current = key;
        setState({
          status: "ready",
          items: page.items,
          total: page.total,
          hasMore: page.hasMore,
          loadingMore: false,
        });
        setUnread(count);
      })
      .catch(() => {
        if (requestId !== requestRef.current) return;
        setState({ status: "error" });
      });
  }, []);

  useEffect(() => {
    fetchPage({
      search: debouncedSearch,
      estado: filters.estado,
      categoria: filters.categoria,
    });
  }, [debouncedSearch, filters.estado, filters.categoria, fetchPage]);

  // Debounce the search box (300ms); selects apply on the next tick.
  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedSearch(filters.search),
      300,
    );
    return () => clearTimeout(timer);
  }, [filters.search]);

  // Hydrate the persisted filters. The read is synchronous (it must happen
  // before the persist effect can ever write), the setState is deferred to a
  // callback so SSR markup and hydration stay identical (the Expedientes
  // pattern); the fetch effect then re-reads with the restored set.
  useEffect(() => {
    const stored = loadNotifFilters();
    if (!notifFiltersActive(stored)) return;
    Promise.resolve().then(() => setFilters(stored));
  }, []);

  // Write-through persistence; the first run is the mount itself (nothing
  // to persist yet, and never clobber a just-restored state with defaults).
  const persistSkippedRef = useRef(true);
  useEffect(() => {
    if (persistSkippedRef.current) {
      persistSkippedRef.current = false;
      return;
    }
    persistNotifFilters(filters);
  }, [filters]);

  function updateFilters(patch: Partial<NotifFilters>) {
    setFilters((prev) => ({ ...prev, ...patch }));
  }

  function clearFilters() {
    setFilters(DEFAULT_NOTIF_FILTERS);
  }

  function loadMore() {
    if (state.status !== "ready" || !state.hasMore || state.loadingMore) return;
    const snapshot: NotifFilters = {
      search: debouncedSearch,
      estado: filters.estado,
      categoria: filters.categoria,
    };
    // The visible rows belong to an older filter set: re-read page one
    // instead of appending at an offset that no longer lines up.
    if (resolvedKeyRef.current !== filterKey(snapshot)) {
      fetchPage(snapshot);
      return;
    }

    const requestId = ++requestRef.current;
    setState({ ...state, loadingMore: true });
    listNotificationsPage({
      search: snapshot.search,
      estado: snapshot.estado,
      categoria: snapshot.categoria,
      offset: state.items.length,
    })
      .then((page) => {
        if (requestId !== requestRef.current) return;
        setState((prev) =>
          prev.status === "ready"
            ? {
                ...prev,
                items: [...prev.items, ...page.items],
                total: page.total,
                hasMore: page.hasMore,
                loadingMore: false,
              }
            : prev,
        );
      })
      .catch(() => {
        if (requestId !== requestRef.current) return;
        setState((prev) =>
          prev.status === "ready" ? { ...prev, loadingMore: false } : prev,
        );
        toast("No pudimos cargar más notificaciones.", { variant: "error" });
      });
  }

  const ready = state.status === "ready" ? state : null;
  const activeFilters = notifFiltersActive(filters);

  function markAllRead() {
    if (!ready) return;
    // The FULL list, not the loaded page: with pagination a "todas" mark
    // must still reach the rows "Cargar más" has not shown yet.
    void listNotifications()
      .then((all) => all.filter((entry) => !entry.leida))
      .then((targets) =>
        Promise.all(targets.map((entry) => markNotificationRead(entry.id))),
      )
      .then(() => {
        setState((prev) =>
          prev.status === "ready"
            ? {
                ...prev,
                items: prev.items.map((item) => ({ ...item, leida: true })),
              }
            : prev,
        );
        setUnread(0);
        toast("Listo: marcaste todas como leídas.");
      })
      .catch(() => {
        toast("No pudimos marcar las notificaciones como leídas.", {
          variant: "error",
        });
      });
  }

  function markRead(item: AppNotification) {
    if (item.leida) return;
    void markNotificationRead(item.id)
      .then(() => {
        setState((prev) =>
          prev.status === "ready"
            ? {
                ...prev,
                items: prev.items.map((row) =>
                  row.id === item.id ? { ...row, leida: true } : row,
                ),
              }
            : prev,
        );
        setUnread((count) => Math.max(0, count - 1));
      })
      .catch(() => undefined);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold text-text">Notificaciones</h1>
          <p className="text-base text-muted">
            {state.status === "loading"
              ? "Cargando tus notificaciones…"
              : state.status === "error"
                ? "No pudimos cargar tus notificaciones."
                : unread > 0
                  ? `Tenés ${unread} notificaciones sin leer.`
                  : "Estás al día con las novedades de tu estudio."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="lg"
            onClick={markAllRead}
            disabled={state.status !== "ready" || unread === 0}
          >
            Marcar todas como leídas
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => setPrefsOpen(true)}
          >
            Preferencias
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-2 sm:max-w-lg">
          <span className="text-sm font-semibold text-text">
            Buscar notificaciones
          </span>
          <Input
            type="search"
            value={filters.search}
            onChange={(event) => updateFilters({ search: event.target.value })}
            placeholder="Escribí un título o un detalle"
          />
        </label>
        <div className="flex min-w-44 flex-col gap-2">
          <label
            htmlFor={estadoId}
            className="text-sm font-semibold text-text"
          >
            Estado
          </label>
          <Select
            id={estadoId}
            value={filters.estado}
            onChange={(event) =>
              updateFilters({
                estado: event.target.value as NotificationEstado,
              })
            }
          >
            <option value="todas">Todas</option>
            <option value="no_leidas">No leídas</option>
            <option value="leidas">Leídas</option>
          </Select>
        </div>
        <div className="flex min-w-56 flex-col gap-2">
          <label
            htmlFor={categoriaId}
            className="text-sm font-semibold text-text"
          >
            Categoría
          </label>
          <Select
            id={categoriaId}
            value={filters.categoria}
            onChange={(event) => updateFilters({ categoria: event.target.value })}
          >
            <option value="">Todas las categorías</option>
            {NOTIFICATION_CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </Select>
        </div>
        {/* One clear control at a time: the empty panel owns the button when
            nothing matches, so "Limpiar filtros" is never rendered twice. */}
        {activeFilters && ready !== null && ready.total > 0 && (
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
            Cargando notificaciones
          </p>
          <SkeletonRows rows={4} />
        </div>
      )}

      {state.status === "error" && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-border bg-surface px-6 py-12 text-center">
          <p className="text-base text-text-muted">
            No pudimos cargar las notificaciones.
          </p>
          <Button
            variant="secondary"
            onClick={() =>
              fetchPage({
                search: debouncedSearch,
                estado: filters.estado,
                categoria: filters.categoria,
              })
            }
          >
            Reintentar
          </Button>
        </div>
      )}

      {ready !== null && ready.total === 0 && activeFilters && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-12 text-center">
          <p className="text-base text-muted">
            No encontramos notificaciones con esos filtros.
          </p>
          <Button variant="secondary" onClick={clearFilters}>
            Limpiar filtros
          </Button>
        </div>
      )}

      {ready !== null && ready.total === 0 && !activeFilters && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-surface px-6 py-12 text-center">
          <p className="text-base text-muted">
            No hay notificaciones nuevas.
          </p>
        </div>
      )}

      {ready !== null && ready.total > 0 && (
        <>
          <ul className="flex flex-col gap-3">
            {ready.items.map((item) => {
              const body = (
                <>
                  <span className="flex items-center gap-2">
                    {!item.leida && (
                      <span
                        aria-hidden="true"
                        className="size-2 shrink-0 rounded-pill bg-info"
                      />
                    )}
                    <span
                      className={
                        item.leida
                          ? "text-base font-medium text-text-muted"
                          : "text-base font-semibold text-text"
                      }
                    >
                      {item.titulo}
                    </span>
                    <span className="sr-only">
                      {item.leida ? "(leída)" : "(sin leer)"}
                    </span>
                  </span>
                  <span className="text-base text-muted">{item.detalle}</span>
                  <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
                    <Badge tone={CATEGORY_TONE[item.categoria]}>
                      {item.categoria}
                    </Badge>
                    {formatDateTime(item.createdAt)}
                  </span>
                </>
              );

              return (
                <li key={item.id}>
                  {item.enlace ? (
                    <Link
                      href={item.enlace}
                      onClick={() => markRead(item)}
                      className="flex min-h-11 flex-col gap-1.5 rounded-lg border border-border bg-surface px-4 py-4 shadow-card hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex min-h-11 flex-col gap-1.5 rounded-lg border border-border bg-surface px-4 py-4 shadow-card">
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              Mostrando {ready.items.length} de {ready.total}
            </p>
            {ready.hasMore && (
              <Button
                variant="secondary"
                onClick={loadMore}
                loading={ready.loadingMore}
              >
                Cargar más
              </Button>
            )}
          </div>
        </>
      )}

      <PreferenciasModal open={prefsOpen} onClose={() => setPrefsOpen(false)} />
    </div>
  );
}
