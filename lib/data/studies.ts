/**
 * Study (studio) functions — POST /api/studies and GET /api/studies/me in
 * miniature. Creating a study also writes the owner's membership, mirroring
 * `init_study_defaults()` from replica/architecture.md.
 */

import type { Study } from "@/lib/types";
import { getSession, requireSession } from "./auth";
import { DataLayerError } from "./errors";
import { getStore, isoNow, nextId } from "./store";

export interface CreateStudyInput {
  name: string;
  jurisdictions: string[];
}

/** Wizard step 3: create the studio and membership for the signed-in user. */
export async function createStudy(input: CreateStudyInput): Promise<Study> {
  const session = await requireSession();
  const store = getStore();

  const name = input.name.trim() || "Mi estudio";
  const study: Study = {
    id: nextId("study"),
    name,
    plan: "prueba",
    jurisdictions: input.jurisdictions.map((item) => item.trim()).filter(Boolean),
    createdAt: isoNow(),
  };

  store.studies.push(study);
  store.memberships.push({ userId: session.user.id, studyId: study.id });

  return study;
}

/**
 * The study the signed-in user belongs to (last membership wins), or null
 * when onboarding has not finished yet.
 */
export async function getMyStudy(): Promise<Study | null> {
  const session = await getSession();
  if (!session) return null;

  const store = getStore();
  const memberships = store.memberships.filter(
    (entry) => entry.userId === session.user.id,
  );
  const latest = memberships[memberships.length - 1];
  if (!latest) return null;

  return store.studies.find((entry) => entry.id === latest.studyId) ?? null;
}

/**
 * Membership guard for case/prueba writes. Throws typed codes instead of
 * returning null so screens map a single Spanish message.
 */
export async function requireStudy(): Promise<Study> {
  const study = await getMyStudy();
  if (!study) throw new DataLayerError("no_study");
  return study;
}
