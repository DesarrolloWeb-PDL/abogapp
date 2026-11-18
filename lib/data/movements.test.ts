import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDataStore } from "./store";

/**
 * Movement contract for both drivers, fully mocked: no live project, no
 * network. The seams under test: identical validation order in both
 * drivers (required fields → sane fecha window → vocabulary/length bounds),
 * the fecha-DESC order with `pinned` badged but NEVER re-sorted (S09's
 * "fijar el más importante" is a badge, not a rank), the tipo/range/search
 * filters, and the narrow PATCH that may only touch `pinned`.
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
  gte: (...args: unknown[]) => MockQuery;
  lte: (...args: unknown[]) => MockQuery;
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
  applyMovementFilter,
  compareMovementsByFecha,
  createMovement,
  listMovements,
  movementPinBadge,
  peekFakeMovements,
  resetFakeMovements,
  updateMovement,
  type Movement,
} from "./movements";
import { getSession, signUp } from "./auth";
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
    gte: step("gte"),
    lte: step("lte"),
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
  // and the module-local movement list must never leak between tests.
  resetDataStore();
  resetFakeMovements();
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

const MOVEMENT_ROW = {
  id: "movement-1",
  study_id: "study-9",
  case_id: "case-a",
  fecha: "2026-11-15",
  tipo: "Resolución",
  detalle: "Se dicta sentencia",
  pinned: false,
  created_at: "2026-11-15T10:00:00.000Z",
  created_by: { full_name: "Ana Beltrán" },
};

describe("fake driver", () => {
  /** Sign up + wizard: the fake store's study, membership and case. */
  async function startCase(): Promise<{ caseId: string; userId: string }> {
    const signed = await signUp({
      fullName: "Ana Beltrán",
      email: "ana.movimientos@ejemplo.test",
      password: "clave-de-prueba",
    });
    if (!signed.ok) throw new Error(`signUp failed: ${signed.error}`);
    await createStudy({ name: "Estudio Movimientos", jurisdictions: ["CABA"] });
    const kase = await createCase({ caratula: "Gómez, Rosa c/ Empresa de Luz" });
    const session = await getSession();
    if (!session) throw new Error("no session after signUp");
    return { caseId: kase.id, userId: session.user.id };
  }

  it("listMovements answers honestly before onboarding", async () => {
    expect(await listMovements("case-x")).toEqual([]);
    // The fake driver never touches the network for a read.
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("createMovement rejects bad input with typed codes and writes nothing", async () => {
    const { caseId } = await startCase();

    const blank = await createMovement({
      caseId,
      fecha: "   ",
      tipo: "Audiencia",
      detalle: "Sin fecha",
    }).then(
      () => null,
      (caught: unknown) => caught,
    );
    // Typed code + the Argentine Spanish copy the screens show (ERROR_COPY).
    expect.soft(blank).toBeInstanceOf(DataLayerError);
    expect.soft(
      blank instanceof DataLayerError ? errorCopy(blank.code) : null,
    ).toBe("Completá todos los campos para continuar.");

    // The shared 1900..2100 window guard (isValidFechaEfectiva), both edges.
    await expect(
      createMovement({ caseId, fecha: "1800-01-01", tipo: "Audiencia", detalle: "Viejo" }),
    ).rejects.toMatchObject({ code: "invalid_fecha_efectiva" });
    await expect(
      createMovement({ caseId, fecha: "61116-02-02", tipo: "Audiencia", detalle: "Imposible" }),
    ).rejects.toMatchObject({ code: "invalid_fecha_efectiva" });
    // Vocabulary and DB length bounds degrade to save_failed.
    await expect(
      createMovement({ caseId, fecha: "2026-11-10", tipo: "Reunión", detalle: "Fuera de set" }),
    ).rejects.toMatchObject({ code: "save_failed" });
    await expect(
      createMovement({ caseId, fecha: "2026-11-10", tipo: "Otro", detalle: "x".repeat(4001) }),
    ).rejects.toMatchObject({ code: "save_failed" });
    // Unknown case mirrors fk_movements_case.
    await expect(
      createMovement({ caseId: "case-ghost", fecha: "2026-11-10", tipo: "Otro", detalle: "Nadie" }),
    ).rejects.toMatchObject({ code: "save_failed" });

    expect(peekFakeMovements()).toEqual([]);
    expect(await listMovements(caseId)).toEqual([]);
  });

  it("createMovement persists trimmed values with pinned false and my name", async () => {
    const { caseId, userId } = await startCase();

    const movement = await createMovement({
      caseId,
      fecha: " 2026-11-10 ",
      tipo: "Trámite",
      detalle: "  Presentada contestación  ",
    });

    expect(movement).toMatchObject({
      caseId,
      fecha: "2026-11-10",
      tipo: "Trámite",
      detalle: "Presentada contestación",
      pinned: false,
      createdBy: "Ana Beltrán",
    });
    expect(movement.studyId).toBeTruthy();
    expect(movement.id).toMatch(/^movement-\d+$/);

    const rows = await listMovements(caseId);
    expect(rows.map((row) => row.id)).toEqual([movement.id]);
    // The creator resolves to my profile id in the fake session.
    expect(userId).toBeTruthy();
  });

  it("listMovements orders fecha DESC, ties by newest insert, pinned never re-sorts", async () => {
    const { caseId } = await startCase();

    const old = await createMovement({
      caseId,
      fecha: "2026-11-10",
      tipo: "Otro",
      detalle: "Movimiento viejo",
    });
    const newest = await createMovement({
      caseId,
      fecha: "2026-11-15",
      tipo: "Audiencia",
      detalle: "Audiencia ordinaria",
    });
    const middle = await createMovement({
      caseId,
      fecha: "2026-11-12",
      tipo: "Presentación",
      detalle: "Se presenta escrito",
    });
    // Pin the OLDEST row: the star is a badge, not a rank (S09 decision).
    await updateMovement(old.id, { pinned: true });

    const sameDay = await createMovement({
      caseId,
      fecha: "2026-11-15",
      tipo: "Resolución",
      detalle: "Otra del mismo día",
    });

    const rows = await listMovements(caseId);
    expect(rows.map((row) => row.id)).toEqual([
      sameDay.id,
      newest.id,
      middle.id,
      old.id,
    ]);
    expect(rows[rows.length - 1]?.pinned).toBe(true);

    // The comparator itself ignores `pinned` entirely.
    const pinnedOld: Movement = {
      ...old,
      fecha: "2026-11-10",
      createdAt: "2026-11-01T10:00:00.000Z",
      pinned: true,
    };
    const unpinnedNew: Movement = {
      ...newest,
      fecha: "2026-11-15",
      createdAt: "2026-11-02T10:00:00.000Z",
      pinned: false,
    };
    expect(compareMovementsByFecha(pinnedOld, unpinnedNew)).toBeGreaterThan(0);
    expect(compareMovementsByFecha(unpinnedNew, pinnedOld)).toBeLessThan(0);
  });

  it("listMovements filters by tipo and the inclusive date range", async () => {
    const { caseId } = await startCase();
    await createMovement({ caseId, fecha: "2026-11-05", tipo: "Audiencia", detalle: "Audiencia de prueba" });
    await createMovement({ caseId, fecha: "2026-11-12", tipo: "Resolución", detalle: "Se provee" });
    await createMovement({ caseId, fecha: "2026-11-20", tipo: "Audiencia", detalle: "Audiencia de vista" });

    const audiencias = await listMovements(caseId, { tipo: "Audiencia" });
    expect(audiencias.map((row) => row.fecha)).toEqual(["2026-11-20", "2026-11-05"]);

    // Range bounds are inclusive on both ends.
    const ranged = await listMovements(caseId, {
      from: "2026-11-05",
      to: "2026-11-12",
    });
    expect(ranged.map((row) => row.fecha)).toEqual(["2026-11-12", "2026-11-05"]);

    const none = await listMovements(caseId, { from: "2026-12-01" });
    expect(none).toEqual([]);

    // Combined: tipo wins over a range that excludes its rows.
    const combined = await listMovements(caseId, {
      tipo: "Audiencia",
      from: "2026-11-10",
    });
    expect(combined.map((row) => row.fecha)).toEqual(["2026-11-20"]);
  });

  it("applyMovementFilter narrows by tipo/range and searches accent-tolerantly", async () => {
    const rows: Movement[] = [
      {
        id: "movement-1",
        studyId: "study-1",
        caseId: "case-1",
        fecha: "2026-11-15",
        tipo: "Audiencia",
        detalle: "Audiencia ordinaria",
        pinned: false,
        createdBy: "",
        createdAt: "2026-11-15T10:00:00.000Z",
      },
      {
        id: "movement-2",
        studyId: "study-1",
        caseId: "case-1",
        fecha: "2026-11-12",
        tipo: "Resolución",
        detalle: "Se dicta sentencia",
        pinned: true,
        createdBy: "",
        createdAt: "2026-11-12T10:00:00.000Z",
      },
    ];

    expect(applyMovementFilter(rows, { tipo: "Resolución" }).map((r) => r.id)).toEqual([
      "movement-2",
    ]);
    expect(applyMovementFilter(rows, { from: "2026-11-13" }).map((r) => r.id)).toEqual([
      "movement-1",
    ]);
    expect(applyMovementFilter(rows, { to: "2026-11-14" }).map((r) => r.id)).toEqual([
      "movement-2",
    ]);
    // lib/search.ts: case/accents fold, and typos within distance 2 match.
    expect(applyMovementFilter(rows, { query: "sentensia" }).map((r) => r.id)).toEqual([
      "movement-2",
    ]);
    expect(applyMovementFilter(rows, { query: "audiencia" }).map((r) => r.id)).toEqual([
      "movement-1",
    ]);
    expect(applyMovementFilter(rows, { query: "zzzzzz" })).toEqual([]);
    // No filter keeps every row, in input order (list order is preserved).
    expect(applyMovementFilter(rows).map((r) => r.id)).toEqual([
      "movement-1",
      "movement-2",
    ]);
  });

  it("updateMovement toggles only the pin and rejects anything else", async () => {
    const { caseId } = await startCase();
    const movement = await createMovement({
      caseId,
      fecha: "2026-11-10",
      tipo: "Otro",
      detalle: "Para fijar",
    });

    const pinned = await updateMovement(movement.id, { pinned: true });
    expect(pinned).toMatchObject({ pinned: true, detalle: "Para fijar" });
    expect(pinned.fecha).toBe("2026-11-10");

    const unpinned = await updateMovement(movement.id, { pinned: false });
    expect(unpinned.pinned).toBe(false);

    // Narrow patch: empty fails before any I/O, junk types never land.
    await expect(updateMovement(movement.id, {})).rejects.toMatchObject({
      code: "missing_fields",
    });
    await expect(
      updateMovement(movement.id, { pinned: "yes" as never }),
    ).rejects.toMatchObject({ code: "save_failed" });
    await expect(
      updateMovement("movement-ghost", { pinned: true }),
    ).rejects.toMatchObject({ code: "save_failed" });

    const rows = await listMovements(caseId);
    expect(rows[0]).toMatchObject({ id: movement.id, pinned: false });
  });

  it("movementPinBadge carries the one Spanish pin word", () => {
    expect(movementPinBadge(true)).toBe("Fijado");
    expect(movementPinBadge(false)).toBe("");
  });
});

