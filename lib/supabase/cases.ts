/**
 * Case functions for the `supabase` driver — browser-safe (anon key + RLS;
 * the expedientes screens run as client components).
 *
 * RLS (`cases_member` = is_member(study_id)) is the tenancy guard, so reads
 * never pre-check the membership the way the fake layer does. Field mapping
 * follows replica/schema.sql → lib/types.ts StudyCase.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudyCase } from "@/lib/types";
import { DataLayerError } from "@/lib/data/errors";
import {
  applyCaseFilters,
  type CaseListFilter,
  type CreateCaseInput,
} from "@/lib/data/cases";
import { requireStudy } from "@/lib/data/studies";
import { getBrowserClient } from "./client";

/**
 * Every column StudyCase reads, plus the two embeds/relations that carry the
 * fields the cases table stores differently:
 *  - `etapa`  → case_stages.name (cases stores etapa_id, the uuid FK; the
 *    stages are seeded per study by init_study_defaults, so the join
 *    resolves from the first expediente on);
 *  - `responsable` → the free-text S07 column, falling back at map time to
 *    the profiles.full_name of created_by for rows written before the
 *    column existed (the fake layer defaults it to the session's full name —
 *    same person).
 */
const CASE_COLUMNS =
  "id, study_id, caratula, numero, fuero, jurisdiccion, juzgado, tipo, " +
  "favorito, archivado, created_at, last_activity_at, responsable, " +
  "etapa:case_stages(name), created_by:profiles(full_name)";

interface CaseRow {
  id: string;
  study_id: string;
  caratula: string;
  numero: string | null;
  fuero: string | null;
  jurisdiccion: string | null;
  juzgado: string | null;
  tipo: string | null;
  favorito: boolean;
  archivado: boolean;
  created_at: string;
  last_activity_at: string;
  responsable: string | null;
  etapa: { name: string } | null;
  created_by: { full_name: string | null } | null;
}

/**
 * Cases of my studies for one partition, newest activity first (S07).
 * `archivedView` is the ONLY server-side filter (it changes the row set:
 * eq(archivado) vs the default not(archivado)); the remaining predicates
 * run through the shared `applyCaseFilters` after the map — same output as
 * the fake driver, one read either way (fetch-once pattern).
 */
export async function listCasesSupabase(
  filter?: CaseListFilter,
): Promise<StudyCase[]> {
  const supabase = getBrowserClient();

  let query = supabase
    .from("cases")
    .select(CASE_COLUMNS)
    .is("deleted_at", null);
  query = filter?.archivedView
    ? query.eq("archivado", true)
    : query.not("archivado", "is", true);

  const { data, error } = await query.order("last_activity_at", {
    ascending: false,
  });
  if (error || !data) throw new DataLayerError("save_failed");

  return applyCaseFilters((data as unknown as CaseRow[]).map(mapCase), filter);
}

