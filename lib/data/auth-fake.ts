/**
 * Fake auth driver (M1 demo) — accounts live in the in-memory store and the
 * session is a JSON blob in localStorage under `lib/auth-stub`'s key.
 *
 * The same session is mirrored into a demo cookie on sign-in so SERVER code
 * (the conversations route gate) can see it: localStorage is browser-only,
 * the route handler never runs there. The cookie is demo-grade on purpose —
 * it carries no credential, only the fake profile the store already knows.
 *
 * Real authentication lives in `auth-supabase.ts`; `auth.ts` dispatches.
 */

import { AUTH_STORAGE_KEY } from "@/lib/auth-stub";
import type { User } from "@/lib/types";
import type {
  AuthOutcome,
  ProfileOutcome,
  Session,
  SignInInput,
  SignUpInput,
} from "./auth";
import { getStore, isoNow, nextId } from "./store";

/** Deliberately loose format check — Supabase enforces the real rules later. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MIN_PASSWORD_LENGTH = 8;

/** Demo cookie lifetime; matches the fake layer's "session survives reloads". */
const DEMO_COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

export async function signUpFake(input: SignUpInput): Promise<AuthOutcome> {
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

export async function signInFake(input: SignInInput): Promise<AuthOutcome> {
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

export async function signOutFake(): Promise<void> {
  const store = getStore();
  store.session = null;
  persistSession(null);
}

/**
 * Read the current session. localStorage is the source of truth in the
 * browser (the same blob is mirrored into the demo cookie so route handlers
 * can gate on it); the store field is the fallback under Node (tests,
 * SSR-free data layer).
 */
export async function getSessionFake(): Promise<Session | null> {
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
export async function updateProfileFake(input: {
  fullName: string;
  email: string;
}): Promise<ProfileOutcome> {
  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();

  if (!fullName || !email) return { ok: false, error: "missing_fields" };
  if (!EMAIL_PATTERN.test(email)) return { ok: false, error: "invalid_email" };

  const session = await getSessionFake();
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

/**
 * Parse the demo session cookie written by `persistSession`. Pure: the route
 * handler reads the cookie off the request and hands the raw value here —
 * no `next/headers` import, so this module stays client-bundle safe.
 */
export function parseDemoSessionCookie(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Session;
    return parsed && parsed.user && parsed.user.id ? parsed : null;
  } catch {
    return null;
  }
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
    document.cookie = [
      `${AUTH_STORAGE_KEY}=${encodeURIComponent(JSON.stringify(session))}`,
      "path=/",
      `max-age=${DEMO_COOKIE_MAX_AGE}`,
      "samesite=lax",
    ].join("; ");
  } else {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    document.cookie = `${AUTH_STORAGE_KEY}=; path=/; max-age=0; samesite=lax`;
  }
}
