/**
 * Task functions — GET/POST /api/tasks and PATCH /api/tasks/:id in
 * miniature (S16 list slice, F04 happy path).
 *
 * Driver split: the M1 store has no `tasks` array (tasks are new in M2 and
 * store.ts belongs to another unit), so the fake driver keeps its rows in a
 * module-local list behind `peekFakeTasks`/`resetFakeTasks` — the same kind
 * of test seam `resetDataStore` provides for the store. The supabase driver
 * runs the same contract against `tasks` + `task_statuses` under the
 * study-member RLS — see lib/supabase/tasks.ts for the query conventions.
 *
 * Shared wording/bounds are deliberately duplicated per driver (mirroring
 * the pruebas pair): the supabase branch must not import values through the
 * data-layer facade, or the two modules form a runtime import cycle.
 */

import { formatDate } from "@/lib/format";
import { requireSession } from "./auth";
import { toArtIsoDate } from "./calendar";
import { DataLayerError } from "./errors";
import { getDataDriver } from "./driver";
import { insertNotification } from "./notifications";
import { getStore, isoNow } from "./store";
import { getMyStudy, requireStudy } from "./studies";
import {
  createTaskSupabase,
  listTaskStatusesSupabase,
  listTasksSupabase,
  updateTaskSupabase,
} from "@/lib/supabase/tasks";

/** Due-date priority vocabulary (the `tasks.prioridad` check constraint). */
export const TASK_PRIORIDADES = [
  "alta",
  "normal",
  "baja",
  "sin_prioridad",
] as const;
export type TaskPrioridad = (typeof TASK_PRIORIDADES)[number];

/** `tasks.titulo` check constraint: 1..255 chars. */
export const TASK_TITULO_MAX = 255;

/**
 * Status keys that end a task — the `completada`/`cancelada` rows seeded per
 * study by `init_study_defaults()` (S16). The default list hides them; the
 * estado filter can still fetch them by key, and only open tasks ever render
 * as "Vencida".
 */
export const TERMINAL_STATUS_KEYS: ReadonlySet<string> = new Set([
  "completada",
  "cancelada",
]);

/** One row of the study's `task_statuses` (five evidenced defaults + customs). */
export interface TaskStatus {
  id: string;
  /** Stable per-study key (`pendiente` …) — filters and tones key off this. */
  key: string;
  /** Display name; editable per study without breaking anything. */
  name: string;
  position: number;
  isDefault: boolean;
}

export interface Task {
  id: string;
  studyId: string;
  caseId: string | null;
  /** Carátula of the linked expediente; "" when there is no case (— in the UI). */
  caseCaratula: string;
  statusId: string;
  estadoKey: string;
  estado: string;
  titulo: string;
  prioridad: TaskPrioridad;
  responsableId: string | null;
  /** profiles.full_name of the assignee; "" when it is not the current user. */
  responsable: string;
  /** ART calendar day (`YYYY-MM-DD`) the task is due; null = no due date. */
  venceAt: string | null;
  /** profiles.full_name of the creator; "" when unknown. */
  createdBy: string;
  createdAt: string;
}

export interface TaskFilter {
  /** Only this `task_statuses.key`; overrides the active-only default. */
  estadoKey?: string;
  /** Skip the active-only default (the screen's "Todas" option). */
  incluirTerminadas?: boolean;
}

export interface CreateTaskInput {
  titulo: string;
  caseId?: string | null;
  /** Defaults to the signed-in user; null = nobody (no alerts, F04 edge). */
  responsableId?: string | null;
  prioridad?: TaskPrioridad;
  /** `YYYY-MM-DD`, optional (typed by the user — never computed, F03 edge). */
  vence?: string | null;
  /** `task_statuses.key`; defaults to the study's `pendiente` state. */
  estadoKey?: string;
}

/** Only the three fields PATCH /api/tasks/:id accepts in this slice. */
export interface UpdateTaskPatch {
  estadoKey?: string;
  responsableId?: string | null;
  /** `YYYY-MM-DD` to set, null to clear, undefined to leave untouched. */
  vence?: string | null;
}

const DAY_MS = 86_400_000;

/**
 * True when `vence` would pass the DB's `chk_task_vence`: a real calendar
 * day within 365 days of creation and 30 years ahead (the upper bound uses
 * 366-day years so a leap year is never cut short). Both drivers run this
 * before any write — the same discipline as the BUG-004 fecha_efectiva
 * guard: a typed failure, nothing half-written.
 */
