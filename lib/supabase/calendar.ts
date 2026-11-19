/**
 * Calendar reads/writes for the `supabase` driver — the S12 non-working-
 * days seam plus the S30 studio-day admin.
 *
 * Mirrors public.es_habil(p_day, p_study_id) in replica/schema.sql: a date
 * is non-working when ANY calendar_days row covers it (kind is irrelevant —
 * feria, feriado and the studio's días inhábiles all count) with
 * `study_id is null or study_id = current study`. The client-side study
 * filter matters for multi-study members: RLS only limits to studies I
 * belong to, while es_habil() also pins the exact tenant.
 *
 * Origins follow the same table: `study_id null` = "Del sistema" (written
 * by migrations/the service role; RLS denies member writes, so these rows
 * are read-only here), `study_id` set = "De tu estudio" (the rows this
 * module creates and deletes).
 */

import type { CalendarDay } from "@/lib/data/calendar";
import { DataLayerError } from "@/lib/data/errors";
import { getMyStudy, requireStudy } from "@/lib/data/studies";
import { getBrowserClient } from "./client";

interface CalendarDayRow {
  id: string;
  study_id: string | null;
  day: string;
  kind: string;
  name: string;
}

const COLUMNS = "id, study_id, day, kind, name";

/**
 * The `kind` calendar_days stores for a study-owned día inhábil — the
 * value es_habil() and the check constraint use ('feriado' | 'feria' |
 * 'inhabil'); learned from init.sql, never guessed.
 */
const STUDIO_DAY_KIND = "inhabil";

function toDay(row: CalendarDayRow): CalendarDay {
  return {
    id: row.id,
    day: row.day,
    kind: row.kind as CalendarDay["kind"],
    name: row.name,
    origen: row.study_id === null ? "sistema" : "estudio",
  };
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

  return (data as unknown as Pick<CalendarDayRow, "study_id" | "day">[])
    .filter((row) => row.study_id === null || row.study_id === study?.id)
    .map((row) => row.day);
}

/**
 * The read-only "Del sistema" group of the S30 screen: every system row
 * (feria and feriados), oldest first. No study lookup on purpose — RLS
 * already answers system rows to any member, and nothing here is scoped to
 * a tenant.
 */
export async function listSystemDaysSupabase(): Promise<CalendarDay[]> {
  const { data, error } = await getBrowserClient()
    .from("calendar_days")
    .select(COLUMNS)
    .is("study_id", null)
    .order("day", { ascending: true });
  if (error || !data) throw new DataLayerError("save_failed");

  return (data as unknown as CalendarDayRow[]).map(toDay);
}

/**
 * The current study's días inhábiles, oldest first — the "De tu estudio"
 * group. Before onboarding the answer is the honest empty list, exactly
 * like listStagesSupabase.
 */
export async function listStudioDaysSupabase(): Promise<CalendarDay[]> {
  const study = await getMyStudy();
  if (!study) return [];

  const { data, error } = await getBrowserClient()
    .from("calendar_days")
    .select(COLUMNS)
    .eq("study_id", study.id)
    .order("day", { ascending: true });
  if (error || !data) throw new DataLayerError("save_failed");

  return (data as unknown as CalendarDayRow[]).map(toDay);
}

/**
 * Add a studio día inhábil. The date window and the duplicate check
 * already ran in lib/data/calendar.ts (isValidFechaEfectiva reuses the
 * fecha_efectiva 1900–2100 bound), so this module only writes; a genuine
 * uq_calendar_days_study violation (23505) maps to save_failed like every
 * other constraint failure.
 */
export async function addStudioDaySupabase(input: {
  day: string;
  name: string;
}): Promise<CalendarDay> {
  const study = await requireStudy();

  const { data, error } = await getBrowserClient()
    .from("calendar_days")
    .insert({
      study_id: study.id,
      day: input.day,
      kind: STUDIO_DAY_KIND,
      name: input.name,
    })
    .select(COLUMNS)
    .single();
  if (error || !data) throw new DataLayerError("save_failed");

  return toDay(data as unknown as CalendarDayRow);
}

/**
 * Delete ONE studio row, pinned to my study: a system-row id (or another
 * tenant's) matches nothing, so zero rows deleted refuses with save_failed
 * instead of pretending the day is gone.
 */
export async function removeStudioDaySupabase(id: string): Promise<void> {
  const study = await requireStudy();

  const { data, error } = await getBrowserClient()
    .from("calendar_days")
    .delete()
    .eq("id", id)
    .eq("study_id", study.id)
    .select("id");
  if (error || !data || data.length === 0) {
    throw new DataLayerError("save_failed");
  }
}
