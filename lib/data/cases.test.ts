import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedCases, seedDemoPassword, seedUser } from "@/lib/seed";
import { getStore } from "./store";

/**
 * Supabase-driver cases contract, fully mocked: no live project, no network.
 * These tests pin the driver dispatch, the snake_case → StudyCase mapping
 * (replica/schema.sql ↔ lib/types.ts) and the write validation that the fake
 * branch already guarantees.
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

import { signIn } from "./auth";
import { createCase, getCase, listCases } from "./cases";

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

/** Membership row that makes `requireStudy()` resolve (studies driver path). */
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

const CASE_ROW = {
  id: "case-a",
  study_id: "study-9",
  caratula: "Gómez, Rosa c/ Empresa de Luz S.A. s/ cobro de pesos",
  numero: "90.111/2026",
  fuero: "Civil y Comercial",
  jurisdiccion: "Ciudad Autónoma de Buenos Aires",
  juzgado: "Juzgado Civil y Comercial N° 4",
  tipo: "Judicial",
  favorito: true,
  archivado: false,
  created_at: "2026-11-05T12:00:00.000Z",
  last_activity_at: "2026-11-13T10:00:00.000Z",
  etapa: { name: "Trámite" },
  created_by: { full_name: "Ana Beltrán" },
};

/** A seeded cloud row: no etapa_id, no responsable join, null optional text. */
const SPARSE_CASE_ROW = {
  id: "case-b",
  study_id: "study-9",
  caratula: "Sucesión de Ferrari, Juan",
  numero: null,
  fuero: null,
  jurisdiccion: null,
  juzgado: null,
  tipo: null,
  favorito: false,
  archivado: false,
  created_at: "2026-11-01T09:00:00.000Z",
  last_activity_at: "2026-11-10T10:15:00.000Z",
  etapa: null,
  created_by: null,
};

