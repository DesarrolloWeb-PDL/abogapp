import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Supabase-driver notifications contract, fully mocked: no live project, no
 * network. The fake branch keeps its shapes and order (newest first, own rows
 * only, read-state flips notifying subscribers once) — these tests pin the
 * RLS-scoped equivalents and the DB category ↔ app category mapping.
 */

interface QueryResponse {
  data?: unknown;
  error?: { message: string } | null;
  count?: number | null;
}

interface RecordedCall {
  table: string;
  steps: Array<{ name: string; args: unknown[] }>;
}

interface MockQuery extends PromiseLike<QueryResponse> {
  select: (...args: unknown[]) => MockQuery;
  insert: (...args: unknown[]) => MockQuery;
  update: (...args: unknown[]) => MockQuery;
  eq: (...args: unknown[]) => MockQuery;
  is: (...args: unknown[]) => MockQuery;
  not: (...args: unknown[]) => MockQuery;
  order: (...args: unknown[]) => MockQuery;
  limit: (...args: unknown[]) => MockQuery;
  single: () => PromiseLike<QueryResponse>;
  maybeSingle: () => PromiseLike<QueryResponse>;
}

const { fromMock, getUserMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  getUserMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getBrowserClient: () => ({
    from: fromMock,
    auth: { getUser: getUserMock },
  }),
}));

import {
  clearNotificationPreferenceCache,
  insertNotification,
  listNotificationPreferences,
  listNotifications,
  listNotificationsPage,
  markNotificationRead,
  onNotification,
  onNotificationsChanged,
  unreadCount,
  updateNotificationPreference,
} from "./notifications";
import { insertNotificationSupabase } from "@/lib/supabase/notifications";
import { getStore, resetDataStore } from "./store";
import { signIn } from "./auth";
import { seedDemoPassword, seedUser } from "@/lib/seed";
import type { AppNotification } from "@/lib/types";

const calls: RecordedCall[] = [];
const responses = new Map<string, QueryResponse[]>();

function queueResponse(table: string, response: QueryResponse): void {
  const queue = responses.get(table) ?? [];
  queue.push(response);
  responses.set(table, queue);
}

function respond(table: string): QueryResponse {
  const next = responses.get(table)?.shift();
  if (!next) throw new Error(`unexpected supabase query: ${table}`);
  return next;
}

function asSingle(response: QueryResponse): QueryResponse {
  if (Array.isArray(response.data)) {
    return { ...response, data: response.data[0] ?? null };
  }
  return response;
}

function buildQuery(call: RecordedCall): MockQuery {
  const step =
    (name: string) =>
    (...args: unknown[]) => {
      call.steps.push({ name, args });
      return query;
    };
  const query: MockQuery = {
    select: step("select"),
    insert: step("insert"),
    update: step("update"),
    eq: step("eq"),
    is: step("is"),
    not: step("not"),
    order: step("order"),
    limit: step("limit"),
    single: () => {
      call.steps.push({ name: "single", args: [] });
      return Promise.resolve(asSingle(respond(call.table)));
    },
    maybeSingle: () => {
      call.steps.push({ name: "maybeSingle", args: [] });
      return Promise.resolve(asSingle(respond(call.table)));
    },
    // PromiseLike-compatible so `await chain` resolves to QueryResponse.
    then<T1 = QueryResponse, T2 = never>(
      onFulfilled?: ((value: QueryResponse) => T1 | PromiseLike<T1>) | null,
      onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ): PromiseLike<T1 | T2> {
      return Promise.resolve(respond(call.table)).then(onFulfilled, onRejected);
    },
  };
  return query;
}

