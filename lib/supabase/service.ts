/**
 * Service-role client — SERVER ONLY, WhatsApp webhook writes.
 *
 * Bypasses RLS for system writes (Meta delivers events with no user
 * session): `wa_webhook_events` idempotency, contacts, conversations and
 * messages. The key lives in `SUPABASE_SECRET_KEY` (never
 * NEXT_PUBLIC_) and this module is imported only by route handlers under
 * app/api — nothing under a client component may reach it (enforced by the
 * SERVICE_ROLE grep in the backend verification step).
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

export function getServiceClient(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("The service-role client must never run in the browser");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase service client is not configured: set SUPABASE_SECRET_KEY (see .env.example)",
    );
  }

  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
