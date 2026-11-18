import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedCases, seedDemoPassword, seedUser } from "@/lib/seed";
import type { StudyCase } from "@/lib/types";
import { getStore, resetDataStore } from "./store";

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
  in: (...args: unknown[]) => MockQuery;
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
  applyCaseFilters,
  archiveCase,
  bulkArchive,
  compareCasesBy,
  createCase,
  getCase,
  listCases,
  softDeleteCase,
  toggleFavorite,
} from "./cases";

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
    in: step("in"),
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

  it("listCases({archivedView:true}) switches the server-side partition", async () => {
    // What the server actually returns for this partition: an archived row.
    queueResponse("cases", {
      data: [{ ...CASE_ROW, archivado: true }],
      error: null,
    });

    const rows = await listCases({ archivedView: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.archived).toBe(true);

    // The ONLY server-side filter: eq(archivado) instead of the default
    // not(archivado); the deleted_at guard and the order stay identical.
    const read = calls.find((call) => call.table === "cases");
    expect(read?.steps).toContainEqual({ name: "eq", args: ["archivado", true] });
    expect(read?.steps.some((step) => step.name === "not")).toBe(false);
    expect(read?.steps).toContainEqual({ name: "is", args: ["deleted_at", null] });
    expect(read?.steps).toContainEqual({
      name: "order",
      args: ["last_activity_at", { ascending: false }],
    });
  });

  it("listCases narrows the in-memory predicates after the fetch", async () => {
    queueResponse("cases", { data: [CASE_ROW, SPARSE_CASE_ROW], error: null });

    // CASE_ROW is `Trámite` + favorite; SPARSE is `""` + not favorite.
    const rows = await listCases({ etapa: "Trámite", favoritoOnly: true });
    expect(rows.map((row) => row.id)).toEqual(["case-a"]);

    queueResponse("cases", { data: [CASE_ROW, SPARSE_CASE_ROW], error: null });
    const none = await listCases({ etapa: "Prueba", tipo: "Extrajudicial" });
    expect(none).toEqual([]);

    // The fetch itself stayed unfiltered: one read, all narrowing in memory.
    const reads = calls.filter((call) => call.table === "cases");
    expect(reads).toHaveLength(2);
    expect(reads.every((read) => read.steps[0]?.name === "select")).toBe(true);
  });

  it("toggleFavorite patches only favorito and validates the row", async () => {
    queueResponse("cases", { data: [{ ...CASE_ROW, favorito: true }], error: null });

    const updated = await toggleFavorite("case-a", true);
    expect(updated.favorite).toBe(true);

    const write = calls.find((call) => call.table === "cases");
    expect(write?.steps[0]).toEqual({ name: "update", args: [{ favorito: true }] });
    expect(write?.steps).toContainEqual({ name: "eq", args: ["id", "case-a"] });
    expect(write?.steps).toContainEqual({
      name: "is",
      args: ["deleted_at", null],
    });

    // RLS/unknown id answers 0 rows → the typed failure, never a silent no-op.
    queueResponse("cases", { data: [], error: null });
    await expect(toggleFavorite("missing", false)).rejects.toMatchObject({
      code: "save_failed",
    });
  });

  it("archiveCase patches archivado with the same narrow shape", async () => {
    queueResponse("cases", { data: [{ ...CASE_ROW, archivado: true }], error: null });

    const archived = await archiveCase("case-a", true);
    expect(archived.archived).toBe(true);

    const write = calls.find((call) => call.table === "cases");
    expect(write?.steps[0]).toEqual({ name: "update", args: [{ archivado: true }] });
    expect(write?.steps).toContainEqual({ name: "eq", args: ["id", "case-a"] });

    queueResponse("cases", { data: [], error: null });
    await expect(archiveCase("missing", false)).rejects.toMatchObject({
      code: "save_failed",
    });
  });

  it("bulkArchive sends one in() update and checks the affected count", async () => {
    queueResponse("cases", { data: [CASE_ROW, SPARSE_CASE_ROW], error: null });

    const rows = await bulkArchive(["case-a", "case-b"], true);
    expect(rows.map((row) => row.id)).toEqual(["case-a", "case-b"]);

    const write = calls.find((call) => call.table === "cases");
    expect(write?.steps[0]).toEqual({ name: "update", args: [{ archivado: true }] });
    expect(write?.steps).toContainEqual({
      name: "in",
      args: ["id", ["case-a", "case-b"]],
    });
    expect(write?.steps).toContainEqual({ name: "is", args: ["deleted_at", null] });

    // Fewer rows back than ids sent (unknown/RLS-hidden id) → typed error.
    queueResponse("cases", { data: [CASE_ROW], error: null });
    await expect(bulkArchive(["case-a", "case-b"], true)).rejects.toMatchObject({
      code: "save_failed",
    });
  });

  it("bulkArchive rejects an empty id list before any query", async () => {
    await expect(bulkArchive([], true)).rejects.toMatchObject({
      code: "missing_fields",
    });
    expect(calls.filter((call) => call.table === "cases")).toHaveLength(0);
  });

  it("softDeleteCase stamps deleted_at and validates the row", async () => {
    queueResponse("cases", { data: [{ id: "case-a" }], error: null });

    await expect(softDeleteCase("case-a")).resolves.toBeUndefined();

    const write = calls.find((call) => call.table === "cases");
    const payload = write?.steps[0]?.args[0] as { deleted_at: string };
    expect(write?.steps[0]?.name).toBe("update");
    expect(typeof payload.deleted_at).toBe("string");
    expect(Number.isNaN(Date.parse(payload.deleted_at))).toBe(false);
    expect(write?.steps).toContainEqual({ name: "eq", args: ["id", "case-a"] });
    expect(write?.steps).toContainEqual({
      name: "is",
      args: ["deleted_at", null],
    });

    queueResponse("cases", { data: [], error: null });
    await expect(softDeleteCase("missing")).rejects.toMatchObject({
      code: "save_failed",
    });
  });
});

