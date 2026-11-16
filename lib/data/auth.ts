/**
 * Auth functions — the driver switch facade.
 *
 * Signatures here are the contract every screen already imports (S01/S02 +
 * wizard); the implementation dispatches per `getDataDriver()`:
 *  - `fake`    → `auth-fake.ts` (in-memory demo, no keys required);
 *  - `supabase`→ `auth-supabase.ts` (Supabase Auth via the SSR browser client,
 *    session cookies managed by @supabase/ssr — see lib/supabase/client.ts
 *    for the httpOnly caveat).
 *
 * Shared validation runs BEFORE either driver, so a malformed input never
 * reaches Supabase Auth (and the rules stay identical in both modes).
 */

import { signInFake, signUpFake, getSessionFake, signOutFake, updateProfileFake, parseDemoSessionCookie } from "./auth-fake";
import {
  getSessionSupabase,
  signInSupabase,
  signOutSupabase,
  signUpSupabase,
  updateProfileSupabase,
} from "./auth-supabase";
import { getDataDriver } from "./driver";
import { DataLayerError, type DataErrorCode } from "./errors";
import type { User } from "@/lib/types";

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

/** First sign-up rule the input breaks, or null when it is acceptable. */
export function validateSignUp(input: SignUpInput): DataErrorCode | null {
  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();

  if (!fullName || !email || !input.password) return "missing_fields";
  if (!EMAIL_PATTERN.test(email)) return "invalid_email";
  if (input.password.length < MIN_PASSWORD_LENGTH) return "weak_password";
  return null;
}

/** First sign-in rule the input breaks, or null when it is acceptable. */
export function validateSignIn(input: SignInInput): DataErrorCode | null {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password) return "missing_fields";
  return null;
}

export async function signUp(input: SignUpInput): Promise<AuthOutcome> {
  const invalid = validateSignUp(input);
  if (invalid) return { ok: false, error: invalid };
  return getDataDriver() === "supabase"
    ? signUpSupabase(input)
    : signUpFake(input);
}

export async function signIn(input: SignInInput): Promise<AuthOutcome> {
  const invalid = validateSignIn(input);
  if (invalid) return { ok: false, error: invalid };
  return getDataDriver() === "supabase"
    ? signInSupabase(input)
    : signInFake(input);
}

export async function signOut(): Promise<void> {
  if (getDataDriver() === "supabase") {
    await signOutSupabase();
    return;
  }
  await signOutFake();
}

/**
 * Read the current session.
 * Browser: the active driver's client (localStorage demo / Supabase cookies).
 * Server: the fake driver falls back to its in-process store; the Supabase
 * driver answers null on purpose — SERVER session reads belong to
 * `lib/supabase/server` (routes and proxy), never to this browser-facing API.
 */
export async function getSession(): Promise<Session | null> {
  return getDataDriver() === "supabase"
    ? getSessionSupabase()
    : getSessionFake();
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

  return getDataDriver() === "supabase"
    ? updateProfileSupabase({ fullName, email })
    : updateProfileFake({ fullName, email });
}

/** Current session or a typed failure — shared by every study/case call. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new DataLayerError("not_signed_in");
  return session;
}

// The demo-cookie parser is fake-driver plumbing, re-exported here so route
// handlers keep a single import surface (`@/lib/data`).
export { parseDemoSessionCookie };
