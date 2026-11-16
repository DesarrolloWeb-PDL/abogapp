import { defineConfig, devices } from "@playwright/test";

/**
 * replica-test e2e configuration.
 *
 * - The dev server on localhost:3000 is already running: there is NO
 *   `webServer` block on purpose, so Playwright never starts a second one
 *   (`reuseExistingServer` would still spawn one if the port were free).
 * - One worker: the specs share one real Supabase dev project, so serial
 *   execution keeps state assertions (unread counts, list rows) deterministic.
 * - `trace: "on-first-retry"` with one retry, per the skill.
 * - ART time zone + es-AR locale everywhere: the product targets Argentine
 *   firms; one describe block overrides the zone for the cross-TZ check.
 * - Projects: `guest` must run FIRST, then `setup` (login + storageState),
 *   then `chromium` (authed specs with the saved session). The order is a
 *   hard requirement, not a preference: the guest logout test (AU01-H2)
 *   signs out with GoTrue's `scope=global`, which revokes EVERY session of
 *   the demo user — a storageState minted before that logout is dead on
 *   arrival (`403 session_not_found` → every authed test bounces to
 *   /login). Hence: `setup` depends on `guest`, `chromium` on `setup`.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3000",
    timezoneId: "America/Argentina/Buenos_Aires",
    locale: "es-AR",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "guest",
      testMatch: /(auth|signup)\.spec\.ts/,
      testIgnore: /auth\.setup\.ts/,
    },
    {
      name: "setup",
      dependencies: ["guest"],
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      testMatch: /.*\.spec\.ts/,
      testIgnore: [/(auth|signup)\.spec\.ts/, /auth\.setup\.ts/],
      use: { storageState: "e2e/.auth/user.json" },
    },
  ],
});
