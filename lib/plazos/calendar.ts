/**
 * Working-day calendar for the plazos engine.
 *
 * Mirrors public.es_habil(p_day, p_study_id) in replica/schema.sql: a day is
 * hábil when it is not a weekend and no calendar_days row (system or studio)
 * covers it. Feriados nacionales, judicial feria and studio dias inhabiles
 * are all pre-merged into one set by the data layer, exactly as the SQL
 * query merges `study_id is null or study_id = p_study_id`.
 *
 * Provincial holidays are intentionally absent: F03 states they are never
 * counted, so they simply stay ordinary working days.
 */

/** ISO calendar dates (`YYYY-MM-DD`) that are not working days. */
export type NonWorkingDays = ReadonlySet<string>;

const DAY_MS = 86_400_000;

/** Is this date a working day for the given calendar? */
export function esHabil(day: string, nonWorkingDays: NonWorkingDays): boolean {
  return !isWeekend(day) && !nonWorkingDays.has(day);
}

/** Saturday (6) or Sunday (7) in ISO terms. */
export function isWeekend(day: string): boolean {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * All days of the judicial feria for a year: 1–31 January and 1–31 July,
 * per F03 ("January & July"). Exact boundaries inside each month are a
 * TODO(gap) pending a jurisdiction check — see replica/schema.sql
 * seed_feria_year().
 */
export function feriaDays(year: number): string[] {
  const days: string[] = [];
  for (const month of [1, 7]) {
    for (let d = 1; d <= 31; d++) {
      days.push(`${year}-${pad(month)}-${pad(d)}`);
    }
  }
  return days;
}

/** Add (or subtract) whole calendar days to an ISO date. */
export function addDays(day: string, amount: number): string {
  return toIso(parseIso(day) + amount * DAY_MS);
}

/** Parse an ISO date as UTC midnight of that calendar date. */
export function parseIso(day: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new Error(`invalid date: ${day}`);
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(ms)) throw new Error(`invalid date: ${day}`);
  return ms;
}

/** UTC-midnight milliseconds back to `YYYY-MM-DD`. */
export function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
