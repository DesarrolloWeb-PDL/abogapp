/**
 * Movement functions for the `supabase` driver — browser-safe (anon key +
 * the `movements_member` RLS created by the init migration for every table
 * with a `study_id` tenant column).
 *
 * The shared vocabulary/bounds below mirror lib/data/movements.ts on
 * purpose: a value import through the data-layer facade would close a
 * runtime import cycle (the tasks/pruebas pairs duplicate theirs the same
 * way). Type-only imports from the facade are erased at compile time and
 * stay safe.
 *
 * Reads push the filter to PostgREST (`eq` tipo, `gte`/`lte` fecha) instead
 * of filtering in JS — same contract as the fake branch's
 * `applyMovementFilter`, asserted step-by-step in movements.test.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { DataLayerError, isValidFechaEfectiva } from "@/lib/data/errors";
import type {
  CreateMovementInput,
  Movement,
  MovementFilter,
  UpdateMovementPatch,
} from "@/lib/data/movements";
import { requireStudy } from "@/lib/data/studies";
import { getBrowserClient } from "./client";

// --- mirrors of lib/data/movements.ts (see the header note) ----------------
const MOVEMENT_TIPOS: readonly string[] = [
  "Audiencia",
  "Trámite",
  "Presentación",
  "Resolución",
  "Otro",
];
const MOVEMENT_DETALLE_MAX = 4000;
// -----------------------------------------------------------------------------

/**
 * Every column the screens read, plus the embed that carries the creator's
 * name: `created_by` → profiles.full_name. profiles RLS is own-row-only,
 * so another member's name comes back null (the UI reads that as no line);
 * my own rows always resolve. The FK needs an explicit `!fkey` hint —
 * PostgREST cannot pick between the profiles foreign keys on its own
 * (the same lesson as the tasks pair).
 */
const MOVEMENT_COLUMNS =
  "id, study_id, case_id, fecha, tipo, detalle, pinned, created_at, " +
  "created_by:profiles!movements_created_by_fkey(full_name)";

interface MovementRow {
  id: string;
  study_id: string;
  case_id: string;
  /** `date` column: PostgREST answers with `YYYY-MM-DD`. */
  fecha: string;
  tipo: string | null;
  detalle: string;
  pinned: boolean;
  created_at: string;
  created_by: { full_name: string | null } | null;
}

/**
 * One case's movements, newest fecha first (`idx_movements_case` order);
 * `pinned` rows stay in place — the UI badges them, the query never
 * re-sorts a chronology around a star.
 */
export async function listMovementsSupabase(
  caseId: string,
  filter?: MovementFilter,
): Promise<Movement[]> {
  const supabase = getBrowserClient();

  // RLS (`movements_member` = is_member(study_id)) is the tenancy guard,
  // same as the cases read; the filter below mirrors applyMovementFilter.
  let query = supabase
    .from("movements")
    .select(MOVEMENT_COLUMNS)
    .eq("case_id", caseId);
  if (filter?.tipo) query = query.eq("tipo", filter.tipo);
  if (filter?.from) query = query.gte("fecha", filter.from);
  if (filter?.to) query = query.lte("fecha", filter.to);
  const { data, error } = await query
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false });
  if (error || !data) throw new DataLayerError("save_failed");

  return (data as unknown as MovementRow[]).map(mapMovement);
}

/** Create a movement in the case's hand-entered log (no notification). */
export async function createMovementSupabase(
  input: CreateMovementInput,
): Promise<Movement> {
  const study = await requireStudy();
  const supabase = getBrowserClient();
  const user = await requireUser(supabase);

  // Same validation, same order as the fake branch — nothing reaches the
  // network before the typed failures the screens map through errorCopy().
  const { caseId, fecha, tipo, detalle } = validateMovementInput(input);

  // caseId is NOT pre-validated: the composite fk_movements_case rejects a
  // foreign/unknown case with the same save_failed the fake branch raises.
  // `pinned` is omitted on purpose — the DB default (false) owns it.
  const { data: row, error } = await supabase
    .from("movements")
    .insert({
      study_id: study.id,
      case_id: caseId,
      fecha,
      tipo,
      detalle,
      created_by: user.id,
    })
    .select(MOVEMENT_COLUMNS)
    .single();
  if (error || !row) throw new DataLayerError("save_failed");
  // The type-level select parser cannot resolve embeds without generated
  // database types, so the row arrives loosely typed — retype it once.
  return mapMovement(row as unknown as MovementRow);
}

/** Apply the narrow patch — the S09 pin toggle, nothing else. */
export async function updateMovementSupabase(
  id: string,
  patch: UpdateMovementPatch,
): Promise<Movement> {
  // A PATCH with nothing to change is a client bug: fail before any I/O.
  if (patch.pinned === undefined) throw new DataLayerError("missing_fields");
  if (typeof patch.pinned !== "boolean") throw new DataLayerError("save_failed");

  const study = await requireStudy();
  const supabase = getBrowserClient();

  // Pre-read: the row must exist in MY study (fake-driver parity) before
  // the single UPDATE below writes anything.
  const { data: current, error: currentError } = await supabase
    .from("movements")
    .select("id")
    .eq("id", id)
    .eq("study_id", study.id)
    .maybeSingle();
  if (currentError || !current) throw new DataLayerError("save_failed");

  // One statement, all-or-nothing: only the pinned column ever reaches it.
  const { data: row, error } = await supabase
    .from("movements")
    .update({ pinned: patch.pinned })
    .eq("id", id)
    .eq("study_id", study.id)
    .select(MOVEMENT_COLUMNS)
    .single();
  if (error || !row) throw new DataLayerError("save_failed");
  return mapMovement(row as unknown as MovementRow);
}

async function requireUser(
  supabase: SupabaseClient,
): Promise<{ id: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new DataLayerError("not_signed_in");
  return user;
}

/**
 * Mirror of lib/data/movements.ts `validateMovementInput` (see the header
 * note): required fields → sane fecha window → vocabulary/length bounds.
 */
function validateMovementInput(input: CreateMovementInput): {
  caseId: string;
  fecha: string;
  tipo: string;
  detalle: string;
} {
  const caseId = input.caseId.trim();
  const fecha = input.fecha.trim();
  const tipo = input.tipo.trim();
  const detalle = input.detalle.trim();
  if (!caseId || !fecha || !tipo || !detalle) {
    throw new DataLayerError("missing_fields");
  }
  if (!isValidFechaEfectiva(fecha)) {
    throw new DataLayerError("invalid_fecha_efectiva");
  }
  if (!MOVEMENT_TIPOS.includes(tipo)) throw new DataLayerError("save_failed");
  if (detalle.length > MOVEMENT_DETALLE_MAX) {
    throw new DataLayerError("save_failed");
  }
  return { caseId, fecha, tipo, detalle };
}

function mapMovement(row: MovementRow): Movement {
  return {
    id: row.id,
    studyId: row.study_id,
    caseId: row.case_id,
    fecha: row.fecha,
    // `tipo` is nullable in the DB; the screens show "Sin tipo" for "".
    tipo: row.tipo ?? "",
    detalle: row.detalle,
    pinned: row.pinned,
    createdBy: row.created_by?.full_name ?? "",
    createdAt: row.created_at,
  };
}
