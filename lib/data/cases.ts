/**
 * Case functions — GET/POST /api/cases and GET /api/cases/:id in miniature.
 * The future layer keeps these signatures and swaps the store for Drizzle.
 *
 * Driver split: the fake layer keeps its in-memory store; the supabase
 * driver runs the same contract against `cases` under RLS — see
 * lib/supabase/cases.ts for the query/mapping conventions.
 *
 * S07 list slice: `listCases(filter)` answers with one row set (the
 * archived/active partition is the only server-side split), while every
 * other predicate runs through the shared pure `applyCaseFilters` — the
 * screens fetch once and narrow in memory (fetch-once pattern, same as
 * tareas-view). Narrow patches (favorite / archive / soft-delete) are
 * idempotent and answer a typed error for unknown rows.
 */

import type { StudyCase } from "@/lib/types";
import { foldForSearch, searchMatches } from "@/lib/search";
import { requireSession } from "./auth";
import { DataLayerError } from "./errors";
import { getDataDriver } from "./driver";
import { getStore, isoNow, nextId } from "./store";
import { requireStudy } from "./studies";
import {
  archiveCaseSupabase,
  bulkArchiveSupabase,
  createCaseSupabase,
  getCaseSupabase,
  listCasesSupabase,
  softDeleteCaseSupabase,
  toggleFavoriteSupabase,
} from "@/lib/supabase/cases";

export interface CreateCaseInput {
  caratula: string;
  numero?: string;
  fuero?: string;
  jurisdiccion?: string;
  juzgado?: string;
  /** Stage NAME from listStages(); the supabase driver resolves it to the
   *  `cases.etapa_id` FK. Empty → the fake layer defaults to "Inicial". */
  etapa?: string;
  tipo?: StudyCase["tipo"];
  /** Free-text responsable; empty falls back to the creator's full name. */
  responsable?: string;
}

/**
 * Read filters for the S07 list. `archivedView` picks the row set (true =
 * ONLY archived, false/absent = only active — both exclude soft-deleted
 * rows); everything else is a pure in-memory predicate the screens apply
 * client-side after one fetch.
 */
export interface CaseListFilter {
  /** true = ONLY archived rows; the default view never shows them. */
  archivedView?: boolean;
  /** "Solo favoritos": only rows with `favorito` set. */
  favoritoOnly?: boolean;
  /** Exact match on the `tipo` vocabulary (Judicial / Extrajudicial). */
  tipo?: string;
  /** Exact match on the display value (no fuero directory exists). */
  fuero?: string;
  /** Stage NAME — `cases` stores the etapa_id FK; StudyCase carries the name. */
  etapa?: string;
  /** Exact match on the jurisdiction text. */
  jurisdiccion?: string;
  /** Case/accent-insensitive substring over the free-text responsable. */
  responsable?: string;
  /** Accent/typo-tolerant search (lib/search.ts) over the row's text fields. */
  query?: string;
}

/** Sortable S07 columns: click-to-sort on the header (recon data table). */
export type CaseSortKey =
  | "caratula"
  | "numero"
  | "fuero"
  | "etapa"
  /** Creation date (the "Creado" column). */
  | "fecha"
  /** `last_activity_at` — the S07 default order. */
  | "ultima_actividad";

export type SortDirection = "asc" | "desc";

/** Text columns compare by locale; the two date columns compare as instants. */
const SORT_READERS: Record<CaseSortKey, (row: StudyCase) => string> = {
  caratula: (row) => row.caratula,
  numero: (row) => row.numero,
  fuero: (row) => row.fuero,
  etapa: (row) => row.etapa,
  fecha: (row) => row.createdAt,
  ultima_actividad: (row) => row.lastActivityAt,
};

const DATE_SORT_KEYS: ReadonlySet<CaseSortKey> = new Set([
  "fecha",
  "ultima_actividad",
]);

/**
 * Comparator for one column + direction (unit-tested pure function; the
 * view wires it to the header buttons). ISO-8601 instants sort
 * chronologically as plain strings — same format every row, so lexicographic
 * order IS time order (no Date parsing, no timezone involved).
 */
export function compareCasesBy(
  sortKey: CaseSortKey,
  direction: SortDirection,
): (a: StudyCase, b: StudyCase) => number {
  const read = SORT_READERS[sortKey];
  const factor = direction === "asc" ? 1 : -1;
  return (a, b) => {
    const left = read(a);
    const right = read(b);
    if (DATE_SORT_KEYS.has(sortKey)) {
      if (left === right) return 0;
      return (left < right ? -1 : 1) * factor;
    }
    return left.localeCompare(right, "es") * factor;
  };
}

/**
 * The one predicate implementation both drivers and the screens share:
 * partition first (archivedView), then AND every set criterion. An absent /
 * empty criterion never filters — clearing a select must show all rows.
 */
