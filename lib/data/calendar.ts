/**
 * Calendar helpers owned by the data layer.
 *
 * `nonWorkingDays` is the seam contract for S12: the add-prueba form never
 * computes anything, it hands this set to `computeFechaLimite` from
 * `lib/plazos` (see odd/tasks/m1-vertical-slice.md, "Surfaces").
 *
 * Contents follow es_habil(): weekend handling lives in the engine, so this
 * set only carries dated non-working days — judicial feria plus the studio's
 * días inhábiles. The S30 admin (Días inhábiles) writes those studio rows
 * through listStudioDays / addStudioDay / removeStudioDay below; the loader
 * re-reads them, so a JUST-ADDED day is in `nonWorkingDays` after the next
 * refetch.
 *
 * TODO(gap): official 2026/2027 national feriado dates are not in the recon
 * inputs (replica/architecture.md) and must be loaded from an authoritative
 * source before M2 — inventing them would falsify every hábil deadline.
 */

import { feriaDays } from "@/lib/plazos";
import { getDataDriver } from "./driver";
import { DataLayerError, isValidFechaEfectiva } from "./errors";
import { getMyStudy, requireStudy } from "./studies";
import {
  addStudioDaySupabase,
  fetchNonWorkingDaysSupabase,
  listStudioDaysSupabase,
  listSystemDaysSupabase,
  removeStudioDaySupabase,
} from "@/lib/supabase/calendar";

/** `calendar_days.kind` vocabulary (init.sql check constraint). */
export type CalendarDayKind = "feriado" | "feria" | "inhabil";

/** S30's "Origen" column: system rows vs the study's own rows. */
export type CalendarDayOrigen = "sistema" | "estudio";

/** One `calendar_days` row as the Días inhábiles screen renders it. */
export interface CalendarDay {
  id: string;
  /** `YYYY-MM-DD`. */
  day: string;
  kind: CalendarDayKind;
  name: string;
  origen: CalendarDayOrigen;
}

/** What addStudioDay writes: the date plus its display name. */
export interface AddStudioDayInput {
  day: string;
  name: string;
}

/** Years of feria covered for demo plazos. */
const FERIA_YEARS = [2026, 2027] as const;

/** The name seed_feria_year() writes for every feria row. */
const SYSTEM_FERIA_NAME = "Feria judicial";

/**
 * System rows the fake driver serves — the same feria days the init
 * migration seeds through seed_feria_year(2026/2027). Feriados are absent
 * in BOTH drivers until the TODO(gap) above is closed.
 */
const SYSTEM_FERIA_DAYS: readonly string[] = FERIA_YEARS.flatMap((year) =>
  feriaDays(year),
);

const SYSTEM_DAYS: readonly CalendarDay[] = SYSTEM_FERIA_DAYS.map((day) => ({
  id: `system-${day}`,
  day,
  kind: "feria" as const,
  name: SYSTEM_FERIA_NAME,
  origen: "sistema" as const,
}));

/**
 * Fake-driver studio rows, lazily empty (store.ts has no calendar table and
 * is not this unit's surface) — the same module-state shape the fake stages
 * and the bot-settings overrides use.
 */
let fakeStudioDayRows: CalendarDay[] | null = null;

function fakeStudioDays(): CalendarDay[] {
  if (!fakeStudioDayRows) fakeStudioDayRows = [];
  return fakeStudioDayRows;
}

/**
 * System + studio non-working days, pre-merged the way the SQL query merges
 * `study_id is null or study_id = p_study_id`. Stable module-level reference.
 *
 * The initial content is the static feria set (matching seed_feria_year());
 * loadNonWorkingDays() rebuilds this SAME set instance from whichever
 * driver is active, so every consumer keeps its reference.
 */
const nonWorkingDaysSet = new Set<string>(SYSTEM_FERIA_DAYS);

export const nonWorkingDays: ReadonlySet<string> = nonWorkingDaysSet;

/**
 * The read-only "Del sistema" group (S30): every system feria/feriado row,
 * oldest first. Never deletable client-side — RLS denies member writes on
 * `study_id is null` rows, and the screen renders no control for them.
 */
export async function listSystemDays(): Promise<CalendarDay[]> {
  if (getDataDriver() === "supabase") return listSystemDaysSupabase();
  return SYSTEM_DAYS.map((row) => ({ ...row }));
}

