/**
 * Case-stage (etapa) reads/writes for the `supabase` driver — browser-safe (anon key
 * + RLS; the expediente screens run as client components).
 *
 * `case_stages` rows are created per study by `init_study_defaults()` and
 * managed in the Etapas settings (S30). The READ feeds the Etapa procesal
 * select of the new-expediente form and the Etapa filter of the list (both
 * S07): those surfaces submit the stage NAME and lib/supabase/cases.ts
 * resolves it to the `cases.etapa_id` FK.
 *
 * The WRITES are the S30 admin. Validation (name shape + case-insensitive
 * uniqueness + the last-stage guard) already ran in lib/data/stages.ts —
 * this module only writes, exactly like the bot-settings pair. Every write
 * is scoped by `study_id` on top of RLS, so a row id from another tenant
 * matches nothing.
 */

import type { CaseStage, StageMoveDirection } from "@/lib/data/stages";
import { DataLayerError } from "@/lib/data/errors";
import { getMyStudy, requireStudy } from "@/lib/data/studies";
import { getBrowserClient } from "./client";

interface StageRow {
  id: string;
  name: string;
  position: number;
  counts_as_active: boolean;
}

const COLUMNS = "id, name, position, counts_as_active";

function toStage(row: StageRow): CaseStage {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    countsAsActive: row.counts_as_active,
  };
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
    .select(COLUMNS)
    .eq("study_id", study.id)
    .order("position", { ascending: true });
  if (error || !data) throw new DataLayerError("save_failed");

  return (data as unknown as StageRow[]).map(toStage);
}

/** Insert the new etapa at `position` (computed by the data layer: max + 1). */
export async function createStageSupabase(input: {
  name: string;
  position: number;
  countsAsActive: boolean;
}): Promise<CaseStage> {
  const study = await requireStudy();

  const { data, error } = await getBrowserClient()
    .from("case_stages")
    .insert({
      study_id: study.id,
      name: input.name,
      position: input.position,
      counts_as_active: input.countsAsActive,
    })
    .select(COLUMNS)
    .single();
  // Includes the uq_case_stages_study_name violation (23505): the network
  // layer maps constraint failures onto save_failed, same as the fake layer.
  if (error || !data) throw new DataLayerError("save_failed");

  return toStage(data as unknown as StageRow);
}

/** Rename one etapa of my study (name already trimmed and validated). */
export async function renameStageSupabase(
  id: string,
  name: string,
): Promise<CaseStage> {
  const study = await requireStudy();

  const { data, error } = await getBrowserClient()
    .from("case_stages")
    .update({ name })
    .eq("id", id)
    .eq("study_id", study.id)
    .select(COLUMNS)
    .single();
  // No row matched (unknown id / foreign tenant) or a duplicate name: the
  // same typed failure the fake layer raises.
  if (error || !data) throw new DataLayerError("save_failed");

  return toStage(data as unknown as StageRow);
}

/** Flip `counts_as_active` — the flag Inicio reads to count a stage. */
export async function setStageCountsAsActiveSupabase(
  id: string,
  next: boolean,
): Promise<CaseStage> {
  const study = await requireStudy();

  const { data, error } = await getBrowserClient()
    .from("case_stages")
    .update({ counts_as_active: next })
    .eq("id", id)
    .eq("study_id", study.id)
    .select(COLUMNS)
    .single();
  if (error || !data) throw new DataLayerError("save_failed");

  return toStage(data as unknown as StageRow);
}

/**
 * Swap `id` with its neighbour in `position` order (up/down buttons).
 *
 * `position` has no unique constraint, so the swap is two plain UPDATEs —
 * no temp value, no RPC (a migration is out of scope for this unit). The
 * edge rows (first "up", last "down") are a no-op: the buttons render them
 * disabled. A failed second update would leave both rows on one position;
 * the next move re-densifies the order, and the UI refetches either way.
 */
export async function moveStageSupabase(
  id: string,
  direction: StageMoveDirection,
): Promise<void> {
  const study = await requireStudy();
  const supabase = getBrowserClient();

  const { data, error } = await supabase
    .from("case_stages")
    .select(COLUMNS)
    .eq("study_id", study.id)
    .order("position", { ascending: true });
  if (error || !data) throw new DataLayerError("save_failed");

  const rows = data as unknown as StageRow[];
  const index = rows.findIndex((row) => row.id === id);
  if (index === -1) throw new DataLayerError("save_failed");

  const neighbourIndex = direction === "up" ? index - 1 : index + 1;
  if (neighbourIndex < 0 || neighbourIndex >= rows.length) return;

  const me = rows[index] as StageRow;
  const neighbour = rows[neighbourIndex] as StageRow;

  const first = await supabase
    .from("case_stages")
    .update({ position: neighbour.position })
    .eq("id", me.id)
    .eq("study_id", study.id)
    .select("id");
  if (first.error) throw new DataLayerError("save_failed");

  const second = await supabase
    .from("case_stages")
    .update({ position: me.position })
    .eq("id", neighbour.id)
    .eq("study_id", study.id)
    .select("id");
  if (second.error) throw new DataLayerError("save_failed");
}

/**
 * Delete one etapa. `cases.etapa_id` is ON DELETE SET NULL (init.sql), so
 * the cases that pointed here come back as "Sin etapa" — the confirm copy
 * says so. The last-stage guard runs in the data layer BEFORE this call.
 */
export async function deleteStageSupabase(id: string): Promise<void> {
  const study = await requireStudy();

  const { data, error } = await getBrowserClient()
    .from("case_stages")
    .delete()
    .eq("id", id)
    .eq("study_id", study.id)
    .select("id");
  // Zero rows deleted = unknown id / foreign tenant: refuse instead of
  // reporting success for a row that is still there.
  if (error || !data || data.length === 0) {
    throw new DataLayerError("save_failed");
  }
}
