import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStore, resetDataStore } from "./store";

/**
 * Task contract for both drivers, fully mocked: no live project, no network.
 * The seams under test: identical validation order in both drivers, the
 * narrow PATCH (estado / responsable / vence only), the assignment alert
 * written exactly once behind its `task:<id>` dedupe key, and the overdue
 * rule that only open tasks past their due day render as "Vencida".
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

import {
  compareTasksByDue,
  createTask,
  isTaskOverdue,
  listTaskStatuses,
  listTasks,
  peekFakeTasks,
  resetFakeTasks,
  updateTask,
} from "./tasks";
import { onNotification } from "./notifications";
import { getSession, signUp } from "./auth";
import { createStudy } from "./studies";
import { DataLayerError, errorCopy } from "./errors";
import type { AppNotification } from "@/lib/types";

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
  // Fresh store per test: the fake-driver cases below write users/studies and
  // the module-local task list must never leak between tests either.
  resetDataStore();
  resetFakeTasks();
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

const OPEN_TASK_ROW = {
  id: "task-1",
  study_id: "study-9",
  case_id: "case-a",
  status_id: "status-1",
  titulo: "Contestar la demanda",
  prioridad: "alta",
  responsable_id: "user-1",
  vence_at: "2026-12-05T12:00:00.000Z",
  created_at: "2026-11-18T10:00:00.000Z",
  status: { key: "pendiente", name: "Pendiente" },
  case: { caratula: "Gómez, Rosa c/ Empresa de Luz S.A. s/ cobro de pesos" },
  responsable: { full_name: "Ana Beltrán" },
  created_by: { full_name: "Ana Beltrán" },
};

const DONE_TASK_ROW = {
  ...OPEN_TASK_ROW,
  id: "task-2",
  titulo: "Tarea terminada",
  status_id: "status-4",
  status: { key: "completada", name: "Completada" },
  created_at: "2026-11-17T10:00:00.000Z",
};

describe("fake driver", () => {
  /** Sign up + wizard: the fake store's study + membership path. */
  async function startStudy(): Promise<{ userId: string }> {
    const signed = await signUp({
      fullName: "Ana Beltrán",
      email: "ana.tareas@ejemplo.test",
      password: "clave-de-prueba",
    });
    if (!signed.ok) throw new Error(`signUp failed: ${signed.error}`);
    await createStudy({ name: "Estudio Tareas", jurisdictions: ["Córdoba"] });
    const session = await getSession();
    if (!session) throw new Error("no session after signUp");
    return { userId: session.user.id };
  }

  it("listTasks and listTaskStatuses answer honestly before onboarding", async () => {
    expect(await listTasks()).toEqual([]);
    expect(await listTaskStatuses()).toEqual([]);
    // The fake driver never touches the network for a read.
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("listTaskStatuses serves the five evidenced defaults in position order", async () => {
    await startStudy();
    const statuses = await listTaskStatuses();
    expect(statuses.map((status) => status.key)).toEqual([
      "pendiente",
      "en_curso",
      "para_revisar",
      "completada",
      "cancelada",
    ]);
    expect(statuses.every((status) => status.isDefault)).toBe(true);
    expect(statuses.map((status) => status.position)).toEqual([1, 2, 3, 4, 5]);
  });

  it("createTask rejects a blank titulo with a typed error and writes nothing", async () => {
    await startStudy();

    const error = await createTask({ titulo: "   " }).then(
      () => null,
      (caught: unknown) => caught,
    );
    // Typed code + the Argentine Spanish copy the screens show (ERROR_COPY).
    expect.soft(error).toBeInstanceOf(DataLayerError);
    expect.soft(
      error instanceof DataLayerError ? errorCopy(error.code) : null,
    ).toBe("Completá todos los campos para continuar.");
    expect(await listTasks({ incluirTerminadas: true })).toEqual([]);
  });

  it("createTask persists the defaults and alerts me exactly once", async () => {
    const { userId } = await startStudy();
    const emitted: AppNotification[] = [];
    const unsubscribe = onNotification((notification) =>
      emitted.push(notification),
    );

    const task = await createTask({ titulo: "  Redactar contestación  " });
    unsubscribe();

    expect(task.titulo).toBe("Redactar contestación");
    expect(task).toMatchObject({
      estadoKey: "pendiente",
      estado: "Pendiente",
      prioridad: "sin_prioridad",
      responsableId: userId,
      venceAt: null,
      caseId: null,
    });
    expect(task.createdBy).toBe("Ana Beltrán");

    // Exactly one alert on the local seam the bell subscribes to.
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.titulo).toContain("Tarea asignada");
    expect(emitted[0]).toMatchObject({
      categoria: "Sistema",
      enlace: "/tareas",
    });
    expect(
      getStore().notifications.filter((entry) =>
        entry.titulo.includes("Redactar contestación"),
      ),
    ).toHaveLength(1);

    const rows = await listTasks();
    expect(rows.map((row) => row.id)).toContain(task.id);
  });

  it("createTask with no responsable sends no alert (F04 edge)", async () => {
    await startStudy();
    const emitted: AppNotification[] = [];
    const unsubscribe = onNotification((notification) =>
      emitted.push(notification),
    );

    const task = await createTask({
      titulo: "Tarea sin dueño",
      responsableId: null,
    });
    unsubscribe();

    expect(task.responsableId).toBeNull();
    expect(emitted).toHaveLength(0);
  });

  it("createTask mirrors the DB constraints: bad rows never reach the store", async () => {
    await startStudy();

    await expect(
      createTask({ titulo: "x".repeat(256) }),
    ).rejects.toMatchObject({ code: "save_failed" });
    await expect(
      createTask({ titulo: "Fecha imposible", vence: "61116-02-02" }),
    ).rejects.toMatchObject({ code: "save_failed" });
    await expect(
      createTask({ titulo: "Fecha muy vieja", vence: "1800-01-01" }),
    ).rejects.toMatchObject({ code: "save_failed" });
    await expect(
      createTask({ titulo: "Prioridad fantasma", prioridad: "urgentísima" as never }),
    ).rejects.toMatchObject({ code: "save_failed" });
    await expect(
      createTask({ titulo: "Estado fantasma", estadoKey: "volando" }),
    ).rejects.toMatchObject({ code: "save_failed" });

    expect(await listTasks({ incluirTerminadas: true })).toEqual([]);
  });

  it("listTasks keeps terminal states out by default and filters by estado", async () => {
    await startStudy();
    const first = await createTask({ titulo: "Una tarea" });
    const second = await createTask({
      titulo: "Otra tarea",
      estadoKey: "en_curso",
    });
    const third = await createTask({
      titulo: "Terminada",
      estadoKey: "completada",
    });

    const active = await listTasks();
    expect(active.map((row) => row.id)).toEqual([second.id, first.id]);

    const done = await listTasks({ estadoKey: "completada" });
    expect(done.map((row) => row.id)).toEqual([third.id]);

    const all = await listTasks({ incluirTerminadas: true });
    expect(all.map((row) => row.id)).toEqual([third.id, second.id, first.id]);
  });

  it("updateTask applies only the estado/responsable/vence patch", async () => {
    const { userId } = await startStudy();
    const task = await createTask({ titulo: "Para actualizar" });

    const withEstado = await updateTask(task.id, { estadoKey: "para_revisar" });
    expect(withEstado).toMatchObject({
      estadoKey: "para_revisar",
      estado: "Para revisar",
    });
    expect(withEstado.titulo).toBe("Para actualizar");
    expect(withEstado.responsableId).toBe(userId);
    expect(withEstado.venceAt).toBeNull();

    const withVence = await updateTask(task.id, { vence: "2026-12-31" });
    expect(withVence.venceAt).toBe("2026-12-31");
    const cleared = await updateTask(task.id, { vence: null });
    expect(cleared.venceAt).toBeNull();

    const unassigned = await updateTask(task.id, { responsableId: null });
    expect(unassigned.responsableId).toBeNull();
    expect(unassigned.titulo).toBe("Para actualizar");
  });

  it("updateTask rejects an empty patch and an unknown estado before writing", async () => {
    await startStudy();
    const task = await createTask({ titulo: "Bloqueada" });

    await expect(updateTask(task.id, {})).rejects.toMatchObject({
      code: "missing_fields",
    });
    await expect(
      updateTask(task.id, { estadoKey: "inventada" }),
    ).rejects.toMatchObject({ code: "save_failed" });

    const rows = await listTasks();
    expect(rows[0]).toMatchObject({ estadoKey: "pendiente", titulo: "Bloqueada" });
  });

  it("assigning a task to me alerts once; later changes do not re-alert", async () => {
    const { userId } = await startStudy();
    const task = await createTask({
      titulo: "Reasignar",
      responsableId: null,
    });

    let alerts = 0;
    const unsubscribe = onNotification(() => {
      alerts += 1;
    });
    await updateTask(task.id, { responsableId: userId });
    await updateTask(task.id, { estadoKey: "en_curso" });
    // Re-sending the same responsable must not duplicate the alert.
    await updateTask(task.id, { responsableId: userId });
    unsubscribe();

    expect(alerts).toBe(1);
  });

  it("isTaskOverdue only fires for open tasks past their due day", () => {
    expect(
      isTaskOverdue({ venceAt: "2026-11-01", estadoKey: "pendiente" }, "2026-11-18"),
    ).toBe(true);
    // Due today is not yet overdue.
    expect(
      isTaskOverdue({ venceAt: "2026-11-18", estadoKey: "pendiente" }, "2026-11-18"),
    ).toBe(false);
    expect(
      isTaskOverdue({ venceAt: "2026-11-30", estadoKey: "en_curso" }, "2026-11-18"),
    ).toBe(false);
    expect(
      isTaskOverdue({ venceAt: null, estadoKey: "pendiente" }, "2026-11-18"),
    ).toBe(false);
    // Finished work is never "Vencida", whatever its date says.
    expect(
      isTaskOverdue({ venceAt: "2026-11-01", estadoKey: "completada" }, "2026-11-18"),
    ).toBe(false);
    expect(
      isTaskOverdue({ venceAt: "2026-11-01", estadoKey: "cancelada" }, "2026-11-18"),
    ).toBe(false);
  });

  it("compareTasksByDue sorts due dates ascending with nulls last", () => {
    const later = { venceAt: "2026-12-01", createdAt: "2026-11-10T10:00:00.000Z" };
    const sooner = { venceAt: "2026-11-01", createdAt: "2026-11-11T10:00:00.000Z" };
    const none = { venceAt: null, createdAt: "2026-11-12T10:00:00.000Z" };

    expect([later, none, sooner].sort(compareTasksByDue)).toEqual([
      sooner,
      later,
      none,
    ]);
  });
});