describe("fake driver", () => {
  it("listCases still serves the in-memory store when no keys are present", async () => {
    // The fake layer has no RLS: it needs a session (the seeded demo user
    // already owns the three seed cases through its membership).
    const signed = await signIn({
      email: seedUser.email,
      password: seedDemoPassword,
    });
    expect(signed.ok).toBe(true);

    const cases = await listCases();
    expect(cases).toHaveLength(seedCases.length);
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("supabase driver", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-demo");
  });

  it("listCases selects non-archived rows newest activity first and maps them", async () => {
    queueResponse("cases", { data: [CASE_ROW, SPARSE_CASE_ROW], error: null });

    const cases = await listCases();

    expect(cases).toEqual([
      {
        id: "case-a",
        studyId: "study-9",
        caratula: CASE_ROW.caratula,
        numero: "90.111/2026",
        fuero: "Civil y Comercial",
        jurisdiccion: "Ciudad Autónoma de Buenos Aires",
        juzgado: "Juzgado Civil y Comercial N° 4",
        etapa: "Trámite",
        tipo: "Judicial",
        responsable: "Ana Beltrán",
        favorite: true,
        archived: false,
        createdAt: "2026-11-05T12:00:00.000Z",
        lastActivityAt: "2026-11-13T10:00:00.000Z",
      },
      {
        id: "case-b",
        studyId: "study-9",
        caratula: "Sucesión de Ferrari, Juan",
        numero: "",
        fuero: "",
        jurisdiccion: "",
        juzgado: "",
        etapa: "",
        tipo: "Judicial",
        responsable: "",
        favorite: false,
        archived: false,
        createdAt: "2026-11-01T09:00:00.000Z",
        lastActivityAt: "2026-11-10T10:15:00.000Z",
      },
    ]);

    // The RLS-scoped read: no tenancy pre-check, archived + soft-deleted out,
    // ordered by last activity descending (S07).
    const read = calls.find((call) => call.table === "cases");
    expect(read?.steps).toContainEqual({ name: "not", args: ["archivado", "is", true] });
    expect(read?.steps).toContainEqual({ name: "is", args: ["deleted_at", null] });
    expect(read?.steps).toContainEqual({
      name: "order",
      args: ["last_activity_at", { ascending: false }],
    });
    expect(calls.some((call) => call.table === "memberships")).toBe(false);
    expect(calls.some((call) => call.table === "profiles")).toBe(false);
  });

  it("getCase maps one row and answers null when RLS/find finds nothing", async () => {
    queueResponse("cases", { data: CASE_ROW, error: null });
    const found = await getCase("case-a");
    expect(found?.id).toBe("case-a");
    expect(found?.etapa).toBe("Trámite");
    expect(found?.responsable).toBe("Ana Beltrán");

    queueResponse("cases", { data: null, error: null });
    const missing = await getCase("nope");
    expect(missing).toBeNull();
  });

  it("createCase rejects a blank caratula before any insert", async () => {
    queueMembership();

    await expect(createCase({ caratula: "   " })).rejects.toMatchObject({
      code: "missing_fields",
    });
    expect(calls.filter((call) => call.table === "cases")).toHaveLength(0);
  });

  it("createCase inserts under RLS and returns the mapped row", async () => {
    queueMembership();
    queueResponse("cases", { data: CASE_ROW, error: null });

    const created = await createCase({
      caratula: "  Gómez, Rosa c/ Empresa de Luz S.A. s/ cobro de pesos  ",
      numero: "90.111/2026",
    });

    expect(created.id).toBe("case-a");
    expect(created.caratula).toBe("Gómez, Rosa c/ Empresa de Luz S.A. s/ cobro de pesos");
    expect(created.etapa).toBe("Trámite");

    const write = calls.find((call) => call.table === "cases");
    expect(write?.steps[0]).toEqual({
      name: "insert",
      args: [
        {
          study_id: "study-9",
          caratula: "Gómez, Rosa c/ Empresa de Luz S.A. s/ cobro de pesos",
          numero: "90.111/2026",
          fuero: "",
          jurisdiccion: "",
          juzgado: "",
          tipo: "Judicial",
          etapa_id: null,
          responsable: null,
          favorito: false,
          archivado: false,
          source: "manual",
          created_by: "user-1",
        },
      ],
    });

    // No etapa given → no case_stages lookup is made at all.
    expect(calls.some((call) => call.table === "case_stages")).toBe(false);

    // The fake store never took the write — the supabase branch owns it.
    expect(getStore().cases).toHaveLength(seedCases.length);
  });

  it("createCase resolves the etapa name to its stage id and sends the responsable column", async () => {
    queueMembership();
    queueResponse("case_stages", { data: { id: "stage-2" }, error: null });
    queueResponse("cases", {
      data: { ...CASE_ROW, etapa: { name: "Trámite" }, responsable: "Marta Sosa" },
      error: null,
    });

    const created = await createCase({
      caratula: "Gómez, Rosa c/ Empresa de Luz S.A. s/ cobro de pesos",
      etapa: "Trámite",
      responsable: "  Marta Sosa  ",
    });

    expect(created.etapa).toBe("Trámite");
    expect(created.responsable).toBe("Marta Sosa");

    // The stage lookup is scoped to the current study and keyed by NAME —
    // cases stores etapa_id (uuid FK), StudyCase.etapa is the display name.
    const lookup = calls.find((call) => call.table === "case_stages");
    expect(lookup?.steps).toContainEqual({ name: "eq", args: ["study_id", "study-9"] });
    expect(lookup?.steps).toContainEqual({ name: "eq", args: ["name", "Trámite"] });

    const write = calls.find((call) => call.table === "cases");
    expect(write?.steps[0]).toEqual({
      name: "insert",
      args: [
        {
          study_id: "study-9",
          caratula: "Gómez, Rosa c/ Empresa de Luz S.A. s/ cobro de pesos",
          numero: "",
          fuero: "",
          jurisdiccion: "",
          juzgado: "",
          tipo: "Judicial",
          etapa_id: "stage-2",
          responsable: "Marta Sosa",
          favorito: false,
          archivado: false,
          source: "manual",
          created_by: "user-1",
        },
      ],
    });
  });

  it("listCases prefers the responsable column and falls back to the creator profile", async () => {
    queueResponse("cases", {
      data: [
        { ...CASE_ROW, id: "case-c", responsable: "Marta Sosa" },
        {
          ...CASE_ROW,
          id: "case-d",
          responsable: null,
          created_by: { full_name: "Luis Duarte" },
        },
      ],
      error: null,
    });

    const cases = await listCases();

    // Old rows (created before the column existed) read their responsable
    // from the creator's profile — same person the fake layer defaults to.
    expect(cases.map((entry) => entry.responsable)).toEqual([
      "Marta Sosa",
      "Luis Duarte",
    ]);

    const read = calls.find((call) => call.table === "cases");
    expect(String(read?.steps[0]?.args[0])).toContain("responsable");
    expect(String(read?.steps[0]?.args[0])).toContain("etapa:case_stages(name)");
  });
});
