import { test, expect, type Page } from "@playwright/test";
import {
  SEED,
  expectNoAxeViolations,
  guardPage,
  restGet,
  restPatch,
  restSend,
} from "./helpers";

/**
 * M2 — notificaciones (S21): filtered pagination, per-browser filters, the
 * Preferencias dialog with its emission gate, and mark-all across filters.
 * Fixtures seed through REST and clean up in `finally`; the gate test drives
 * the REAL emitter (createPrueba → insertNotificationSupabase) because a
 * REST insert bypasses the seam on purpose.
 */

interface ScopeRow {
  user_id: string;
  study_id: string;
}

/** The demo user's scope (RLS owns the visibility; we just need the ids). */
async function notificationScope(): Promise<ScopeRow> {
  const [row] = await restGet<ScopeRow[]>(
    "notifications?select=user_id,study_id&limit=1",
  );
  if (!row) throw new Error("no notification row to derive scope from");
  return row;
}

/** Create a prueba with a 10-días-hábiles plazo so the alert fires. */
async function createPruebaWithPlazo(page: Page, titulo: string): Promise<void> {
  await page.goto(`/expedientes/${SEED.gomezId}/pruebas/nueva`);
  await expect(page.getByRole("heading", { name: "Agregar prueba" })).toBeVisible();
  await page.getByLabel("Título").fill(titulo);
  await page.getByLabel("Informante").fill("Estudio Contable Rivadavia");
  await page.getByLabel("Fecha efectiva").fill("2026-11-16");
  await page.getByRole("radio", { name: "Días hábiles" }).check();
  await page.getByLabel("Cantidad").fill("10");
  await page.getByRole("button", { name: "Guardar prueba" }).click();
  await page.waitForURL(/tab=pruebas/);
  await expect(page.getByText(titulo)).toBeVisible();
}

