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
 * the Tareas tab (S16 scoped to the expediente) and the Agenda tab (S17
 * scoped version opening in Lista) reachable through the same `?tab=`
 * deep link, plus the F02-E7 regression guard proving the existing
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

/** Unique prefix so a crashed run can pre-clean, cleanup can target. */
const EVENT_PREFIX = "S08 agenda ";

async function cleanSeededEvents(): Promise<void> {
  await restSend(
    "DELETE",
    `events?title=like.${encodeURIComponent(`${EVENT_PREFIX}%`)}`,
  );
}

/** One manual event, optionally pinned to a case (events.case_id). */
async function seedAgendaEvent(options: {
  title: string;
  startAt: string;
  caseId?: string;
}): Promise<string> {
  const [membership] = await restGet<{ study_id: string }[]>(
    "memberships?status=eq.active&select=study_id&limit=1",
  );
  const [seeded] = await restSend<{ id: string }[]>("POST", "events", {
    study_id: membership.study_id,
    title: options.title,
    start_at: options.startAt,
    end_at: new Date(
      Date.parse(options.startAt) + 60 * 60 * 1000,
    ).toISOString(),
    source: "manual",
    ...(options.caseId ? { case_id: options.caseId } : {}),
  });
  if (!seeded?.id) throw new Error("REST returned no event row");
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

      // Five tabs at 390 px: the strip scrolls, the page must not.
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

  test("S08-T2 Agenda tab: opens in Lista scoped to the case, survives a refresh", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const stamp = Date.now();
    const scopedTitle = `${EVENT_PREFIX}${stamp} gomez`;
    const studyTitle = `${EVENT_PREFIX}${stamp} estudio`;
    const scopedStart = new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    ).toISOString();
    const studyStart = new Date(
      Date.now() + 2 * 24 * 60 * 60 * 1000,
    ).toISOString();

    try {
      await cleanSeededEvents();
      await seedAgendaEvent({
        title: scopedTitle,
        startAt: scopedStart,
        caseId: SEED.gomezId,
      });
      // Same study, no case: visible in the studio /agenda, never here.
      await seedAgendaEvent({ title: studyTitle, startAt: studyStart });

      await page.goto(`/expedientes/${SEED.gomezId}`);
      await tabStrip(page)
        .getByRole("link", { name: "Agenda", exact: true })
        .click();
      await expect(page).toHaveURL(/tab=agenda/);

      // Opens in Lista (recon S17): the shared panel's list-level search
      // is the view's signature, and Resumen's cards are gone.
      await expect(page.getByLabel("Buscar eventos")).toBeVisible();
      await expect(
        page.getByRole("listitem").filter({ hasText: scopedTitle }),
      ).toHaveCount(1);
      await expect(
        page.getByRole("listitem").filter({ hasText: studyTitle }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Próximos plazos" }),
      ).toHaveCount(0);
      await expect(
        tabStrip(page).getByRole("link", { name: "Agenda", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await expectNoAxeViolations(page, "/expedientes/[id] ?tab=agenda (S08)");

      // F02-E7 contract applied to the new tab: the query survives a reload
      // and the scope still holds.
      await page.reload();
      await expect(page).toHaveURL(/tab=agenda/);
      await expect(
        page.getByRole("listitem").filter({ hasText: scopedTitle }),
      ).toHaveCount(1);
      await expect(
        page.getByRole("listitem").filter({ hasText: studyTitle }),
      ).toHaveCount(0);

      // Scoping proof: the very same study row IS listed in /agenda, so
      // its absence above is listEventsByCase working, not a dead seed.
      await page.goto("/agenda");
      await expect(
        page.getByRole("listitem").filter({ hasText: studyTitle }),
      ).toHaveCount(1);

      await guard.assertClean();
    } finally {
      await cleanSeededEvents();
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
    // Pruebas → Agenda); a reorder or a dropped tab fails here before
    // F02-E7 does.
    await expect(
      tabStrip(page).getByRole("link").allInnerTexts(),
    ).resolves.toEqual([
      "Resumen",
      "Movimientos",
      "Tareas",
      "Pruebas",
      "Agenda",
    ]);

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
