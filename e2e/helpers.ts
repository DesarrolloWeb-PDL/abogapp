/**
 * Shared helpers for the replica-test e2e suite.
 *
 * Selectors use roles and labels only (Spanish copy as the app renders it);
 * this module never reaches into CSS classes or app internals.
 */
import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const BASE_URL = "http://localhost:3000";

/** Confirmed demo account (real Supabase Auth, study membership attached). */
export const DEMO = {
  email: "prueba.abogapp@gmail.com",
  password: "demo-estudio-2026",
};

export const AUTH_FILE = "e2e/.auth/user.json";

/** Seed rows from supabase/seed.sql — the assertions quote them verbatim. */
export const SEED = {
  studyName: "Estudio Beltrán & Asociados",
  /** Fake-layer fallback the sidebar must NOT keep after the read resolves. */
  fakeStudyName: "Estudio Beltrán & Asoc.",
  fakeUserName: "Ana Beltrán",
  caseGomez: "Gómez, Rosa c/ Empresa de Luz S.A. s/ cobro de pesos",
  casePerez: "Pérez, Juan c/ Constructora del Sur SRL s/ despido",
  gomezId: "c0000000-0000-4000-8000-000000000001",
  notificationTitle: "Vence en 3 días: Contestar el informe pericial",
  waContacts: ["Marina Duarte", "Maria Perez"],
  /** Seeded plazo on the Gómez case: 10 días hábiles desde 2026-11-02. */
  gomezPlazoBadge: "Vence 16/11/2026",
};

/* ---------------------------------------------------------------- env ---- */

let envCache: Record<string, string> | null = null;

/** Reads .env.local (test process only — never shipped to the browser). */
export function envLocal(key: string): string {
  const value = optionalEnv(key);
  if (!value) throw new Error(`missing ${key} in .env.local`);
  return value;
}

/**
 * Same file, but optional: returns null when the variable is absent or
 * empty. Used by specs whose expectation depends on how the local project
 * is configured (e.g. the WhatsApp access token is not issued yet).
 */
export function optionalEnv(key: string): string | null {
  if (!envCache) {
    const raw = readFileSync(path.resolve(__dirname, "..", ".env.local"), "utf8");
    envCache = {};
    for (const line of raw.split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match) envCache[match[1]] = match[2];
    }
  }
  return envCache[key] || null;
}

/* ------------------------------------------------------------- guards ---- */

export interface GuardOptions {
  /** Expected console errors (e.g. aborted/forced-failed requests). */
  ignoreConsole?: (text: string) => boolean;
  /** Expected 5xx responses (e.g. a forced-500 fixture). */
  ignoreResponse?: (url: string) => boolean;
}

/**
 * Global spec guards from the skill: fail on any console error, any
 * uncaught page error and any 5xx response. Call `assertClean()` at the end
 * of the test (and before a deliberate failure assertion, if any).
 */
export function guardPage(page: Page, options: GuardOptions = {}) {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (options.ignoreConsole?.(text)) return;
    problems.push(`console error: ${text}`);
  });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() < 500) return;
    if (options.ignoreResponse?.(response.url())) return;
    problems.push(`${response.status()} on ${response.url()}`);
  });

  return {
    async assertClean() {
      expect(problems, "console / 5xx guard").toEqual([]);
    },
  };
}

/** Axe scan (wcag2a/2aa/21a/21aa) on the current screen — 0 violations.
 *
 * No waivers: every rule (including `label-content-name-mismatch`, BUG-001,
 * fixed) is enforced on every scan; any violation fails the test.
 */
export async function expectNoAxeViolations(
  page: Page,
  label: string,
): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const summary: string[] = [];
  for (const violation of results.violations) {
    for (const node of violation.nodes) {
      const target = node.target.join(" ");
      summary.push(
        `${violation.id} (${violation.impact ?? "n/a"}) ${target}: ${violation.help}`,
      );
    }
  }
  expect(summary, `axe violations — ${label}`).toEqual([]);
}

/**
 * The app's own error toasts/copy (`role="alert"`), excluding Next.js' always
 * present empty `#__next-route-announcer__` (also role="alert"), which would
 * otherwise make every alert assertion a strict-mode violation.
 */
export function appAlert(page: Page) {
  return page.getByRole("alert").filter({ hasText: /\S/ });
}

/* --------------------------------------------------------------- auth ---- */

/** UI login: lands on /expedientes with the seeded list visible. */
export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(DEMO.email);
  await page.getByLabel("Contraseña").fill(DEMO.password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await page.waitForURL("**/expedientes");
  await expect(
    page.getByRole("heading", { name: "Expedientes", exact: true }),
  ).toBeVisible();
}