/** The study's own días inhábiles, oldest first; empty before onboarding. */
export async function listStudioDays(): Promise<CalendarDay[]> {
  if (getDataDriver() === "supabase") return listStudioDaysSupabase();

  const study = await getMyStudy();
  if (!study) return [];

  return fakeStudioDays()
    .map((row) => ({ ...row }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/**
 * Add a studio día inhábil (kind = 'inhabil', the value es_habil() reads).
 *
 * Validation runs BEFORE the driver switch: both fields are required, and
 * the date reuses isValidFechaEfectiva — the same sane 1900-01-01..2100-12-31
 * window fecha_efectiva gets (its typed failure reuses
 * `invalid_fecha_efectiva`; the screen shows its own inline copy first).
 * The duplicate half of uq_calendar_days_study is checked here because a
 * Postgres unique index is case/duplicate-sensitive per (study_id, day,
 * kind) — same-day studio rows are rejected in BOTH drivers.
 */
export async function addStudioDay(
  input: AddStudioDayInput,
): Promise<CalendarDay> {
  const day = input.day.trim();
  const name = input.name.trim();
  if (!day || !name) throw new DataLayerError("missing_fields");
  if (!isValidFechaEfectiva(day)) {
    throw new DataLayerError("invalid_fecha_efectiva");
  }

  const existing = await listStudioDays();
  if (existing.some((row) => row.day === day)) {
    throw new DataLayerError("save_failed");
  }

  if (getDataDriver() === "supabase") {
    return addStudioDaySupabase({ day, name });
  }

  await requireStudy(); // the fake layer has no rows without a study
  const created: CalendarDay = {
    id: nextFakeStudioDayId(existing),
    day,
    kind: "inhabil",
    name,
    origen: "estudio",
  };
  fakeStudioDays().push(created);
  return { ...created };
}

/**
 * Delete ONE studio row. System rows are never passed here: their ids are
 * not in the studio list, so the fake layer refuses them and the supabase
 * layer's `study_id` scope matches zero rows — both raise save_failed.
 */
export async function removeStudioDay(id: string): Promise<void> {
  if (getDataDriver() === "supabase") return removeStudioDaySupabase(id);

  await requireStudy();
  const rows = fakeStudioDays();
  const index = rows.findIndex((row) => row.id === id);
  if (index === -1) throw new DataLayerError("save_failed");
  rows.splice(index, 1);
}

/**
 * Refresh the shared set from the active driver (S12 seam).
 *
 * - fake: rebuilds the SAME set from the static feria days + the studio
 *   days added in this session, so a just-added day reaches the engine;
 * - supabase: reads calendar_days (system rows + current study's rows) and
 *   mutates the exported set in place, so `nonWorkingDays` keeps the exact
 *   ReadonlySet shape the add-prueba form consumes.
 *
 * Under supabase the engine never runs client-side (the plazos trigger owns
 * the computation); this loader keeps the shared reference truthful for the
 * S12 surfaces that read it directly.
 */
export async function loadNonWorkingDays(): Promise<ReadonlySet<string>> {
  const days =
    getDataDriver() !== "supabase"
      ? [...SYSTEM_FERIA_DAYS, ...fakeStudioDays().map((row) => row.day)]
      : await fetchNonWorkingDaysSupabase();

  nonWorkingDaysSet.clear();
  for (const day of days) nonWorkingDaysSet.add(day);
  return nonWorkingDays;
}

/** Next `studio-day-N` beyond every id currently in the list. */
function nextFakeStudioDayId(rows: CalendarDay[]): string {
  const max = rows.reduce((highest, row) => {
    const match = /^studio-day-(\d+)$/.exec(row.id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `studio-day-${max + 1}`;
}

/** ART = UTC−3, no daylight saving since 2009. */
const ART_OFFSET_MS = -3 * 60 * 60 * 1000;

/**
 * ART calendar date (`YYYY-MM-DD`) of an engine instant.
 *
 * The engine returns 23:59:59 ART for date-based plazos; stepping back to
 * ART recovers the calendar day the deadline belongs to.
 */
export function toArtIsoDate(instant: Date): string {
  return new Date(instant.getTime() + ART_OFFSET_MS).toISOString().slice(0, 10);
}
