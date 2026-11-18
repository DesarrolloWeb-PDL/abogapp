import { test, expect, type Page, type Route } from "@playwright/test";
import {
  SEED,
  expectNoAxeViolations,
  formatDate,
  guardPage,
  restGet,
  restSend,
  tabUntil,
  toArtDate,
} from "./helpers";

/**
 * F04 — assign a task (~3 clicks): sidebar → Nueva tarea → título + Crear.
 * Covers S16's list half: the five states read from `task_statuses` (never
 * hardcoded), persistence across reload (UI + raw DB row), the overdue red
 * + "Vencida" row, the assignee alert, and every screen state (loading is
 * transient, error + Reintentar is route-driven here).
 */

const TASKS_REST = /\/rest\/v1\/tasks(\?|$)/;

async function gotoTareas(page: Page): Promise<void> {
  await page.goto("/tareas");
  await expect(page.getByRole("heading", { name: "Tareas", exact: true })).toBeVisible();
}

test.describe("F04 create + estado transition", () => {
  test("F04-H1 sidebar → create → appears → estado change persists → alert", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const stamp = Date.now();
    const titulo = `E2E tarea ${stamp}`;

    // 1. The sidebar entry sits right after Expedientes (the original's slot
    //    between Expedientes and Agenda).
    await page.goto("/expedientes");
    await page.getByRole("link", { name: "Tareas", exact: true }).click();
    await page.waitForURL("**/tareas");
    await expect(
      page.getByRole("heading", { name: "Tareas", exact: true }),
    ).toBeVisible();

    // 2. Nueva tarea opens the dialog; scan it while open (a11y first).
    await page.getByRole("button", { name: "Nueva tarea" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expectNoAxeViolations(page, "nueva tarea dialog");

    // 3. F04 happy path: título + Crear tarea (2 clicks inside the dialog).
    await dialog.getByLabel("Título").fill(titulo);
    await dialog.getByRole("button", { name: "Crear tarea" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Tarea creada.")).toBeVisible();

    const row = page.getByRole("row").filter({ hasText: titulo });
    await expect(row).toBeVisible();

    // 4. Estado control offers the study's five states (read from data).
    const estado = row.getByLabel(/Cambiar estado de/);
    await expect(estado).toHaveValue("pendiente");
    await estado.selectOption({ label: "En curso" });
    await expect(estado).toHaveValue("en_curso");

    // 5. Persists after reload — UI value AND the raw DB row (RLS read).
    await page.reload();
    const reloadedRow = page.getByRole("row").filter({ hasText: titulo });
    await expect(reloadedRow.getByLabel(/Cambiar estado de/)).toHaveValue(
      "en_curso",
    );
    const dbRows = await restGet<{ status: { key: string } }[]>(
      `tasks?titulo=eq.${encodeURIComponent(titulo)}&select=status:task_statuses(key)`,
    );
    expect(dbRows, "exactly one row for this run's título").toHaveLength(1);
    expect(dbRows[0].status.key).toBe("en_curso");

    // 6. The assignee (me, the default) got one "Tarea asignada" alert.
    await page.goto("/notificaciones");
    const ownItem = page.getByRole("listitem").filter({ hasText: titulo });
    await expect(ownItem).toBeVisible();
    expect(await ownItem.innerText()).toContain("Tarea asignada");

    // 7. The list itself scans clean (filled state).
    await gotoTareas(page);
    await expectNoAxeViolations(page, "/tareas list");
    await guard.assertClean();
  });

  test("F04-E keyboard: open the dialog and create without the mouse", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const titulo = `E2E teclado ${Date.now()}`;

    await gotoTareas(page);
    // The button enables once the reads resolve — focus only lands on it
    // when it is actually focusable (a disabled button swallows the press).
    const nuevaTarea = page.getByRole("button", { name: "Nueva tarea" });
    await expect(nuevaTarea).toBeEnabled();
    await nuevaTarea.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // The dialog parks focus on its close control; Tab reaches the form.
    const reachedTitle = await tabUntil(
      page,
      () => document.activeElement?.getAttribute("name") === "titulo",
      15,
    );
    expect(reachedTitle, "Título reachable by keyboard").toBe(true);
    await page.keyboard.type(titulo);

    const reachedSubmit = await tabUntil(
      page,
      () =>
        document.activeElement?.getAttribute("type") === "submit" &&
        document.activeElement?.textContent?.trim() === "Crear tarea",
      15,
    );
    expect(reachedSubmit, "Crear tarea reachable by keyboard").toBe(true);
    await page.keyboard.press("Enter");

    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("row").filter({ hasText: titulo }),
    ).toBeVisible();
    await guard.assertClean();
  });

  test("F04-E error panel with Reintentar recovers the list", async ({
    page,
  }) => {
    const guard = guardPage(page, {
      ignoreConsole: (text) => text.includes("Failed to load resource"),
    });
    const handler = (route: Route) =>
      route.request().url().includes("/rest/v1/tasks")
        ? route.abort("internetdisconnected")
        : route.continue();
    // `/rest/v1/tasks?…` only — task_statuses and cases keep loading.
    await page.route(TASKS_REST, handler);

    await gotoTareas(page);
    await expect(page.getByText("No pudimos cargar las tareas.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();

    await page.unroute(TASKS_REST, handler);
    await page.getByRole("button", { name: "Reintentar" }).click();
    await expect(page.getByText("No pudimos cargar las tareas.")).toHaveCount(0);
    await expect(page.getByText(/Mostrando \d+ de \d+ tareas/)).toBeVisible();
    await guard.assertClean();
  });
});

test.describe("F04 overdue rendering", () => {
  test("a past-due task shows red + Vencida with its expediente", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const stamp = Date.now();
    const titulo = `E2E vencida ${stamp}`;
    // 30 days in the past (ART) — computed, so the fixture never rots.
    const past = toArtDate(new Date(Date.now() - 30 * 86_400_000).toISOString());
    let taskId: string | null = null;

    try {
      const [membership] = await restGet<{ study_id: string }[]>(
        "memberships?status=eq.active&select=study_id&limit=1",
      );
      const [status] = await restGet<{ id: string }[]>(
        `task_statuses?study_id=eq.${membership.study_id}&key=eq.pendiente&select=id`,
      );
      const [seeded] = await restSend<{ id: string }[]>("POST", "tasks", {
        study_id: membership.study_id,
        status_id: status.id,
        case_id: SEED.gomezId,
        titulo,
        prioridad: "alta",
        vence_at: `${past}T12:00:00.000Z`,
      });
      taskId = seeded.id;

      await gotoTareas(page);
      const row = page.getByRole("row").filter({ hasText: titulo });
      await expect(row).toBeVisible();
      await expect(row).toContainText("Vencida");
      await expect(row).toContainText(formatDate(past));
      await expect(row).toContainText(SEED.caseGomez);
      await expect(row).toContainText("Sin responsable");
      // Colour never carries the meaning alone: the chip says "Vencida".
      await expectNoAxeViolations(page, "/tareas overdue row");
    } finally {
      // Clean the seeded row up (spec hygiene: no fixtures outlive the run).
      if (taskId) await restSend("DELETE", `tasks?id=eq.${taskId}`);
    }

    await guard.assertClean();
  });
});

test.describe("F04 mobile 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("tareas list fits 390 px with no horizontal scroll", async ({
    page,
  }) => {
    const guard = guardPage(page);
    await gotoTareas(page);
    await expect(
      page.getByRole("button", { name: "Nueva tarea" }),
    ).toBeVisible();

    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    );
    expect(fits, "no horizontal scroll at 390 px").toBe(true);

    await expectNoAxeViolations(page, "/tareas at 390");
    await guard.assertClean();
  });
});
