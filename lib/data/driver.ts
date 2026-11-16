/**
 * The driver switch between the real Supabase backend and the fake layer.
 *
 * Rule (documented in replica/backend.md):
 *  1. `DATA_DRIVER=supabase|fake` wins when set to a valid value — explicit
 *     intent beats detection (used by tests and by forced demo runs);
 *  2. otherwise both public vars present → "supabase";
 *  3. otherwise → "fake", so unit tests and `next dev` without `.env.local`
 *     keep working unchanged.
 *
 * The env object is injectable for tests; production reads `process.env`.
 */

export type DataDriver = "supabase" | "fake";

type EnvLike = Record<string, string | undefined>;

/**
 * Static `process.env.NEXT_PUBLIC_*` reads so Next.js inlines them into the
 * browser bundle. Dynamic property access on `process.env` (as in `env.X`)
 * is NOT replaced in client builds and always reads undefined there, which
 * silently dropped the browser onto the fake driver while the server used
 * Supabase — logins then failed with "credentials do not match".
 */
function staticEnv(): EnvLike {
  return {
    DATA_DRIVER: process.env.DATA_DRIVER,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

export function getDataDriver(env: EnvLike = staticEnv()): DataDriver {
  const override = env.DATA_DRIVER;
  if (override === "supabase" || override === "fake") return override;

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && anonKey ? "supabase" : "fake";
}

/** True when the public Supabase env vars are present (client-safe check). */
export function isSupabaseConfigured(env: EnvLike = staticEnv()): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
