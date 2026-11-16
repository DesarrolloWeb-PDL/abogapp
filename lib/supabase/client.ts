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
 */

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

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