/* --------------------------------------------------------------- pure ---- */

function makeCase(overrides: Partial<StudyCase> & { id: string }): StudyCase {
  return {
    studyId: "study-9",
    caratula: "Gómez, Rosa c/ Empresa de Luz S.A. s/ cobro de pesos",
    numero: "90.111/2026",
    fuero: "Civil y Comercial",
    jurisdiccion: "Ciudad Autónoma de Buenos Aires",
    juzgado: "Juzgado Civil y Comercial N° 4",
    etapa: "Trámite",
    tipo: "Judicial",
    responsable: "Ana Beltrán",
    favorite: false,
    archived: false,
    createdAt: "2026-11-05T12:00:00.000Z",
    lastActivityAt: "2026-11-13T10:00:00.000Z",
    ...overrides,
  };
}

/** Three rows covering every filter vocabulary the panel offers. */
const FILTER_ROWS: StudyCase[] = [
  makeCase({ id: "row-a", favorite: true }),
  makeCase({
    id: "row-b",
    caratula: "Sucesión de Ferrari, Juan",
    numero: "",
    fuero: "Sucesiones",
    jurisdiccion: "Provincia de Buenos Aires",
    etapa: "Cita",
    responsable: "Luis Duarte",
    lastActivityAt: "2026-11-10T10:15:00.000Z",
  }),
  makeCase({
    id: "row-c",
    caratula: "Acme S.A. s/ quiebra",
    fuero: "Contencioso Administrativo",
    tipo: "Extrajudicial",
    etapa: "Inicial",
    responsable: "ana beltrán",
    archived: true,
    createdAt: "2026-11-01T09:00:00.000Z",
  }),
];

