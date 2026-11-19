import { test, expect, type Page } from "@playwright/test";
import {
  SEED,
  expectNoAxeViolations,
  guardPage,
  restGet,
  restSend,
} from "./helpers";

/**
 * S08 case detail hub — the tab strip beyond Resumen/Movimientos/Pruebas:
 * the Tareas tab (S16 scoped to the expediente) reachable through the same
 * `?tab=` deep link, plus the F02-E7 regression guard proving the existing
 * deep-link behaviour (query survives a refresh, Resumen drops it) still
 * holds with the wider strip.
 *
 * Every row this spec writes carries a unique `S08 …` título and is
 * hard-deleted through REST in `finally`.
 */

/** The tab strip lives in its own landmark so the sidebar link never collides. */
function tabStrip(page: Page) {
  return page.getByRole("navigation", { name: "Secciones del expediente" });
}

async function seedTaskOnGomez(titulo: string): Promise<string> {
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
    prioridad: "normal",
  });
  if (!seeded?.id) throw new Error("REST returned no task row");
  return seeded.id;
}

test.describe("S08 case detail tabs", () => {
  test("S08-T1 Tareas tab: deep link, scoped rows, survives a refresh", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const titulo = `S08 tab tarea ${Date.now()}`;
    let taskId: string | null = null;

    try {
      taskId = await seedTaskOnGomez(titulo);

      await page.goto(`/expedientes/${SEED.gomezId}?tab=tareas`);
      await expect(page).toHaveURL(/tab=tareas/);
      await expect(
        tabStrip(page).getByRole("link", { name: "Tareas", exact: true }),
      ).toBeVisible();

      // The tab renders THIS case's tasks and nothing of Resumen's cards.
      const row = page.getByRole("row").filter({ hasText: titulo });
      await expect(row).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Próximos plazos" }),
      ).toHaveCount(0);
      await expectNoAxeViolations(page, "/expedientes/[id] ?tab=tareas (S08)");

      // F02-E7 contract applied to the new tab: the query survives a reload.
      await page.reload();
      await expect(page).toHaveURL(/tab=tareas/);
      await expect(row).toBeVisible();

      // Four tabs at 390 px: the strip scrolls, the page must not.
      await page.setViewportSize({ width: 390, height: 844 });
      const fits = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      );
      expect(fits, "no horizontal scroll at 390 px").toBe(true);
      await expectNoAxeViolations(
        page,
        "/expedientes/[id] ?tab=tareas at 390 (S08)",
      );
      await guard.assertClean();
    } finally {
      if (taskId) await restSend("DELETE", `tasks?id=eq.${taskId}`);
    }
  });

  test("S08-E7 regression: the existing ?tab= deep link still holds with the wider strip", async ({
    page,
  }) => {
    const guard = guardPage(page);
    await page.goto(`/expedientes/${SEED.gomezId}`);
    await expect(
      page.getByRole("heading", { name: "Próximos plazos" }),
    ).toBeVisible();

    // The strip keeps the recon order (Resumen → Movimientos → Tareas →
    // Pruebas); a reorder or a dropped tab fails here before F02-E7 does.
    await expect(
      tabStrip(page).getByRole("link").allInnerTexts(),
    ).resolves.toEqual(["Resumen", "Movimientos", "Tareas", "Pruebas"]);

    await tabStrip(page).getByRole("link", { name: "Pruebas" }).click();
    await expect(page).toHaveURL(/tab=pruebas/);
    await page.reload();
    await expect(page).toHaveURL(/tab=pruebas/);
    await expect(page.getByRole("link", { name: "Agregar prueba" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Próximos plazos" }),
    ).toHaveCount(0);

    // Resumen is the one tab that drops the query (its href is bare).
    await tabStrip(page).getByRole("link", { name: "Resumen" }).click();
    await expect(page).not.toHaveURL(/tab=/);
    await expect(
      page.getByRole("heading", { name: "Próximos plazos" }),
    ).toBeVisible();
    await guard.assertClean();
  });
});
