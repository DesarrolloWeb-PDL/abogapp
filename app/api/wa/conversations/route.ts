import type { NextRequest } from "next/server";
import { AUTH_STORAGE_KEY } from "@/lib/auth-stub";
import { getSession, listConversations, parseDemoSessionCookie } from "@/lib/data";
import { getDataDriver } from "@/lib/data/driver";
import { listConversationsSupabase } from "@/lib/supabase/inbox";
import { createClient } from "@/lib/supabase/server";

/**
 * WhatsApp inbox list (Module A) — `GET /api/wa/conversations`.
 *
 * The inbox reads through this route instead of the client-side store: the
 * webhook writes on the server, so this is the only place where a fresh
 * inbound conversation is visible to the browser.
 *
 * Session gate (both drivers): 401 without a valid session.
 *  - supabase: Supabase Auth on the request cookies; rows come back through
 *    the RLS-scoped query (is_member on wa_conversations).
 *  - fake: the demo session from the store or the demo cookie the fake layer
 *    writes on sign-in (localStorage never reaches a route handler).
 */
export async function GET(request?: NextRequest) {
  if (getDataDriver() === "supabase") {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    try {
      const conversations = await listConversationsSupabase(supabase);
      return Response.json({ conversations });
    } catch {
      return Response.json({ error: "query_failed" }, { status: 500 });
    }
  }

  const cookieValue = request?.cookies.get(AUTH_STORAGE_KEY)?.value ?? null;
  const session = (await getSession()) ?? parseDemoSessionCookie(cookieValue);
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const conversations = await listConversations();
  return Response.json({ conversations });
}
