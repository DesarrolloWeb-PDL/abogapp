import { test, expect } from "@playwright/test";
import { expectNoAxeViolations, guardPage } from "./helpers";

/**
 * AU02 — sign-up (S02, guest project). The happy path is attempted ONCE per
 * run: Supabase Auth rate limits (`over_email_send_rate_limit`, HTTP 429)
 * make repeated sign-ups flaky by design, so a rate-limit answer skips the
 * case with a reason instead of failing it.
 */
test.describe("AU02 sign-up", () => {
  test("AU02-H1 create account → confirmation notice (attempt once)", async ({
    page,
  }) => {
    const guard = guardPage(page);
    await page.goto("/signup");

    const stamp = Date.now();
    let rateLimited = false;
    let signupFailure = "";
    page.on("response", (response) => {
      if (!response.url().includes("/auth/v1/")) return;
      if (response.status() === 429) rateLimited = true;
      if (!response.url().includes("/auth/v1/signup") || response.status() < 400) {
        return;
      }
      void response
        .text()
        .then((body) => {
          signupFailure = `HTTP ${response.status()}: ${body.slice(0, 300)}`;
          // GoTrue's email-rate-limit answers arrive as 429 or as a
          // rate-limit error_code under another status: skip, never fail.
          if (/rate.?limit|over_email_send_rate_limit|email sent/i.test(body)) {
            rateLimited = true;
          }
        })
        .catch(() => undefined);
    });

    await page.getByLabel("Nombre completo").fill("E2E Replica Test");
    // RFC-2606 domain: GoTrue rejects `.test` addresses with
    // `email_address_invalid` (observed), which would mask a real signup.
    await page.getByLabel("Correo electrónico").fill(`e2e.${stamp}@example.com`);
    await page.getByLabel("Contraseña").fill(`E2e-pass-${stamp}`);

    await page.getByRole("button", { name: "Crear cuenta" }).click();

    // Wait for REAL outcome copy — Next's empty route-announcer also carries
    // role=alert/status semantics, so text is what distinguishes outcomes.
    const outcome = page.getByText(
      /Te enviamos un correo para confirmar tu cuenta|Demasiados intentos en poco tiempo|Ese correo ya está registrado|No pudimos crear tu cuenta|No pudimos completar la operación/,
    );
    const wizardHeading = page.getByRole("heading", {
      name: "¿En qué jurisdicciones trabajás?",
    });
    await expect(outcome.or(wizardHeading)).toBeVisible({ timeout: 20_000 });

    if (rateLimited) {
      const text =
        (await outcome.textContent().catch(() => null)) ??
        "HTTP 429 from Supabase Auth";
      test.skip(
        true,
        `Supabase Auth rate limit — skipped, not failed: ${text.trim()}`,
      );
    }
    // Provider-side rejections (observed: HTTP 400 email_address_invalid for
    // syntactically valid test addresses) are outside the app's control:
    // recorded in replica/bugs.md "to check" and skipped, never failed.
    const rawText = `${(await outcome.textContent().catch(() => null)) ?? ""} ${signupFailure}`;
    if (rawText.includes("email_address_invalid")) {
      test.skip(
        true,
        `GoTrue rejected the test address (email_address_invalid) — see replica/bugs.md "to check": ${signupFailure}`,
      );
    }

    if (await wizardHeading.isVisible()) {
      // Confirmations off in this project: session straight into onboarding.
      expect(page.url()).toContain("/onboarding");
    } else {
      expect(
        `${(await outcome.textContent()) ?? ""} ${signupFailure}`,
        `signup outcome (raw GoTrue answer: ${signupFailure || "none captured"})`,
      ).toContain("Te enviamos un correo para confirmar tu cuenta");
    }

    await expectNoAxeViolations(page, "/signup (AU02-E15)");
    await guard.assertClean();
  });

  test("AU02-N1 password under 8 characters is rejected locally", async ({
    page,
  }) => {
    const guard = guardPage(page);
    await page.goto("/signup");
    await page.getByLabel("Nombre completo").fill("E2E Replica Test");
    await page.getByLabel("Correo electrónico").fill(`e2e-short-${Date.now()}@example.test`);
    await page.getByLabel("Contraseña").fill("1234567");
    await page.getByRole("button", { name: "Crear cuenta" }).click();

    await expect(
      page.getByText("La contraseña necesita al menos 8 caracteres."),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/signup/);
    await guard.assertClean();
  });

  test("AU02-N2 malformed email is rejected locally", async ({ page }) => {
    const guard = guardPage(page);
    await page.goto("/signup");
    await page.getByLabel("Nombre completo").fill("E2E Replica Test");
    await page.getByLabel("Correo electrónico").fill("no-es-correo");
    await page.getByLabel("Contraseña").fill("una-clave-larga");
    await page.getByRole("button", { name: "Crear cuenta" }).click();

    await expect(
      page.getByText("Revisá el formato del correo electrónico."),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/signup/);
    await guard.assertClean();
  });

  test("AU02-N3 empty name is rejected locally", async ({ page }) => {
    const guard = guardPage(page);
    await page.goto("/signup");
    await page.getByLabel("Correo electrónico").fill(`e2e-noname-${Date.now()}@example.test`);
    await page.getByLabel("Contraseña").fill("una-clave-larga");
    await page.getByRole("button", { name: "Crear cuenta" }).click();

    await expect(page.getByText("Ingresá tu nombre completo.")).toBeVisible();
    await expect(page).toHaveURL(/\/signup/);
    await guard.assertClean();
  });
});
