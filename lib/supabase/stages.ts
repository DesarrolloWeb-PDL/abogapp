/**
 * Case-stage (etapa) reads for the `supabase` driver — browser-safe (anon key
 * + RLS; the expediente screens run as client components).
 *
 * `case_stages` rows are created per study by `init_study_defaults()` and
 * managed in the Etapas settings (S30). This read feeds the Etapa procesal
 * select of the new-expediente form (S07): the form submits the stage NAME
 * and lib/supabase/cases.ts resolves it to the `cases.etapa_id` FK.
 */

import type { CaseStage } from "@/lib/data/stages";
import { DataLayerError } from "@/lib/data/errors";
import { getMyStudy } from "@/lib/data/studies";
import { getBrowserClient } from "./client";

interface StageRow {
  id: string;
  name: string;
  position: number;
}

/**
 * The current study's stages ordered for the etapa picker. RLS already
 * scopes `case_stages` to my memberships; the study filter keeps the answer
 * to THE study the form is creating a case for (a user may belong to up to
 * five). No study yet → empty list, same as the fake driver.
 */
export async function listStagesSupabase(): Promise<CaseStage[]> {
  const study = await getMyStudy();
  if (!study) return [];

  const supabase = getBrowserClient();

  const { data, error } = await supabase
    .from("case_stages")
    .select("id, name, position")
    .eq("study_id", study.id)
    .order("position", { ascending: true });
  if (error || !data) throw new DataLayerError("save_failed");

  return (data as unknown as StageRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    position: row.position,
  }));
}
