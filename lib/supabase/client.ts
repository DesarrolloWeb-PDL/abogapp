/**
 * SSR browser client (`@supabase/ssr` createBrowserClient).
 *
 * Used by client components and the fake↔supabase data layer when the driver
 * is `supabase`. Holds the anon key only — RLS is the security boundary.
 *
 * Cookie notes (verified against @supabase/ssr 0.12.7 source):
 *  - the library writes session cookies with `httpOnly: false` on purpose:
 *    the browser client must read them to refresh tokens proactively, so a
 *    truly httpOnly session cookie is NOT possible with this library;
 *  - `sameSite=lax` always; `secure` only in production (localhost is plain
 *    http during development).
 *
 * Sign-out determinism (BUG-002): every /auth/v1/ call goes through
 * `authFetch`, which (1) counts requests already on the wire so
 * `startSignOut()` can drain them BEFORE the global revoke lands — they
 * still carry a valid token, so they answer 200 instead of racing the
 * revocation into `403 on /auth/v1/user` — and (2) while the revoke is in
 * flight, answers any NEW auth call locally with a synthetic 401 (no
 * request leaves the tab, so the console stays clean).
 */

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

/** Upper bound on how long sign-out waits for in-flight auth requests. */
const SIGN_OUT_DRAIN_TIMEOUT_MS = 5_000;

/** /auth/ requests currently open in this tab. */
let openAuthRequests = 0;
/** Resolvers registered by `startSignOut()` while requests are open. */
let idleWaiters: Array<() => void> = [];
/** True from the moment sign-out starts until the revoke has finished. */
let signOutInProgress = false;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** `/auth/v1/<path>` of the requested URL, or null when it is not auth. */
function authPath(input: RequestInfo | URL): string | null {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;
  const match = /\/auth\/v1\/[^?#]*/.exec(raw);
  return match ? match[0] : null;
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input !== "string" && !(input instanceof URL)) {
    return input.method.toUpperCase();
  }
  return "GET";
}

/**
 * The fetch installed as `global.fetch` on the browser client: transparent
 * for every non-auth URL; counts auth requests; gates them during sign-out.
 */
export const authFetch: FetchLike = async (input, init) => {
  const path = authPath(input);
  if (path === null) return fetch(input, init);

  // During the revoke the only auth call allowed onto the network is the
  // sign-out itself; everything else is answered locally (a synthetic 401
  // the auth lib turns into its typed "not signed in" error, with no
  // request — and therefore no console error — at all).
  if (signOutInProgress && !(path === "/auth/v1/logout" && methodOf(input, init) === "POST")) {
    return new Response(
      JSON.stringify({ code: "session_not_found", msg: "No active session" }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }

  openAuthRequests += 1;
  try {
    return await fetch(input, init);
  } finally {
    openAuthRequests -= 1;
    if (openAuthRequests === 0) {
      const waiters = idleWaiters;
      idleWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }
}

/**
 * BUG-002: first half of the deterministic sign-out. Gates NEW auth calls
 * (answered locally) and waits — bounded — for auth requests already in
 * flight to settle while their token is still valid. Always pair with
 * `endSignOut()` in a `finally`.
 */
export async function startSignOut(): Promise<void> {
  signOutInProgress = true;
  if (openAuthRequests === 0) return;
  await new Promise<void>((resolve) => {
    idleWaiters.push(resolve);
    const timer = setTimeout(resolve, SIGN_OUT_DRAIN_TIMEOUT_MS);
    // Tests (Node): a stale drain timer must not hold the process open.
    (timer as unknown as { unref?: () => void }).unref?.();
  });
}

/** Releases the sign-out gate (normal and failure paths alike). */
export function endSignOut(): void {
  signOutInProgress = false;
}

export function getBrowserClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example)",
    );
  }

  if (!browserClient) {
    browserClient = createBrowserClient(url, anonKey, {
      global: { fetch: authFetch },
      cookieOptions: {
        path: "/",
        sameSite: "lax",
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
      },
    });
  }
  return browserClient;
}
