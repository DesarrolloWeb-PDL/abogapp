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
import type { CreateCaseInput } from "@/lib/data/cases";
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

/** Non-archived, non-deleted cases of my studies, newest activity first (S07). */
export async function listCasesSupabase(): Promise<StudyCase[]> {
  const supabase = getBrowserClient();

  const { data, error } = await supabase
    .from("cases")
    .select(CASE_COLUMNS)
    .not("archivado", "is", true)
    .is("deleted_at", null)
    .order("last_activity_at", { ascending: false });
  if (error || !data) throw new DataLayerError("save_failed");

  return (data as unknown as CaseRow[]).map(mapCase);
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
