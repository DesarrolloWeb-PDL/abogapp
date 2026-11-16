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

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({
  getBrowserClient: () => ({
    from: fromMock,
    auth: { getUser: vi.fn() },
  }),
}));

import {
  listNotifications,
  markNotificationRead,
  onNotificationsChanged,
  unreadCount,
} from "./notifications";

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
  calls.length = 0;
  responses.clear();
  fromMock.mockReset();
  fromMock.mockImplementation((table: string) => {
    const call: RecordedCall = { table, steps: [] };
    calls.push(call);
    return buildQuery(call);
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
