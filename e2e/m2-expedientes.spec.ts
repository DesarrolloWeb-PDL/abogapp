import { test, expect, type Page } from "@playwright/test";
import { expectNoAxeViolations, guardPage, restGet, restSend } from "./helpers";

/**
 * M2 slice for S07 (Expedientes list): the Filtros panel with its
 * active-count badge, studio-wide favorites, the archive round-trip,
 * multi-select + bulk bar, soft delete behind a confirm, click-to-sort
 * headers and the footer counter.
 *
 * Every row this spec writes carries a unique `M2 …` carátula and is
 * hard-deleted through REST in `finally` — including soft-deleted rows
 * (the row still exists, only flagged with `deleted_at`).
 */

interface SeededCase {
  id: string;
  caratula: string;
}

/** Unique suffix so retries and earlier runs never collide. */
function uniqueStamp(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

let studyIdPromise: Promise<string> | null = null;

/** Demo study id (RLS: memberships answers only my own rows). */
function studyId(): Promise<string> {
  studyIdPromise ??= (async () => {
    const rows = await restGet<Array<{ study_id: string }>>(
      "memberships?select=study_id",
    );
    const id = rows[0]?.study_id;
    if (!id) throw new Error("the demo user has no study membership");
    return id;
  })();
  return studyIdPromise;
}

async function seedCase(
  caratula: string,
  extra: Record<string, unknown> = {},
): Promise<SeededCase> {
  const [row] = await restSend<Array<{ id: string }>>("POST", "cases", {
    study_id: await studyId(),
    caratula,
    source: "manual",
    tipo: "Judicial",
    ...extra,
  });
  if (!row) throw new Error(`REST returned no row for ${caratula}`);
  return { id: row.id, caratula };
}

/** Hard-delete every row of the test (works for soft-deleted rows too). */
async function deleteCases(cases: SeededCase[]): Promise<void> {
  if (cases.length === 0) return;
  await restSend(
    "DELETE",
    `cases?id=in.(${cases.map((entry) => entry.id).join(",")})`,
  );
}

/** The study's `case_stages` id for a stage NAME (the etapa filter value). */
async function stageId(name: string): Promise<string> {
  const rows = await restGet<Array<{ id: string }>>(
    `case_stages?select=id&study_id=eq.${await studyId()}&name=eq.${name}`,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`case_stages row "${name}" is missing`);
  return id;
}

function row(page: Page, caratula: string) {
  return page.getByRole("row", { name: caratula });
}

async function openRowMenu(page: Page, caratula: string) {
  await row(page, caratula)
    .getByRole("button", { name: `Acciones de ${caratula}` })
    .click();
}

async function openFiltros(page: Page) {
  await page.getByRole("button", { name: "Filtros", exact: true }).click();
}

test.describe("M2 expedientes list (S07)", () => {
  test("M2-E1 etapa filter narrows the list and Limpiar restores it", async ({
    page,
  }) => {
    const stamp = uniqueStamp();
    const withStage = await seedCase(`M2 etapa si ${stamp}`, {
      etapa_id: await stageId("Inicial"),
    });
    const withoutStage = await seedCase(`M2 etapa no ${stamp}`);
    const guard = guardPage(page);

    try {
      await page.goto("/expedientes");
      await expect(
        page.getByRole("link", { name: withStage.caratula }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: withoutStage.caratula }),
      ).toBeVisible();

      await openFiltros(page);
      await page.getByLabel("Etapa procesal").selectOption("Inicial");

      // Narrowed: the etapa row survives, the other one is filtered out.
      await expect(
        page.getByRole("link", { name: withStage.caratula }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: withoutStage.caratula }),
      ).toBeHidden();
      // The badge announces exactly one active criterion.
      await expect(
        page.getByRole("button", {
          name: "Filtros 1 filtros activos",
          exact: true,
        }),
      ).toBeVisible();

      await page.getByRole("button", { name: "Limpiar filtros" }).click();
      await expect(
        page.getByRole("link", { name: withoutStage.caratula }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Filtros", exact: true }),
      ).toBeVisible();

      // Axe runs last: the panel stays open so the scan covers the new
      // badge, selects and toggles.
      await expectNoAxeViolations(page, "/expedientes Filtros panel (M2)");
      await guard.assertClean();
    } finally {
      await deleteCases([withStage, withoutStage]);
    }
  });

  test("M2-E2 the star toggles the favorite and it survives a reload", async ({
    page,
  }) => {
    const target = await seedCase(`M2 favorito ${uniqueStamp()}`);
    const guard = guardPage(page);

    try {
      await page.goto("/expedientes");
      const star = row(page, target.caratula).getByRole("button", {
        name: "Agregar a favoritos",
      });
      await star.click();
      await expect(
        row(page, target.caratula).getByRole("button", {
          name: "Quitar de favoritos",
        }),
      ).toHaveAttribute("aria-pressed", "true");

      // Studio-wide: the flag lives in the row, not in the tab.
      await page.reload();
      await expect(
        row(page, target.caratula).getByRole("button", {
          name: "Quitar de favoritos",
        }),
      ).toHaveAttribute("aria-pressed", "true");
      await guard.assertClean();
    } finally {
      await deleteCases([target]);
    }
  });

  test("M2-E3 archive hides the row until Ver archivados, then restores it", async ({
    page,
  }) => {
    const target = await seedCase(`M2 archivar ${uniqueStamp()}`);
    const guard = guardPage(page);

    try {
      await page.goto("/expedientes");
      await expect(
        page.getByRole("link", { name: target.caratula }),
      ).toBeVisible();

      await openRowMenu(page, target.caratula);
      await page
        .getByRole("menu")
        .getByRole("menuitem", { name: "Archivar", exact: true })
        .click();
      await expect(page.getByText("Expediente archivado.")).toBeVisible();
      await expect(
        page.getByRole("link", { name: target.caratula }),
      ).toBeHidden();

      // Under "Ver archivados" the row is back, with the archived footer.
      await openFiltros(page);
      await page.getByLabel("Ver archivados").check();
      await expect(
        page.getByRole("link", { name: target.caratula }),
      ).toBeVisible();
      await expect(
        page.getByText(/Mostrando \d+ de \d+ expedientes archivados/),
      ).toBeVisible();

      await openRowMenu(page, target.caratula);
      await page
        .getByRole("menu")
        .getByRole("menuitem", { name: "Desarchivar", exact: true })
        .click();
      await expect(
        page.getByRole("link", { name: target.caratula }),
      ).toBeHidden();

      await page.getByLabel("Ver archivados").uncheck();
      await expect(
        page.getByRole("link", { name: target.caratula }),
      ).toBeVisible();
      await guard.assertClean();
    } finally {
      await deleteCases([target]);
    }
  });

  test("M2-E4 multi-select archives two rows through the bulk bar", async ({
    page,
  }) => {
    const first = await seedCase(`M2 bulk a ${uniqueStamp()}`);
    const second = await seedCase(`M2 bulk b ${uniqueStamp()}`);
    const guard = guardPage(page);

    try {
      await page.goto("/expedientes");
      await page.getByLabel(`Seleccionar ${first.caratula}`).check();
      await page.getByLabel(`Seleccionar ${second.caratula}`).check();
      await expect(page.getByText("2 seleccionados", { exact: true })).toBeVisible();

      // Axe with the bulk bar on screen (selection state + bar actions).
      await expectNoAxeViolations(page, "/expedientes bulk bar (M2)");

      await page
        .getByRole("button", { name: "Archivar", exact: true })
        .click();
      await expect(
        page.getByRole("link", { name: first.caratula }),
      ).toBeHidden();
      await expect(
        page.getByRole("link", { name: second.caratula }),
      ).toBeHidden();
      await expect(
        page.getByText("2 seleccionados", { exact: true }),
      ).toBeHidden();

      await openFiltros(page);
      await page.getByLabel("Ver archivados").check();
      await expect(
        page.getByRole("link", { name: first.caratula }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: second.caratula }),
      ).toBeVisible();
      await guard.assertClean();
    } finally {
      await deleteCases([first, second]);
    }
  });

  test("M2-E5 Eliminar confirms and soft-deletes the row", async ({ page }) => {
    const target = await seedCase(`M2 eliminar ${uniqueStamp()}`);
    const guard = guardPage(page);

    try {
      await page.goto("/expedientes");
      await expect(
        page.getByRole("link", { name: target.caratula }),
      ).toBeVisible();

      await openRowMenu(page, target.caratula);
      await page
        .getByRole("menu")
        .getByRole("menuitem", { name: "Eliminar", exact: true })
        .click();

      const dialog = page.getByRole("dialog", {
        name: "Eliminar expediente",
      });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Eliminar", exact: true }).click();

      await expect(
        page.getByRole("link", { name: target.caratula }),
      ).toBeHidden();
      await expect(page.getByText("Expediente eliminado.")).toBeVisible();
      await guard.assertClean();
    } finally {
      await deleteCases([target]);
    }
  });

  test("M2-E6 sorting by Carátula toggles ascending then descending", async ({
    page,
  }) => {
    const stamp = Date.now();
    const alpha = await seedCase(`M2 sort ${stamp} a alfa`);
    const zeta = await seedCase(`M2 sort ${stamp} z zeta`);
    const guard = guardPage(page);

    try {
      await page.goto("/expedientes");
      // Isolate the pair: sorting is judged on THESE two rows only (the dev
      // database may carry rows from earlier runs).
      await page.getByLabel("Buscar expedientes").fill(`M2 sort ${stamp}`);
      await expect(
        page.getByRole("link", { name: alpha.caratula }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: zeta.caratula }),
      ).toBeVisible();

      const caratulaHeader = page.getByRole("button", { name: "Carátula" });
      const column = page.getByRole("columnheader", { name: "Carátula" });
      const orderOfPair = async () => {
        const texts = await page.getByRole("row").allInnerTexts();
        return [
          texts.findIndex((text) => text.includes("a alfa")),
          texts.findIndex((text) => text.includes("z zeta")),
        ] as const;
      };

      // Natural default for text: A→Z.
      await caratulaHeader.click();
      await expect(column).toHaveAttribute("aria-sort", "ascending");
      const ascending = await orderOfPair();
      expect(ascending[0]).toBeGreaterThan(-1);
      expect(ascending[1]).toBeGreaterThan(-1);
      expect(ascending[0]).toBeLessThan(ascending[1]);

      await caratulaHeader.click();
      await expect(column).toHaveAttribute("aria-sort", "descending");
      const descending = await orderOfPair();
      expect(descending[0]).toBeGreaterThan(descending[1]);
      await guard.assertClean();
    } finally {
      await deleteCases([alpha, zeta]);
    }
  });

  test("M2-N1 cancelling the Eliminar dialog leaves the row in place", async ({
    page,
  }) => {
    const target = await seedCase(`M2 cancelar ${uniqueStamp()}`);
    const guard = guardPage(page);

    try {
      await page.goto("/expedientes");
      await expect(
        page.getByRole("link", { name: target.caratula }),
      ).toBeVisible();

      await openRowMenu(page, target.caratula);
      await page
        .getByRole("menu")
        .getByRole("menuitem", { name: "Eliminar", exact: true })
        .click();

      const dialog = page.getByRole("dialog", {
        name: "Eliminar expediente",
      });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Cancelar" }).click();

      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole("link", { name: target.caratula }),
      ).toBeVisible();
      await guard.assertClean();
    } finally {
      await deleteCases([target]);
    }
  });
});