export function isValidVenceDate(
  vence: string,
  createdAtMs: number = Date.now(),
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vence)) return false;
  const day = Date.parse(`${vence}T12:00:00.000Z`);
  if (Number.isNaN(day)) return false;
  return (
    day >= createdAtMs - 365 * DAY_MS && day <= createdAtMs + 30 * 366 * DAY_MS
  );
}

/**
 * Overdue = a due day strictly before today (ART) on a task that is still
 * open: finished work never renders "Vencida" whatever its date says.
 * `today` is injectable so the rule stays a pure function under test.
 */
export function isTaskOverdue(
  task: Pick<Task, "venceAt" | "estadoKey">,
  today: string = toArtIsoDate(new Date()),
): boolean {
  if (!task.venceAt) return false;
  if (TERMINAL_STATUS_KEYS.has(task.estadoKey)) return false;
  return task.venceAt < today;
}

/**
 * The list's default order: due date ascending, tasks without a due date
 * last, newest first inside each group (nulls last is the S16 sort rule).
 */
export function compareTasksByDue(
  a: Pick<Task, "venceAt" | "createdAt">,
  b: Pick<Task, "venceAt" | "createdAt">,
): number {
  if (a.venceAt && b.venceAt) {
    if (a.venceAt !== b.venceAt) return a.venceAt < b.venceAt ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  }
  if (a.venceAt) return -1;
  if (b.venceAt) return 1;
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * The five evidenced defaults, in `init_study_defaults()` order. Keys are
 * stable per study; names/colors stay editable (S16). Ids are stable per
 * position so the estado select never changes value between two reads.
 */
const DEFAULT_TASK_STATUSES: TaskStatus[] = [
  { id: "task-status-1", key: "pendiente", name: "Pendiente", position: 1, isDefault: true },
  { id: "task-status-2", key: "en_curso", name: "En curso", position: 2, isDefault: true },
  { id: "task-status-3", key: "para_revisar", name: "Para revisar", position: 3, isDefault: true },
  { id: "task-status-4", key: "completada", name: "Completada", position: 4, isDefault: true },
  { id: "task-status-5", key: "cancelada", name: "Cancelada", position: 5, isDefault: true },
];

/** Module-local fake task list (see the file header for why it lives here). */
let fakeTasks: Task[] = [];
let fakeTaskSeq = 0;

/** Rebuild the fake task list — test isolation, like `resetDataStore`. */
export function resetFakeTasks(): void {
  fakeTasks = [];
  fakeTaskSeq = 0;
}

/** Read seam for tests: the supabase branch must never write into this list. */
export function peekFakeTasks(): readonly Task[] {
  return fakeTasks;
}

/** Study tasks, newest first; the default view hides terminal states. */
export async function listTasks(filter?: TaskFilter): Promise<Task[]> {
  if (getDataDriver() === "supabase") return listTasksSupabase(filter);

  const study = await getMyStudy();
  if (!study) return [];

  const rows = fakeTasks.filter((task) => task.studyId === study.id);
  const scoped = filter?.estadoKey
    ? rows.filter((task) => task.estadoKey === filter.estadoKey)
    : filter?.incluirTerminadas
      ? rows
      : rows.filter((task) => !TERMINAL_STATUS_KEYS.has(task.estadoKey));

  // Newest first; the id tie-break keeps same-millisecond inserts (fast
  // tests) in insertion order — fake ids are `task-{n}`.
  return [...scoped].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || seqOf(b.id) - seqOf(a.id),
  );
}

function seqOf(id: string): number {
  const value = Number(id.slice("task-".length));
  return Number.isNaN(value) ? 0 : value;
}

/** The current study's task states in `position` order; empty before onboarding. */
export async function listTaskStatuses(): Promise<TaskStatus[]> {
  if (getDataDriver() === "supabase") return listTaskStatusesSupabase();

  const study = await getMyStudy();
  if (!study) return [];
  // Copy so a caller can never mutate the module defaults.
  return DEFAULT_TASK_STATUSES.map((status) => ({ ...status }));
}

