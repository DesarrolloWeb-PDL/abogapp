import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedDemoPassword, seedUser } from "@/lib/seed";

/**
 * The S12 non-working-days seam in both drivers: the exported reference never
 * changes shape (ReadonlySet<string> of ISO dates), the fake driver keeps the
 * static feria set, and the supabase driver rebuilds the SAME set from
 * calendar_days with es_habil()'s predicate (system rows + own-study rows).
 *
 * The S30 admin adds the studio-day contract on top: listSystemDays (read-
 * only feria/feriado rows), listStudioDays / addStudioDay / removeStudioDay
 * for the study's own días inhábiles — and the loader must pick up a
 * just-added day, because that set is what the plazos engine reads.
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

import { signIn } from "./auth";
import {
  addStudioDay,
  listStudioDays,
  listSystemDays,
  loadNonWorkingDays,
  nonWorkingDays,
  removeStudioDay,
} from "./calendar";

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

  it("listSystemDays answers the seeded feria rows as read-only system rows", async () => {
    const days = await listSystemDays();

    expect(days.length).toBeGreaterThan(0);
    expect(days.every((day) => day.origen === "sistema")).toBe(true);
    expect(days.every((day) => day.kind === "feria")).toBe(true);
    const dates = days.map((day) => day.day);
    expect(dates).toEqual([...dates].sort());
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("addStudioDay then removeStudioDay flow into the nonWorkingDays loader", async () => {
    const signed = await signIn({
      email: seedUser.email,
      password: seedDemoPassword,
    });
    expect(signed.ok).toBe(true);

    const added = await addStudioDay({
      day: "2026-05-01",
      name: "Día inhábil del estudio",
    });
    expect(added).toEqual({
      id: expect.any(String),
      day: "2026-05-01",
      kind: "inhabil",
      name: "Día inhábil del estudio",
      origen: "estudio",
    });

    const studio = await listStudioDays();
    expect(studio.map((day) => day.day)).toContain("2026-05-01");

    // The S12 seam: the loader picks the JUST-ADDED day up (no engine call).
    expect((await loadNonWorkingDays()).has("2026-05-01")).toBe(true);

    await removeStudioDay(added.id);
    expect((await listStudioDays()).map((day) => day.day)).not.toContain(
      "2026-05-01",
    );
    expect((await loadNonWorkingDays()).has("2026-05-01")).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("validates studio days before any write and never deletes system rows", async () => {
    const signed = await signIn({
      email: seedUser.email,
      password: seedDemoPassword,
    });
    expect(signed.ok).toBe(true);

    // Typed validation runs before anything reaches a store.
    await expect(addStudioDay({ day: "", name: "Día" })).rejects.toMatchObject({
      code: "missing_fields",
    });
    await expect(
      addStudioDay({ day: "2026-13-01", name: "Día" }),
    ).rejects.toMatchObject({ code: "invalid_fecha_efectiva" });
    await expect(
      addStudioDay({ day: "2026-02-30", name: "Día" }),
    ).rejects.toMatchObject({ code: "invalid_fecha_efectiva" });
    await expect(
      addStudioDay({ day: "1899-12-31", name: "Día" }),
    ).rejects.toMatchObject({ code: "invalid_fecha_efectiva" });
    await expect(
      addStudioDay({ day: "2026-06-20", name: "   " }),
    ).rejects.toMatchObject({ code: "missing_fields" });
    expect(fromMock).not.toHaveBeenCalled();

    const added = await addStudioDay({ day: "2026-06-20", name: "Asueto de prueba" });
    // Same day twice: the unique (study_id, day, kind) index's app-side twin.
    await expect(
      addStudioDay({ day: "2026-06-20", name: "Otro nombre" }),
    ).rejects.toMatchObject({ code: "save_failed" });

    // A system row id never reaches a delete: it is not a studio row.
    const [system] = await listSystemDays();
    await expect(removeStudioDay(system!.id)).rejects.toMatchObject({
      code: "save_failed",
    });
    expect((await listSystemDays()).map((day) => day.day)).toContain(
      system!.day,
    );

    await removeStudioDay(added.id);
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

  /** Membership row that makes `getMyStudy()` resolve (study-scoped reads). */
  function queueMembership(): void {
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
    getUserMock.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
  }

  it("listSystemDays reads system rows; listStudioDays reads only my study's", async () => {
    // No study lookup for the system group: RLS already answers those rows.
    queueResponse("calendar_days", {
      data: [
        {
          id: "sys-1",
          study_id: null,
          day: "2026-01-05",
          kind: "feria",
          name: "Feria judicial",
        },
        {
          id: "sys-2",
          study_id: null,
          day: "2026-06-15",
          kind: "feriado",
          name: "Feriado puente",
        },
      ],
      error: null,
    });

    const system = await listSystemDays();
    expect(system).toEqual([
      {
        id: "sys-1",
        day: "2026-01-05",
        kind: "feria",
        name: "Feria judicial",
        origen: "sistema",
      },
      {
        id: "sys-2",
        day: "2026-06-15",
        kind: "feriado",
        name: "Feriado puente",
        origen: "sistema",
      },
    ]);
    const systemRead = calls.find((call) => call.table === "calendar_days");
    expect(systemRead?.steps).toContainEqual({
      name: "is",
      args: ["study_id", null],
    });
    expect(systemRead?.steps).toContainEqual({
      name: "order",
      args: ["day", { ascending: true }],
    });

    queueMembership();
    queueResponse("calendar_days", {
      data: [
        // PostgREST answers ONLY my study's rows — the eq("study_id", …)
        // step asserted below is what keeps another tenant's row out.
        {
          id: "own-1",
          study_id: "study-9",
          day: "2026-03-02",
          kind: "inhabil",
          name: "Receso",
        },
      ],
      error: null,
    });

    const studio = await listStudioDays();
    expect(studio).toEqual([
      {
        id: "own-1",
        day: "2026-03-02",
        kind: "inhabil",
        name: "Receso",
        origen: "estudio",
      },
    ]);
    const studioReads = calls.filter((call) => call.table === "calendar_days");
    expect(studioReads[1]?.steps).toContainEqual({
      name: "eq",
      args: ["study_id", "study-9"],
    });
    expect(studioReads[1]?.steps).toContainEqual({
      name: "order",
      args: ["day", { ascending: true }],
    });
    expect(
      calls.filter((call) => call.table === "memberships"),
    ).toHaveLength(1);
  });

  it("addStudioDay inserts kind 'inhabil' and the loader picks the day up", async () => {
    // 1) duplicate pre-check read (nothing there yet) …
    queueMembership();
    queueResponse("calendar_days", { data: [], error: null });
    // 2) the write itself …
    queueMembership();
    queueResponse("calendar_days", {
      data: {
        id: "own-2",
        study_id: "study-9",
        day: "2026-08-17",
        kind: "inhabil",
        name: "Asueto del estudio",
      },
      error: null,
    });

    const added = await addStudioDay({
      day: "2026-08-17",
      name: "Asueto del estudio",
    });
    expect(added).toEqual({
      id: "own-2",
      day: "2026-08-17",
      kind: "inhabil",
      name: "Asueto del estudio",
      origen: "estudio",
    });

    const write = calls.find((call) =>
      call.steps.some((step) => step.name === "insert"),
    );
    expect(write?.steps).toContainEqual({
      name: "insert",
      args: [
        {
          study_id: "study-9",
          day: "2026-08-17",
          kind: "inhabil",
          name: "Asueto del estudio",
        },
      ],
    });

    // The loader's refetch (the read es_habil merges) now carries the day.
    queueMembership();
    queueResponse("calendar_days", {
      data: [
        { study_id: null, day: "2026-01-05", kind: "feria" },
        { study_id: "study-9", day: "2026-08-17", kind: "inhabil" },
      ],
      error: null,
    });
    const loaded = await loadNonWorkingDays();
    expect(loaded.has("2026-08-17")).toBe(true);
    expect(loaded.has("2026-01-05")).toBe(true);
  });

  it("removeStudioDay deletes study-scoped only: a system id matches nothing", async () => {
    queueMembership();
    queueResponse("calendar_days", { data: [], error: null });

    await expect(removeStudioDay("sys-1")).rejects.toMatchObject({
      code: "save_failed",
    });

    const write = calls.find((call) =>
      call.steps.some((step) => step.name === "delete"),
    );
    expect(write?.steps).toContainEqual({ name: "eq", args: ["id", "sys-1"] });
    expect(write?.steps).toContainEqual({
      name: "eq",
      args: ["study_id", "study-9"],
    });

    // The happy path: one study row really gone.
    queueMembership();
    queueResponse("calendar_days", { data: [{ id: "own-2" }], error: null });
    await expect(removeStudioDay("own-2")).resolves.toBeUndefined();
  });
});
