import { test, expect, type Page } from "@playwright/test";
import {
  SEED,
  expectNoAxeViolations,
  guardPage,
  restGet,
  restSend,
  tabUntil,
} from "./helpers";

/**
 * M2 / S21 — bell dropdown panel (T3): the header bell opens the anchored
 * panel with the Todas / No leídas tabs, both fed by the same
 * listNotificationsPage driver the page reads with; read-on-click follows
 * the deep link and decrements the badge; the panel also carries mark-all,
 * Preferencias and the escape to the full page (recon S21 + components.md
 * block 2). Fixtures seed through REST and clean up in `finally`.
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

/** Drop leftovers from an earlier crashed run so counts stay exact. */
async function clearBellLeftovers(): Promise<void> {
  await restSend(
    "DELETE",
    "notifications?title=like." + encodeURIComponent("E2E bell %"),
  );
}

function bellButton(page: Page) {
  return page.getByRole("button", { name: /^Notificaciones/ });
}

function panel(page: Page) {
  // exact: "Preferencias de notificaciones" (the modal) also contains the
  // word "Notificaciones" and would otherwise match the substring.
  return page.getByRole("dialog", { name: "Notificaciones", exact: true });
}

/** The badge number out of the bell's accessible name (0 = plain label). */
async function bellUnread(page: Page): Promise<number> {
  const name = await bellButton(page).getAttribute("aria-label");
  const match = /Notificaciones, (\d+) sin leer/.exec(name ?? "");
  return match ? Number(match[1]) : 0;
}

async function openPanel(page: Page): Promise<void> {
  await expect(bellButton(page)).toBeVisible();
  await bellButton(page).click();
  await expect(panel(page)).toBeVisible();
}

