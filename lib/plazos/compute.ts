/**
 * The plazos engine — TS mirror of public.compute_fecha_limite() in
 * replica/schema.sql (the crown-jewel constraint, F03).
 *
 * The database owns this computation in production: the plazos trigger
 * recomputes fecha_limite on every write of its inputs, so API, UI and jobs
 * cannot disagree. This module exists so the fake data layer used before
 * Supabase is wired in produces the *same* instants — swap the data layer
 * later and no screen changes.
 *
 * Rules (F03 / recon.md):
 *  - the count starts the day AFTER fecha_efectiva;
 *  - hábiles skip weekends, national feriados, the judicial feria (all of
 *    January and July) and the studio's dias inhabiles;
 *  - corridos are plain calendar days with NO roll-over when the last day is
 *    inhábil;
 *  - horas include nights (continuous clock time from ART midnight);
 *  - date-based plazos end at 23:59:59 ART (UTC−3, no DST since 2009).
 */

import { esHabil, parseIso, toIso } from "./calendar.ts";

export type PlazoTipo = "horas" | "corridos" | "habiles";

export interface ComputeFechaLimiteInput {
  /** `YYYY-MM-DD`, the date the plazo runs from. */
  fechaEfectiva: string;
  tipo: PlazoTipo;
  /** Whole units; must be 1..5000 (same bound as the SQL CHECK). */
  cantidad: number;
  /** System + studio non-working days, merged the way es_habil() merges them. */
  nonWorkingDays: ReadonlySet<string>;
}

/** ART = UTC−3 with no daylight saving since 2009. */
const ART_OFFSET_MS = -3 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MAX_GUARD_ITERATIONS = 3660; // ~10 years, same guard as the SQL loop

/**
 * Compute the deadline instant for a plazo.
 *
 * @throws if the quantity is outside 1..5000, the type is unknown, or a
 *   hábiles count cannot be satisfied within ten years of calendar time —
 *   the same failure modes as the SQL function.
 */
export function computeFechaLimite(input: ComputeFechaLimiteInput): Date {
  const { fechaEfectiva, tipo, cantidad, nonWorkingDays } = input;

  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 5000) {
    throw new Error(`invalid plazo quantity: ${cantidad}`);
  }

  const startMs = parseIso(fechaEfectiva);

  if (tipo === "horas") {
    // TODO(gap): the exact start time of an "horas" plazo is not documented in
    // the recon; default = midnight of fecha_efectiva in ART (same default as
    // the SQL function).
    return new Date(startMs - ART_OFFSET_MS + cantidad * HOUR_MS);
  }

  if (tipo === "corridos") {
    // Plain calendar days from the day after; no roll-over on inhábil days.
    return endOfDayArt(startMs + cantidad * DAY_MS);
  }

  if (tipo === "habiles") {
    let dayMs = startMs;
    let count = 0;
    let guard = 0;
    while (count < cantidad) {
      dayMs += DAY_MS;
      guard += 1;
      if (guard > MAX_GUARD_ITERATIONS) {
        throw new Error("plazo exceeds 10 years of calendar time");
      }
      if (esHabil(toIso(dayMs), nonWorkingDays)) count += 1;
    }
    return endOfDayArt(dayMs);
  }

  throw new Error(`unknown plazo type: ${tipo}`);
}

/** 23:59:59 ART of the given UTC-midnight calendar day, as an instant. */
function endOfDayArt(dayUtcMidnightMs: number): Date {
  return new Date(
    dayUtcMidnightMs + (23 * 3_600 + 59 * 60 + 59) * 1000 - ART_OFFSET_MS,
  );
}
