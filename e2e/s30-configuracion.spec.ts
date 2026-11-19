import { test, expect, type Page, type Route } from "@playwright/test";
import {
  appAlert,
  expectNoAxeViolations,
  guardPage,
  restGet,
  restSend,
  tabUntil,
} from "./helpers";

/**
 * S30 — Configuración: Etapas + Días inhábiles (parity gap #4).
 *
 *  H1 etapas CRUD + the live S07 wiring: create a stage → it shows up in the
 *    nueva-expediente Etapa select AND in the list's Etapa procesal filter
 *    (both read listStages on navigation) → rename it → the filter reflects
 *    the new name and drops the old one → delete it (never the last one) →
 *    gone. Cleanup in `finally` removes the rows by their unique prefix.
 *  H2 días inhábiles: the "Del sistema" group renders feria rows with the
 *    origen badge and NO delete control; a studio day is added through the
 *    form (inline duplicate refusal covered too) and deleted behind the
 *    confirm modal.
 *  H3 negative: with ONE stage left, delete is refused by the typed
 *    last-stage guard and the Spanish copy surfaces in an alert. Reaching
 *    that state means deleting the seeded stages, so `finally` re-inserts
 *    every original row (same id/name/position/flag) — the seeded cases all
 *    carry `etapa_id = null`, so nothing else in the database moves.
 *
 * Every spec keeps `worker: 1` ordering, so the destructive window in H3
 * never overlaps another spec.
 */

/** Prefixes that mark a row as this spec's own (unique per run). */
const STAGE_PREFIX_A = "Etapa Alta ";
const STAGE_PREFIX_B = "Etapa Baja ";
const STUDIO_DAY_PREFIX = "Día E2E ";
/** October 2026: outside the seeded January/July feria windows. */
const STUDIO_DAY_DATE = "2026-10-10";

const LAST_STAGE_ERROR =
  "No pudimos completar la operación. Probá otra vez en unos minutos.";

interface StageRow {
  id: string;
  name: string;
  position: number;
  counts_as_active: boolean;
}

interface StudioDayRow {
  id: string;
  name: string;
}

async function studyId(): Promise<string> {
  const studies = await restGet<{ id: string }[]>("studies?select=id");
  const id = studies[0]?.id;
  if (!id) throw new Error("no study visible under the demo session (RLS)");
  return id;
}

/**
 * The Etapa select lives inside the collapsible filter panel. The button's
 * accessible name carries the active-count suffix ("Filtros 1 filtros
 * activos"), so the prefix regex matches both states — and never the
 * "Limpiar filtros" button.
 */
async function openFiltros(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Filtros/ }).click();
}

/** REST cleanup: drop every stage this spec created (never the seeded five). */
async function cleanupStages(study: string): Promise<void> {
  const rows = await restGet<StudioDayRow[]>(
    `case_stages?select=id,name&study_id=eq.${study}`,
  );
  for (const row of rows.filter(
    (stage) =>
      stage.name.startsWith(STAGE_PREFIX_A) ||
      stage.name.startsWith(STAGE_PREFIX_B),
  )) {
    await restSend("DELETE", `case_stages?id=eq.${row.id}`);
  }
}

/** REST cleanup: drop every studio day this spec created. */
async function cleanupStudioDays(study: string): Promise<void> {
  const rows = await restGet<StudioDayRow[]>(
    `calendar_days?select=id,name&study_id=eq.${study}`,
  );
  for (const row of rows.filter((day) => day.name.startsWith(STUDIO_DAY_PREFIX))) {
    await restSend("DELETE", `calendar_days?id=eq.${row.id}`);
  }
}

