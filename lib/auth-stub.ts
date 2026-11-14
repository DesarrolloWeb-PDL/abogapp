/**
 * Client-side session stub for M1.
 *
 * Real authentication lands in T4 (Supabase Auth). Until then the authed
 * routes read this localStorage flag so the guard, login and signup flows can
 * be exercised end to end.
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