export function applyCaseFilters(
  cases: StudyCase[],
  filter?: CaseListFilter,
): StudyCase[] {
  const archivedView = filter?.archivedView ?? false;
  const responsable = filter?.responsable?.trim();
  const query = filter?.query?.trim();

  return cases.filter((row) => {
    if (row.archived !== archivedView) return false;
    if (filter?.favoritoOnly && !row.favorite) return false;
    if (filter?.tipo && row.tipo !== filter.tipo) return false;
    if (filter?.fuero && row.fuero !== filter.fuero) return false;
    if (filter?.etapa && row.etapa !== filter.etapa) return false;
    if (filter?.jurisdiccion && row.jurisdiccion !== filter.jurisdiccion) return false;
    if (
      responsable &&
      !foldForSearch(row.responsable).includes(foldForSearch(responsable))
    ) {
      return false;
    }
    if (
      query &&
      !searchMatches(query, [row.caratula, row.numero, row.juzgado, row.fuero].join(" "))
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Cases of the current study for one partition, newest activity first (S07).
 * Default = the active view (non-archived, non-deleted); `archivedView`
 * flips the row set. Soft-deleted rows never answer in either driver.
 */
export async function listCases(filter?: CaseListFilter): Promise<StudyCase[]> {
  if (getDataDriver() === "supabase") return listCasesSupabase(filter);

  const session = await requireSession();
  const store = getStore();

  const memberships = store.memberships.filter(
    (entry) => entry.userId === session.user.id,
  );
  const latest = memberships[memberships.length - 1];
  if (!latest) return []; // onboarding not finished: honest empty list

  const rows = store.cases.filter((entry) => entry.studyId === latest.studyId);
  return applyCaseFilters(rows, filter).sort((a, b) =>
    b.lastActivityAt.localeCompare(a.lastActivityAt),
  );
}

/**
 * One case by id. No tenancy check in the fake layer (ids are unguessable
 * enough for the demo); RLS will scope this query in the real one.
 */
export async function getCase(id: string): Promise<StudyCase | null> {
  if (getDataDriver() === "supabase") return getCaseSupabase(id);

  return getStore().cases.find((entry) => entry.id === id) ?? null;
}

/** Manual case creation (S07 / M1 slice entry point). */
export async function createCase(input: CreateCaseInput): Promise<StudyCase> {
  if (getDataDriver() === "supabase") return createCaseSupabase(input);

  const study = await requireStudy();
  const session = await requireSession();

  const caratula = input.caratula.trim();
  if (!caratula) throw new DataLayerError("missing_fields");

  const now = isoNow();
  const record: StudyCase = {
    id: nextId("case"),
    studyId: study.id,
    caratula,
    numero: input.numero?.trim() ?? "",
    fuero: input.fuero?.trim() ?? "",
    jurisdiccion: input.jurisdiccion?.trim() ?? "",
    juzgado: input.juzgado?.trim() ?? "",
    etapa: input.etapa?.trim() || "Inicial",
    tipo: input.tipo ?? "Judicial",
    responsable: input.responsable?.trim() || session.user.fullName,
    favorite: false,
    archived: false,
    createdAt: now,
    lastActivityAt: now,
  };

  getStore().cases.push(record);
  return record;
}

/**
 * Fake-layer row lookup for a narrow patch: the row must exist in the
 * CURRENT study (the fake has no RLS — the membership is the tenancy).
 * Unknown id → the typed failure, same code the supabase driver answers
 * when RLS/the filter matches 0 rows.
 */
async function requireWritableCase(id: string): Promise<StudyCase> {
  const study = await requireStudy();
  const row = getStore().cases.find(
    (entry) => entry.id === id && entry.studyId === study.id,
  );
  if (!row) throw new DataLayerError("save_failed");
  return row;
}

/**
 * Studio-wide favorite toggle (S07 star): writes `favorito` only.
 * Setting the value the row already has is a no-op success (idempotent).
 */
export async function toggleFavorite(
  id: string,
  next: boolean,
): Promise<StudyCase> {
  if (getDataDriver() === "supabase") return toggleFavoriteSupabase(id, next);

  const row = await requireWritableCase(id);
  row.favorite = next;
  return row;
}

/** Archive/unarchive one case (row ⋯ menu). Idempotent by design. */
export async function archiveCase(
  id: string,
  archived: boolean,
): Promise<StudyCase> {
  if (getDataDriver() === "supabase") return archiveCaseSupabase(id, archived);

  const row = await requireWritableCase(id);
  row.archived = archived;
  return row;
}

/**
 * Bulk archive (bulk bar). Validates EVERY id before writing one byte: a
 * single unknown row fails the whole call and nothing half-applies (the
 * supabase driver gets the same all-or-nothing from its one UPDATE + the
 * affected-count check). Archiving already-archived rows succeeds unchanged.
 */
export async function bulkArchive(
  ids: string[],
  archived: boolean,
): Promise<StudyCase[]> {
  if (ids.length === 0) throw new DataLayerError("missing_fields");
  if (getDataDriver() === "supabase") return bulkArchiveSupabase(ids, archived);

  const study = await requireStudy();
  const store = getStore();
  const unique = [...new Set(ids)];

  const rows: StudyCase[] = [];
  for (const id of unique) {
    const row = store.cases.find(
      (entry) => entry.id === id && entry.studyId === study.id,
    );
    if (!row) throw new DataLayerError("save_failed");
    rows.push(row);
  }

  for (const row of rows) row.archived = archived;
  return rows;
}

/**
 * Soft delete (Eliminar): stamps `deleted_at`, which every read already
 * excludes — the row disappears from every list and getCase answers null.
 * The fake layer has no deleted_at column on StudyCase, so it drops the
 * record outright (same observable contract).
 */
export async function softDeleteCase(id: string): Promise<void> {
  if (getDataDriver() === "supabase") return softDeleteCaseSupabase(id);

  const study = await requireStudy();
  const store = getStore();
  const index = store.cases.findIndex(
    (entry) => entry.id === id && entry.studyId === study.id,
  );
  if (index === -1) throw new DataLayerError("save_failed");
  store.cases.splice(index, 1);
}
