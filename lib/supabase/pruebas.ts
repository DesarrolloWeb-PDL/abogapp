/**
 * Prueba + plazo functions for the `supabase` driver — browser-safe (anon
 * key + `pruebas_member` / `plazos_member` RLS).
 *
 * Spec S5 seam: the fecha límite is NEVER computed or written here. The
 * `trg_plazos_compute` trigger in replica/schema.sql recomputes it from the
 * inputs on insert, and this branch only reads back what the database
 * returns (the fake branch runs lib/plazos instead — same result, no screen
 * changes).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Plazo, PlazoTipo, Prueba, PruebaTipo } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { DataLayerError } from "@/lib/data/errors";
import type { CreatePruebaInput } from "@/lib/data/pruebas";
import { emitNotification } from "@/lib/data/notifications";
import { toArtIsoDate } from "@/lib/data/calendar";
import { requireStudy } from "@/lib/data/studies";
import { insertNotificationSupabase } from "./notifications";
import { getBrowserClient } from "./client";

/** Parent columns + the embedded plazos (fecha_limite is the trigger's). */
const PRUEBA_COLUMNS =
  "id, study_id, case_id, type, titulo, estado, fecha_efectiva, parte, " +
  "informante:informante_person_id(nombre), " +
  "plazos(id, study_id, case_id, prueba_id, tipo, cantidad, fecha_efectiva, fecha_limite)";

const PLAZO_COLUMNS =
  "id, study_id, case_id, prueba_id, tipo, cantidad, fecha_efectiva, fecha_limite";

interface PlazoRow {
  id: string;
  study_id: string;
  case_id: string;
  prueba_id: string | null;
  tipo: string;
  cantidad: number;
  fecha_efectiva: string;
  /** timestamptz written by the DB trigger; null while not computed. */
  fecha_limite: string | null;
}

interface PruebaRow {
  id: string;
  study_id: string;
  case_id: string;
  type: string;
  titulo: string;
  estado: string;
  fecha_efectiva: string;
  parte: string | null;
  informante: { nombre: string } | null;
  plazos: PlazoRow[];
}

const PRUEBA_TIPOS: readonly string[] = [
  "Documental",
  "Informativa",
  "Confesional",
  "Testimonial",
  "Pericial",
  "Otras",
];

/** Pruebas of one case (or all of them), insertion order (created_at asc). */
export async function listPruebasSupabase(
  caseId?: string,
): Promise<Prueba[]> {
  const supabase = getBrowserClient();

  let query = supabase.from("pruebas").select(PRUEBA_COLUMNS);
  if (caseId) query = query.eq("case_id", caseId);
  const { data, error } = await query.order("created_at", { ascending: true });
  if (error || !data) throw new DataLayerError("save_failed");

  return (data as unknown as PruebaRow[]).map(mapPrueba);
}

