import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedDemoPassword, seedUser } from "@/lib/seed";

/**
 * Case-stage (etapa) data-layer contract, fully mocked: no live project, no
 * network. listStages feeds the Etapa procesal select of the new-expediente
 * form (S07) and must answer with the study's `case_stages` rows in
 * `position` order — the same default set init_study_defaults seeds.
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
  eq: (...args: unknown[]) => MockQuery;
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

import { signIn } from "./auth";
import { listStages } from "./stages";
import { resetDataStore } from "./store";

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
    eq: step("eq"),
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
  // Fresh store per test: the fake-driver tests sign in, and the next one
  // must start from "no session, onboarding not finished".
  resetDataStore();
  fromMock.mockImplementation((table: string) => {
    const call: RecordedCall = { table, steps: [] };
    calls.push(call);
    return buildQuery(call);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Membership row that makes `getMyStudy()` resolve (studies driver path). */
function queueMembership(): void {
  queueResponse("memberships", {
    data: {
      study: {
        id: "study-9",
        name: "Estudio Demo",
        plan_key: "trial",
        jurisdictions: [],
        created_at: "2026-11-01T00:00:00.000Z",
      },
    },
    error: null,
  });
  getUserMock.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
}

describe("fake driver", () => {
  it("listStages still answers the seeded default set without any network", async () => {
    const signed = await signIn({
      email: seedUser.email,
      password: seedDemoPassword,
    });
    expect(signed.ok).toBe(true);

    const stages = await listStages();

    expect(stages.map((stage) => stage.name)).toEqual([
      "Inicial",
      "Trámite",
      "Prueba",
      "Sentencia",
      "Ejecución",
    ]);
    expect(stages.map((stage) => stage.position)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(stages.map((stage) => stage.id)).size).toBe(stages.length);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("listStages answers an empty list before onboarding finishes", async () => {
    const stages = await listStages();
    expect(stages).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("supabase driver", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-demo");
  });

  it("listStages reads the study's case_stages ordered by position", async () => {
    queueMembership();
    queueResponse("case_stages", {
      data: [
        { id: "stage-1", name: "Inicial", position: 1 },
        { id: "stage-2", name: "Trámite", position: 2 },
      ],
      error: null,
    });

    const stages = await listStages();

    expect(stages).toEqual([
      { id: "stage-1", name: "Inicial", position: 1 },
      { id: "stage-2", name: "Trámite", position: 2 },
    ]);

    const read = calls.find((call) => call.table === "case_stages");
    expect(read?.steps).toContainEqual({ name: "select", args: ["id, name, position"] });
    expect(read?.steps).toContainEqual({ name: "eq", args: ["study_id", "study-9"] });
    expect(read?.steps).toContainEqual({
      name: "order",
      args: ["position", { ascending: true }],
    });
    // Exactly two reads: the study lookup, then the study-scoped stages —
    // no cross-tenant or unrelated table is touched.
    expect(calls.map((call) => call.table)).toEqual([
      "memberships",
      "case_stages",
    ]);
  });
});
