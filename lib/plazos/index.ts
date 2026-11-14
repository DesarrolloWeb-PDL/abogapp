/**
 * Public surface of the plazos engine.
 *
 * Screens and route handlers must import from here and never re-implement a
 * deadline calculation: the DB trigger owns it in production, and
 * computeFechaLimite() is its exact mirror for the pre-Supabase data layer.
 */

export {
  computeFechaLimite,
  type ComputeFechaLimiteInput,
  type PlazoTipo,
} from "./compute.ts";

export {
  addDays,
  esHabil,
  feriaDays,
  isWeekend,
  type NonWorkingDays,
} from "./calendar.ts";