/** One case by id; RLS answers null for ids outside my studies. */
export async function getCaseSupabase(id: string): Promise<StudyCase | null> {
  const supabase = getBrowserClient();

  const { data, error } = await supabase
    .from("cases")
    .select(CASE_COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new DataLayerError("save_failed");
  if (!data) return null;

  return mapCase(data as unknown as CaseRow);
}

/** Manual case creation (S07 / M1 slice entry point), insert under RLS. */
export async function createCaseSupabase(
  input: CreateCaseInput,
): Promise<StudyCase> {
  const study = await requireStudy();
  const supabase = getBrowserClient();
  const user = await requireUser(supabase);

  // Same validation, same order as the fake branch: no network before the
  // typed failure the screens already map through errorCopy().
  const caratula = input.caratula.trim();
  if (!caratula) throw new DataLayerError("missing_fields");

  // Etapa: StudyCase.etapa carries the stage NAME (the fake layer stores it
  // that way too); cases stores the uuid FK `etapa_id`. Resolve the name
  // against the study's case_stages — the form only offers rows from
  // listStages(), so a miss means the stage was deleted while the form was
  // open: the case is still created and reads back with no etapa, exactly
  // like any other null FK.
  const etapaName = input.etapa?.trim();
  let etapaId: string | null = null;
  if (etapaName) {
    const { data: stage, error: stageError } = await supabase
      .from("case_stages")
      .select("id")
      .eq("study_id", study.id)
      .eq("name", etapaName)
      .maybeSingle();
    if (stageError) throw new DataLayerError("save_failed");
    etapaId = stage?.id ?? null;
  }

  // responsable: null means "not stated" — mapCase falls back to the
  // creator's profile full name, which is the same default the form
  // pre-fills (the current user's full name).
  const responsable = input.responsable?.trim() || null;

  const { data: row, error } = await supabase
    .from("cases")
    .insert({
      study_id: study.id,
      caratula,
      numero: input.numero?.trim() ?? "",
      fuero: input.fuero?.trim() ?? "",
      jurisdiccion: input.jurisdiccion?.trim() ?? "",
      juzgado: input.juzgado?.trim() ?? "",
      tipo: input.tipo ?? "Judicial",
      etapa_id: etapaId,
      responsable,
      favorito: false,
      archivado: false,
      source: "manual",
      created_by: user.id,
    })
    .select(CASE_COLUMNS)
    .single();
  if (error || !row) throw new DataLayerError("save_failed");

  return mapCase(row as unknown as CaseRow);
}

/**
 * One narrow patch helper: a single UPDATE scoped to a live row under RLS
 * (the tenancy guard — same no-pre-check convention as the reads above).
 * 0 rows back (unknown id, other study's row, already soft-deleted) is the
 * typed failure; 1 row back is the mapped result.
 */
async function patchCaseRow(
  id: string,
  payload: Record<string, unknown>,
): Promise<StudyCase> {
  const supabase = getBrowserClient();

  const { data, error } = await supabase
    .from("cases")
    .update(payload)
    .eq("id", id)
    .is("deleted_at", null)
    .select(CASE_COLUMNS)
    .single();
  if (error || !data) throw new DataLayerError("save_failed");

  return mapCase(data as unknown as CaseRow);
}

/** Studio-wide favorite toggle (S07 star) — writes `favorito` only. */
export async function toggleFavoriteSupabase(
  id: string,
  next: boolean,
): Promise<StudyCase> {
  return patchCaseRow(id, { favorito: next });
}

/** Archive/unarchive one case (row ⋯ menu) — writes `archivado` only. */
export async function archiveCaseSupabase(
  id: string,
  archived: boolean,
): Promise<StudyCase> {
  return patchCaseRow(id, { archivado: archived });
}

/**
 * Bulk archive (bulk bar): ONE UPDATE over the id list. The affected-count
 * check mirrors the fake layer's validate-then-write: fewer rows back than
 * ids sent means an unknown/RLS-hidden id → typed error. Rows already in
 * the requested state still match the UPDATE, so re-archiving succeeds
 * unchanged (idempotent no-op success).
 */
export async function bulkArchiveSupabase(
  ids: string[],
  archived: boolean,
): Promise<StudyCase[]> {
  if (ids.length === 0) throw new DataLayerError("missing_fields");

  const unique = [...new Set(ids)];
  const supabase = getBrowserClient();

  const { data, error } = await supabase
    .from("cases")
    .update({ archivado: archived })
    .in("id", unique)
    .is("deleted_at", null)
    .select(CASE_COLUMNS);
  if (error || !data || data.length !== unique.length) {
    throw new DataLayerError("save_failed");
  }

  return (data as unknown as CaseRow[]).map(mapCase);
}

/**
 * Soft delete (Eliminar): stamps `deleted_at`, the column every read
 * already excludes — the row vanishes from lists and getCase answers null.
 */
export async function softDeleteCaseSupabase(id: string): Promise<void> {
  const supabase = getBrowserClient();

  const { data, error } = await supabase
    .from("cases")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id")
    .single();
  if (error || !data) throw new DataLayerError("save_failed");
}

async function requireUser(
  supabase: SupabaseClient,
): Promise<{ id: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new DataLayerError("not_signed_in");
  return user;
}

/** snake_case row → StudyCase; nullable text collapses to "" like the fake. */
function mapCase(row: CaseRow): StudyCase {
  return {
    id: row.id,
    studyId: row.study_id,
    caratula: row.caratula,
    numero: row.numero ?? "",
    fuero: row.fuero ?? "",
    jurisdiccion: row.jurisdiccion ?? "",
    juzgado: row.juzgado ?? "",
    etapa: row.etapa?.name ?? "",
    tipo: row.tipo === "Extrajudicial" ? "Extrajudicial" : "Judicial",
    // Old rows predate the responsable column: fall back to the creator's
    // profile full name (the person the fake layer would have defaulted to).
    responsable: row.responsable ?? row.created_by?.full_name ?? "",
    favorite: row.favorito,
    archived: row.archivado,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
  };
}
