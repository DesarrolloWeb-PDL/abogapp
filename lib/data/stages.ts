/**
 * Case-stage (etapa) functions — the read behind the Etapa procesal select
 * of the new-expediente form and the Etapa filter of the list (S07), plus
 * the S30 admin CRUD (create / rename / counts_as_active / position swap /
 * delete).
 *
 * Driver split: the supabase driver reads and writes the study's
 * `case_stages` rows (seeded per study by init_study_defaults()); the fake
 * layer has no stages table, so it keeps its rows in module state — the
 * same in-memory-singleton shape the bot settings use (a full page reload
 * re-seeds both).
 *
 * Validation is driver-agnostic and runs BEFORE any write, in the order
 * every other module uses (bot-settings): name shape first, then the
 * current list for uniqueness/existence, then the driver switch.
 *
 * Error-code note (errors.ts is outside this unit's surfaces, the same
 * precedent the bot unit documented): blank names reuse `missing_fields`;
 * the over-80 bound, a duplicate name and the last-stage guard reuse
 * `save_failed` because they mirror DB constraint failures (the check
 * constraint, uq_case_stages_study_name and the guard respectively) and
 * `email_taken` is auth-specific copy. A dedicated `stage_name_taken` /
 * `last_stage` pair would read better in the toast — reported upstream.
 */

import { getDataDriver } from "./driver";
import { DataLayerError } from "./errors";
import { getMyStudy, requireStudy } from "./studies";
import {
  createStageSupabase,
  deleteStageSupabase,
  listStagesSupabase,
  moveStageSupabase,
  renameStageSupabase,
  setStageCountsAsActiveSupabase,
} from "@/lib/supabase/stages";

/** One row of the study's `case_stages` (Etapas settings, S30). */
export interface CaseStage {
  id: string;
  name: string;
  position: number;
  /** Counts as an active stage on Inicio (S30's "cuenta como activa"). */
  countsAsActive: boolean;
}

/** What createStage writes: the name plus the Inicio flag. */
export interface CreateStageInput {
  name: string;
  countsAsActive?: boolean;
}

/** up/down buttons — there is no drag-and-drop (S30 has buttons). */
export type StageMoveDirection = "up" | "down";

/** Mirrors `char_length(name) between 1 and 80` in case_stages. */
export const STAGE_NAME_MAX = 80;

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

/**
 * Fake-driver rows, lazily seeded from the defaults above and kept in
 * module state (store.ts has no stages table and is not this unit's
 * surface). Every mutation re-densifies `position` to 1..n, so the list
 * order and the position numbers can never drift apart.
 */
let fakeStageRows: CaseStage[] | null = null;

function fakeStages(): CaseStage[] {
  if (!fakeStageRows) {
    fakeStageRows = DEFAULT_STAGE_NAMES.map((name, index) => ({
      id: `stage-${index + 1}`,
      name,
      position: index + 1,
      countsAsActive: true,
    }));
  }
  return fakeStageRows;
}

/** The current study's stages in `position` order; empty before onboarding. */
export async function listStages(): Promise<CaseStage[]> {
  if (getDataDriver() === "supabase") return listStagesSupabase();

  const study = await getMyStudy();
  if (!study) return [];

  // Ids are stable per position (not nextId): the select must not change
  // value between two reads of the same list.
  return fakeStages()
    .map((row) => ({ ...row }))
    .sort((a, b) => a.position - b.position);
}

/** Create the etapa at `position` = max + 1 (both drivers, same order). */
export async function createStage(input: CreateStageInput): Promise<CaseStage> {
  const name = assertStageName(input.name);
  const countsAsActive = input.countsAsActive ?? true;

  const rows = await listStages();
  assertUniqueStageName(rows, name);
  const position =
    rows.reduce((max, row) => Math.max(max, row.position), 0) + 1;

  if (getDataDriver() === "supabase") {
    return createStageSupabase({ name, position, countsAsActive });
  }

  await requireStudy(); // the fake layer has no rows without a study
  const created: CaseStage = {
    id: nextFakeStageId(rows),
    name,
    position,
    countsAsActive,
  };
  fakeStages().push(created);
  return { ...created };
}

