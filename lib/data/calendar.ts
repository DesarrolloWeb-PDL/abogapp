/**
 * Calendar helpers owned by the data layer.
 *
 * `nonWorkingDays` is the seam contract for S12: the add-prueba form never
 * computes anything, it hands this set to `computeFechaLimite` from
 * `lib/plazos` (see odd/tasks/m1-vertical-slice.md, "Surfaces").
 *
 * Contents follow es_habil(): weekend handling lives in the engine, so this
 * set only carries dated non-working days — judicial feria plus the studio's
 * días inhábiles (none seeded in M1; the S30 settings screen adds them).
 *
 * TODO(gap): official 2026/2027 national feriado dates are not in the recon
 * inputs (replica/architecture.md) and must be loaded from an authoritative
 * source before M2 — inventing them would falsify every hábil deadline.
 */

import { feriaDays } from "@/lib/plazos";
import { getDataDriver } from "./driver";
import { fetchNonWorkingDaysSupabase } from "@/lib/supabase/calendar";

/** Studio días inhábiles (calendar_days rows with a study_id). */
const STUDIO_NON_WORKING_DAYS: readonly string[] = [];

/** Years of feria covered for demo plazos. */
const FERIA_YEARS = [2026, 2027] as const;

/**
 * System + studio non-working days, pre-merged the way the SQL query merges
 * `study_id is null or study_id = p_study_id`. Stable module-level reference.
 *
 * The fake driver serves this static set (feria matches seed_feria_year());
 * the supabase driver rebuilds the SAME set instance from calendar_days
 * through `loadNonWorkingDays()`, so every consumer keeps its reference.
 */
const nonWorkingDaysSet = new Set<string>([
  ...FERIA_YEARS.flatMap((year) => feriaDays(year)),
  ...STUDIO_NON_WORKING_DAYS,
]);

export const nonWorkingDays: ReadonlySet<string> = nonWorkingDaysSet;

/**
 * Refresh the shared set from the active driver (S12 seam).
 *
 * - fake: the static set is already the truth — returns it untouched;
 * - supabase: reads calendar_days (system rows + current study's rows) and
 *   mutates the exported set in place, so `nonWorkingDays` keeps the exact
 *   ReadonlySet shape the add-prueba form consumes.
 *
 * Under supabase the engine never runs client-side (the plazos trigger owns
 * the computation); this loader keeps the shared reference truthful for the
 * S12 surfaces that read it directly.
 */
export async function loadNonWorkingDays(): Promise<ReadonlySet<string>> {
  if (getDataDriver() !== "supabase") return nonWorkingDays;

  const days = await fetchNonWorkingDaysSupabase();
  nonWorkingDaysSet.clear();
  for (const day of days) nonWorkingDaysSet.add(day);
  return nonWorkingDays;
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
