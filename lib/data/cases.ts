/**
 * Case functions — GET/POST /api/cases and GET /api/cases/:id in miniature.
 * The future layer keeps these signatures and swaps the store for Drizzle.
 */

import type { StudyCase } from "@/lib/types";
import { requireSession } from "./auth";
import { DataLayerError } from "./errors";
import { getStore, isoNow, nextId } from "./store";
import { requireStudy } from "./studies";

export interface CreateCaseInput {
  caratula: string;
  numero?: string;
  fuero?: string;
  jurisdiccion?: string;
  juzgado?: string;
  etapa?: string;
  tipo?: StudyCase["tipo"];
  responsable?: string;
}

/** Non-archived cases of the current study, newest activity first (S07). */
export async function listCases(): Promise<StudyCase[]> {
  const session = await requireSession();
  const store = getStore();

  const memberships = store.memberships.filter(
    (entry) => entry.userId === session.user.id,
  );
  const latest = memberships[memberships.length - 1];
  if (!latest) return []; // onboarding not finished: honest empty list

  return store.cases
    .filter(
      (entry) => entry.studyId === latest.studyId && entry.archived === false,
    )
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

/**
 * One case by id. No tenancy check in the fake layer (ids are unguessable
 * enough for the demo); RLS will scope this query in the real one.
 */
export async function getCase(id: string): Promise<StudyCase | null> {
  return getStore().cases.find((entry) => entry.id === id) ?? null;
}

/** Manual case creation (S07 / M1 slice entry point). */
export async function createCase(input: CreateCaseInput): Promise<StudyCase> {
  const study = await requireStudy();
  const session = await requireSession();

  const caratula = input.caratula.trim();
  if (!caratula) throw new DataLayerError("missing_fields");

  const now = isoNow();
  const record: StudyCase = {
    id: nextId("case"),
    studyId: study.id,
    caratula,
    numero: input.numero?.trim() ?? "",
    fuero: input.fuero?.trim() ?? "",
    jurisdiccion: input.jurisdiccion?.trim() ?? "",
    juzgado: input.juzgado?.trim() ?? "",
    etapa: input.etapa?.trim() || "Inicial",
    tipo: input.tipo ?? "Judicial",
    responsable: input.responsable?.trim() || session.user.fullName,
    favorite: false,
    archived: false,
    createdAt: now,
    lastActivityAt: now,
  };

  getStore().cases.push(record);
  return record;
}