test.describe("M2 — bell dropdown panel (S21)", () => {
  test("BELL-E1 open, Todas/No leídas filter, read-on-click deep link + badge", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const stamp = Date.now();
    const unreadTitle = `E2E bell sin leer ${stamp}`;
    const readTitle = `E2E bell leida ${stamp}`;
    const scope = await notificationScope();
    let unreadId: string | null = null;

    try {
      await clearBellLeftovers();
      const [unreadRow] = await restSend<{ id: string }[]>(
        "POST",
        "notifications",
        {
          study_id: scope.study_id,
          user_id: scope.user_id,
          category: "equipo",
          title: unreadTitle,
          body: "Fila sin leer para el panel de la campana.",
          channel: "in_app",
          deep_link: `/expedientes/${SEED.gomezId}`,
        },
      );
      unreadId = unreadRow.id;
      await restSend("POST", "notifications", {
        study_id: scope.study_id,
        user_id: scope.user_id,
        category: "causas",
        title: readTitle,
        body: "Fila ya leida para el panel de la campana.",
        channel: "in_app",
        read_at: new Date().toISOString(),
      });

      await page.goto("/expedientes");
      await expect(
        page.getByRole("heading", { name: "Expedientes", exact: true }),
      ).toBeVisible();
      // The badge must have settled before we snapshot the count.
      await expect.poll(() => bellUnread(page)).toBeGreaterThan(0);
      const before = await bellUnread(page);

      await openPanel(page);
      const tabs = panel(page).getByRole("tab");
      await expect(tabs).toHaveCount(2);
      await expect(tabs.nth(0)).toHaveText("Todas");
      await expect(tabs.nth(1)).toHaveText("No leídas");
      await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");

      // Todas shows both rows (the read one included)…
      await expect(panel(page).getByText(unreadTitle)).toBeVisible();
      await expect(panel(page).getByText(readTitle)).toBeVisible();

      // …No leídas filters the read row out.
      await tabs.nth(1).click();
      await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
      await expect(panel(page).getByText(readTitle)).toHaveCount(0);
      await expect(panel(page).getByText(unreadTitle)).toBeVisible();

      await expectNoAxeViolations(page, "bell panel open (M2-S21)");

      // Read-on-click: follows the deep link, marks read and decrements
      // the badge the shell keeps in the accessible name.
      await panel(page).getByText(unreadTitle).click();
      await page.waitForURL(new RegExp(`/expedientes/${SEED.gomezId}`));
      // At zero the badge disappears and the label drops the count suffix.
      const expectedName =
        before - 1 > 0
          ? `Notificaciones, ${before - 1} sin leer`
          : "Notificaciones";
      await expect(bellButton(page)).toHaveAccessibleName(expectedName);
      const [stored] = await restGet<{ read_at: string | null }[]>(
        `notifications?id=eq.${unreadId}&select=read_at`,
      );
      expect(stored?.read_at, "read-on-click persisted the read state").toBeTruthy();

      // The now-read row is gone from No leídas on the next open.
      await openPanel(page);
      await panel(page).getByRole("tab").nth(1).click();
      await expect(panel(page).getByText(unreadTitle)).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(panel(page)).toHaveCount(0);

      await guard.assertClean();
    } finally {
      if (unreadId) await restSend("DELETE", `notifications?id=eq.${unreadId}`);
      await clearBellLeftovers();
    }
  });

  test("BELL-E2 keyboard: Enter opens, arrow keys move rows, Esc restores focus", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const stamp = Date.now();
    const firstTitle = `E2E bell teclado a ${stamp}`;
    const secondTitle = `E2E bell teclado b ${stamp}`;
    const scope = await notificationScope();

    try {
      await clearBellLeftovers();
      // Two deep-linked rows, newest first: they become the top rows of Todas.
      await restSend("POST", "notifications", [
        {
          study_id: scope.study_id,
          user_id: scope.user_id,
          category: "equipo",
          title: firstTitle,
          body: "Fila de teclado 1.",
          channel: "in_app",
          deep_link: `/expedientes/${SEED.gomezId}`,
        },
        {
          study_id: scope.study_id,
          user_id: scope.user_id,
          category: "equipo",
          title: secondTitle,
          body: "Fila de teclado 2.",
          channel: "in_app",
          deep_link: `/expedientes/${SEED.gomezId}`,
        },
      ]);

      await page.goto("/expedientes");
      await expect(
        page.getByRole("heading", { name: "Expedientes", exact: true }),
      ).toBeVisible();

      // Tab to the bell and press Enter (components.md block 2: Enter opens).
      const reachedBell = await tabUntil(
        page,
        () =>
          document.activeElement
            ?.getAttribute("aria-label")
            ?.startsWith("Notificaciones") ?? false,
        30,
      );
      expect(reachedBell, "bell reachable by keyboard").toBe(true);
      await page.keyboard.press("Enter");
      await expect(panel(page)).toBeVisible();
      // Focus lands on the selected tab…
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.getAttribute("role")))
        .toBe("tab");
      // …and the rows are loaded before we walk them (the tablist renders
      // with the panel; the list lands when the driver read resolves).
      await expect(panel(page).getByText(firstTitle)).toBeVisible();

      // Tab exits the tab group (roving tabindex: only the selected tab is
      // in the Tab sequence) onto the first row with a deep link…
      await page.keyboard.press("Tab");
      const firstIsRow = await page.evaluate(() => {
        const active = document.activeElement as HTMLAnchorElement | null;
        return (
          active?.tagName === "A" &&
          active.closest('[role="dialog"]') !== null
        );
      });
      expect(firstIsRow, "Tab reaches the panel rows").toBe(true);

      // …and ArrowDown/ArrowUp move between rows.
      const firstText = await page.evaluate(
        () => document.activeElement?.textContent ?? "",
      );
      await page.keyboard.press("ArrowDown");
      const secondText = await page.evaluate(
        () => document.activeElement?.textContent ?? "",
      );
      expect(secondText).not.toBe(firstText);
      await page.keyboard.press("ArrowUp");
      const backText = await page.evaluate(
        () => document.activeElement?.textContent ?? "",
      );
      expect(backText).toBe(firstText);

      // Esc closes the panel and restores focus to the bell.
      await page.keyboard.press("Escape");
      await expect(panel(page)).toHaveCount(0);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.activeElement?.getAttribute("aria-label") ?? "",
          ),
        )
        .toMatch(/^Notificaciones/);

      await guard.assertClean();
    } finally {
      await clearBellLeftovers();
    }
  });

  test("BELL-E3 mark-all empties No leídas, Preferencias opens, page escape works", async ({
    page,
  }) => {
    const guard = guardPage(page);
    const stamp = Date.now();
    const titleA = `E2E bell markall a ${stamp}`;
    const titleB = `E2E bell markall b ${stamp}`;
    const scope = await notificationScope();
    const seededIds: string[] = [];

    try {
      await clearBellLeftovers();
      const rows = await restSend<{ id: string }[]>("POST", "notifications", [
        {
          study_id: scope.study_id,
          user_id: scope.user_id,
          category: "equipo",
          title: titleA,
          body: "Fila para el marcado masivo del panel.",
          channel: "in_app",
        },
        {
          study_id: scope.study_id,
          user_id: scope.user_id,
          category: "equipo",
          title: titleB,
          body: "Otra fila para el marcado masivo del panel.",
          channel: "in_app",
        },
      ]);
      seededIds.push(...rows.map((row) => row.id));

      await page.goto("/expedientes");
      await expect(
        page.getByRole("heading", { name: "Expedientes", exact: true }),
      ).toBeVisible();

      await openPanel(page);
      await panel(page).getByRole("tab").nth(1).click();
      await expect(panel(page).getByText(titleA)).toBeVisible();
      await expect(panel(page).getByText(titleB)).toBeVisible();

      // Mark-all reaches the WHOLE list (not only the loaded rows).
      await panel(page)
        .getByRole("button", { name: "Marcar todas como leídas" })
        .click();
      await expect(page.getByText("Listo: marcaste todas como leídas.")).toBeVisible();
      // The tab refetches: nothing unread is left to show.
      await expect(
        panel(page).getByText("Estás al día con las novedades de tu estudio."),
      ).toBeVisible();
      await expect(bellButton(page)).toHaveAccessibleName("Notificaciones");
      const stored = await restGet<{ read_at: string | null }[]>(
        `notifications?id=in.(${seededIds.join(",")})&select=read_at`,
      );
      expect(stored.every((row) => row.read_at !== null)).toBe(true);

      // Preferencias closes the panel and opens the modal (never two dialogs).
      await panel(page)
        .getByRole("button", { name: "Preferencias", exact: true })
        .click();
      await expect(panel(page)).toHaveCount(0);
      const modal = page.getByRole("dialog", {
        name: "Preferencias de notificaciones",
      });
      await expect(modal).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(modal).toHaveCount(0);

      // The footer escapes to the full page.
      await openPanel(page);
      await panel(page)
        .getByRole("link", { name: "Ver la lista completa" })
        .click();
      await page.waitForURL("**/notificaciones");
      await expect(
        page.getByRole("heading", { name: "Notificaciones" }),
      ).toBeVisible();

      await guard.assertClean();
    } finally {
      for (const id of seededIds) {
        await restSend("DELETE", `notifications?id=eq.${id}`);
      }
      await clearBellLeftovers();
    }
  });
});