beforeEach(() => {
  // Fresh store + empty preference/gate caches per test: a pause written by
  // one case must never gate the emissions of the next one.
  resetDataStore();
  clearNotificationPreferenceCache();
  calls.length = 0;
  responses.clear();
  fromMock.mockReset();
  fromMock.mockImplementation((table: string) => {
    const call: RecordedCall = { table, steps: [] };
    calls.push(call);
    return buildQuery(call);
  });
  getUserMock.mockReset();
  getUserMock.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const NOTIFICATION_ROWS = [
  {
    id: "notif-1",
    study_id: "study-9",
    user_id: "user-1",
    category: "sistemas_judiciales",
    title: "Vence el 23/11/2026",
    body: "El plazo de «Informe contable» (10 días hábiles) vence el 23/11/2026.",
    deep_link: "/expedientes/case-a?tab=pruebas",
    read_at: null,
    created_at: "2026-11-14T09:00:00.000Z",
  },
  {
    id: "notif-3",
    study_id: "study-9",
    user_id: "user-1",
    category: "causas",
    title: "Expediente actualizado",
    body: "Se registró una nueva actividad.",
    deep_link: "/expedientes/case-c",
    read_at: "2026-11-12T16:10:00.000Z",
    created_at: "2026-11-12T16:10:00.000Z",
  },
];

describe("fake driver", () => {
  it("listNotifications answers an empty list without a session (no keys present)", async () => {
    expect(await listNotifications()).toEqual([]);
    expect(await unreadCount()).toBe(0);
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("supabase driver", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-demo");
  });

  it("listNotifications maps own rows newest first", async () => {
    queueResponse("notifications", { data: NOTIFICATION_ROWS, error: null });

    const notifications = await listNotifications();

    expect(notifications).toEqual([
      {
        id: "notif-1",
        studyId: "study-9",
        userId: "user-1",
        titulo: "Vence el 23/11/2026",
        detalle: "El plazo de «Informe contable» (10 días hábiles) vence el 23/11/2026.",
        categoria: "Plazos",
        leida: false,
        createdAt: "2026-11-14T09:00:00.000Z",
        enlace: "/expedientes/case-a?tab=pruebas",
      },
      {
        id: "notif-3",
        studyId: "study-9",
        userId: "user-1",
        titulo: "Expediente actualizado",
        detalle: "Se registró una nueva actividad.",
        categoria: "Expedientes",
        leida: true,
        createdAt: "2026-11-12T16:10:00.000Z",
        enlace: "/expedientes/case-c",
      },
    ]);

    // RLS (`notifications_self`) owns the "own rows" filter; only the
    // newest-first order is asked of the query.
    const read = calls.find((call) => call.table === "notifications");
    expect(read?.steps).toContainEqual({
      name: "order",
      args: ["created_at", { ascending: false }],
    });
  });

  it("markNotificationRead flips only unread rows and notifies subscribers once", async () => {
    // First call: unread row updated → change emitted (fake parity).
    queueResponse("notifications", { data: [{ id: "notif-1" }], error: null });
    // Second call: already read → zero rows updated → no second emission.
    queueResponse("notifications", { data: [], error: null });

    let changes = 0;
    const unsubscribe = onNotificationsChanged(() => {
      changes += 1;
    });

    await markNotificationRead("notif-1");
    expect(changes).toBe(1);

    await markNotificationRead("notif-1");
    unsubscribe();
    expect(changes).toBe(1);

    const writes = calls.filter((call) => call.table === "notifications");
    expect(writes).toHaveLength(2);
    const firstWrite = writes[0];
    expect(firstWrite?.steps).toContainEqual({
      name: "update",
      args: [{ read_at: expect.any(String) }],
    });
    expect(firstWrite?.steps).toContainEqual({ name: "eq", args: ["id", "notif-1"] });
    expect(firstWrite?.steps).toContainEqual({
      name: "is",
      args: ["read_at", null],
    });
  });

  it("markNotificationRead maps a failed update onto save_failed", async () => {
    queueResponse("notifications", {
      data: null,
      error: { message: "boom" },
    });

    await expect(markNotificationRead("notif-1")).rejects.toMatchObject({
      code: "save_failed",
    });
  });

  it("unreadCount counts unread rows with an exact head count", async () => {
    queueResponse("notifications", { count: 2, error: null });

    expect(await unreadCount()).toBe(2);

    const read = calls.find((call) => call.table === "notifications");
    expect(read?.steps).toContainEqual({
      name: "select",
      args: ["id", { count: "exact", head: true }],
    });
    expect(read?.steps).toContainEqual({ name: "is", args: ["read_at", null] });
  });

  it("unreadCount answers zero when RLS returns no rows", async () => {
    queueResponse("notifications", { count: 0, error: null });
    expect(await unreadCount()).toBe(0);
  });
});

/* ---------------------------------------------------------------------- */
/* S21 M2: pagination, filters, preferences and the emission gate.        */
/* ---------------------------------------------------------------------- */

/** Open the seeded demo session (fake driver: no env keys stubbed here). */
async function signInAsSeedUser(): Promise<void> {
  const result = await signIn({
    email: seedUser.email,
    password: seedDemoPassword,
  });
  if (!result.ok) throw new Error(`signIn failed: ${result.error}`);
}

/** Push one synthetic row onto the fake store (newest-first ordering). */
function pushFakeNotification(
  partial: Partial<AppNotification> & { id: string },
): void {
  const entry: AppNotification = {
    studyId: "study-1",
    userId: seedUser.id,
    titulo: `Aviso ${partial.id}`,
    detalle: "Detalle del aviso",
    categoria: "Plazos",
    leida: false,
    createdAt: "2026-11-10T09:00:00.000Z",
    enlace: null,
    ...partial,
  };
  getStore().notifications.push(entry);
}

const INSERT_INPUT = {
  studyId: "study-9",
  userId: "user-1",
  titulo: "Aviso",
  detalle: "Detalle",
  enlace: null,
};

describe("fake driver — listNotificationsPage", () => {
  it("slices 20 at a time and reports hasMore/total (Cargar más contract)", async () => {
    await signInAsSeedUser();
    for (let i = 1; i <= 25; i += 1) {
      const id = `n-${String(i).padStart(2, "0")}`;
      pushFakeNotification({
        id,
        createdAt: `2026-11-15T10:${String(i).padStart(2, "0")}:00.000Z`,
      });
    }

    const first = await listNotificationsPage();
    expect(first.items).toHaveLength(20);
    expect(first.items[0]?.id).toBe("n-25"); // newest first
    expect(first.total).toBe(28); // 25 synthetic + 3 seeded
    expect(first.hasMore).toBe(true);

    const second = await listNotificationsPage({ offset: 20 });
    expect(second.items).toHaveLength(8);
    expect(second.total).toBe(28);
    expect(second.hasMore).toBe(false);

    const beyond = await listNotificationsPage({ offset: 40 });
    expect(beyond.items).toHaveLength(0);
    expect(beyond.hasMore).toBe(false);
  });

  it("combines search, estado and categoria predicates", async () => {
    await signInAsSeedUser();
    pushFakeNotification({
      id: "n-causa",
      categoria: "Expedientes",
      titulo: "Expediente Gómez actualizado",
      detalle: "Nueva actividad en Gómez, Rosa",
      leida: true,
      createdAt: "2026-11-15T09:00:00.000Z",
    });

    const unread = await listNotificationsPage({ estado: "no_leidas" });
    expect(unread.items.every((item) => !item.leida)).toBe(true);
    expect(unread.total).toBe(2); // the two seeded unread Plazos rows

    const read = await listNotificationsPage({ estado: "leidas" });
    expect(read.items.every((item) => item.leida)).toBe(true);
    expect(read.total).toBe(2); // seeded notif-3 + n-causa

    const causas = await listNotificationsPage({ categoria: "causas" });
    expect(causas.items.map((item) => item.id).sort()).toEqual([
      "n-causa",
      "notif-3",
    ]);

    // Accent-tolerant search over title + body (lib/search): "gomez" hits
    // "Gómez" without ever storing the accent.
    const search = await listNotificationsPage({ search: "gomez" });
    expect(search.items.map((item) => item.id)).toEqual(["n-causa"]);

    const combined = await listNotificationsPage({
      estado: "leidas",
      categoria: "causas",
      search: "gomez",
    });
    expect(combined.items.map((item) => item.id)).toEqual(["n-causa"]);
    expect(combined.total).toBe(1);
    expect(combined.hasMore).toBe(false);

    const none = await listNotificationsPage({ search: "qwertyuiopzz" });
    expect(none.items).toHaveLength(0);
    expect(none.total).toBe(0);
    expect(none.hasMore).toBe(false);
  });

  it("maps the three Sistema-side buckets onto the app's Sistema rows (documented fake collapse)", async () => {
    await signInAsSeedUser();
    pushFakeNotification({ id: "n-sistema", categoria: "Sistema" });

    for (const bucket of ["tareas", "facturacion", "novedades_consejos"]) {
      const page = await listNotificationsPage({ categoria: bucket });
      expect(page.items.map((item) => item.id)).toContain("n-sistema");
    }
    const equipo = await listNotificationsPage({ categoria: "equipo" });
    expect(equipo.items).toHaveLength(0); // no Equipo rows in the seed
    expect(equipo.total).toBe(0);
  });
});

describe("fake driver — notification preferences", () => {
  it("lists [] without a session and six defaults with one", async () => {
    expect(await listNotificationPreferences()).toEqual([]);

    await signInAsSeedUser();
    const defaults = await listNotificationPreferences();
    expect(defaults).toHaveLength(6);
    expect(defaults.every((row) => row.inApp && row.email)).toBe(true);
  });

  it("persists per-channel updates without touching the other channel", async () => {
    await signInAsSeedUser();

    const paused = await updateNotificationPreference("tareas", "in_app", false);
    expect(paused).toEqual({ category: "tareas", inApp: false, email: true });

    const afterPause = await listNotificationPreferences();
    expect(afterPause.find((row) => row.category === "tareas")).toEqual({
      category: "tareas",
      inApp: false,
      email: true,
    });
    expect(afterPause.filter((row) => row.inApp)).toHaveLength(5);

    const mailOff = await updateNotificationPreference("tareas", "email", false);
    expect(mailOff).toEqual({ category: "tareas", inApp: false, email: false });

    // Re-enabling restores exactly that channel.
    const backOn = await updateNotificationPreference("tareas", "in_app", true);
    expect(backOn).toEqual({ category: "tareas", inApp: true, email: false });
  });

  it("rejects an unknown category/channel and a non-boolean value", async () => {
    await signInAsSeedUser();
    await expect(
      updateNotificationPreference("nope", "in_app", false),
    ).rejects.toMatchObject({ code: "missing_fields" });
    await expect(
      updateNotificationPreference("tareas", "push" as never, false),
    ).rejects.toMatchObject({ code: "missing_fields" });
    await expect(
      updateNotificationPreference("tareas", "in_app", "si" as never),
    ).rejects.toMatchObject({ code: "missing_fields" });
  });
});

describe("fake driver — emission gate", () => {
  it("allowed by default (miss fails open), disabled skips insert+emit, re-enable restores", async () => {
    await signInAsSeedUser();
    const before = getStore().notifications.length;

    let emitted = 0;
    const unsubscribe = onNotification(() => {
      emitted += 1;
    });

    // Allowed: nothing stored → the migration default (on) applies → the
    // row is written and the listener seam fires.
    const allowed = insertNotification({
      ...INSERT_INPUT,
      userId: seedUser.id,
      titulo: "Aviso permitido",
      categoria: "Plazos",
    });
    expect(allowed).not.toBeNull();
    expect(getStore().notifications).toHaveLength(before + 1);
    expect(emitted).toBe(1);

    // Disabled: pausing the bucket the emitter maps to stops everything —
    // no row, no emission, null back to the caller.
    await updateNotificationPreference("sistemas_judiciales", "in_app", false);
    const skipped = insertNotification({
      ...INSERT_INPUT,
      userId: seedUser.id,
      titulo: "Aviso pausado",
      categoria: "Plazos",
    });
    expect(skipped).toBeNull();
    expect(getStore().notifications).toHaveLength(before + 1);
    expect(emitted).toBe(1);

    // The F04 task alert (app category "Sistema") answers to "Tareas".
    await updateNotificationPreference("tareas", "in_app", false);
    expect(
      insertNotification({
        ...INSERT_INPUT,
        userId: seedUser.id,
        titulo: "Tarea pausada",
        categoria: "Sistema",
      }),
    ).toBeNull();
    expect(getStore().notifications).toHaveLength(before + 1);
    expect(emitted).toBe(1);

    // Re-enabling lets the next emission through again.
    await updateNotificationPreference(
      "sistemas_judiciales",
      "in_app",
      true,
    );
    const restored = insertNotification({
      ...INSERT_INPUT,
      userId: seedUser.id,
      titulo: "Aviso otra vez",
      categoria: "Plazos",
    });
    expect(restored).not.toBeNull();
    expect(getStore().notifications).toHaveLength(before + 2);
    expect(emitted).toBe(2);
    unsubscribe();
  });
});

/** Raw rows shared by the supabase page/parity tests (newest first). */
const PAGE_ROWS = [
  {
    id: "p-1",
    study_id: "study-9",
    user_id: "user-1",
    category: "sistemas_judiciales",
    title: "Vence el 23/11/2026",
    body: "El plazo de «Informe contable» vence el 23/11/2026.",
    deep_link: null,
    read_at: null,
    created_at: "2026-11-14T09:00:00.000Z",
  },
  {
    id: "p-2",
    study_id: "study-9",
    user_id: "user-1",
    category: "causas",
    title: "Expediente Gómez actualizado",
    body: "Se adjunta informe contable.",
    deep_link: "/expedientes/case-b",
    read_at: "2026-11-13T10:00:00.000Z",
    created_at: "2026-11-13T10:00:00.000Z",
  },
  {
    id: "p-3",
    study_id: "study-9",
    user_id: "user-1",
    category: "facturacion",
    title: "Factura del mes",
    body: "Pago recibido.",
    deep_link: null,
    read_at: "2026-11-12T10:00:00.000Z",
    created_at: "2026-11-12T10:00:00.000Z",
  },
];

describe("supabase driver — listNotificationsPage", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-demo");
  });

  it("slices the newest rows and reports hasMore/total", async () => {
    queueResponse("notifications", { data: PAGE_ROWS, error: null });
    const first = await listNotificationsPage({ limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual(["p-1", "p-2"]);
    expect(first.total).toBe(3);
    expect(first.hasMore).toBe(true);

    queueResponse("notifications", { data: PAGE_ROWS, error: null });
    const rest = await listNotificationsPage({ limit: 2, offset: 2 });
    expect(rest.items.map((item) => item.id)).toEqual(["p-3"]);
    expect(rest.total).toBe(3);
    expect(rest.hasMore).toBe(false);
  });

  it("applies estado, categoria and search together on the raw buckets", async () => {
    queueResponse("notifications", { data: PAGE_ROWS, error: null });
    const unread = await listNotificationsPage({ estado: "no_leidas" });
    expect(unread.items.map((item) => item.id)).toEqual(["p-1"]);
    expect(unread.total).toBe(1);

    queueResponse("notifications", { data: PAGE_ROWS, error: null });
    const read = await listNotificationsPage({ estado: "leidas" });
    expect(read.items.map((item) => item.id)).toEqual(["p-2", "p-3"]);

    // The raw bucket tells facturacion apart from the "Sistema" chip it
    // collapses to on read — the fake layer cannot (documented above).
    queueResponse("notifications", { data: PAGE_ROWS, error: null });
    const facturacion = await listNotificationsPage({
      categoria: "facturacion",
    });
    expect(facturacion.items.map((item) => item.titulo)).toEqual([
      "Factura del mes",
    ]);

    queueResponse("notifications", { data: PAGE_ROWS, error: null });
    const search = await listNotificationsPage({ search: "gomez" });
    expect(search.items.map((item) => item.id)).toEqual(["p-2"]);

    queueResponse("notifications", { data: PAGE_ROWS, error: null });
    const combined = await listNotificationsPage({
      estado: "leidas",
      categoria: "causas",
      search: "informe",
    });
    expect(combined.items.map((item) => item.id)).toEqual(["p-2"]);
    expect(combined.total).toBe(1);
    expect(combined.hasMore).toBe(false);

    queueResponse("notifications", { data: PAGE_ROWS, error: null });
    const none = await listNotificationsPage({ search: "qwertyuiopzz" });
    expect(none.items).toHaveLength(0);
    expect(none.total).toBe(0);
    expect(none.hasMore).toBe(false);
  });

  it("maps a failed row read onto save_failed", async () => {
    queueResponse("notifications", { data: null, error: { message: "boom" } });
    await expect(listNotificationsPage()).rejects.toMatchObject({
      code: "save_failed",
    });
  });
});

describe("supabase driver — notification preferences", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-demo");
  });

  it("list upserts the missing buckets and answers all six", async () => {
    queueResponse("notification_preferences", {
      data: [{ category: "tareas", in_app: false, email: true }],
      error: null,
    });
    // The multi-row insert for the five missing buckets (no representation
    // requested, so data stays null).
    queueResponse("notification_preferences", { data: null, error: null });

    const prefs = await listNotificationPreferences();
    expect(prefs).toHaveLength(6);
    expect(prefs.find((row) => row.category === "tareas")).toEqual({
      category: "tareas",
      inApp: false,
      email: true,
    });
    expect(prefs.filter((row) => row.inApp)).toHaveLength(5);

    const insertCall = calls.find(
      (call) =>
        call.table === "notification_preferences" &&
        call.steps.some((step) => step.name === "insert"),
    );
    const payload = insertCall?.steps.find((step) => step.name === "insert")
      ?.args[0] as Array<{ category: string; in_app: boolean; email: boolean }>;
    expect(payload).toHaveLength(5);
    expect(payload.map((row) => row.category)).not.toContain("tareas");
    expect(
      payload.every((row) => row.in_app === true && row.email === true),
    ).toBe(true);
  });

  it("list maps a failed read onto save_failed", async () => {
    queueResponse("notification_preferences", {
      data: null,
      error: { message: "boom" },
    });
    await expect(listNotificationPreferences()).rejects.toMatchObject({
      code: "save_failed",
    });
  });

  it("update patches an existing row (bot_settings update-first order)", async () => {
    queueResponse("notification_preferences", {
      data: { category: "equipo", in_app: false, email: true },
      error: null,
    });

    const updated = await updateNotificationPreference(
      "equipo",
      "in_app",
      false,
    );
    expect(updated).toEqual({ category: "equipo", inApp: false, email: true });

    const write = calls.find(
      (call) => call.table === "notification_preferences",
    );
    expect(write?.steps).toContainEqual({
      name: "update",
      args: [{ in_app: false }],
    });
    expect(write?.steps).toContainEqual({ name: "eq", args: ["user_id", "user-1"] });
    expect(write?.steps).toContainEqual({
      name: "eq",
      args: ["category", "equipo"],
    });
  });

  it("update inserts when the user has no row yet", async () => {
    // update → no matching row → insert with the migration defaults for
    // the untouched channel (email stays true).
    queueResponse("notification_preferences", { data: null, error: null });
    queueResponse("notification_preferences", {
      data: { category: "equipo", in_app: false, email: true },
      error: null,
    });

    const created = await updateNotificationPreference(
      "equipo",
      "in_app",
      false,
    );
    expect(created).toEqual({ category: "equipo", inApp: false, email: true });

    const insertCall = calls.find(
      (call) =>
        call.table === "notification_preferences" &&
        call.steps.some((step) => step.name === "insert"),
    );
    expect(insertCall?.steps.find((step) => step.name === "insert")?.args[0])
      .toEqual({
        user_id: "user-1",
        category: "equipo",
        in_app: false,
        email: true,
      });
  });
});

