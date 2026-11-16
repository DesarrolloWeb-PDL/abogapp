/**
 * Case-stage (etapa) functions — the small read behind the Etapa procesal
 * select of the new-expediente form (S07).
 *
 * Driver split: the supabase driver reads the study's `case_stages` rows
 * (seeded per study by init_study_defaults()); the fake layer has no stages
 * table, so it answers the same default set — the names the fake createCase
 * already defaults to.
 */

import { getDataDriver } from "./driver";
import { getMyStudy } from "./studies";
import { listStagesSupabase } from "@/lib/supabase/stages";

/** One row of the study's `case_stages` (Etapas settings, S30). */
export interface CaseStage {
  id: string;
  name: string;
  position: number;
}

/**
 * Default etapa set seeded per study by init_study_defaults(). ASSUMPTION:
 * the recon never evidences stage names (S30 only shows the settings table),
 * so this five-step set is our own product default — keep in sync with
 * supabase/migrations/20261115120000_form_gaps.sql.
 */
const DEFAULT_STAGE_NAMES = [
  "Inicial",
  "Trámite",
  "Prueba",
  "Sentencia",
  "Ejecución",
] as const;

/** The current study's stages in `position` order; empty before onboarding. */
export async function listStages(): Promise<CaseStage[]> {
  if (getDataDriver() === "supabase") return listStagesSupabase();

  const study = await getMyStudy();
  if (!study) return [];

  // Ids are stable per position (not nextId): the select must not change
  // value between two reads of the same list.
  return DEFAULT_STAGE_NAMES.map((name, index) => ({
    id: `stage-${index + 1}`,
    name,
    position: index + 1,
  }));
}