describe("supabase driver", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-demo");
  });

  it("listMovements orders fecha desc and pushes tipo/range to the query", async () => {
    queueResponse("movements", {
      data: [MOVEMENT_ROW, { ...MOVEMENT_ROW, id: "movement-2", tipo: null }],
      error: null,
    });

    const rows = await listMovements("case-a", {
      tipo: "Resolución",
      from: "2026-11-01",
      to: "2026-11-30",
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: "movement-1",
      fecha: "2026-11-15",
      tipo: "Resolución",
      detalle: "Se dicta sentencia",
      pinned: false,
      createdBy: "Ana Beltrán",
    });
    // A nullable tipo maps to "" (the UI shows "Sin tipo"), never a crash.
    expect(rows[1]?.tipo).toBe("");

    const read = calls.find((call) => call.table === "movements");
    expect(read?.steps).toContainEqual({ name: "eq", args: ["case_id", "case-a"] });
    expect(read?.steps).toContainEqual({ name: "eq", args: ["tipo", "Resolución"] });
    expect(read?.steps).toContainEqual({ name: "gte", args: ["fecha", "2026-11-01"] });
    expect(read?.steps).toContainEqual({ name: "lte", args: ["fecha", "2026-11-30"] });
    // Newest fecha first, created_at desc as the same-day tie-break.
    expect(read?.steps).toContainEqual({
      name: "order",
      args: ["fecha", { ascending: false }],
    });
    expect(read?.steps).toContainEqual({
      name: "order",
      args: ["created_at", { ascending: false }],
    });
  });

  it("createMovement inserts the trimmed payload with created_by and no pinned", async () => {
    queueMembership();
    queueResponse("movements", {
      data: {
        ...MOVEMENT_ROW,
        id: "movement-9",
        fecha: "2026-11-10",
        tipo: "Trámite",
        detalle: "Presentada contestación",
      },
      error: null,
    });

    const movement = await createMovement({
      caseId: "case-a",
      fecha: " 2026-11-10 ",
      tipo: "Trámite",
      detalle: "  Presentada contestación  ",
    });

    expect(movement).toMatchObject({
      id: "movement-9",
      fecha: "2026-11-10",
      tipo: "Trámite",
      detalle: "Presentada contestación",
      pinned: false,
      createdBy: "Ana Beltrán",
    });

    const write = calls.find(
      (call) =>
        call.table === "movements" && call.steps.some((step) => step.name === "insert"),
    );
    // `pinned` is omitted on purpose: the DB default (false) owns it.
    expect(write?.steps[0]).toEqual({
      name: "insert",
      args: [
        {
          study_id: "study-9",
          case_id: "case-a",
          fecha: "2026-11-10",
          tipo: "Trámite",
          detalle: "Presentada contestación",
          created_by: "user-1",
        },
      ],
    });

    // The fake driver's module-local list never took the write.
    expect(peekFakeMovements()).toHaveLength(0);
  });

  it("createMovement rejects invalid input before any query", async () => {
    // One study resolution per attempt (requireStudy runs first, like the
    // tasks branch) — none of them may reach a movement write.
    queueMembership();
    await expect(
      createMovement({ caseId: "case-a", fecha: "  ", tipo: "Audiencia", detalle: "x" }),
    ).rejects.toMatchObject({ code: "missing_fields" });
    queueMembership();
    await expect(
      createMovement({ caseId: "case-a", fecha: "1800-01-01", tipo: "Audiencia", detalle: "x" }),
    ).rejects.toMatchObject({ code: "invalid_fecha_efectiva" });
    queueMembership();
    await expect(
      createMovement({ caseId: "case-a", fecha: "2026-11-10", tipo: "Reunión", detalle: "x" }),
    ).rejects.toMatchObject({ code: "save_failed" });
    queueMembership();
    await expect(
      createMovement({ caseId: "case-a", fecha: "2026-11-10", tipo: "Otro", detalle: "x".repeat(4001) }),
    ).rejects.toMatchObject({ code: "save_failed" });

    expect(calls.filter((call) => call.table === "movements")).toHaveLength(0);
  });

  it("updateMovement patches only the pinned column", async () => {
    queueMembership();
    queueResponse("movements", { data: { id: "movement-1" }, error: null });
    queueResponse("movements", {
      data: { ...MOVEMENT_ROW, pinned: true },
      error: null,
    });

    const updated = await updateMovement("movement-1", { pinned: true });

    expect(updated).toMatchObject({
      id: "movement-1",
      pinned: true,
      detalle: "Se dicta sentencia",
    });

    const updateWrite = calls.find(
      (call) =>
        call.table === "movements" && call.steps.some((step) => step.name === "update"),
    );
    // Narrow patch: only `pinned` ever reaches the UPDATE.
    expect(updateWrite?.steps[0]).toEqual({ name: "update", args: [{ pinned: true }] });
    expect(updateWrite?.steps).toContainEqual({ name: "eq", args: ["id", "movement-1"] });
    expect(updateWrite?.steps).toContainEqual({
      name: "eq",
      args: ["study_id", "study-9"],
    });

    // The fake driver's module-local list never took the write.
    expect(peekFakeMovements()).toHaveLength(0);
  });

  it("updateMovement rejects an empty or junk patch before touching the network", async () => {
    await expect(updateMovement("movement-1", {})).rejects.toMatchObject({
      code: "missing_fields",
    });
    await expect(
      updateMovement("movement-1", { pinned: "yes" as never }),
    ).rejects.toMatchObject({ code: "save_failed" });
    expect(calls).toHaveLength(0);
  });
});
