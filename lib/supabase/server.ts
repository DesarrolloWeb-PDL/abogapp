/**
 * SSR server client (`@supabase/ssr` createServerClient) for route handlers
 * and server components. Next 16: `cookies()` is async (await it).
 *
 * `setAll` writes are attempted through the cookie store and swallowed when
 * called from a Server Component (setting cookies there is not allowed);
 * `proxy.ts` is the session-refresh point, per the Supabase SSR contract —
 * a missing `setAll` would cause silent logouts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example)",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookieOptions: {
      path: "/",
      sameSite: "lax",
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Component call: ignored on purpose — proxy.ts refreshes
          // the session before any page renders (see lib/supabase/session.ts).
        }
      },
    },
  });
}
