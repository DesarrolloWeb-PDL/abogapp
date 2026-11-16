import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The S12 non-working-days seam in both drivers: the exported reference never
 * changes shape (ReadonlySet<string> of ISO dates), the fake driver keeps the
 * static feria set, and the supabase driver rebuilds the SAME set from
 * calendar_days with es_habil()'s predicate (system rows + own-study rows).
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

import { loadNonWorkingDays, nonWorkingDays } from "./calendar";

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
  getUserMock.mockReset();
  fromMock.mockImplementation((table: string) => {
    const call: RecordedCall = { table, steps: [] };
    calls.push(call);
    return buildQuery(call);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("fake driver", () => {
  it("keeps the static feria set without touching Supabase", async () => {
    const loaded = await loadNonWorkingDays();

    // Same stable reference the S12 form consumes.
    expect(loaded).toBe(nonWorkingDays);
    // Static content: judicial feria for demo plazos (January 2026).
    expect(loaded.has("2026-01-15")).toBe(true);
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("supabase driver", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-demo");
  });

  it("rebuilds the same set from calendar_days (system + own study only)", async () => {
    // getMyStudy (membership path) decides which study-scoped rows count.
    getUserMock.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    queueResponse("memberships", {
      data: {
        study: {
          id: "study-9",
          name: "Estudio Demo",
          plan_key: "trial",
          created_at: "2026-11-01T00:00:00.000Z",
        },
      },
      error: null,
    });
    queueResponse("calendar_days", {
      data: [
        // System rows (study_id null) always count — feria seeded by
        // seed_feria_year() plus, later, the national feriados.
        { study_id: null, day: "2026-01-05", kind: "feria" },
        { study_id: null, day: "2026-06-15", kind: "feriado" },
        // Own-study rows count (studio días inhábiles, S30).
        { study_id: "study-9", day: "2026-03-02", kind: "inhabil" },
        // Another study's row must NOT leak in (es_habil filters by study).
        { study_id: "other-study", day: "2026-04-10", kind: "inhabil" },
      ],
      error: null,
    });

    const loaded = await loadNonWorkingDays();

    // The export shape is untouched: consumers keep the same reference.
    expect(loaded).toBe(nonWorkingDays);
    expect([...loaded].sort()).toEqual([
      "2026-01-05",
      "2026-03-02",
      "2026-06-15",
    ]);

    const read = calls.find((call) => call.table === "calendar_days");
    expect(read?.steps).toContainEqual({
      name: "select",
      args: ["study_id, day"],
    });
    expect(calls.some((call) => call.table === "memberships")).toBe(true);
  });
});