describe("supabase driver — emission gate", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-demo");
  });

  const INSERTED_ROW = {
    id: "n-ok",
    study_id: "study-9",
    user_id: "user-1",
    category: "sistemas_judiciales",
    title: "Aviso",
    body: "Detalle",
    deep_link: null,
    read_at: null,
    created_at: "2026-11-14T09:00:00.000Z",
  };

  it("allowed: in_app on → the insert runs", async () => {
    queueResponse("notification_preferences", {
      data: { in_app: true },
      error: null,
    });
    queueResponse("notifications", { data: INSERTED_ROW, error: null });

    const result = await insertNotificationSupabase({
      ...INSERT_INPUT,
      categoria: "Plazos",
    });
    expect(result).not.toBeNull();
    expect(result?.id).toBe("n-ok");
    expect(calls.filter((call) => call.table === "notifications")).toHaveLength(1);
  });

  it("disabled: in_app off → no insert, null back, cache reused next time", async () => {
    // Only ONE preference response is queued: the second emission must hit
    // the cache. If the gate re-read (or the insert ran), the mock would
    // throw / consume a missing response and fail this test.
    queueResponse("notification_preferences", {
      data: { in_app: false },
      error: null,
    });

    const first = await insertNotificationSupabase({
      ...INSERT_INPUT,
      titulo: "Primero",
      categoria: "Plazos",
    });
    expect(first).toBeNull();

    const second = await insertNotificationSupabase({
      ...INSERT_INPUT,
      titulo: "Segundo",
      categoria: "Plazos",
    });
    expect(second).toBeNull();

    expect(calls.filter((call) => call.table === "notifications")).toHaveLength(0);
    expect(
      calls.filter((call) => call.table === "notification_preferences"),
    ).toHaveLength(1);
  });

  it("read-fails-open: a broken preference read still inserts the alert", async () => {
    // No response queued for notification_preferences: the mock throws on
    // the read, the gate swallows it and defaults to "allowed" — a broken
    // read must never silently drop an alert.
    queueResponse("notifications", { data: INSERTED_ROW, error: null });

    const result = await insertNotificationSupabase({
      ...INSERT_INPUT,
      categoria: "Plazos",
    });
    expect(result).not.toBeNull();
    expect(calls.filter((call) => call.table === "notifications")).toHaveLength(1);
  });
});

describe("driver parity — listNotificationsPage", () => {
  it("fake and supabase answer the same shape for the same rows", async () => {
    // Supabase side: keys present just for this read.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-demo");
    queueResponse("notifications", { data: PAGE_ROWS, error: null });
    const viaSupabase = await listNotificationsPage({
      estado: "leidas",
      search: "informe",
    });

    // Fake side: same logical row, no keys.
    vi.unstubAllEnvs();
    await signInAsSeedUser();
    pushFakeNotification({
      id: "p-2",
      studyId: "study-9",
      categoria: "Expedientes",
      titulo: "Expediente Gómez actualizado",
      detalle: "Se adjunta informe contable.",
      leida: true,
      createdAt: "2026-11-13T10:00:00.000Z",
      enlace: "/expedientes/case-b",
    });
    const viaFake = await listNotificationsPage({
      estado: "leidas",
      search: "informe",
    });

    expect(viaFake.items).toEqual(viaSupabase.items);
    expect(viaFake.total).toBe(viaSupabase.total);
    expect(viaFake.hasMore).toBe(viaSupabase.hasMore);
    expect(viaFake.total).toBe(1);
  });
});
