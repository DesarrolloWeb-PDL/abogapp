/**
 * Calendar reads for the `supabase` driver — the S12 non-working-days seam.
 *
 * Mirrors public.es_habil(p_day, p_study_id) in replica/schema.sql: a date is
 * non-working when ANY calendar_days row covers it (kind is irrelevant —
 * feria, feriado and the studio's días inhábiles all count) with
 * `study_id is null or study_id = current study`. The client-side study
 * filter matters for multi-study members: RLS only limits to studies I belong
 * to, while es_habil() also pins the exact tenant.
 */

import { DataLayerError } from "@/lib/data/errors";
import { getMyStudy } from "@/lib/data/studies";
import { getBrowserClient } from "./client";

interface CalendarDayRow {
  study_id: string | null;
  day: string;
}

/**
 * ISO dates (`YYYY-MM-DD`) that count as non-working for the current study,
 * in es_habil()'s merge order: system rows (study_id null) + my study's rows.
 */
export async function fetchNonWorkingDaysSupabase(): Promise<string[]> {
  const supabase = getBrowserClient();
  const study = await getMyStudy();

  const { data, error } = await supabase
    .from("calendar_days")
    .select("study_id, day");
  if (error || !data) throw new DataLayerError("save_failed");

  return (data as unknown as CalendarDayRow[])
    .filter((row) => row.study_id === null || row.study_id === study?.id)
    .map((row) => row.day);
}
