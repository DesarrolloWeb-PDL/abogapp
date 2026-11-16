/**
 * Next 16 proxy (the middleware convention was renamed — see
 * node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md).
 *
 * Session refresh for Supabase Auth + optimistic redirects. Optimistic only:
 * every API route re-checks the session itself (proxy is not the sole
 * authorization layer — see replica/backend.md, security checklist).
 */

import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";

export default async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match every route except static assets. API routes are visited by the
     * refresh logic but never redirected (they answer 401/503 as JSON).
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