test.describe("S30 configuración (etapas + días inhábiles)", () => {
  test("S30-H1 etapas CRUD flows into the S07 Etapa select and filter", async ({
    page,
  }) => {
    const study = await studyId();
    const stamp = Date.now();
    const created = `${STAGE_PREFIX_A}${stamp}`;
    const renamed = `${STAGE_PREFIX_B}${stamp}`;
    const guard = guardPage(page);

    try {
      await cleanupStages(study);

      // Section nav: sidebar "Configuración" → tabs → Etapas.
      await page.goto("/expedientes");
      await page.getByRole("link", { name: "Configuración" }).click();
      await page.waitForURL("**/configuracion/bot");
      await page.getByRole("link", { name: "Etapas", exact: true }).click();
      await page.waitForURL("**/configuracion/etapas");
      await expect(
        page.getByRole("heading", { name: "Etapas", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Días inhábiles", exact: true }),
      ).toBeVisible();

      // 1. Create through the modal, keyboard only: focus the trigger, open
      //    with Enter, Tab from the dialog's close control to the field,
      //    type the name and submit the native form with Enter.
      const nuevaEtapa = page.getByRole("button", { name: "Nueva etapa" });
      await expect(nuevaEtapa).toBeEnabled();
      await nuevaEtapa.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog")).toBeVisible();

      const reachedName = await tabUntil(
        page,
        () => document.activeElement?.getAttribute("name") === "name",
        15,
      );
      expect(reachedName, "Nombre field reachable by keyboard").toBe(true);
      await page.keyboard.type(created);

      const reachedSubmit = await tabUntil(
        page,
        () =>
          document.activeElement?.getAttribute("type") === "submit" &&
          document.activeElement?.textContent?.trim() === "Crear etapa",
        15,
      );
      expect(reachedSubmit, "Crear etapa reachable by keyboard").toBe(true);
      await page.keyboard.press("Enter");

      await expect(
        page.getByRole("status").filter({ hasText: "Etapa creada." }),
      ).toBeVisible();
      await expect(
        page.getByRole("listitem").filter({ hasText: created }),
      ).toHaveCount(1);

      // 2a. Wiring: the new stage is an option of the nueva-expediente
      //     Etapa select (both read listStages on navigation).
      await page.goto("/expedientes/nueva");
      const nuevaSelect = page.getByLabel("Etapa", { exact: true });
      await nuevaSelect.selectOption({ label: created });
      await expect(nuevaSelect).toHaveValue(created);

      // 2b. …and an option of the list's Etapa procesal filter.
      await page.goto("/expedientes");
      await openFiltros(page);
      const filter = page.getByLabel("Etapa procesal", { exact: true });
      await expect(filter.locator("option", { hasText: created })).toHaveCount(
        1,
      );

      // 3. Rename → the row and the filter both reflect it; the old name is
      //    gone everywhere (the option count below proves the refetch).
      await page.goto("/configuracion/etapas");
      await page
        .getByRole("listitem")
        .filter({ hasText: created })
        .getByRole("button", { name: "Renombrar" })
        .click();
      await page.getByLabel("Nombre", { exact: true }).fill(renamed);
      await page.getByRole("button", { name: "Guardar" }).click();
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "Guardamos el nombre de la etapa." }),
      ).toBeVisible();
      await expect(
        page.getByRole("listitem").filter({ hasText: renamed }),
      ).toHaveCount(1);
      await expect(
        page.getByRole("listitem").filter({ hasText: created }),
      ).toHaveCount(0);

      await page.goto("/expedientes");
      await openFiltros(page);
      await expect(
        page
          .getByLabel("Etapa procesal", { exact: true })
          .locator("option", { hasText: renamed }),
      ).toHaveCount(1);
      await expect(
        page
          .getByLabel("Etapa procesal", { exact: true })
          .locator("option", { hasText: created }),
      ).toHaveCount(0);

      // 4. Delete (never the last stage) behind the confirm modal, whose
      //    copy warns about the cases left without an etapa.
      await page.goto("/configuracion/etapas");
      const target = page.getByRole("listitem").filter({ hasText: renamed });
      await target.getByRole("button", { name: "Eliminar" }).click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByText("Las causas con esta etapa quedan sin etapa."),
      ).toBeVisible();
      await dialog.getByRole("button", { name: "Eliminar", exact: true }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "Etapa eliminada." }),
      ).toBeVisible();
      await expect(target).toHaveCount(0);

      // 5. 390px keeps the primary action on screen; axe stays clean.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/configuracion/etapas");
      await expect(
        page.getByRole("button", { name: "Nueva etapa" }),
      ).toBeVisible();
      await expectNoAxeViolations(page, "/configuracion/etapas");

      await guard.assertClean();
    } finally {
      await cleanupStages(study);
    }
  });

  test("S30-H2 días inhábiles: system rows read-only, studio day add + delete", async ({
    page,
  }) => {
    const study = await studyId();
    const stamp = Date.now();
    const dayName = `${STUDIO_DAY_PREFIX}${stamp}`;
    const guard = guardPage(page);

    try {
      await cleanupStudioDays(study);

      await page.goto("/configuracion/dias-inhabiles");
      await expect(
        page.getByRole("heading", { name: "Días inhábiles", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(
          "Se suman a los feriados y a la feria para calcular los plazos.",
        ),
      ).toBeVisible();

      // "Del sistema": feria rows, origen badge, NO delete control.
      const systemGroup = page.getByRole("region", { name: "Del sistema" });
      await expect(systemGroup).toBeVisible();
      const feriaRow = systemGroup
        .getByRole("listitem")
        .filter({ hasText: "Feria judicial" })
        .first();
      await expect(feriaRow.getByText("Del sistema")).toBeVisible();
      await expect(feriaRow.getByRole("button")).toHaveCount(0);

      // Add a studio day through the form.
      await page.getByLabel("Fecha", { exact: true }).fill(STUDIO_DAY_DATE);
      await page.getByLabel("Nombre", { exact: true }).fill(dayName);
      await page.getByRole("button", { name: "Agregar día" }).click();
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "Sumamos el día a los inhábiles del estudio." }),
      ).toBeVisible();

      const studioGroup = page.getByRole("region", { name: "De tu estudio" });
      const studioRow = studioGroup
        .getByRole("listitem")
        .filter({ hasText: dayName });
      await expect(studioRow).toHaveCount(1);
      await expect(studioRow.getByText("De tu estudio")).toBeVisible();

      // The same date twice is refused inline, before any write.
      await page.getByLabel("Fecha", { exact: true }).fill(STUDIO_DAY_DATE);
      await page
        .getByLabel("Nombre", { exact: true })
        .fill(`${dayName} otra vez`);
      await page.getByRole("button", { name: "Agregar día" }).click();
      await expect(
        appAlert(page).filter({ hasText: "Ya agregaste esa fecha." }),
      ).toBeVisible();
      await expect(studioGroup.getByRole("listitem")).toHaveCount(1);

      // Delete behind the confirm modal → gone from the group.
      await studioRow.getByRole("button", { name: "Eliminar" }).click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByText("deja de contar para los plazos del estudio."),
      ).toBeVisible();
      await dialog.getByRole("button", { name: "Eliminar", exact: true }).click();
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "Eliminamos el día inhábil del estudio." }),
      ).toBeVisible();
      await expect(
        studioGroup.getByRole("listitem").filter({ hasText: dayName }),
      ).toHaveCount(0);

      // 390px keeps the add form usable; axe stays clean.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/configuracion/dias-inhabiles");
      await expect(
        page.getByRole("button", { name: "Agregar día" }),
      ).toBeVisible();
      await expectNoAxeViolations(page, "/configuracion/dias-inhabiles");

      await guard.assertClean();
    } finally {
      await cleanupStudioDays(study);
    }
  });

  test("S30-H3 the last stage cannot be deleted (typed refusal in Spanish)", async ({
    page,
  }) => {
    const study = await studyId();
    const guard = guardPage(page);
    const original = await restGet<StageRow[]>(
      `case_stages?select=id,name,position,counts_as_active&study_id=eq.${study}&order=position`,
    );
    test.skip(original.length === 0, "no stages seeded for this study");

    // The seeded "Inicial" stays: m2-expedientes resolves it by name.
    const keeper =
      original.find((stage) => stage.name === "Inicial") ?? original[0]!;

    try {
      // Reduce the study to ONE stage (the seeded cases all carry
      // etapa_id = null, so deleting the other four touches no case).
      for (const stage of original.filter((row) => row.id !== keeper.id)) {
        await restSend("DELETE", `case_stages?id=eq.${stage.id}`);
      }

      await page.goto("/configuracion/etapas");
      const rows = page.getByRole("listitem");
      await expect(rows.filter({ hasText: keeper.name })).toHaveCount(1);

      await rows
        .filter({ hasText: keeper.name })
        .getByRole("button", { name: "Eliminar" })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Eliminar", exact: true }).click();

      // The typed guard refusal surfaces as Spanish copy and the row stays.
      await expect(
        appAlert(page).filter({ hasText: LAST_STAGE_ERROR }),
      ).toBeVisible();
      await expect(rows.filter({ hasText: keeper.name })).toHaveCount(1);
      await dialog.getByRole("button", { name: "Cancelar" }).click();
      await expect(dialog).toHaveCount(0);

      await expectNoAxeViolations(page, "/configuracion/etapas");
      await guard.assertClean();
    } finally {
      // Put every original row back — same id, name, position and flag —
      // so the rest of the suite reads the seeded five again.
      const current = await restGet<StageRow[]>(
        `case_stages?select=id&study_id=eq.${study}`,
      );
      const present = new Set(current.map((row) => row.id));
      for (const stage of original) {
        if (present.has(stage.id)) continue;
        await restSend("POST", "case_stages", {
          id: stage.id,
          study_id: study,
          name: stage.name,
          position: stage.position,
          counts_as_active: stage.counts_as_active,
        });
      }
    }
  });

  test("S30-H4 error panel + Reintentar recovers both configuración screens", async ({
    page,
  }) => {
    // The aborted reads log a Chrome network error line: expected here.
    const guard = guardPage(page, {
      ignoreConsole: (text) => text.includes("Failed to load resource"),
    });

    // Etapas: only the case_stages read goes down; the study lookup is fine.
    const stagesHandler = (route: Route) =>
      route.request().url().includes("/rest/v1/case_stages")
        ? route.abort("internetdisconnected")
        : route.continue();
    await page.route("**/rest/v1/case_stages*", stagesHandler);

    await page.goto("/configuracion/etapas");
    await expect(
      page.getByText("No pudimos cargar las etapas del estudio."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();

    await page.unroute("**/rest/v1/case_stages*", stagesHandler);
    await page.getByRole("button", { name: "Reintentar" }).click();
    await expect(
      page.getByText("No pudimos cargar las etapas del estudio."),
    ).toHaveCount(0);
    await expect(
      page.getByRole("listitem").filter({ hasText: "Inicial" }),
    ).toHaveCount(1);

    // Días inhábiles: same contract on its own read.
    const daysHandler = (route: Route) =>
      route.request().url().includes("/rest/v1/calendar_days")
        ? route.abort("internetdisconnected")
        : route.continue();
    await page.route("**/rest/v1/calendar_days*", daysHandler);

    await page.goto("/configuracion/dias-inhabiles");
    await expect(
      page.getByText("No pudimos cargar los días inhábiles."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();

    await page.unroute("**/rest/v1/calendar_days*", daysHandler);
    await page.getByRole("button", { name: "Reintentar" }).click();
    await expect(
      page.getByText("No pudimos cargar los días inhábiles."),
    ).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Del sistema" }),
    ).toBeVisible();

    await guard.assertClean();
  });
});
