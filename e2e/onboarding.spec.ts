import { test, expect, type Page } from "@playwright/test";
import {
  DEMO,
  SEED,
  envLocal,
  expectNoAxeViolations,
  guardPage,
} from "./helpers";

/**
 * T1 / S1 — onboarding wizard steps 4-5 (recon S03, five-step flow).
 *
 * M1 shipped three data steps (jurisdictions / profile / studio); M2
 * completes the recon order:
 *
 *   1 jurisdictions → 2 pitch → 3 profile → 4 security → 5 studio →
 *   "Crear estudio" → /expedientes
 *
 * Session rules: the demo user already has a seeded study, and its
 * profiles.full_name / auth metadata are shared state other specs render, so
 * the completion test intercepts EVERY write of the finish path (auth user
 * PUT, profiles upsert, studies insert, init_study_defaults) and answers
 * them from memory — the app keeps behaving exactly as in production while
 * the shared Supabase project stays untouched. The PUT is answered with the
 * body of the preceding real GET /auth/v1/user, so auth-js saves an
 * unchanged session instead of a cobbled-together one. The captured write
 * ORDER still proves profile-first, studio-second — what "the studio is
 * created right after sign-up" has to keep proving.
 */

const PITCH_HEADING = "Nosotros te avisamos";
const SECURITY_HEADING = "Tus datos, bien cuidados";
const STUDY_ID = "e2e00000-0000-4000-8000-000000000001";

/** Clicks Continuar until the heading shows (≤ `max` screens forward). */
async function advanceUntil(
  page: Page,
  heading: string,
  max = 2,
): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (
      await page.getByRole("heading", { name: heading, exact: true }).isVisible()
    ) {
      return;
    }
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
  }
  await expect(
    page.getByRole("heading", { name: heading, exact: true }),
  ).toBeVisible();
}

