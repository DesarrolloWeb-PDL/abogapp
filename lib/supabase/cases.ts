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
 * Every column StudyCase reads, plus the two embeds that carry the fields
 * the cases table has no direct column for:
 *  - `etapa`  → case_stages.name (cases stores etapa_id; no stages are
 *    seeded yet, so new rows read back as "" until S30 lands);
 *  - `responsable` → profiles.full_name of created_by (the fake layer
 *    defaults it to the session's full name — same person).
 */
const CASE_COLUMNS =
  "id, study_id, caratula, numero, fuero, jurisdiccion, juzgado, tipo, " +
  "favorito, archivado, created_at, last_activity_at, " +
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

  // TODO(schema gap): `input.etapa` (free text) needs a case_stages row and
  // `input.responsable` has no column — cases.etapa_id stays null and
  // responsable reads back from created_by's profile until S30/M2.
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
    responsable: row.created_by?.full_name ?? "",
    favorite: row.favorito,
    archived: row.archivado,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
  };
}
