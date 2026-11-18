/**
 * Movement functions — GET/POST /api/cases/:id/movements and
 * PATCH /api/movements/:id in miniature (S09, M2 slice).
 *
 * Driver split: same shape as the tasks pair. The M1 store has no
 * `movements` array (store.ts belongs to another unit), so the fake driver
 * keeps its rows in a module-local list behind `peekFakeMovements` /
 * `resetFakeMovements`; the supabase driver runs the same contract against
 * `movements` under the `movements_member` RLS — see lib/supabase/movements.ts.
 *
 * Columns (migrations/20261114120000_init.sql): `fecha` date NOT NULL,
 * `tipo` text NULL with NO check constraint, `detalle` text NOT NULL with
 * `check (char_length between 1 and 4000)`, `pinned` boolean default false.
 * Two clone decisions follow from that schema:
 *  - `tipo` is required on create, from a small Spanish vocabulary owned by
 *    this layer: neither the schema nor the seed carries a set, and S09's
 *    evidence is an index line — the same "we own the defaults" stance
 *    `init_study_defaults()` takes for case stages;
 *  - `detalle` is REQUIRED, not optional: the brief suggested optional, but
 *    the DB says `not null check (1..4000)` and the constraint wins.
 *
 * Sort decision (S09 "pin most important"): rows are served fecha DESC
 * (`idx_movements_case (case_id, fecha desc)` is the order the DB already
 * keeps) and `pinned` is a VISUAL badge only — the pin never re-sorts the
 * history, because a chronology that reshuffles under a star is useless.
 *
 * No notification is written: S09 asks for the hand-entered history, the
 * pin and the filters only.
 *
 * Shared bounds/vocabulary are duplicated per driver on purpose (the
 * pruebas/tasks pairs do the same): a value import from lib/supabase/*
 * back through the data-layer facade would close a runtime import cycle.
 */

import { searchMatches } from "@/lib/search";
import { requireSession } from "./auth";
import { DataLayerError, isValidFechaEfectiva } from "./errors";
import { getDataDriver } from "./driver";
import { getStore, isoNow } from "./store";
import { getMyStudy, requireStudy } from "./studies";
import {
  createMovementSupabase,
  listMovementsSupabase,
  updateMovementSupabase,
} from "@/lib/supabase/movements";

/** The controlled `movements.tipo` vocabulary (see the header note). */
export const MOVEMENT_TIPOS = [
  "Audiencia",
  "Trámite",
  "Presentación",
  "Resolución",
  "Otro",
] as const;
export type MovementTipo = (typeof MOVEMENT_TIPOS)[number];

/** `movements.detalle` check constraint: 1..4000 chars. */
export const MOVEMENT_DETALLE_MAX = 4000;

/** One row of the case's hand-entered movement log (S09). */
export interface Movement {
  id: string;
  studyId: string;
  caseId: string;
  /** `YYYY-MM-DD` — the day the movement happened (ART calendar). */
  fecha: string;
  /** Controlled vocabulary value; "" for a legacy row whose tipo is null. */
  tipo: string;
  detalle: string;
  /** S09's "fijar el más importante": badged in the UI, never re-sorted. */
  pinned: boolean;
  /** profiles.full_name of the creator; "" when RLS hides it. */
  createdBy: string;
  createdAt: string;
}

export interface MovementFilter {
  /** Exact `movements.tipo` match (the controlled vocabulary above). */
  tipo?: string;
  /** Inclusive `YYYY-MM-DD` lower bound on fecha. */
  from?: string;
  /** Inclusive `YYYY-MM-DD` upper bound on fecha. */
  to?: string;
}

export interface MovementQuery extends MovementFilter {
  /** Free text over tipo + detalle (accent/typo tolerant — lib/search.ts). */
  query?: string;
}

export interface CreateMovementInput {
  caseId: string;
  /** `YYYY-MM-DD`, required (the column is NOT NULL). */
  fecha: string;
  /** One of MOVEMENT_TIPOS (validated in both drivers). */
  tipo: string;
  /** 1..4000 chars (the DB check) — required, see the header note. */
  detalle: string;
}

/** The one column PATCH /api/movements/:id may touch: the S09 pin toggle. */
export interface UpdateMovementPatch {
  pinned?: boolean;
}

/** Type guard for the controlled vocabulary. */
export function isMovementTipo(value: string): value is MovementTipo {
  return (MOVEMENT_TIPOS as readonly string[]).includes(value);
}

/**
 * The list's default order: fecha DESC (newest day first), created_at DESC
 * inside a day. `pinned` is deliberately NOT part of the comparator — the
 * star is a badge, not a rank (see the sort decision in the header).
 */