test.describe("T1 S1 — onboarding wizard steps 4-5", () => {
  test("the wizard runs five steps and steps 4-5 advance", async ({ page }) => {
    const guard = guardPage(page);
    await page.goto("/onboarding");

    await expect(page.getByText("Paso 1 de 5")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "¿En qué jurisdicciones trabajás?" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Saltar este paso" }),
    ).toBeVisible();

    // Step 2: the informational pitch screen.
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByText("Paso 2 de 5")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: PITCH_HEADING, exact: true }),
    ).toBeVisible();
    await expectNoAxeViolations(page, "/onboarding step 2 (T1-S1)");

    // Step 3: the profile screen keeps its place in the flow.
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByText("Paso 3 de 5")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Tu perfil", exact: true }),
    ).toBeVisible();

    // Prefilled from the session, so Continuar passes validation.
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByText("Paso 4 de 5")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: SECURITY_HEADING, exact: true }),
    ).toBeVisible();
    await expectNoAxeViolations(page, "/onboarding step 4 (T1-S1)");

    // Atrás walks the new steps backwards too.
    await page.getByRole("button", { name: "Atrás", exact: true }).click();
    await expect(page.getByText("Paso 3 de 5")).toBeVisible();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();

    // Step 5: the studio screen ends the wizard.
    await expect(page.getByText("Paso 5 de 5")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Datos del estudio", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Crear estudio" })).toBeVisible();

    await page.getByRole("button", { name: "Atrás", exact: true }).click();
    await expect(page.getByText("Paso 4 de 5")).toBeVisible();

    await guard.assertClean();
  });

  test("finishing saves the profile first and then creates the studio", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const supabaseUrl = envLocal("NEXT_PUBLIC_SUPABASE_URL");
    const writes: string[] = [];
    let studyInsert: Record<string, unknown> | null = null;
    let initArgs: Record<string, unknown> | null = null;
    let authUserBody: string | null = null;

    // updateProfile starts with a real GET /auth/v1/user (read-only); its
    // body is replayed for the PUT so auth-js re-saves a valid session.
    await page.route(new RegExp(`${supabaseUrl}/auth/v1/user`), async (route) => {
      const method = route.request().method();
      if (method === "PUT") {
        if (!authUserBody) {
          throw new Error("PUT /auth/v1/user arrived before any GET");
        }
        writes.push("auth_user");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: authUserBody,
        });
        return;
      }
      if (method === "GET") {
        const response = await route.fetch();
        authUserBody = await response.text();
        await route.fulfill({ response });
        return;
      }
      await route.continue();
    });

    // profiles.full_name is rendered by tasks/cases joins: never write it.
    await page.route(/\/rest\/v1\/profiles/, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      writes.push("profiles");
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: "[]",
      });
    });

    // Intercept the study writes: a new study would steal the seeded
    // membership ("last membership wins") and break the rest of the suite.
    await page.route(/\/rest\/v1\/studies\?/, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      writes.push("studies");
      studyInsert = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: STUDY_ID,
          name: (studyInsert as { name: string }).name,
          plan_key: "trial",
          jurisdictions: (studyInsert as { jurisdictions: string[] }).jurisdictions,
          created_at: new Date().toISOString(),
        }),
      });
    });

    await page.route(/\/rest\/v1\/rpc\/init_study_defaults/, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      writes.push("init_study_defaults");
      initArgs = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "null",
      });
    });

    await page.goto("/onboarding");

    // Walk all five steps; only step 1 takes input.
    await expect(page.getByText("Paso 1 de 5")).toBeVisible();
    await page.getByLabel("Córdoba").check();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByText("Paso 2 de 5")).toBeVisible();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByText("Paso 3 de 5")).toBeVisible();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByText("Paso 4 de 5")).toBeVisible();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByText("Paso 5 de 5")).toBeVisible();

    await page.getByLabel("Nombre del estudio").fill("Estudio E2E T1");
    await page.getByRole("button", { name: "Crear estudio" }).click();

    // finish() only pushes after every write resolved, so the redirect is
    // the natural synchronization point for the write log.
    await page.waitForURL("**/expedientes");
    await expect(
      page.getByRole("heading", { name: "Expedientes", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: SEED.caseGomez })).toBeVisible();

    // Auth user + profile saved before the studio, studio insert before the
    // membership bootstrap — the exact completion order M1 shipped.
    expect(writes).toEqual([
      "auth_user",
      "profiles",
      "studies",
      "init_study_defaults",
    ]);
    expect(studyInsert).toMatchObject({
      name: "Estudio E2E T1",
      jurisdictions: ["Córdoba"],
      plan_key: "trial",
    });
    expect(initArgs).toMatchObject({ p_study_id: STUDY_ID });

    // Drop route handlers before teardown: post-navigation auth reads may
    // still be in flight, and their callbacks must not fail the test.
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await guard.assertClean();
  });

  test("REGRESSION: the original steps 1-3 keep their behaviour", async ({
    page,
  }) => {
    const guard = guardPage(page);
    await page.goto("/onboarding");

    // Step 1 keeps its controls (progress copy may read any total).
    await expect(page.getByText(/^Paso 1 de \d+$/)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "¿En qué jurisdicciones trabajás?" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Continuar", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Saltar este paso" }),
    ).toBeVisible();

    // "Saltar este paso" still advances towards the profile screen.
    await page.getByRole("button", { name: "Saltar este paso" }).click();
    await advanceUntil(page, "Tu perfil");

    // The profile screen still prefills from the session… (the demo account
    // carries no full_name metadata, so the session falls back to its email —
    // observed behaviour, unchanged by M2).
    await expect(page.getByLabel("Nombre completo")).toHaveValue(DEMO.email);
    await expect(page.getByLabel("Correo electrónico")).toHaveValue(DEMO.email);

    // …and still gates Continuar with the same validation copy.
    await page.getByLabel("Nombre completo").fill("");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByText("Ingresá tu nombre completo.")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Tu perfil", exact: true }),
    ).toBeVisible();

    await page.getByLabel("Nombre completo").fill(SEED.fakeUserName);
    await page.getByLabel("Correo electrónico").fill("no-es-correo");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(
      page.getByText("Revisá el formato del correo electrónico."),
    ).toBeVisible();

    // The studio screen still requires a name before "Crear estudio".
    await page.getByLabel("Correo electrónico").fill(DEMO.email);
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await advanceUntil(page, "Datos del estudio");

    await page.getByLabel("Nombre del estudio").fill("");
    await page.getByRole("button", { name: "Crear estudio" }).click();
    await expect(page.getByText("Poné un nombre para tu estudio.")).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding/);

    await guard.assertClean();
  });
});
