import { test as setup, expect } from "@playwright/test";
import { AUTH_FILE, SEED, guardPage, login } from "./helpers";

/**
 * One login per run: saves the demo session for every authed project
 * (`chromium` depends on `setup`). Login itself is asserted in
 * `auth.spec.ts`; here it only has to produce a durable storageState.
 */
setup("authenticate as the demo user", async ({ page }) => {
  const guard = guardPage(page);
  await login(page);
  await expect(page.getByRole("link", { name: SEED.caseGomez })).toBeVisible();
  await guard.assertClean();
  await page.context().storageState({ path: AUTH_FILE });
});
