import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Supabase-driver study contract, fully mocked: no live project, no network.
 * These tests pin the wizard's jurisdictions end-to-end (createStudy input →
 * `studies` insert → getMyStudy read-back) and the `init_study_defaults`
 * RPC handshake the onboarding membership depends on.
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

const { fromMock, getUserMock, rpcMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  getUserMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getBrowserClient: () => ({
    from: fromMock,
    auth: { getUser: getUserMock },
    rpc: rpcMock,
  }),
}));

import { createStudy, getMyStudy } from "./studies";

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
  rpcMock.mockReset();
  fromMock.mockImplementation((table: string) => {
    const call: RecordedCall = { table, steps: [] };
    calls.push(call);
    return buildQuery(call);
  });
  getUserMock.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const STUDY_ROW = {
  id: "study-9",
  name: "Estudio Nuevo",
  plan_key: "trial",
  jurisdictions: ["Santa Fe", "Córdoba"],
  created_at: "2026-11-14T00:00:00.000Z",
};

describe("supabase driver", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-demo");
    rpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("createStudy persists the wizard's jurisdictions and calls init_study_defaults", async () => {
    queueResponse("studies", { data: STUDY_ROW, error: null });

    const study = await createStudy({
      name: "  Estudio Nuevo  ",
      jurisdictions: [" Santa Fe ", "Córdoba", ""],
    });

    const write = calls.find((call) => call.table === "studies");
    expect(write?.steps[0]).toEqual({
      name: "insert",
      args: [
        {
          name: "Estudio Nuevo",
          plan_key: "trial",
          created_by: "user-1",
          jurisdictions: ["Santa Fe", "Córdoba"],
        },
      ],
    });
    expect(rpcMock).toHaveBeenCalledWith("init_study_defaults", {
      p_study_id: "study-9",
      p_owner_id: "user-1",
    });
    expect(study.jurisdictions).toEqual(["Santa Fe", "Córdoba"]);
  });

  it("createStudy surfaces a failed init_study_defaults RPC", async () => {
    queueResponse("studies", { data: STUDY_ROW, error: null });
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    await expect(
      createStudy({ name: "Estudio Nuevo", jurisdictions: ["Santa Fe"] }),
    ).rejects.toMatchObject({ code: "save_failed" });
  });

  it("getMyStudy reads the latest membership's study with its jurisdictions", async () => {
    queueResponse("memberships", { data: { study: STUDY_ROW }, error: null });

    const mine = await getMyStudy();

    expect(mine?.id).toBe("study-9");
    expect(mine?.name).toBe("Estudio Nuevo");
    expect(mine?.jurisdictions).toEqual(["Santa Fe", "Córdoba"]);

    const read = calls.find((call) => call.table === "memberships");
    expect(read?.steps).toContainEqual({ name: "eq", args: ["status", "active"] });
  });

  it("maps a pre-migration study row (no jurisdictions column) to an empty list", async () => {
    queueResponse("memberships", {
      data: {
        study: {
          id: "study-9",
          name: "Estudio Viejo",
          plan_key: "trial",
          created_at: "2026-11-01T00:00:00.000Z",
        },
      },
      error: null,
    });

    const mine = await getMyStudy();

    expect(mine?.name).toBe("Estudio Viejo");
    expect(mine?.jurisdictions).toEqual([]);
  });
});