/**
 * Keyboard-only tabbing until the browser-side predicate matches.
 * Returns false when the target was not reached within `max` presses.
 */
export async function tabUntil(
  page: Page,
  predicate: () => boolean,
  max = 40,
): Promise<boolean> {
  for (let i = 0; i < max; i++) {
    if (await page.evaluate(predicate)) return true;
    await page.keyboard.press("Tab");
  }
  return page.evaluate(predicate);
}

/* --------------------------------------------------------------- REST ---- */

let tokenPromise: Promise<string> | null = null;

/** Demo-user access token (one password grant per test run, memoised). */
export function demoToken(): Promise<string> {
  tokenPromise ??= (async () => {
    const response = await fetch(
      `${envLocal("NEXT_PUBLIC_SUPABASE_URL")}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          apikey: envLocal("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: DEMO.email, password: DEMO.password }),
      },
    );
    const data = (await response.json()) as { access_token?: string };
    if (!data.access_token) {
      throw new Error(`demo token grant failed: ${response.status}`);
    }
    return data.access_token;
  })();
  return tokenPromise;
}

/** RLS-scoped read of our own clone's REST API (RLS: demo user only). */
export async function restGet<T>(pathAndQuery: string): Promise<T> {
  const response = await fetch(
    `${envLocal("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/${pathAndQuery}`,
    {
      headers: {
        apikey: envLocal("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
        authorization: `Bearer ${await demoToken()}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`REST ${pathAndQuery} -> ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * RLS-scoped REST write (POST/DELETE) with `return=representation`, so a
 * spec can seed a row and read it back (or clean it up) through the same
 * demo-user credentials `restGet` uses.
 */
export async function restSend<T = unknown>(
  method: "POST" | "DELETE",
  pathAndQuery: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(
    `${envLocal("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/${pathAndQuery}`,
    {
      method,
      headers: {
        apikey: envLocal("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
        authorization: `Bearer ${await demoToken()}`,
        "content-type": "application/json",
        prefer: "return=representation",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw new Error(`REST ${method} ${pathAndQuery} -> ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * RLS-scoped REST update (PATCH) with `return=representation` — the write
 * counterpart of `restGet` for row updates (e.g. restoring bot_settings in
 * a spec's cleanup). Empty result array = no matching row, still a success.
 */
export async function restPatch<T = unknown>(
  pathAndQuery: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(
    `${envLocal("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/${pathAndQuery}`,
    {
      method: "PATCH",
      headers: {
        apikey: envLocal("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
        authorization: `Bearer ${await demoToken()}`,
        "content-type": "application/json",
        prefer: "return=representation",
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw new Error(`REST PATCH ${pathAndQuery} -> ${response.status}`);
  }
  return (await response.json()) as T;
}

/* ------------------------------------------------------------- webhook ---- */

/** `X-Hub-Signature-256` over the raw body, exactly like Meta signs it. */
export function hubSignature(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

/** Meta WhatsApp Cloud API delivery shape (text message). */
export function metaMessagePayload(options: {
  id: string;
  from: string;
  text: string;
  profileName?: string;
}): string {
  const message: Record<string, unknown> = {
    id: options.id,
    from: options.from,
    type: "text",
    text: { body: options.text },
  };
  if (options.profileName) message.profile = { name: options.profileName };

  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1000000000000000",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15551234567" },
              messages: [message],
            },
          },
        ],
      },
    ],
  });
}

/* -------------------------------------------------------------- dates ---- */

/** `YYYY-MM-DD` → `dd/mm/yyyy` (the app's formatDate contract). */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

/** timestamptz → the ART calendar day it belongs to. */
export function toArtDate(isoTimestamp: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(isoTimestamp));
}

/**
 * Independent business-day computation (mirrors the documented engine rules:
 * count starts the day after `fechaEfectiva`; Saturdays, Sundays and every
 * calendar_days row are skipped). Used to cross-check the DB trigger.
 */
export function addBusinessDays(
  fechaEfectiva: string,
  cantidad: number,
  nonWorkingDays: Iterable<string>,
): string {
  const nonWorking = new Set(nonWorkingDays);
  const cursor = new Date(`${fechaEfectiva}T12:00:00Z`);
  let added = 0;
  while (added < cantidad) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const iso = cursor.toISOString().slice(0, 10);
    const weekday = cursor.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    if (nonWorking.has(iso)) continue;
    added += 1;
  }
  return cursor.toISOString().slice(0, 10);
}
