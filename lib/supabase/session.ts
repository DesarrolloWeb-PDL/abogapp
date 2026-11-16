/**
 * Session refresh + optimistic redirects for `proxy.ts` (Next 16's
 * middleware — see node_modules/next/dist/docs/01-app/01-getting-started/
 * 16-proxy.md).
 *
 * Contract (Supabase SSR): build the server client from the REQUEST cookies,
 * call `getUser()` before any response is produced (so a token refresh can
 * still write Set-Cookie), then always return the response that carries those
 * cookies. Redirects here are optimistic only — every API route re-checks
 * the session against its own data.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // Fake driver (no keys): the demo relies on the client-side guard only.
  if (!url || !anonKey) return supabaseResponse;

  const supabase = createServerClient(url, anonKey, {
    cookieOptions: {
      path: "/",
      sameSite: "lax",
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // Do not run code between createServerClient and getUser: the refresh
  // writes its cookies onto `supabaseResponse` while headers are still open.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isApi = path.startsWith("/api");
  const isAuthPage = path === "/login" || path === "/signup";
  // API routes are skipped on purpose: a fetch must get a 401/503 JSON
  // answer, never an HTML redirect. Each route enforces its own session.
  const isPublic = path === "/" || isAuthPage || isApi;

  if (!user && !isPublic) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.search = "";
    return NextResponse.redirect(redirect);
  }

  if (user && isAuthPage) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/expedientes";
    redirect.search = "";
    return NextResponse.redirect(redirect);
  }

  return supabaseResponse;
}