describe("applyCaseFilters (pure predicates)", () => {
  it("defaults to the active partition only", () => {
    expect(applyCaseFilters(FILTER_ROWS).map((row) => row.id)).toEqual([
      "row-a",
      "row-b",
    ]);
  });

  it("archivedView keeps ONLY archived rows", () => {
    expect(
      applyCaseFilters(FILTER_ROWS, { archivedView: true }).map((row) => row.id),
    ).toEqual(["row-c"]);
  });

  it("favoritoOnly keeps starred rows", () => {
    expect(
      applyCaseFilters(FILTER_ROWS, { favoritoOnly: true }).map((row) => row.id),
    ).toEqual(["row-a"]);
  });

  it("tipo matches the vocabulary exactly", () => {
    expect(
      applyCaseFilters(FILTER_ROWS, { tipo: "Extrajudicial" }).map((row) => row.id),
    ).toEqual([]);
    expect(
      applyCaseFilters(
        [...FILTER_ROWS, makeCase({ id: "row-d", tipo: "Extrajudicial" })],
        { tipo: "Extrajudicial" },
      ).map((row) => row.id),
    ).toEqual(["row-d"]);
  });

  it("fuero, etapa and jurisdiccion match their display values", () => {
    expect(
      applyCaseFilters(FILTER_ROWS, { fuero: "Sucesiones" }).map((row) => row.id),
    ).toEqual(["row-b"]);
    expect(
      applyCaseFilters(FILTER_ROWS, { etapa: "Cita" }).map((row) => row.id),
    ).toEqual(["row-b"]);
    expect(
      applyCaseFilters(FILTER_ROWS, {
        jurisdiccion: "Provincia de Buenos Aires",
      }).map((row) => row.id),
    ).toEqual(["row-b"]);
  });

  it("responsable matches case-insensitively and accent-insensitively", () => {
    expect(
      applyCaseFilters(FILTER_ROWS, { responsable: "ANA BELTRÁN" }).map(
        (row) => row.id,
      ),
    ).toEqual(["row-a"]);
    // No accent in the needle: foldForSearch strips it on both sides.
    expect(
      applyCaseFilters(FILTER_ROWS, { responsable: "beltran" }).map(
        (row) => row.id,
      ),
    ).toEqual(["row-a"]);
    expect(
      applyCaseFilters(FILTER_ROWS, { responsable: "luis" }).map((row) => row.id),
    ).toEqual(["row-b"]);
  });

  it("query rides on the accent/typo-tolerant search", () => {
    expect(
      applyCaseFilters(FILTER_ROWS, { query: "gomez" }).map((row) => row.id),
    ).toEqual(["row-a"]);
    expect(
      applyCaseFilters(FILTER_ROWS, { query: "ferrai" }).map((row) => row.id),
    ).toEqual(["row-b"]);
    expect(
      applyCaseFilters(FILTER_ROWS, { query: "zzzzzz" }).map((row) => row.id),
    ).toEqual([]);
  });

  it("combines every predicate with AND semantics", () => {
    const combined = applyCaseFilters(FILTER_ROWS, {
      etapa: "Trámite",
      fuero: "Civil y Comercial",
      tipo: "Judicial",
      jurisdiccion: "Ciudad Autónoma de Buenos Aires",
      responsable: "ana",
      favoritoOnly: true,
      query: "gomez",
    });
    expect(combined.map((row) => row.id)).toEqual(["row-a"]);

    // One extra predicate turns the match into a miss — never an OR.
    expect(
      applyCaseFilters(FILTER_ROWS, {
        etapa: "Trámite",
        favoritoOnly: true,
        responsable: "luis",
      }),
    ).toEqual([]);
  });
});

describe("compareCasesBy (sort comparators)", () => {
  const older = makeCase({
    id: "older",
    caratula: "Alfa, Juan c/ Beta s/ daños",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActivityAt: "2026-01-01T00:00:00.000Z",
  });
  const newer = makeCase({
    id: "newer",
    caratula: "Zeta, Ana c/ Ñandú s/ despido",
    createdAt: "2026-06-01T00:00:00.000Z",
    lastActivityAt: "2025-06-01T00:00:00.000Z",
  });

  it("caratula sorts alphabetically and desc flips the order", () => {
    expect(
      [newer, older].sort(compareCasesBy("caratula", "asc")).map((row) => row.id),
    ).toEqual(["older", "newer"]);
    expect(
      [newer, older].sort(compareCasesBy("caratula", "desc")).map((row) => row.id),
    ).toEqual(["newer", "older"]);
  });

  it("fecha orders by createdAt", () => {
    expect(
      [newer, older].sort(compareCasesBy("fecha", "asc")).map((row) => row.id),
    ).toEqual(["older", "newer"]);
    expect(
      [newer, older].sort(compareCasesBy("fecha", "desc")).map((row) => row.id),
    ).toEqual(["newer", "older"]);
  });

  it("ultima_actividad desc puts the newest activity first (S07 default)", () => {
    // older has the LATER activity here: desc must surface it first.
    expect(
      [newer, older]
        .sort(compareCasesBy("ultima_actividad", "desc"))
        .map((row) => row.id),
    ).toEqual(["older", "newer"]);
    expect(
      [newer, older]
        .sort(compareCasesBy("ultima_actividad", "asc"))
        .map((row) => row.id),
    ).toEqual(["newer", "older"]);
  });
});