export function compareMovementsByFecha(
  a: Pick<Movement, "fecha" | "createdAt">,
  b: Pick<Movement, "fecha" | "createdAt">,
): number {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * Client-side filter over an already date-sorted list: tipo + inclusive
 * date range + the lib/search.ts free text. This is the fetch-once + client
 * filter shape expedientes/tareas use; `listMovements` applies the same
 * tipo/range at the driver level for API parity, and `query` only exists
 * here because search never travels to the API.
 */
export function applyMovementFilter(
  rows: readonly Movement[],
  filter?: MovementQuery,
): Movement[] {
  const tipo = filter?.tipo ?? "";
  const from = filter?.from ?? "";
  const to = filter?.to ?? "";
  const query = (filter?.query ?? "").trim();

  return rows.filter((row) => {
    if (tipo && row.tipo !== tipo) return false;
    // `YYYY-MM-DD` strings compare chronologically (the formatDate trick).
    if (from && row.fecha < from) return false;
    if (to && row.fecha > to) return false;
    if (query && !searchMatches(query, `${row.tipo} ${row.detalle}`)) {
      return false;
    }
    return true;
  });
}

/** The pin badge word ("" when the row is not pinned) — Spanish copy lives
 *  here once, so the star and its label can never drift apart. */
export function movementPinBadge(pinned: boolean): string {
  return pinned ? "Fijado" : "";
}

/** Module-local fake movement list (see the file header for why it lives here). */
let fakeMovements: Movement[] = [];
let fakeMovementSeq = 0;

/** Rebuild the fake movement list — test isolation, like `resetDataStore`. */
export function resetFakeMovements(): void {
  fakeMovements = [];
  fakeMovementSeq = 0;
}

/** Read seam for tests: the supabase branch must never write into this list. */
export function peekFakeMovements(): readonly Movement[] {
  return fakeMovements;
}

/**
 * One case's movements, newest fecha first. `pinned` rows stay in place
 * (badged by the UI); the optional filter narrows tipo + date range.
 */
export async function listMovements(
  caseId: string,
  filter?: MovementFilter,
): Promise<Movement[]> {
  if (getDataDriver() === "supabase") return listMovementsSupabase(caseId, filter);

  const study = await getMyStudy();
  if (!study || !caseId) return [];

  const rows = fakeMovements.filter(
    (row) => row.studyId === study.id && row.caseId === caseId,
  );
  // Same-millisecond inserts (fast tests) tie on fecha AND createdAt: the
  // id sequence (`movement-{n}`) keeps them in insertion order, newest first.
  return applyMovementFilter(rows, filter).sort(
    (a, b) => compareMovementsByFecha(a, b) || seqOf(b.id) - seqOf(a.id),
  );
}

function seqOf(id: string): number {
  const value = Number(id.slice("movement-".length));
  return Number.isNaN(value) ? 0 : value;
}

/** Create a movement in the case's hand-entered log (no notification). */
export async function createMovement(
  input: CreateMovementInput,
): Promise<Movement> {
  if (getDataDriver() === "supabase") return createMovementSupabase(input);

  const study = await requireStudy();
  const session = await requireSession();

  // Same validation, same order as the supabase branch — every typed
  // failure fires before anything is written (mirrors the DB constraints).
  const { caseId, fecha, tipo, detalle } = validateMovementInput(input);
  if (
    !getStore().cases.some(
      (row) => row.id === caseId && row.studyId === study.id,
    )
  ) {
    throw new DataLayerError("save_failed"); // mirrors fk_movements_case
  }

  const movement: Movement = {
    id: `movement-${(fakeMovementSeq += 1)}`,
    studyId: study.id,
    caseId,
    fecha,
    tipo,
    detalle,
    pinned: false,
    createdBy: session.user.fullName,
    createdAt: isoNow(),
  };

  fakeMovements.push(movement);
  return movement;
}

/** Apply the narrow patch — the S09 pin toggle, nothing else. */
export async function updateMovement(
  id: string,
  patch: UpdateMovementPatch,
): Promise<Movement> {
  if (getDataDriver() === "supabase") return updateMovementSupabase(id, patch);

  // A PATCH with nothing to change is a client bug: fail before any I/O.
  if (patch.pinned === undefined) throw new DataLayerError("missing_fields");
  // The DB column is boolean; a cast-in junk value must not reach the store.
  if (typeof patch.pinned !== "boolean") throw new DataLayerError("save_failed");

  const study = await requireStudy();

  const movement = fakeMovements.find(
    (row) => row.id === id && row.studyId === study.id,
  );
  if (!movement) throw new DataLayerError("save_failed");

  movement.pinned = patch.pinned;
  return movement;
}

/**
 * Validation the supabase branch mirrors verbatim (a value import through
 * the facade would close a runtime import cycle): required fields first,
 * then the sane fecha window, then the vocabulary/length bounds the DB
 * enforces through its own constraints. Returned values are the trimmed ones.
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
  // Same 1900..2100 guard the pruebas pair uses (BUG-004 discipline): a
  // date column would reject absurd years anyway, but with a typed code.
  if (!isValidFechaEfectiva(fecha)) {
    throw new DataLayerError("invalid_fecha_efectiva");
  }
  if (!isMovementTipo(tipo)) throw new DataLayerError("save_failed");
  if (detalle.length > MOVEMENT_DETALLE_MAX) {
    throw new DataLayerError("save_failed");
  }
  return { caseId, fecha, tipo, detalle };
}