/** Create a prueba and, when a plazo is given, its DB-computed deadline + alert. */
export async function createPruebaSupabase(
  input: CreatePruebaInput,
): Promise<Prueba> {
  const study = await requireStudy();
  const supabase = getBrowserClient();
  const user = await requireUser(supabase);

  // Same validation, same order as the fake branch — nothing reaches the
  // network before the typed failure the screens map through errorCopy().
  const titulo = input.titulo.trim();
  const informante = input.informante.trim();
  if (!titulo || !informante || !input.fechaEfectiva || !input.caseId) {
    throw new DataLayerError("missing_fields");
  }
  // Bounds mirror computeFechaLimite's guard (1..5000, known unit) WITHOUT
  // computing any date: the trigger is the only engine in this driver.
  if (input.plazo && !isValidPlazo(input.plazo)) {
    throw new DataLayerError("invalid_plazo");
  }

  // `estado` is not sent: the DB default ('proveida') owns the first state,
  // exactly as the documented POST /api/cases/:id/pruebas payload does.
  // TODO(schema gap): pruebas has no free-text informante column
  // (informante_person_id → persons is the M2 picker); the M1 string goes
  // into `parte` and reads back through the person embed when one is linked.
  const { data: row, error } = await supabase
    .from("pruebas")
    .insert({
      study_id: study.id,
      case_id: input.caseId,
      type: input.tipo.toLowerCase(),
      titulo,
      parte: informante,
      fecha_efectiva: input.fechaEfectiva,
      created_by: user.id,
    })
    .select(PRUEBA_COLUMNS)
    .single();
  if (error || !row) throw new DataLayerError("save_failed");
  // The type-level select parser cannot resolve embeds without generated
  // database types, so the row arrives loosely typed — retype it once.
  const inserted = row as unknown as PruebaRow;

  const plazos: Plazo[] = [];
  if (input.plazo) {
    // concepto is NOT NULL in plazos and has no app-side field: the prueba
    // title labels the deadline until the API exposes its own concepto.
    const { data: plazoRow, error: plazoError } = await supabase
      .from("plazos")
      .insert({
        study_id: study.id,
        case_id: input.caseId,
        prueba_id: inserted.id,
        concepto: titulo,
        tipo: input.plazo.tipo,
        cantidad: input.plazo.cantidad,
        fecha_efectiva: input.fechaEfectiva,
        source: "prueba",
        created_by: user.id,
      })
      .select(PLAZO_COLUMNS)
      .single();
    if (plazoError || !plazoRow) {
      // The trigger raises for out-of-bound inputs the same way the TS
      // engine does; anything else is a real write failure.
      throw plazoError && isEngineFailure(plazoError.message)
        ? new DataLayerError("invalid_plazo")
        : new DataLayerError("save_failed");
    }
    // Read back untouched: whatever compute_fecha_limite returned.
    plazos.push(mapPlazo(plazoRow as unknown as PlazoRow));
  }

  const prueba: Prueba = {
    ...mapPrueba(inserted),
    // The embed above was read before the plazo row existed.
    plazos,
  };

  const plazo = plazos[0];
  if (plazo?.fechaLimite) {
    // No DB trigger emits this alert — the app writes it, mirroring the fake
    // layer's insertNotification copy verbatim so both drivers read alike.
    const notification = await insertNotificationSupabase({
      studyId: study.id,
      userId: user.id,
      titulo: `Vence el ${formatDate(plazo.fechaLimite)}`,
      detalle: `El plazo de «${prueba.titulo}» (${plazoLabel(
        plazo.tipo,
        plazo.cantidad,
      )}) vence el ${formatDate(plazo.fechaLimite)}.`,
      categoria: "Plazos",
      enlace: `/expedientes/${prueba.caseId}?tab=pruebas`,
      dedupeKey: `prueba:${prueba.id}`,
    });
    // Same local seam the fake layer fires: the badge re-reads unreadCount().
    emitNotification(notification);
  }

  return prueba;
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

/** Bounds of the engine's guard, without ever computing a deadline. */
function isValidPlazo(plazo: { tipo: PlazoTipo; cantidad: number }): boolean {
  const tipos: PlazoTipo[] = ["horas", "corridos", "habiles"];
  return (
    tipos.includes(plazo.tipo) &&
    Number.isInteger(plazo.cantidad) &&
    plazo.cantidad >= 1 &&
    plazo.cantidad <= 5000
  );
}

/** Signatures of compute_fecha_limite() failures (see schema.sql). */
function isEngineFailure(message: string): boolean {
  return (
    message.includes("invalid plazo quantity") ||
    message.includes("unknown plazo type") ||
    message.includes("plazo exceeds")
  );
}

function mapPrueba(row: PruebaRow): Prueba {
  return {
    id: row.id,
    studyId: row.study_id,
    caseId: row.case_id,
    tipo: mapTipo(row.type),
    titulo: row.titulo,
    // Person name wins when the M2 picker linked one; `parte` carries the
    // M1 free-text informante (see the schema-gap TODO above).
    informante: row.informante?.nombre ?? row.parte ?? "",
    estado: capitalize(row.estado),
    fechaEfectiva: row.fecha_efectiva,
    plazos: (row.plazos ?? []).map(mapPlazo),
  };
}

function mapPlazo(row: PlazoRow): Plazo {
  return {
    id: row.id,
    studyId: row.study_id,
    caseId: row.case_id,
    pruebaId: row.prueba_id ?? "",
    tipo: row.tipo as PlazoTipo,
    cantidad: row.cantidad,
    fechaEfectiva: row.fecha_efectiva,
    // timestamptz (UTC) → the ART calendar day the deadline belongs to.
    fechaLimite: row.fecha_limite
      ? toArtIsoDate(new Date(row.fecha_limite))
      : null,
  };
}

function mapTipo(value: string): PruebaTipo {
  const mapped = capitalize(value);
  return PRUEBA_TIPOS.includes(mapped) ? (mapped as PruebaTipo) : "Otras";
}

/** `proveida` → `Proveida`, the casing the screens render (S12 chips). */
function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Plazo quantity in Spanish, mirroring lib/data/pruebas.ts (fake copy). */
function plazoLabel(tipo: PlazoTipo, cantidad: number): string {
  const singular: Record<PlazoTipo, string> = {
    horas: "hora",
    corridos: "día corrido",
    habiles: "día hábil",
  };
  const plural: Record<PlazoTipo, string> = {
    horas: "horas",
    corridos: "días corridos",
    habiles: "días hábiles",
  };
  return `${cantidad} ${cantidad === 1 ? singular[tipo] : plural[tipo]}`;
}
