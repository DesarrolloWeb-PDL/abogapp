/**
 * Demo session storage key for the FAKE data driver (M1).
 *
 * Real authentication (Supabase Auth) keeps its session in SSR cookies and
 * never touches this module — see lib/data/auth.ts for the driver switch.
 * The fake driver mirrors its session into a cookie of the same key so
 * route handlers can gate on it (localStorage never reaches the server).
 */

export const AUTH_STORAGE_KEY = "m1-demo-session";

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

export function readDemoSession(): string | null {
  if (!hasWindow()) return null;
  return window.localStorage.getItem(AUTH_STORAGE_KEY);
}

export function startDemoSession(): void {
  if (!hasWindow()) return;
  window.localStorage.setItem(AUTH_STORAGE_KEY, seedSessionValue());
}

export function endDemoSession(): void {
  if (!hasWindow()) return;
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

function seedSessionValue(): string {
  return JSON.stringify({ stub: true, startedAt: Date.now() });
}