test.describe("M2 — notificaciones page (S21)", () => {
  test("M2-S21 search narrows, empty query shows no-results, Limpiar restores", async ({
    page,
  }) => {
    const guard = guardPage(page);
    await page.goto("/notificaciones");
    await expect(
      page.getByRole("heading", { name: "Notificaciones" }),
    ).toBeVisible();
    const items = page.getByRole("listitem");
    await expect(items.first()).toBeVisible();

    // Search narrows to the one row that mentions the phrase.
    const search = page.getByLabel("Buscar notificaciones");
    await search.fill("informe pericial");
    await expect(items).toHaveCount(1);
    await expect(page.getByText(SEED.notificationTitle)).toBeVisible();

    // Negative: no match → the no-results state (never a blank screen).
    await search.fill("zzzznotificacionesxyz");
    await expect(items).toHaveCount(0);
    await expect(
      page.getByText("No encontramos notificaciones con esos filtros."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Limpiar filtros" }).click();

    // Limpiar restores the full first page and empties the box.
    await expect(search).toHaveValue("");
    await expect(items).toHaveCount(20);
    await expect(page.getByText(/Mostrando 20 de \d+/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Limpiar filtros" }),
    ).toHaveCount(0);

    await expectNoAxeViolations(page, "/notificaciones M2 filters");
    await guard.assertClean();
  });

  test("M2-S21 categoria/estado filters narrow, persist per browser, Limpiar restores", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const title = `E2E categoria ${Date.now()}`;
    const scope = await notificationScope();
    let seededId: string | null = null;

    try {
      // Drop leftovers from an earlier crashed run so the count is exact.
      await restSend(
        "DELETE",
        "notifications?title=like." + encodeURIComponent("E2E categoria %"),
      );
      // One Causas row (the seed and every leftover are other buckets).
      const [row] = await restSend<{ id: string }[]>("POST", "notifications", {
        study_id: scope.study_id,
        user_id: scope.user_id,
        category: "causas",
        title,
        body: "Actividad nueva en la causa.",
        channel: "in_app",
      });
      seededId = row.id;

      await page.goto("/notificaciones");
      await expect(
        page.getByRole("heading", { name: "Notificaciones" }),
      ).toBeVisible();
      const items = page.getByRole("listitem");
      const categoria = page.getByLabel("Categoría", { exact: true });
      const estado = page.getByLabel("Estado", { exact: true });

      await categoria.selectOption({ label: "Causas" });
      await expect(items).toHaveCount(1);
      await expect(page.getByText(title)).toBeVisible();

      // Estado narrows inside the category: the row is unread, so "Leídas"
      // empties the list into the no-results state.
      await estado.selectOption({ label: "Leídas" });
      await expect(
        page.getByText("No encontramos notificaciones con esos filtros."),
      ).toBeVisible();
      await estado.selectOption({ label: "No leídas" });
      await expect(items).toHaveCount(1);

      // Filters are remembered per browser (sessionStorage, same tab).
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Notificaciones" }),
      ).toBeVisible();
      await expect(categoria).toHaveValue("causas");
      await expect(estado).toHaveValue("no_leidas");
      await expect(page.getByText(title)).toBeVisible();

      // Limpiar restores the unfiltered first page.
      await page.getByRole("button", { name: "Limpiar filtros" }).click();
      await expect(categoria).toHaveValue("");
      await expect(estado).toHaveValue("todas");
      await expect(items).toHaveCount(20);
      await guard.assertClean();
    } finally {
      if (seededId) await restSend("DELETE", `notifications?id=eq.${seededId}`);
    }
  });

  test("M2-S21 Preferencias pauses a category: the emitter writes no alert until re-enabled", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const stamp = Date.now();
    const pausedTitulo = `E2E aviso pausado ${stamp}`;
    const activeTitulo = `E2E aviso activo ${stamp}`;
    const scope = await notificationScope();

    // Start from a known "on" state even if an earlier run died mid-test.
    await restPatch(
      `notification_preferences?user_id=eq.${scope.user_id}&category=eq.sistemas_judiciales`,
      { in_app: true },
    );

    const inAppToggle = () =>
      page
        .getByRole("dialog")
        .getByRole("group", { name: "Sistemas judiciales" })
        .getByLabel("En la app");

    const savePreferences = async () => {
      await page
        .getByRole("button", { name: "Guardar preferencias" })
        .click();
      await expect(
        page.getByText("Listo: guardamos tus preferencias."),
      ).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    };

    try {
      await page.goto("/notificaciones");
      await expect(
        page.getByRole("heading", { name: "Notificaciones" }),
      ).toBeVisible();

      // 1. Pause the bucket the plazo alert writes to.
      await page
        .getByRole("button", { name: "Preferencias", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(inAppToggle()).toBeChecked();
      await expectNoAxeViolations(page, "preferencias modal (M2)");
      await inAppToggle().uncheck();
      await savePreferences();

      // 2. Drive the REAL emitter: a prueba with a plazo must write no row
      //    while the category is paused (a REST insert would bypass the
      //    seam, so it could never prove the gate).
      await createPruebaWithPlazo(page, pausedTitulo);
      const pausedRows = await restGet<{ id: string }[]>(
        `notifications?body=like.${encodeURIComponent(
          `%${pausedTitulo}%`,
        )}&select=id`,
      );
      expect(
        pausedRows,
        "the paused category must not receive the alert",
      ).toHaveLength(0);

      // 3. Re-enable → the next emission lands (fresh page load: the gate
      //    re-reads the row from the DB, not a warm cache).
      await page.goto("/notificaciones");
      await expect(
        page.getByRole("heading", { name: "Notificaciones" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Preferencias", exact: true })
        .click();
      await expect(inAppToggle()).not.toBeChecked();
      await inAppToggle().check();
      await savePreferences();

      await createPruebaWithPlazo(page, activeTitulo);
      const activeRows = await restGet<{ id: string }[]>(
        `notifications?body=like.${encodeURIComponent(
          `%${activeTitulo}%`,
        )}&select=id`,
      );
      expect(activeRows, "re-enabled category receives the alert").toHaveLength(
        1,
      );

      // …and the list shows it once the search narrows to this run.
      await page.goto("/notificaciones");
      await page.getByLabel("Buscar notificaciones").fill(activeTitulo);
      await expect(
        page.getByRole("listitem").filter({ hasText: activeTitulo }),
      ).toHaveCount(1);
      await guard.assertClean();
    } finally {
      // Restore the preference first: a crashed run must never leave the
      // demo account with a paused category for the rest of the suite.
      await restPatch(
        `notification_preferences?user_id=eq.${scope.user_id}&category=eq.sistemas_judiciales`,
        { in_app: true },
      );
      await restSend(
        "DELETE",
        `notifications?body=like.${encodeURIComponent(`%${stamp}%`)}`,
      );
      const pruebas = await restGet<{ id: string }[]>(
        `pruebas?titulo=like.${encodeURIComponent(
          `E2E aviso %${stamp}`,
        )}&select=id`,
      );
      for (const prueba of pruebas) {
        await restSend("DELETE", `plazos?prueba_id=eq.${prueba.id}`);
      }
      if (pruebas.length > 0) {
        await restSend(
          "DELETE",
          `pruebas?id=in.(${pruebas.map((row) => row.id).join(",")})`,
        );
      }
    }
  });

  test("M2-S21 mark-all reaches rows beyond the active filter", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const title = `E2E markall ${Date.now()}`;
    const scope = await notificationScope();
    let seededId: string | null = null;

    try {
      const [row] = await restSend<{ id: string }[]>("POST", "notifications", {
        study_id: scope.study_id,
        user_id: scope.user_id,
        category: "equipo",
        title,
        body: "Fila para el marcado masivo.",
        channel: "in_app",
      });
      seededId = row.id;

      await page.goto("/notificaciones");
      await expect(
        page.getByRole("heading", { name: "Notificaciones" }),
      ).toBeVisible();
      await expect(
        page.getByText(/Tenés \d+ notificaciones sin leer\./),
      ).toBeVisible();

      // Narrow the view first: mark-all must still reach the WHOLE list.
      await page.getByLabel("Buscar notificaciones").fill(title);
      const items = page.getByRole("listitem");
      await expect(items).toHaveCount(1);

      const markAll = page.getByRole("button", {
        name: "Marcar todas como leídas",
      });
      await expect(markAll).toBeEnabled();
      await markAll.click();
      await expect(
        page.getByText("Listo: marcaste todas como leídas."),
      ).toBeVisible();
      await expect(
        page.getByText("Estás al día con las novedades de tu estudio."),
      ).toBeVisible();
      await expect(markAll).toBeDisabled();

      // The read state landed in the DB, not only in this filtered view.
      const [stored] = await restGet<{ read_at: string | null }[]>(
        `notifications?id=eq.${seededId}&select=read_at`,
      );
      expect(stored?.read_at, "mark-all persisted the read state").toBeTruthy();
      await guard.assertClean();
    } finally {
      if (seededId) await restSend("DELETE", `notifications?id=eq.${seededId}`);
    }
  });

  test("M2-S21 Cargar más appends 20 at a time until the count is complete", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const stamp = Date.now();
    const scope = await notificationScope();
    const before = (
      await restGet<{ id: string }[]>("notifications?select=id")
    ).length;
    const batch = Array.from({ length: 25 }, (_, index) => ({
      study_id: scope.study_id,
      user_id: scope.user_id,
      category: "equipo",
      title: `E2E paginacion ${stamp} ${index + 1}`,
      body: `Fila ${index + 1} del lote de paginacion.`,
      channel: "in_app",
    }));
    const total = before + batch.length;

    try {
      await restSend<unknown[]>("POST", "notifications", batch);

      await page.goto("/notificaciones");
      await expect(
        page.getByRole("heading", { name: "Notificaciones" }),
      ).toBeVisible();
      const items = page.getByRole("listitem");
      await expect(items).toHaveCount(20);
      await expect(page.getByText(`Mostrando 20 de ${total}`)).toBeVisible();

      let shown = 20;
      while (shown < total) {
        await page.getByRole("button", { name: "Cargar más" }).click();
        shown = Math.min(shown + 20, total);
        await expect(items).toHaveCount(shown);
        await expect(page.getByText(`Mostrando ${shown} de ${total}`)).toBeVisible();
      }

      await expect(
        page.getByRole("button", { name: "Cargar más" }),
      ).toHaveCount(0);
      await expect(items).toHaveCount(total);
      await guard.assertClean();
    } finally {
      await restSend(
        "DELETE",
        `notifications?title=like.${encodeURIComponent(
          `E2E paginacion ${stamp}%`,
        )}`,
      );
    }
  });
});
