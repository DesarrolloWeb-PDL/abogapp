/**
 * Per-browser filter persistence for the notifications page (S21: "filters
 * remembered per browser"). Same rules as the Expedientes list helper
 * (app/(app)/expedientes/case-list.ts): sessionStorage only — tab-scoped and
 * cleared with the tab, never localStorage, so two people sharing a machine
 * never inherit each other's filters. Reads/writes are guarded: SSR has no
 * window, private modes may throw on write, and corrupt JSON collapses to
 * "no filter" instead of a screen that boots into a broken state.
 */

import { NOTIFICATION_CATEGORIES, type NotificationEstado } from "@/lib/data";

/** sessionStorage key; versioned so a shape change never loads garbage. */
const FILTER_STORAGE_KEY = "notificaciones.filtros.v1";

export interface NotifFilters {
  /** Free text over title + body (lib/search matching). */
  search: string;
  estado: NotificationEstado;
  /** Raw DB bucket value; "" = todas las categorías. */
  categoria: string;
}

export const DEFAULT_NOTIF_FILTERS: NotifFilters = {
  search: "",
  estado: "todas",
  categoria: "",
};

const ESTADOS: NotificationEstado[] = ["todas", "no_leidas", "leidas"];

/** True when at least one criterion would narrow the list. */
export function notifFiltersActive(filters: NotifFilters): boolean {
  return (
    filters.search.trim() !== "" ||
    filters.estado !== "todas" ||
    filters.categoria !== ""
  );
}

/** Resolve the storage to use: injected in tests, sessionStorage in a tab. */
function resolveStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null; // storage access itself can throw (locked-down contexts)
  }
}

/**
 * Read the persisted filter set. Every wrong shape (unknown estado, unknown
 * category, non-string fields) collapses to the default for that field.
 */
export function loadNotifFilters(storage?: Storage): NotifFilters {
  const target = resolveStorage(storage);
  if (!target) return { ...DEFAULT_NOTIF_FILTERS };

  let raw: string | null = null;
  try {
    raw = target.getItem(FILTER_STORAGE_KEY);
  } catch {
    return { ...DEFAULT_NOTIF_FILTERS };
  }
  if (!raw) return { ...DEFAULT_NOTIF_FILTERS };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_NOTIF_FILTERS };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ...DEFAULT_NOTIF_FILTERS };
  }

  const record = parsed as Record<string, unknown>;
  const estado =
    typeof record.estado === "string" && ESTADOS.includes(record.estado as NotificationEstado)
      ? (record.estado as NotificationEstado)
      : DEFAULT_NOTIF_FILTERS.estado;
  const search =
    typeof record.search === "string" ? record.search : DEFAULT_NOTIF_FILTERS.search;
  const categoria =
    typeof record.categoria === "string" &&
    (record.categoria === "" ||
      NOTIFICATION_CATEGORIES.some((entry) => entry.value === record.categoria))
      ? record.categoria
      : DEFAULT_NOTIF_FILTERS.categoria;
  return { search, estado, categoria };
}

/** Write the current filter set; a refused write must never break the UI. */
export function persistNotifFilters(
  filters: NotifFilters,
  storage?: Storage,
): void {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Quota / private mode: filters simply stop persisting this session.
  }
}
