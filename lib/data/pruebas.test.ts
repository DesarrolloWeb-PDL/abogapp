import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedPruebas } from "@/lib/seed";
import { getStore, resetDataStore } from "./store";

/**
 * Supabase-driver pruebas contract, fully mocked: no live project, no network.
 * The critical seam under test: the client NEVER computes or writes
 * fecha_limite — the database trigger owns it (replica/schema.sql
 * `trg_plazos_compute`) and the branch only reads back what it returns.
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

import { createPrueba, listPruebas } from "./pruebas";
import { signUp } from "./auth";
import { createCase } from "./cases";
import { createStudy } from "./studies";
import { DataLayerError, errorCopy } from "./errors";

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
  // Fresh store per test: the fake-driver cases below write users/studies
  // and must never leak into the seeded-length assertions.
  resetDataStore();
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

const PRUEBA_ROW = {
  id: "prueba-1",
  study_id: "study-9",
  case_id: "case-a",
  type: "informativa",
  titulo: "Informe contable del demandado",
  estado: "proveida",
  fecha_efectiva: "2026-11-02",
  informante: { nombre: "Estudio Contable Rivadavia" },
  plazos: [
    {
      id: "plazo-1",
      study_id: "study-9",
      case_id: "case-a",
      prueba_id: "prueba-1",
      tipo: "habiles",
      cantidad: 10,
      fecha_efectiva: "2026-11-02",
      // A trigger-computed timestamptz (2026-11-15 23:59:59 ART in UTC).
      fecha_limite: "2026-11-16T02:59:59+00:00",
    },
  ],
};

/** No person link: the M1 free-text informante lives in `parte`. */
const PARTE_PRUEBA_ROW = {
  id: "prueba-2",
  study_id: "study-9",
  case_id: "case-a",
  type: "testimonial",
  titulo: "Testigo del contrato de locación",
  estado: "ofrecida",
  fecha_efectiva: "2026-11-16",
  informante: null,
  parte: "Martín Ocampo",
  plazos: [],
};