/** Rename one etapa; the name is trimmed and uniqueness-checked first. */
export async function renameStage(id: string, name: string): Promise<CaseStage> {
  const trimmed = assertStageName(name);

  const rows = await listStages();
  assertStageExists(rows, id);
  assertUniqueStageName(rows, trimmed, id);

  if (getDataDriver() === "supabase") {
    return renameStageSupabase(id, trimmed);
  }

  await requireStudy();
  const row = fakeStages().find((stage) => stage.id === id) as CaseStage;
  row.name = trimmed;
  return { ...row };
}

/** Flip the Inicio flag for one etapa. */
export async function setStageCountsAsActive(
  id: string,
  next: boolean,
): Promise<CaseStage> {
  // A non-boolean is a client bug: fail before any read or write.
  if (typeof next !== "boolean") throw new DataLayerError("save_failed");

  const rows = await listStages();
  assertStageExists(rows, id);

  if (getDataDriver() === "supabase") {
    return setStageCountsAsActiveSupabase(id, next);
  }

  await requireStudy();
  const row = fakeStages().find((stage) => stage.id === id) as CaseStage;
  row.countsAsActive = next;
  return { ...row };
}

/**
 * Swap `id` with its neighbour (up/down). The first row cannot move up and
 * the last cannot move down: those requests are a clean no-op, which is why
 * the buttons render disabled at the edges.
 */
export async function moveStage(
  id: string,
  direction: StageMoveDirection,
): Promise<void> {
  if (direction !== "up" && direction !== "down") {
    throw new DataLayerError("save_failed");
  }

  if (getDataDriver() === "supabase") {
    return moveStageSupabase(id, direction);
  }

  await requireStudy();
  const rows = fakeStages().sort((a, b) => a.position - b.position);
  const index = rows.findIndex((stage) => stage.id === id);
  if (index === -1) throw new DataLayerError("save_failed");

  const neighbourIndex = direction === "up" ? index - 1 : index + 1;
  if (neighbourIndex < 0 || neighbourIndex >= rows.length) return;

  const [moved] = rows.splice(index, 1);
  rows.splice(neighbourIndex, 0, moved as CaseStage);
  rows.forEach((row, position) => {
    row.position = position + 1;
  });
}

/**
 * Delete one etapa — refused while it is the LAST one: a study always
 * keeps at least one etapa (S30), so the guard runs on the fresh list
 * BEFORE the driver switch. `cases.etapa_id` is ON DELETE SET NULL, hence
 * the confirm copy about cases left without an etapa.
 */
export async function deleteStage(id: string): Promise<void> {
  const rows = await listStages();
  assertStageExists(rows, id);
  if (rows.length <= 1) throw new DataLayerError("save_failed");

  if (getDataDriver() === "supabase") {
    return deleteStageSupabase(id);
  }

  await requireStudy();
  const store = fakeStages();
  const index = store.findIndex((stage) => stage.id === id);
  store.splice(index, 1);
  store.forEach((row, position) => {
    row.position = position + 1;
  });
}

/**
 * Trim + shape check shared by create and rename. Empty → `missing_fields`
 * (the input the user must fill in); over the 80-char DB bound →
 * `save_failed` (a check-constraint refusal, see the header note).
 */
function assertStageName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new DataLayerError("missing_fields");
  if (trimmed.length > STAGE_NAME_MAX) throw new DataLayerError("save_failed");
  return trimmed;
}

/**
 * Unique per study, case-insensitively. The DB backs this with
 * uq_case_stages_study_name, but a Postgres text unique index is
 * case-sensitive — "Inicial" and "inicial" would both land — so the
 * case-insensitive half is enforced here, in BOTH drivers (and a genuine
 * 23505 maps to save_failed in the supabase branch).
 */
function assertUniqueStageName(
  rows: CaseStage[],
  name: string,
  excludeId?: string,
): void {
  const needle = name.trim().toLowerCase();
  const duplicate = rows.some(
    (row) => row.id !== excludeId && row.name.trim().toLowerCase() === needle,
  );
  if (duplicate) throw new DataLayerError("save_failed");
}

/** Unknown id (or a foreign tenant's row) → the same refusal as the driver. */
function assertStageExists(rows: CaseStage[], id: string): void {
  if (!rows.some((row) => row.id === id)) {
    throw new DataLayerError("save_failed");
  }
}

/** Next `stage-N` beyond every id currently in the list (collision-free). */
function nextFakeStageId(rows: CaseStage[]): string {
  const max = rows.reduce((highest, row) => {
    const match = /^stage-(\d+)$/.exec(row.id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `stage-${max + 1}`;
}