/* ----------------------------------------------------- fake mutations ---- */

describe("fake driver case mutations", () => {
  // The fake store holds the seed OBJECTS themselves (`[...seedCases]` is a
  // shallow copy), so in-place patches poison every later rebuild in this
  // file. Snapshot the two mutable flags at import time, restore per test.
  const SEED_FLAGS = new Map(
    seedCases.map((row) => [row.id, { favorite: row.favorite, archived: row.archived }]),
  );

  beforeEach(async () => {
    resetDataStore();
    for (const row of getStore().cases) {
      const flags = SEED_FLAGS.get(row.id);
      if (flags) {
        row.favorite = flags.favorite;
        row.archived = flags.archived;
      }
    }
    const signed = await signIn({
      email: seedUser.email,
      password: seedDemoPassword,
    });
    if (!signed.ok) throw new Error("demo signIn failed");
  });

  it("toggleFavorite flips favorito and repeats are a no-op success", async () => {
    const [first] = await listCases();
    expect(first).toBeDefined();

    const on = await toggleFavorite(first!.id, true);
    expect(on.favorite).toBe(true);
    // Idempotent: setting the value the row already has still succeeds.
    expect((await toggleFavorite(first!.id, true)).favorite).toBe(true);
    expect((await toggleFavorite(first!.id, false)).favorite).toBe(false);

    await expect(toggleFavorite("case-missing", true)).rejects.toMatchObject({
      code: "save_failed",
    });
  });

  it("archiveCase moves the row between the default and archived views", async () => {
    const [first] = await listCases();

    await archiveCase(first!.id, true);
    expect((await listCases()).some((row) => row.id === first!.id)).toBe(false);
    expect(
      (await listCases({ archivedView: true })).map((row) => row.id),
    ).toEqual([first!.id]);

    await archiveCase(first!.id, false);
    expect((await listCases()).some((row) => row.id === first!.id)).toBe(true);
    expect(await listCases({ archivedView: true })).toEqual([]);

    await expect(archiveCase("case-missing", true)).rejects.toMatchObject({
      code: "save_failed",
    });
  });

  it("bulkArchive validates every id before writing (atomic)", async () => {
    const rows = await listCases();

    await expect(
      bulkArchive([rows[0]!.id, "case-missing"], true),
    ).rejects.toMatchObject({ code: "save_failed" });

    // No half-write: the known id stayed exactly where it was.
    expect((await listCases()).map((row) => row.id)).toContain(rows[0]!.id);
    expect(await listCases({ archivedView: true })).toEqual([]);
  });

  it("bulkArchive of already-archived rows is a no-op success", async () => {
    const rows = await listCases();
    const ids = rows.map((row) => row.id);

    const first = await bulkArchive(ids, true);
    expect(first).toHaveLength(ids.length);
    const again = await bulkArchive(ids, true);
    expect(again).toHaveLength(ids.length);

    expect(await listCases()).toEqual([]);
    expect(await listCases({ archivedView: true })).toHaveLength(ids.length);

    await expect(bulkArchive([], true)).rejects.toMatchObject({
      code: "missing_fields",
    });
  });

  it("softDeleteCase removes the row from every read", async () => {
    const [first] = await listCases();

    await softDeleteCase(first!.id);

    expect((await listCases()).some((row) => row.id === first!.id)).toBe(false);
    expect(await getCase(first!.id)).toBeNull();
    expect(
      (await listCases({ archivedView: true })).some(
        (row) => row.id === first!.id,
      ),
    ).toBe(false);

    await expect(softDeleteCase("case-missing")).rejects.toMatchObject({
      code: "save_failed",
    });
  });

  it("listCases applies favoritoOnly and the archived partition", async () => {
    const rows = await listCases();
    // Seed row 1 is the favorite one (lib/seed.ts).
    expect(
      (await listCases({ favoritoOnly: true })).map((row) => row.id),
    ).toEqual([rows[0]!.id]);

    await archiveCase(rows[0]!.id, true);
    expect(
      (await listCases({ archivedView: true, favoritoOnly: true })).map(
        (row) => row.id,
      ),
    ).toEqual([rows[0]!.id]);
    expect(
      await listCases({ archivedView: true, favoritoOnly: true, etapa: "Prueba" }),
    ).toEqual([]);
  });
});