describe("fake driver", () => {
  it("listPruebas still serves the in-memory store when no keys are present", async () => {
    const pruebas = await listPruebas();
    expect(pruebas).toHaveLength(seedPruebas.length);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("createPrueba rejects an out-of-range fecha_efectiva with a typed error (BUG-004)", async () => {
    const signed = await signUp({
      fullName: "Ana Beltrán",
      email: "ana.fake@ejemplo.test",
      password: "clave-de-prueba",
    });
    if (!signed.ok) throw new Error(`signUp failed: ${signed.error}`);
    await createStudy({ name: "Estudio Fake", jurisdictions: ["Córdoba"] });
    const kase = await createCase({ caratula: "Expediente fecha corrupta" });

    // 5-digit year: the engine and the store must never see it.
    await expect(
      createPrueba({
        caseId: kase.id,
        tipo: "Informativa",
        titulo: "Informe con año absurdo",
        informante: "Estudio Contable Rivadavia",
        fechaEfectiva: "61116-02-02",
        plazo: { tipo: "corridos", cantidad: 7 },
      }),
    ).rejects.toMatchObject({ code: "invalid_fecha_efectiva" });

    // The guard runs before anything is written to the store.
    expect(getStore().pruebas).toHaveLength(seedPruebas.length);
  });
});

describe("supabase driver", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-demo");
  });

  it("listPruebas maps rows, capitalizes vocab and converts fecha_limite", async () => {
    queueResponse("pruebas", {
      data: [PRUEBA_ROW, PARTE_PRUEBA_ROW],
      error: null,
    });

    const pruebas = await listPruebas("case-a");

    expect(pruebas).toEqual([
      {
        id: "prueba-1",
        studyId: "study-9",
        caseId: "case-a",
        tipo: "Informativa",
        titulo: "Informe contable del demandado",
        informante: "Estudio Contable Rivadavia",
        estado: "Proveida",
        fechaEfectiva: "2026-11-02",
        plazos: [
          {
            id: "plazo-1",
            studyId: "study-9",
            caseId: "case-a",
            pruebaId: "prueba-1",
            tipo: "habiles",
            cantidad: 10,
            fechaEfectiva: "2026-11-02",
            fechaLimite: "2026-11-15",
          },
        ],
      },
      {
        id: "prueba-2",
        studyId: "study-9",
        caseId: "case-a",
        tipo: "Testimonial",
        titulo: "Testigo del contrato de locación",
        informante: "Martín Ocampo",
        estado: "Ofrecida",
        fechaEfectiva: "2026-11-16",
        plazos: [],
      },
    ]);

    const read = calls.find((call) => call.table === "pruebas");
    expect(read?.steps).toContainEqual({ name: "eq", args: ["case_id", "case-a"] });
    expect(read?.steps).toContainEqual({
      name: "order",
      args: ["created_at", { ascending: true }],
    });
  });

  it("createPrueba inserts the prueba + plazo and returns the DB fecha_limite untouched", async () => {
    queueMembership();
    queueResponse("pruebas", {
      data: {
        id: "prueba-9",
        study_id: "study-9",
        case_id: "case-a",
        type: "testimonial",
        titulo: "Testigo del contrato",
        estado: "proveida",
        fecha_efectiva: "2026-11-16",
        informante: null,
        parte: "Lucía Peralta",
        plazos: [],
      },
      error: null,
    });
    queueResponse("plazos", {
      data: {
        id: "plazo-9",
        study_id: "study-9",
        case_id: "case-a",
        prueba_id: "prueba-9",
        tipo: "corridos",
        cantidad: 5,
        fecha_efectiva: "2026-11-16",
        // Whatever the trigger computed — deliberately NOT what the engine
        // would return for corridos 5 from 2026-11-16 (2026-11-21).
        fecha_limite: "2026-12-31T23:59:59.000Z",
      },
      error: null,
    });
    queueResponse("notifications", {
      data: {
        id: "notif-9",
        study_id: "study-9",
        user_id: "user-1",
        category: "sistemas_judiciales",
        title: "Vence el 31/12/2026",
        body: "El plazo de «Testigo del contrato» (5 días corridos) vence el 31/12/2026.",
        deep_link: "/expedientes/case-a?tab=pruebas",
        read_at: null,
        created_at: "2026-11-15T12:00:00.000Z",
      },
      error: null,
    });

    const prueba = await createPrueba({
      caseId: "case-a",
      tipo: "Testimonial",
      titulo: "Testigo del contrato",
      informante: "  Lucía Peralta  ",
      fechaEfectiva: "2026-11-16",
      plazo: { tipo: "corridos", cantidad: 5 },
    });

    // The DB value comes back untouched: no client-side computation.
    expect(prueba.plazos[0]?.fechaLimite).toBe("2026-12-31");
    expect(prueba.estado).toBe("Proveida");
    expect(prueba.informante).toBe("Lucía Peralta");

    const pruebaWrite = calls.find(
      (call) => call.table === "pruebas" && call.steps.some((s) => s.name === "insert"),
    );
    expect(pruebaWrite?.steps[0]).toEqual({
      name: "insert",
      args: [
        {
          study_id: "study-9",
          case_id: "case-a",
          type: "testimonial",
          titulo: "Testigo del contrato",
          parte: "Lucía Peralta",
          fecha_efectiva: "2026-11-16",
          created_by: "user-1",
        },
      ],
    });

    const plazoWrite = calls.find((call) => call.table === "plazos");
    const plazoPayload = plazoWrite?.steps[0]?.args[0] as Record<string, unknown>;
    expect(plazoPayload).toMatchObject({
      study_id: "study-9",
      case_id: "case-a",
      prueba_id: "prueba-9",
      concepto: "Testigo del contrato",
      tipo: "corridos",
      cantidad: 5,
      fecha_efectiva: "2026-11-16",
      source: "prueba",
      created_by: "user-1",
    });
    // Spec S5 seam: the deadline is never sent, only read back.
    expect(plazoPayload).not.toHaveProperty("fecha_limite");

    // No DB trigger emits the alert (schema has none on plazos/notifications):
    // the app-side branch writes the row itself, mirroring insertNotification.
    const notifWrite = calls.find((call) => call.table === "notifications");
    expect(notifWrite?.steps[0]).toEqual({
      name: "insert",
      args: [
        {
          study_id: "study-9",
          user_id: "user-1",
          category: "sistemas_judiciales",
          title: "Vence el 31/12/2026",
          body: "El plazo de «Testigo del contrato» (5 días corridos) vence el 31/12/2026.",
          deep_link: "/expedientes/case-a?tab=pruebas",
          channel: "in_app",
          dedupe_key: "prueba:prueba-9",
        },
      ],
    });

    // The fake store never took the write — the supabase branch owns it.
    expect(getStore().pruebas).toHaveLength(seedPruebas.length);
  });

  it("createPrueba rejects a blank titulo before any insert", async () => {
    queueMembership();

    await expect(
      createPrueba({
        caseId: "case-a",
        tipo: "Testimonial",
        titulo: "   ",
        informante: "Lucía Peralta",
        fechaEfectiva: "2026-11-16",
      }),
    ).rejects.toMatchObject({ code: "missing_fields" });
    expect(calls.filter((call) => call.table === "pruebas")).toHaveLength(0);
  });

  it("createPrueba rejects an out-of-bound plazo like the engine does", async () => {
    queueMembership();

    await expect(
      createPrueba({
        caseId: "case-a",
        tipo: "Testimonial",
        titulo: "Testigo del contrato",
        informante: "Lucía Peralta",
        fechaEfectiva: "2026-11-16",
        plazo: { tipo: "corridos", cantidad: 0 },
      }),
    ).rejects.toMatchObject({ code: "invalid_plazo" });
    expect(calls.filter((call) => call.table === "pruebas")).toHaveLength(0);
    expect(calls.filter((call) => call.table === "plazos")).toHaveLength(0);
  });

  it("createPrueba rejects an out-of-range fecha_efectiva before any write (BUG-004)", async () => {
    queueMembership();

    const error = await createPrueba({
      caseId: "case-a",
      tipo: "Testimonial",
      titulo: "Testigo del contrato",
      informante: "Lucía Peralta",
      fechaEfectiva: "61116-02-02",
      plazo: { tipo: "corridos", cantidad: 7 },
    }).then(
      () => null,
      (caught: unknown) => caught,
    );

    // Typed code + the Argentine Spanish copy the screens show (ERROR_COPY).
    expect.soft(error).toMatchObject({ code: "invalid_fecha_efectiva" });
    expect.soft(
      error instanceof DataLayerError ? errorCopy(error.code) : null,
    ).toBe("La fecha efectiva tiene que estar entre 01/01/1900 y 31/12/2100.");
    // Nothing reaches the network before the typed failure.
    expect(calls.filter((call) => call.table === "pruebas")).toHaveLength(0);
    expect(calls.filter((call) => call.table === "plazos")).toHaveLength(0);
  });

  it("listPruebas maps a corrupt out-of-range fecha_limite to null, never throws (BUG-004)", async () => {
    queueResponse("pruebas", {
      data: [
        {
          ...PRUEBA_ROW,
          plazos: [
            {
              ...(PRUEBA_ROW.plazos[0] as NonNullable<
                (typeof PRUEBA_ROW.plazos)[number]
              >),
              // Legacy row: the trigger once wrote an absurd year, so
              // `new Date(...)` is Invalid Date and toISOString() throws.
              fecha_limite: "61116-02-10T02:59:59+00:00",
            },
          ],
        },
      ],
      error: null,
    });

    // The case detail reads through this call: it must resolve so the
    // screen stays renderable instead of "No pudimos cargar el expediente."
    const pruebas = await listPruebas("case-a");

    expect(pruebas).toHaveLength(1);
    expect(pruebas[0]?.plazos[0]?.fechaLimite).toBeNull();
  });

  it("createPrueba survives a corrupt fecha_limite read-back (BUG-004 save abort)", async () => {
    queueMembership();
    queueResponse("pruebas", {
      data: {
        id: "prueba-9",
        study_id: "study-9",
        case_id: "case-a",
        type: "testimonial",
        titulo: "Testigo del contrato",
        estado: "proveida",
        fecha_efectiva: "2026-11-16",
        informante: null,
        parte: "Lucía Peralta",
        plazos: [],
      },
      error: null,
    });
    queueResponse("plazos", {
      data: {
        id: "plazo-9",
        study_id: "study-9",
        case_id: "case-a",
        prueba_id: "prueba-9",
        tipo: "corridos",
        cantidad: 7,
        fecha_efectiva: "2026-11-16",
        // Whatever the DB returns — even a corrupt value must not abort
        // the save after the rows were already written.
        fecha_limite: "61116-02-10T02:59:59+00:00",
      },
      error: null,
    });

    const prueba = await createPrueba({
      caseId: "case-a",
      tipo: "Testimonial",
      titulo: "Testigo del contrato",
      informante: "Lucía Peralta",
      fechaEfectiva: "2026-11-16",
      plazo: { tipo: "corridos", cantidad: 7 },
    });

    expect(prueba.plazos[0]?.fechaLimite).toBeNull();
    // No deadline → no "Vence el …" alert (its copy would be meaningless).
    expect(calls.filter((call) => call.table === "notifications")).toHaveLength(0);
  });
});
