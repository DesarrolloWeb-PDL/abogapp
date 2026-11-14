/**
 * Auth functions for the fake data layer (T3b).
 *
 * NOT real authentication: accounts live in the in-memory store and the
 * session is a signed-off JSON blob in localStorage under the same key the
 * auth guard already reads (`lib/auth-stub`). Signatures mirror what the
 * Supabase Auth swap will expose, so screens never change.
 */

import { AUTH_STORAGE_KEY } from "@/lib/auth-stub";
import type { User } from "@/lib/types";
import { DataLayerError, type DataErrorCode } from "./errors";
import { getStore, isoNow, nextId } from "./store";

export interface Session {
  user: User;
  startedAt: string;
}

export interface SignUpInput {
  fullName: string;
  email: string;
  password: string;
}

export interface SignInInput {
  email: string;
  password: string;
}

export type AuthOutcome =
  | { ok: true; session: Session }
  | { ok: false; error: DataErrorCode };

export type ProfileOutcome =
  | { ok: true; user: User }
  | { ok: false; error: DataErrorCode };

/** Deliberately loose format check — Supabase enforces the real rules later. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MIN_PASSWORD_LENGTH = 8;

export async function signUp(input: SignUpInput): Promise<AuthOutcome> {
  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();

  if (!fullName || !email || !input.password) {
    return { ok: false, error: "missing_fields" };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "invalid_email" };
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: "weak_password" };
  }

  const store = getStore();
  const taken = store.users.some(
    (entry) => entry.user.email.toLowerCase() === email,
  );
  if (taken) return { ok: false, error: "email_taken" };

  const user: User = { id: nextId("user"), fullName, email };
  store.users.push({ user, password: input.password });

  return { ok: true, session: openSession(user) };
}

export async function signIn(input: SignInInput): Promise<AuthOutcome> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password) return { ok: false, error: "missing_fields" };

  const store = getStore();
  const record = store.users.find(
    (entry) => entry.user.email.toLowerCase() === email,
  );
  if (!record || record.password !== input.password) {
    return { ok: false, error: "invalid_credentials" };
  }

  return { ok: true, session: openSession(record.user) };
}

export async function signOut(): Promise<void> {
  const store = getStore();
  store.session = null;
  persistSession(null);
}

/**
 * Read the current session. localStorage is the source of truth in the
 * browser (so the guard's `endDemoSession()` clears it too); the store field
 * is the fallback under Node (tests, SSR-free data layer).
 */
export async function getSession(): Promise<Session | null> {
  if (typeof window !== "undefined") {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Session;
      return parsed && parsed.user ? parsed : null;
    } catch {
      return null;
    }
  }
  return getStore().session;
}

/** Wizard step 2: keep the signed-in profile in sync with what the user typed. */
export async function updateProfile(input: {
  fullName: string;
  email: string;
}): Promise<ProfileOutcome> {
  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();

  if (!fullName || !email) return { ok: false, error: "missing_fields" };
  if (!EMAIL_PATTERN.test(email)) return { ok: false, error: "invalid_email" };

  const session = await getSession();
  if (!session) return { ok: false, error: "not_signed_in" };

  const store = getStore();
  const duplicate = store.users.some(
    (entry) =>
      entry.user.id !== session.user.id &&
      entry.user.email.toLowerCase() === email,
  );
  if (duplicate) return { ok: false, error: "email_taken" };

  const updated: User = { ...session.user, fullName, email };
  const record = store.users.find((entry) => entry.user.id === session.user.id);
  if (record) record.user = updated;

  const nextSession: Session = { ...session, user: updated };
  store.session = nextSession;
  persistSession(nextSession);

  return { ok: true, user: updated };
}

/** Current session or a typed failure — shared by every study/case call. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new DataLayerError("not_signed_in");
  return session;
}

function openSession(user: User): Session {
  const session: Session = { user, startedAt: isoNow() };
  const store = getStore();
  store.session = session;
  persistSession(session);
  return session;
}

function persistSession(session: Session | null): void {
  if (typeof window === "undefined") return;
  if (session) {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  } else {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  }
}
