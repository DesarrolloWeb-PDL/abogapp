/**
 * Supabase Auth driver — email/password with verification, session stored in
 * cookies by `@supabase/ssr`.
 *
 * Runs in the BROWSER through the SSR browser client (`lib/supabase/client`),
 * which reads/writes the session cookies the proxy refreshes server-side.
 * Server session reads never come through here: routes and `proxy.ts` build
 * their own client from `lib/supabase/server` (importing `next/headers` in
 * this module would drag server code into the client bundle).
 */

import type { AuthError, User } from "@supabase/supabase-js";
import { getBrowserClient } from "@/lib/supabase/client";
import type {
  AuthOutcome,
  ProfileOutcome,
  Session,
  SignInInput,
  SignUpInput,
} from "./auth";
import type { DataErrorCode } from "./errors";

export async function signUpSupabase(input: SignUpInput): Promise<AuthOutcome> {
  const supabase = getBrowserClient();
  const email = input.email.trim().toLowerCase();

  const { data, error } = await supabase.auth.signUp({
    email,
    password: input.password,
    options: { data: { full_name: input.fullName.trim() } },
  });

  if (error) return { ok: false, error: mapAuthErrorCode(error) };
  // Email verification on: Supabase creates the account but withholds the
  // session until the confirmation link is clicked.
  if (!data.session || !data.user) return { ok: false, error: "confirmation_pending" };
  return { ok: true, session: toSession(data.user) };
}

export async function signInSupabase(input: SignInInput): Promise<AuthOutcome> {
  const supabase = getBrowserClient();
  const email = input.email.trim().toLowerCase();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: input.password,
  });

  if (error) return { ok: false, error: mapAuthErrorCode(error) };
  if (!data.user) return { ok: false, error: "invalid_credentials" };
  return { ok: true, session: toSession(data.user) };
}

export async function signOutSupabase(): Promise<void> {
  // Local session state is cleared even if the network call fails — a stale
  // cookie must never survive a user-initiated sign-out.
  try {
    await getBrowserClient().auth.signOut();
  } catch {
    // Best effort: the proxy re-validates on the next request anyway.
  }
}

export async function getSessionSupabase(): Promise<Session | null> {
  if (typeof window === "undefined") return null;

  const supabase = getBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return null;
  return toSession(session.user);
}

export async function updateProfileSupabase(input: {
  fullName: string;
  email: string;
}): Promise<ProfileOutcome> {
  const supabase = getBrowserClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not_signed_in" };

  // Display name lives in the auth user metadata (what the shell renders).
  const { error } = await supabase.auth.updateUser({
    data: { full_name: input.fullName },
  });
  if (error) return { ok: false, error: mapAuthErrorCode(error) };

  // Keep the profiles row (created by the on_auth_user_created trigger) in
  // sync — invite matching (M2) reads profiles.email. Changing the auth
  // email itself needs a re-confirmation flow and stays M2 (features.csv).
  const { error: profileError } = await supabase
    .from("profiles")
    .upsert(
      { id: user.id, email: input.email, full_name: input.fullName },
      { onConflict: "id" },
    );
  if (profileError) return { ok: false, error: "save_failed" };

  const updated = { id: user.id, fullName: input.fullName, email: input.email };
  return { ok: true, user: updated };
}

/** Map Supabase Auth failures onto the data layer's typed codes. */
function mapAuthErrorCode(error: AuthError | { message: string }): DataErrorCode {
  const message = error.message.toLowerCase();
  if (message.includes("already registered") || message.includes("already been registered")) {
    return "email_taken";
  }
  if (message.includes("invalid login credentials")) return "invalid_credentials";
  if (message.includes("email not confirmed")) return "email_not_confirmed";
  if (
    message.includes("rate limit") ||
    message.includes("too many") ||
    message.includes("security purposes")
  ) {
    return "too_many_requests";
  }
  if (message.includes("password")) return "weak_password";
  return "save_failed";
}

function toSession(user: User): Session {
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fullName =
    typeof metadata.full_name === "string" && metadata.full_name.trim()
      ? metadata.full_name.trim()
      : (user.email ?? "");

  return {
    user: { id: user.id, fullName, email: user.email ?? "" },
    startedAt: new Date().toISOString(),
  };
}
