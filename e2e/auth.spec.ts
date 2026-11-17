import { test, expect } from "@playwright/test";
import {
  DEMO,
  SEED,
  appAlert,
  expectNoAxeViolations,
  guardPage,
  login,
  tabUntil,
} from "./helpers";

/**
 * AU01 — login / logout / session (S01, guest project: no storageState).
 * All copy is quoted from the app as it renders it.
 */
test.describe("AU01 login and logout", () => {
  test("AU01-H1 happy path: demo credentials land on the seeded list", async ({
    page,
  }) => {
    const guard = guardPage(page);
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "Ingresá a tu cuenta" }),
    ).toBeVisible();

    await page.getByLabel("Correo electrónico").fill(DEMO.email);
    await page.getByLabel("Contraseña").fill(DEMO.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();

    await page.waitForURL("**/expedientes");
    await expect(
      page.getByRole("heading", { name: "Expedientes", exact: true }),
    ).toBeVisible();

    // Seeded content visible under RLS (must-row: expedientes list).
    await expect(page.getByRole("link", { name: SEED.caseGomez })).toBeVisible();
    await expect(page.getByRole("link", { name: SEED.casePerez })).toBeVisible();
    await expect(page.getByText(SEED.studyName)).toBeVisible();

    // The fake-layer seed identity must not survive the real session read.
    await expect(
      page.getByText(SEED.fakeStudyName, { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(SEED.fakeUserName, { exact: true })).toHaveCount(
      0,
    );

    await expectNoAxeViolations(page, "/expedientes after login (AU01-E15)");
    await guard.assertClean();
  });

  test("AU01-N1 wrong password shows the typed credentials error", async ({
    page,
  }) => {
    // The negative path deliberately makes the auth provider answer 400;
    // Chromium logs every failed resource load as a console error, which is
    // the EXPECTED signal here (the typed UI error is asserted below).
    const guard = guardPage(page, {
      ignoreConsole: (text) => text.includes("status of 400"),
    });
    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill(DEMO.email);
    await page.getByLabel("Contraseña").fill("esta-no-es-la-clave");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();

    await expect(appAlert(page)).toHaveText(
      "El correo y la contraseña no coinciden. Revisalos e intentá otra vez.",
    );
    await expect(page).toHaveURL(/\/login/);
    await guard.assertClean();
  });

  test("AU01-N2 empty fields produce field errors, no request", async ({
    page,
  }) => {
    const guard = guardPage(page);
    await page.goto("/login");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();

    await expect(page.getByText("Ingresá tu correo electrónico.")).toBeVisible();
    await expect(page.getByText("Ingresá tu contraseña.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await guard.assertClean();
  });

  test("AU01-N3 malformed email fails typed, never creates a session", async ({
    page,
  }) => {
    // Same as N1: the rejected credentials request logs a 400 by design.
    const guard = guardPage(page, {
      ignoreConsole: (text) => text.includes("status of 400"),
    });
    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill("notanemail");
    await page.getByLabel("Contraseña").fill("una-clave-cualquiera");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();

    await expect(appAlert(page)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    // No session: a protected route still bounces to /login.
    await page.goto("/expedientes");
    await expect(page).toHaveURL(/\/login/);
    await guard.assertClean();
  });

  test("AU01-H2 logout returns to /login and locks the app", async ({
    page,
  }) => {
    // BUG-002 is fixed: the console guard is NOT waived anymore, so any
    // `403 on /auth/v1/user` racing the global revoke fails this test.
    const guard = guardPage(page);
    await login(page);
    await page.getByRole("button", { name: "Cerrar sesión" }).click();

    await page.waitForURL("**/login");
    await expect(
      page.getByRole("heading", { name: "Ingresá a tu cuenta" }),
    ).toBeVisible();

    await page.goto("/expedientes");
    await expect(page).toHaveURL(/\/login/);
    await guard.assertClean();
  });

  test("AU01-E10 expired session: cleared cookies bounce to /login", async ({
    page,
    context,
  }) => {
    const guard = guardPage(page);
    await login(page);
    await context.clearCookies();
    await page.goto("/expedientes");
    await expect(page).toHaveURL(/\/login/);
    await guard.assertClean();
  });

  test("AU01-E14 keyboard-only login (Tab/Enter, no mouse)", async ({
    page,
  }) => {
    const guard = guardPage(page);
    await page.goto("/login");

    const reachedEmail = await tabUntil(
      page,
      () => document.activeElement?.getAttribute("name") === "email",
    );
    expect(reachedEmail, "email field reachable by keyboard").toBe(true);
    await page.keyboard.type(DEMO.email);

    await page.keyboard.press("Tab"); // → password
    expect(
      await page.evaluate(
        () => document.activeElement?.getAttribute("name") === "password",
      ),
      "password follows email in tab order",
    ).toBe(true);
    await page.keyboard.type(DEMO.password);

    await page.keyboard.press("Tab"); // → submit button
    expect(
      await page.evaluate(
        () =>
          (document.activeElement as HTMLButtonElement | null)?.type ===
          "submit",
      ),
      "submit button reachable by keyboard",
    ).toBe(true);
    await page.keyboard.press("Enter");

    await page.waitForURL("**/expedientes");
    await expect(
      page.getByRole("heading", { name: "Expedientes", exact: true }),
    ).toBeVisible();
    await guard.assertClean();
  });
});

test.describe("AU01-E13 login at mobile width 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("login form fits 390 px with no horizontal scroll", async ({ page }) => {
    const guard = guardPage(page);
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "Ingresá a tu cuenta" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      "no horizontal scroll at 390",
    ).toBe(true);

    await page.getByLabel("Correo electrónico").fill(DEMO.email);
    await page.getByLabel("Contraseña").fill(DEMO.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await page.waitForURL("**/expedientes");
    await expect(
      page.getByRole("heading", { name: "Expedientes", exact: true }),
    ).toBeVisible();

    await expectNoAxeViolations(page, "/login at 390 (AU01-E13/E15)");
    await guard.assertClean();
  });
});