/** Create a task; the assignee (default: me) gets exactly one alert. */
export async function createTask(input: CreateTaskInput): Promise<Task> {
  if (getDataDriver() === "supabase") return createTaskSupabase(input);

  const study = await requireStudy();
  const session = await requireSession();

  // Same validation, same order as the supabase branch — every typed
  // failure fires before anything is written (mirrors the DB constraints).
  const titulo = input.titulo.trim();
  if (!titulo) throw new DataLayerError("missing_fields");
  if (titulo.length > TASK_TITULO_MAX) throw new DataLayerError("save_failed");
  const prioridad = input.prioridad ?? "sin_prioridad";
  if (!TASK_PRIORIDADES.includes(prioridad)) {
    throw new DataLayerError("save_failed");
  }
  const vence = input.vence?.trim() || null;
  if (vence && !isValidVenceDate(vence)) throw new DataLayerError("save_failed");
  const estadoKey = input.estadoKey ?? "pendiente";
  const status = DEFAULT_TASK_STATUSES.find((row) => row.key === estadoKey);
  if (!status) throw new DataLayerError("save_failed");
  const caseId = input.caseId ?? null;
  if (
    caseId &&
    !getStore().cases.some(
      (row) => row.id === caseId && row.studyId === study.id,
    )
  ) {
    throw new DataLayerError("save_failed"); // mirrors fk_tasks_case
  }

  const responsableId =
    input.responsableId === undefined ? session.user.id : input.responsableId;

  const task: Task = {
    id: `task-${(fakeTaskSeq += 1)}`,
    studyId: study.id,
    caseId,
    caseCaratula: caseId
      ? getStore().cases.find((row) => row.id === caseId)?.caratula ?? ""
      : "",
    statusId: status.id,
    estadoKey: status.key,
    estado: status.name,
    titulo,
    prioridad,
    responsableId,
    responsable:
      responsableId && responsableId === session.user.id
        ? session.user.fullName
        : "",
    venceAt: vence,
    createdBy: session.user.fullName,
    createdAt: isoNow(),
  };

  fakeTasks.push(task);

  // F04: the assignee gets one "Tarea asignada" alert — and with no
  // responsable nobody is alerted at all.
  if (task.responsableId === session.user.id) {
    const copy = taskNotificationCopy(task);
    insertNotification({
      studyId: study.id,
      userId: session.user.id,
      titulo: copy.titulo,
      detalle: copy.detalle,
      categoria: "Sistema",
      enlace: "/tareas",
    });
  }

  return task;
}

/** Apply the narrow patch (estado / responsable / vence — nothing else). */
export async function updateTask(
  id: string,
  patch: UpdateTaskPatch,
): Promise<Task> {
  if (getDataDriver() === "supabase") return updateTaskSupabase(id, patch);

  // A PATCH with nothing to change is a client bug: fail before any I/O.
  if (
    patch.estadoKey === undefined &&
    patch.responsableId === undefined &&
    patch.vence === undefined
  ) {
    throw new DataLayerError("missing_fields");
  }

  const study = await requireStudy();
  const session = await requireSession();

  const task = fakeTasks.find(
    (row) => row.id === id && row.studyId === study.id,
  );
  if (!task) throw new DataLayerError("save_failed");

  // Validate the whole patch first: a bad field never half-applies (the
  // supabase branch gets the same atomicity from its single UPDATE).
  let nextStatus: TaskStatus | undefined;
  if (patch.estadoKey !== undefined) {
    nextStatus = DEFAULT_TASK_STATUSES.find(
      (row) => row.key === patch.estadoKey,
    );
    if (!nextStatus) throw new DataLayerError("save_failed");
  }
  let nextVence: string | null = null;
  if (patch.vence !== undefined) {
    nextVence = patch.vence?.trim() || null;
    if (nextVence && !isValidVenceDate(nextVence)) {
      throw new DataLayerError("save_failed");
    }
  }

  const previousResponsable = task.responsableId;

  if (nextStatus) {
    task.statusId = nextStatus.id;
    task.estadoKey = nextStatus.key;
    task.estado = nextStatus.name;
  }
  if (patch.responsableId !== undefined) {
    task.responsableId = patch.responsableId;
    task.responsable =
      task.responsableId === session.user.id ? session.user.fullName : "";
  }
  if (patch.vence !== undefined) task.venceAt = nextVence;

  // F04 assignment alert: only when the task lands on ME (the fake has no
  // member directory; cross-member delivery needs the server-side path).
  if (
    patch.responsableId !== undefined &&
    task.responsableId === session.user.id &&
    previousResponsable !== session.user.id
  ) {
    const copy = taskNotificationCopy(task);
    insertNotification({
      studyId: study.id,
      userId: session.user.id,
      titulo: copy.titulo,
      detalle: copy.detalle,
      categoria: "Sistema",
      enlace: "/tareas",
    });
  }

  return task;
}

/** Spanish alert copy for this driver (supabase/tasks.ts mirrors it verbatim). */
function taskNotificationCopy(task: {
  titulo: string;
  estado: string;
  venceAt: string | null;
}): { titulo: string; detalle: string } {
  return {
    titulo: `Tarea asignada: «${task.titulo}»`,
    detalle: task.venceAt
      ? `Quedó en ${task.estado}, vence el ${formatDate(task.venceAt)}.`
      : `Quedó en ${task.estado}.`,
  };
}