describe("supabase driver", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-demo");
  });

  it("listTasks maps rows, keeps terminal out by default and filters by estado", async () => {
    queueResponse("tasks", {
      data: [OPEN_TASK_ROW, DONE_TASK_ROW],
      error: null,
    });

    const active = await listTasks();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      id: "task-1",
      estadoKey: "pendiente",
      estado: "Pendiente",
      prioridad: "alta",
      venceAt: "2026-12-05",
      caseCaratula: "Gómez, Rosa c/ Empresa de Luz S.A. s/ cobro de pesos",
      responsable: "Ana Beltrán",
      createdBy: "Ana Beltrán",
    });

    const read = calls.find((call) => call.table === "tasks");
    expect(read?.steps).toContainEqual({
      name: "order",
      args: ["created_at", { ascending: false }],
    });

    queueResponse("tasks", {
      data: [OPEN_TASK_ROW, DONE_TASK_ROW],
      error: null,
    });
    const done = await listTasks({ estadoKey: "completada" });
    expect(done.map((row) => row.id)).toEqual(["task-2"]);

    queueResponse("tasks", {
      data: [OPEN_TASK_ROW, DONE_TASK_ROW],
      error: null,
    });
    const all = await listTasks({ incluirTerminadas: true });
    expect(all).toHaveLength(2);
  });

  it("listTasks maps a corrupt vence_at to null instead of throwing (BUG-004 lesson)", async () => {
    queueResponse("tasks", {
      data: [{ ...OPEN_TASK_ROW, vence_at: "61116-02-10T02:59:59+00:00" }],
      error: null,
    });

    const rows = await listTasks({ incluirTerminadas: true });
    expect(rows[0]?.venceAt).toBeNull();
  });

  it("createTask inserts the resolved status and writes ONE tareas alert with its dedupe", async () => {
    queueMembership();
    queueResponse("task_statuses", {
      data: {
        id: "status-1",
        key: "pendiente",
        name: "Pendiente",
        position: 1,
        is_default: true,
      },
      error: null,
    });
    queueResponse("tasks", {
      data: {
        ...OPEN_TASK_ROW,
        id: "task-9",
        titulo: "Tarea supabase",
        prioridad: "sin_prioridad",
        case_id: null,
        vence_at: null,
        case: null,
      },
      error: null,
    });
    queueResponse("notifications", {
      data: {
        id: "notif-9",
        study_id: "study-9",
        user_id: "user-1",
        category: "tareas",
        title: "Tarea asignada: «Tarea supabase»",
        body: "Quedó en Pendiente.",
        deep_link: "/tareas",
        read_at: null,
        created_at: "2026-11-18T12:00:00.000Z",
      },
      error: null,
    });

    const emitted: AppNotification[] = [];
    const unsubscribe = onNotification((notification) =>
      emitted.push(notification),
    );
    const task = await createTask({ titulo: "  Tarea supabase  " });
    unsubscribe();

    expect(task).toMatchObject({
      id: "task-9",
      estadoKey: "pendiente",
      estado: "Pendiente",
      prioridad: "sin_prioridad",
      responsableId: "user-1",
      responsable: "Ana Beltrán",
      venceAt: null,
      caseId: null,
    });

    const taskWrite = calls.find(
      (call) =>
        call.table === "tasks" && call.steps.some((step) => step.name === "insert"),
    );
    expect(taskWrite?.steps[0]).toEqual({
      name: "insert",
      args: [
        {
          study_id: "study-9",
          case_id: null,
          status_id: "status-1",
          titulo: "Tarea supabase",
          prioridad: "sin_prioridad",
          responsable_id: "user-1",
          vence_at: null,
          created_by: "user-1",
        },
      ],
    });

    // The alert is app-side (no trigger writes notifications) and carries the
    // idempotency key the reminder jobs share: task:<id>.
    const notifWrite = calls.find((call) => call.table === "notifications");
    expect(notifWrite?.steps[0]).toEqual({
      name: "insert",
      args: [
        {
          study_id: "study-9",
          user_id: "user-1",
          category: "tareas",
          title: "Tarea asignada: «Tarea supabase»",
          body: "Quedó en Pendiente.",
          deep_link: "/tareas",
          channel: "in_app",
          dedupe_key: "task:task-9",
        },
      ],
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ categoria: "Sistema", enlace: "/tareas" });

    // The fake driver's module-local list never took the write.
    expect(peekFakeTasks()).toHaveLength(0);
  });

  it("createTask rejects invalid input before any query", async () => {
    // One study resolution per attempt (requireStudy runs first, like the
    // pruebas branch) — none of them may reach a task write.
    queueMembership();
    await expect(createTask({ titulo: "   " })).rejects.toMatchObject({
      code: "missing_fields",
    });
    queueMembership();
    await expect(
      createTask({ titulo: "x".repeat(256) }),
    ).rejects.toMatchObject({ code: "save_failed" });
    queueMembership();
    await expect(
      createTask({ titulo: "Fecha muy vieja", vence: "1800-01-01" }),
    ).rejects.toMatchObject({ code: "save_failed" });

    expect(calls.filter((call) => call.table === "tasks")).toHaveLength(0);
    expect(calls.filter((call) => call.table === "notifications")).toHaveLength(0);
    expect(calls.filter((call) => call.table === "task_statuses")).toHaveLength(0);
  });

  it("updateTask patches only the allowed columns and alerts on assignment", async () => {
    queueMembership();
    queueResponse("tasks", {
      data: { id: "task-1", responsable_id: null },
      error: null,
    });
    queueResponse("task_statuses", {
      data: {
        id: "status-2",
        key: "en_curso",
        name: "En curso",
        position: 2,
        is_default: true,
      },
      error: null,
    });
    queueResponse("tasks", {
      data: { ...OPEN_TASK_ROW, status_id: "status-2", status: { key: "en_curso", name: "En curso" } },
      error: null,
    });
    queueResponse("notifications", {
      data: {
        id: "notif-10",
        study_id: "study-9",
        user_id: "user-1",
        category: "tareas",
        title: "Tarea asignada: «Contestar la demanda»",
        body: "Quedó en En curso.",
        deep_link: "/tareas",
        read_at: null,
        created_at: "2026-11-18T12:05:00.000Z",
      },
      error: null,
    });

    const emitted: AppNotification[] = [];
    const unsubscribe = onNotification((notification) =>
      emitted.push(notification),
    );
    const updated = await updateTask("task-1", {
      estadoKey: "en_curso",
      responsableId: "user-1",
    });
    unsubscribe();

    expect(updated).toMatchObject({
      estadoKey: "en_curso",
      estado: "En curso",
      titulo: "Contestar la demanda",
      venceAt: "2026-12-05",
    });

    const updateWrite = calls.find(
      (call) =>
        call.table === "tasks" && call.steps.some((step) => step.name === "update"),
    );
    // Narrow patch: only the three allowed columns ever reach the UPDATE.
    expect(updateWrite?.steps[0]).toEqual({
      name: "update",
      args: [{ status_id: "status-2", responsable_id: "user-1" }],
    });

    const notifWrite = calls.find((call) => call.table === "notifications");
    expect(notifWrite?.steps[0]).toEqual({
      name: "insert",
      args: [
        {
          study_id: "study-9",
          user_id: "user-1",
          category: "tareas",
          title: "Tarea asignada: «Contestar la demanda»",
          body: "Quedó en En curso, vence el 05/12/2026.",
          deep_link: "/tareas",
          channel: "in_app",
          dedupe_key: "task:task-1",
        },
      ],
    });
    expect(emitted).toHaveLength(1);
  });

  it("updateTask rejects an empty patch before touching the network", async () => {
    await expect(updateTask("task-1", {})).rejects.toMatchObject({
      code: "missing_fields",
    });
    expect(calls).toHaveLength(0);
  });

  it("listTaskStatuses maps the study's rows in position order", async () => {
    queueMembership();
    queueResponse("task_statuses", {
      data: [
        { id: "status-1", key: "pendiente", name: "Pendiente", position: 1, is_default: true },
        { id: "status-2", key: "en_curso", name: "En curso", position: 2, is_default: true },
        { id: "status-3", key: "para_revisar", name: "Para revisar", position: 3, is_default: true },
        { id: "status-4", key: "completada", name: "Completada", position: 4, is_default: true },
        { id: "status-5", key: "cancelada", name: "Cancelada", position: 5, is_default: true },
      ],
      error: null,
    });

    const statuses = await listTaskStatuses();

    expect(statuses.map((status) => status.key)).toEqual([
      "pendiente",
      "en_curso",
      "para_revisar",
      "completada",
      "cancelada",
    ]);
    expect(statuses.every((status) => status.isDefault)).toBe(true);
    const read = calls.find((call) => call.table === "task_statuses");
    expect(read?.steps).toContainEqual({ name: "eq", args: ["study_id", "study-9"] });
    expect(read?.steps).toContainEqual({
      name: "order",
      args: ["position", { ascending: true }],
    });
  });
});
