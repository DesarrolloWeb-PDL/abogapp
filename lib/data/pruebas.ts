/**
 * Prueba + plazo functions — POST /api/cases/:id/pruebas in miniature.
 *
 * The fecha límite is ALWAYS produced by `computeFechaLimite` from
 * `lib/plazos` (the TS mirror of the DB trigger). This module must never
 * re-implement date math: it only feeds the engine and stores what it
 * returns, exactly as the production trigger will.
 */

import { computeFechaLimite } from "@/lib/plazos";
import type { Plazo, PlazoTipo, Prueba, PruebaTipo } from "@/lib/types";
import { requireSession } from "./auth";
import { nonWorkingDays, toArtIsoDate } from "./calendar";
import { DataLayerError } from "./errors";
import { insertNotification } from "./notifications";
import { getStore, nextId } from "./store";
import { requireStudy } from "./studies";

export interface CreatePruebaInput {
  caseId: string;
  tipo: PruebaTipo;
  titulo: string;
  informante: string;
  /** `YYYY-MM-DD` — the count starts the day after this date. */
  fechaEfectiva: string;
  /** Optional plazo group; without it the prueba carries no deadline. */
  plazo?: { tipo: PlazoTipo; cantidad: number };
}

/** Pruebas of one case (or all of them), insertion order. */
export async function listPruebas(caseId?: string): Promise<Prueba[]> {
  const store = getStore();
  return store.pruebas.filter((entry) => !caseId || entry.caseId === caseId);
}

/** Create a prueba and, when a plazo is given, its deadline + alert (S12). */
export async function createPrueba(input: CreatePruebaInput): Promise<Prueba> {
  const study = await requireStudy();
  const session = await requireSession();

  const titulo = input.titulo.trim();
  const informante = input.informante.trim();
  if (!titulo || !informante || !input.fechaEfectiva || !input.caseId) {
    throw new DataLayerError("missing_fields");
  }

  const pruebaId = nextId("prueba");
  const plazos: Plazo[] = [];

  if (input.plazo) {
    // The engine owns the computation (throws on out-of-bound quantities).
    let fechaLimite: string;
    try {
      fechaLimite = toArtIsoDate(
        computeFechaLimite({
          fechaEfectiva: input.fechaEfectiva,
          tipo: input.plazo.tipo,
          cantidad: input.plazo.cantidad,
          nonWorkingDays,
        }),
      );
    } catch {
      throw new DataLayerError("invalid_plazo");
    }

    plazos.push({
      id: nextId("plazo"),
      studyId: study.id,
      caseId: input.caseId,
      pruebaId,
      tipo: input.plazo.tipo,
      cantidad: input.plazo.cantidad,
      fechaEfectiva: input.fechaEfectiva,
      fechaLimite,
    });
  }

  const prueba: Prueba = {
    id: pruebaId,
    studyId: study.id,
    caseId: input.caseId,
    tipo: input.tipo,
    titulo,
    informante,
    estado: "Ofrecida",
    fechaEfectiva: input.fechaEfectiva,
    plazos,
  };

  getStore().pruebas.push(prueba);

  const plazo = plazos[0];
  if (plazo?.fechaLimite) {
    insertNotification({
      studyId: study.id,
      userId: session.user.id,
      titulo: `Vence el ${formatDate(plazo.fechaLimite)}`,
      detalle: `El plazo de «${prueba.titulo}» (${plazoLabel(
        plazo.tipo,
        plazo.cantidad,
      )}) vence el ${formatDate(plazo.fechaLimite)}.`,
      categoria: "Plazos",
      enlace: `/expedientes/${prueba.caseId}?tab=pruebas`,
    });
  }

  return prueba;
}

/** `YYYY-MM-DD` → `dd/mm/yyyy` for notification copy. */
function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) return isoDate;
  return `${day}/${month}/${year}`;
}

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
