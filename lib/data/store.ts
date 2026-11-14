/**
 * In-memory data store for the M1 slice (T3b).
 *
 * One module-level singleton, rebuilt from `lib/seed.ts` on first use. The
 * future Supabase/Drizzle layer replaces the functions in `lib/data/*` but
 * keeps their signatures, so no screen imports this file directly — only the
 * data-layer modules do (plus tests, via `resetDataStore`).
 *
 * Persistence model (deliberately small):
 *  - the store itself is in-memory: a full page reload re-seeds it;
 *  - the session lives in localStorage under the same key the auth guard
 *    reads (`lib/auth-stub`), so sign-in survives reloads.
 */

import {
  seedCases,
  seedDemoPassword,
  seedNotifications,
  seedPruebas,
  seedStudy,
  seedUser,
  seedWaConversations,
  seedWaMessages,
} from "@/lib/seed";
import type {
  AppNotification,
  Prueba,
  Study,
  StudyCase,
  User,
  WaConversation,
  WaMessage,
} from "@/lib/types";
import type { Session } from "./auth";

export interface StoredUser {
  user: User;
  /** Plaintext on purpose: this is a fake layer, never a real credential. */
  password: string;
}

export interface Membership {
  userId: string;
  studyId: string;
}

export interface DataStore {
  users: StoredUser[];
  memberships: Membership[];
  studies: Study[];
  cases: StudyCase[];
  pruebas: Prueba[];
  notifications: AppNotification[];
  waConversations: WaConversation[];
  waMessages: WaMessage[];
  /** Per-prefix id counters seeded from the seed data (`case-3` → next 4). */
  counters: Record<string, number>;
  /** Node-side session fallback; browsers use localStorage (see auth.ts). */
  session: Session | null;
}

type SeedShape = Omit<DataStore, "counters" | "session">;

function buildStore(): DataStore {
  const seed: SeedShape = {
    users: [{ user: seedUser, password: seedDemoPassword }],
    memberships: [{ userId: seedUser.id, studyId: seedStudy.id }],
    studies: [seedStudy],
    cases: [...seedCases],
    pruebas: [...seedPruebas],
    notifications: [...seedNotifications],
    waConversations: [...seedWaConversations],
    waMessages: [...seedWaMessages],
  };

  return { ...seed, counters: collectCounters(seed), session: null };
}

function collectCounters(seed: SeedShape): Record<string, number> {
  const ids = [
    ...seed.users.map((entry) => entry.user.id),
    ...seed.studies.map((entry) => entry.id),
    ...seed.cases.map((entry) => entry.id),
    ...seed.pruebas.flatMap((entry) => [
      entry.id,
      ...entry.plazos.map((plazo) => plazo.id),
    ]),
    ...seed.notifications.map((entry) => entry.id),
    ...seed.waConversations.map((entry) => entry.id),
    ...seed.waMessages.map((entry) => entry.id),
  ];

  const counters: Record<string, number> = {};
  for (const id of ids) {
    const match = /^(.+)-(\d+)$/.exec(id);
    if (!match) continue;
    const prefix = match[1] as string;
    const value = Number(match[2]);
    counters[prefix] = Math.max(counters[prefix] ?? 0, value);
  }
  return counters;
}

let store: DataStore = buildStore();

export function getStore(): DataStore {
  return store;
}

/** Next id in the seed's `{prefix}-{n}` convention (`case-4`, `prueba-4`). */
export function nextId(prefix: string): string {
  const next = (store.counters[prefix] ?? 0) + 1;
  store.counters[prefix] = next;
  return `${prefix}-${next}`;
}

/** Rebuild the store from the seed — test isolation and demo reset. */
export function resetDataStore(): void {
  store = buildStore();
}

/** Current instant as a full ISO timestamp (createdAt/lastActivityAt…). */
export function isoNow(): string {
  return new Date().toISOString();
}
