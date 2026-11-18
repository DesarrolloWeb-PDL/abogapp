/**
 * Pure helpers behind the Expedientes list chrome (S07): the Filtros
 * active-count badge, the footer counter copy, the header's natural sort
 * defaults and the per-browser-session filter persistence.
 *
 * Persistence: the recon says list filters persist per browser, and this
 * slice stores them in sessionStorage (tab-scoped, cleared with the tab) —
 * never localStorage, so two people sharing a machine never inherit each
 * other's filters. Reads/writes are guarded: SSR has no window, private
 * modes may throw on write.
 */

import type { CaseListFilter, CaseSortKey, SortDirection } from "@/lib/data";

/** sessionStorage key; versioned so a shape change never loads garbage. */
const FILTER_STORAGE_KEY = "expedientes.filtros.v1";

/** Panel criteria (recon Filtros panel) — the badge counts these. */
const FILTER_STRING_KEYS = [
  "tipo",
  "fuero",
  "etapa",
  "jurisdiccion",
  "responsable",
] as const;
const FILTER_BOOLEAN_KEYS = ["favoritoOnly", "archivedView"] as const;

/**
 * First-click direction per column: text A→Z, dates newest-first (the S07
 * default order is "Última actividad" descending).
 */
export const NATURAL_SORT: Record<CaseSortKey, SortDirection> = {
  caratula: "asc",
  numero: "asc",
  fuero: "asc",
  etapa: "asc",
  fecha: "desc",
  ultima_actividad: "desc",
};

/** How many Filtros criteria are active (drives the count badge). */
export function countActiveFilters(filter: CaseListFilter): number {
  let count = 0;
  if (filter.archivedView) count += 1;
  if (filter.favoritoOnly) count += 1;
  for (const key of FILTER_STRING_KEYS) {
    if (filter[key]?.trim()) count += 1;
  }
  return count;
}

/**
 * Footer counter ("Mostrando 12 de 48"): X = rows the filters let through,
 * Y = every row of the current view's partition (active or archived).
 */
export function caseFooterCopy(
  visible: number,
  total: number,
  archivedView: boolean,
): string {
  const noun = archivedView ? "expedientes archivados" : "expedientes";
  return `Mostrando ${visible} de ${total} ${noun}`;
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
 * Read the persisted filter set. Defensive by design: corrupt JSON, wrong
 * value types, unknown keys and empty strings all collapse to "no filter"
 * instead of a screen that boots into a broken state.
 */
export function loadCaseFilters(storage?: Storage): CaseListFilter {
  const target = resolveStorage(storage);
  if (!target) return {};

  let raw: string | null = null;
  try {
    raw = target.getItem(FILTER_STORAGE_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};

  const record = parsed as Record<string, unknown>;
  const filters: CaseListFilter = {};
  for (const key of FILTER_STRING_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) filters[key] = value;
  }
  for (const key of FILTER_BOOLEAN_KEYS) {
    if (record[key] === true) filters[key] = true;
  }
  return filters;
}

/** Write the current filter set; a refused write must never break the UI. */
export function persistCaseFilters(
  filter: CaseListFilter,
  storage?: Storage,
): void {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.setItem(FILTER_STORAGE_KEY, JSON.stringify(filter));
  } catch {
    // Quota / private mode: filters simply stop persisting this session.
  }
}
