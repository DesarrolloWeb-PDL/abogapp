import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedDemoPassword, seedUser } from "@/lib/seed";

/**
 * Case-stage (etapa) data-layer contract, fully mocked: no live project, no
 * network. listStages feeds the Etapa procesal select of the new-expediente
 * form (S07) and the Etapa filter of the list (both S07) and must answer
 * with the study's `case_stages` rows in `position` order — the same default
 * set init_study_defaults seeds. The S30 admin adds the CRUD contract:
 * create / rename / counts_as_active toggle / position swap / delete, with
 * the name validation and the last-stage guard running BEFORE any write.
 *
 * Test isolation note: the fake driver keeps its rows in module state (the
 * store has no stages table), so the fake describe runs as one ordered
 * flow — the lifecycle test restores the seeded five and the LAST fake test
 * is the only one allowed to leave a single stage behind.
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
  delete: (...args: unknown[]) => MockQuery;
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
import {
  createStage,
  deleteStage,
  listStages,
  moveStage,
  renameStage,
  setStageCountsAsActive,
  STAGE_NAME_MAX,
} from "./stages";
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
    update: step("update"),
    delete: step("delete"),
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
    // The seeded defaults all count as active on Inicio (S30).
    expect(stages.every((stage) => stage.countsAsActive)).toBe(true);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("listStages answers an empty list before onboarding finishes", async () => {
    const stages = await listStages();
    expect(stages).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("create → rename → toggle → move → delete keeps the seeded list consistent", async () => {
    const signed = await signIn({
      email: seedUser.email,
      password: seedDemoPassword,
    });
    expect(signed.ok).toBe(true);

    // createStage trims, appends at max position + 1 and honours the flag.
    const created = await createStage({
      name: "  Etapa E2E  ",
      countsAsActive: false,
    });
    expect(created).toEqual({
      id: expect.any(String),
      name: "Etapa E2E",
      position: 6,
      countsAsActive: false,
    });

    let stages = await listStages();
    expect(stages.map((stage) => stage.name)).toEqual([
      "Inicial",
      "Trámite",
      "Prueba",
      "Sentencia",
      "Ejecución",
      "Etapa E2E",
    ]);
    expect(stages.map((stage) => stage.position)).toEqual([1, 2, 3, 4, 5, 6]);

    const renamed = await renameStage(created.id, " Etapa E2E v2 ");
    expect(renamed).toEqual({ ...created, name: "Etapa E2E v2" });

    const toggled = await setStageCountsAsActive(created.id, true);
    expect(toggled.countsAsActive).toBe(true);

    // Position swap: two "up" steps walk the row past its neighbours and
    // renumber densely.
    await moveStage(created.id, "up");
    await moveStage(created.id, "up");
    stages = await listStages();
    expect(stages.map((stage) => stage.name)).toEqual([
      "Inicial",
      "Trámite",
      "Prueba",
      "Etapa E2E v2",
      "Sentencia",
      "Ejecución",
    ]);
    expect(stages.map((stage) => stage.position)).toEqual([1, 2, 3, 4, 5, 6]);

    await moveStage(created.id, "down");
    stages = await listStages();
    expect(stages.map((stage) => stage.name)).toEqual([
      "Inicial",
      "Trámite",
      "Prueba",
      "Sentencia",
      "Etapa E2E v2",
      "Ejecución",
    ]);

    // Edge request: the first row cannot move further up — a clean no-op.
    await moveStage(stages[0]!.id, "up");
    expect((await listStages()).map((stage) => stage.position)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);

    await deleteStage(created.id);
    stages = await listStages();
    expect(stages.map((stage) => stage.name)).toEqual([
      "Inicial",
      "Trámite",
      "Prueba",
      "Sentencia",
      "Ejecución",
    ]);
    expect(stages.every((stage) => stage.countsAsActive)).toBe(true);
    // The fake driver never touches Supabase.
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("rejects blank, oversized and duplicated names with typed codes before any write", async () => {
    const signed = await signIn({
      email: seedUser.email,
      password: seedDemoPassword,
    });
    expect(signed.ok).toBe(true);

    await expect(createStage({ name: "   " })).rejects.toMatchObject({
      code: "missing_fields",
    });
    await expect(
      createStage({ name: "x".repeat(STAGE_NAME_MAX + 1) }),
    ).rejects.toMatchObject({ code: "save_failed" });
    // Case-insensitive duplicate of the seeded "Inicial" (the DB unique
    // constraint is case-sensitive, so this check lives app-side).
    await expect(createStage({ name: "  iNiCiaL " })).rejects.toMatchObject({
      code: "save_failed",
    });
    await expect(renameStage("stage-1", " prueba ")).rejects.toMatchObject({
      code: "save_failed",
    });
    await expect(renameStage("stage-does-not-exist", "Otra")).rejects.toMatchObject({
      code: "save_failed",
    });
    await expect(setStageCountsAsActive("stage-1", "yes" as never)).rejects.toMatchObject({
      code: "save_failed",
    });

    // Nothing was written: the seeded five are untouched.
    const stages = await listStages();
    expect(stages.map((stage) => stage.name)).toEqual([
      "Inicial",
      "Trámite",
      "Prueba",
      "Sentencia",
      "Ejecución",
    ]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  // LAST fake-driver test on purpose: it reduces the module state to a
  // single stage (no reset hook exists outside the store, which has no
  // stages table), and every later test runs on the mocked supabase driver.
  it("refuses to delete the last remaining stage", async () => {
    const signed = await signIn({
      email: seedUser.email,
      password: seedDemoPassword,
    });
    expect(signed.ok).toBe(true);

    const stages = await listStages();
    for (const stage of stages.slice(1)) {
      await deleteStage(stage.id);
    }
    const remaining = await listStages();
    expect(remaining).toHaveLength(1);

    await expect(deleteStage(remaining[0]!.id)).rejects.toMatchObject({
      code: "save_failed",
    });
    expect(await listStages()).toHaveLength(1);
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("supabase driver", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-demo");
  });

  /** Two seeded rows every mutation test starts from. */
  function queueStageList(): void {
    queueResponse("case_stages", {
      data: [
        { id: "stage-1", name: "Inicial", position: 1, counts_as_active: true },
        {
          id: "stage-2",
          name: "Trámite",
          position: 2,
          counts_as_active: false,
        },
      ],
      error: null,
    });
  }

  it("listStages reads the study's case_stages ordered by position", async () => {
    queueMembership();
    queueResponse("case_stages", {
      data: [
        { id: "stage-1", name: "Inicial", position: 1, counts_as_active: true },
        { id: "stage-2", name: "Trámite", position: 2, counts_as_active: true },
      ],
      error: null,
    });

    const stages = await listStages();

    expect(stages).toEqual([
      { id: "stage-1", name: "Inicial", position: 1, countsAsActive: true },
      { id: "stage-2", name: "Trámite", position: 2, countsAsActive: true },
    ]);

    const read = calls.find((call) => call.table === "case_stages");
    expect(read?.steps).toContainEqual({
      name: "select",
      args: ["id, name, position, counts_as_active"],
    });
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

  it("createStage validates before the network, then inserts at max position + 1", async () => {
    // Driver-agnostic validation runs before ANY query (bot-settings order).
    await expect(createStage({ name: "   " })).rejects.toMatchObject({
      code: "missing_fields",
    });
    expect(calls).toHaveLength(0);

    // Pre-read (guard + uniqueness + position), then the insert.
    queueMembership();
    queueStageList();
    queueMembership();
    queueResponse("case_stages", {
      data: {
        id: "stage-3",
        name: "Nueva etapa",
        position: 3,
        counts_as_active: true,
      },
      error: null,
    });

    const created = await createStage({ name: " Nueva etapa " });
    expect(created).toEqual({
      id: "stage-3",
      name: "Nueva etapa",
      position: 3,
      countsAsActive: true,
    });

    const write = calls.find((call) =>
      call.steps.some((step) => step.name === "insert"),
    );
    expect(write?.steps).toContainEqual({
      name: "insert",
      args: [
        {
          study_id: "study-9",
          name: "Nueva etapa",
          position: 3,
          counts_as_active: true,
        },
      ],
    });
    expect(write?.steps).toContainEqual({
      name: "select",
      args: ["id, name, position, counts_as_active"],
    });

    // A case-insensitive duplicate dies on the pre-read: no insert runs.
    queueMembership();
    queueResponse("case_stages", {
      data: [{ id: "stage-1", name: "Inicial", position: 1, counts_as_active: true }],
      error: null,
    });
    await expect(createStage({ name: "INICIAL" })).rejects.toMatchObject({
      code: "save_failed",
    });
    expect(
      calls.filter((call) => call.steps.some((step) => step.name === "insert")),
    ).toHaveLength(1);
  });

  it("renameStage writes only the name, scoped to my study", async () => {
    queueMembership();
    queueStageList();
    queueMembership();
    queueResponse("case_stages", {
      data: {
        id: "stage-2",
        name: "Trámite a medida",
        position: 2,
        counts_as_active: false,
      },
      error: null,
    });

    const renamed = await renameStage("stage-2", "  Trámite a medida  ");
    expect(renamed).toEqual({
      id: "stage-2",
      name: "Trámite a medida",
      position: 2,
      countsAsActive: false,
    });

    const write = calls.find((call) =>
      call.steps.some((step) => step.name === "update"),
    );
    expect(write?.steps).toContainEqual({
      name: "update",
      args: [{ name: "Trámite a medida" }],
    });
    expect(write?.steps).toContainEqual({ name: "eq", args: ["id", "stage-2"] });
    expect(write?.steps).toContainEqual({
      name: "eq",
      args: ["study_id", "study-9"],
    });
  });

  it("setStageCountsAsActive flips the boolean column only", async () => {
    queueMembership();
    queueStageList();
    queueMembership();
    queueResponse("case_stages", {
      data: {
        id: "stage-2",
        name: "Trámite",
        position: 2,
        counts_as_active: true,
      },
      error: null,
    });

    const toggled = await setStageCountsAsActive("stage-2", true);
    expect(toggled.countsAsActive).toBe(true);

    const write = calls.find((call) =>
      call.steps.some((step) => step.name === "update"),
    );
    expect(write?.steps).toContainEqual({
      name: "update",
      args: [{ counts_as_active: true }],
    });

    await expect(
      setStageCountsAsActive("stage-2", "yes" as never),
    ).rejects.toMatchObject({ code: "save_failed" });
  });

  it("moveStage swaps the two positions with two scoped updates", async () => {
    // The driver reads the ordered list itself: [Inicial, Trámite, ...].
    queueMembership();
    queueStageList();
    queueResponse("case_stages", {
      data: [
        { id: "stage-1", name: "Inicial", position: 1, counts_as_active: true },
        { id: "stage-2", name: "Trámite", position: 2, counts_as_active: false },
      ],
      error: null,
    });
    queueResponse("case_stages", { data: null, error: null });
    queueResponse("case_stages", { data: null, error: null });

    await moveStage("stage-2", "up");

    const writes = calls.filter((call) =>
      call.steps.some((step) => step.name === "update"),
    );
    expect(writes).toHaveLength(2);
    expect(writes[0]?.steps).toContainEqual({
      name: "update",
      args: [{ position: 1 }],
    });
    expect(writes[0]?.steps).toContainEqual({
      name: "eq",
      args: ["id", "stage-2"],
    });
    expect(writes[1]?.steps).toContainEqual({
      name: "update",
      args: [{ position: 2 }],
    });
    expect(writes[1]?.steps).toContainEqual({
      name: "eq",
      args: ["id", "stage-1"],
    });
    // Every write carries the study scope.
    for (const write of writes) {
      expect(write.steps).toContainEqual({ name: "eq", args: ["study_id", "study-9"] });
    }
  });

  it("deleteStage removes a non-last stage, study-scoped", async () => {
    queueMembership();
    queueStageList();
    queueMembership();
    queueResponse("case_stages", { data: [{ id: "stage-2" }], error: null });

    await expect(deleteStage("stage-2")).resolves.toBeUndefined();

    const write = calls.find((call) =>
      call.steps.some((step) => step.name === "delete"),
    );
    expect(write?.steps).toContainEqual({ name: "eq", args: ["id", "stage-2"] });
    expect(write?.steps).toContainEqual({
      name: "eq",
      args: ["study_id", "study-9"],
    });
  });

  it("deleteStage refuses the last remaining stage without issuing a delete", async () => {
    queueMembership();
    queueResponse("case_stages", {
      data: [{ id: "stage-1", name: "Inicial", position: 1, counts_as_active: true }],
      error: null,
    });

    await expect(deleteStage("stage-1")).rejects.toMatchObject({
      code: "save_failed",
    });
    expect(
      calls.some((call) => call.steps.some((step) => step.name === "delete")),
    ).toBe(false);
  });
});
