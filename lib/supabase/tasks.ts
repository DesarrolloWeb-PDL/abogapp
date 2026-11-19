/**
 * Task functions for the `supabase` driver — browser-safe (anon key + the
 * `tasks_member` / `task_statuses_member` RLS created by the init migration
 * for every table with a `study_id` tenant column).
 *
 * Vocabulary mapping: the DB stores `tasks.status_id → task_statuses` and a
 * timestamptz `vence_at`; the screens speak the status KEY + display name
 * and the ART calendar day, so reads embed the status and writes resolve
 * the key first (same trick as the etapa name → etapa_id resolve in
 * lib/supabase/cases.ts).
 *
 * The shared wording/bounds below mirror lib/data/tasks.ts on purpose: a
 * value import through the data-layer facade would close a runtime import
 * cycle (the pruebas pair duplicates its alert copy the same way).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppNotification } from "@/lib/types";
import { DataLayerError } from "@/lib/data/errors";
import type {
  CreateTaskInput,
  Task,
  TaskFilter,
  TaskPrioridad,
  TaskStatus,
  UpdateTaskPatch,
} from "@/lib/data/tasks";
import { emitNotification } from "@/lib/data/notifications";
import { toArtIsoDate } from "@/lib/data/calendar";
import { getMyStudy, requireStudy } from "@/lib/data/studies";
import { formatDate } from "@/lib/format";
import { getBrowserClient } from "./client";
import { isInAppEnabled } from "./notifications";

// --- mirrors of lib/data/tasks.ts (see the header note) ---------------------
const TASK_PRIORIDADES: readonly string[] = [
  "alta",
  "normal",
  "baja",
  "sin_prioridad",
];
const TASK_TITULO_MAX = 255;
const TERMINAL_STATUS_KEYS: ReadonlySet<string> = new Set([
  "completada",
  "cancelada",
]);
const DAY_MS = 86_400_000;
// -----------------------------------------------------------------------------

/**
 * Every column the screens read, plus the embeds that carry the fields the
 * tasks table stores differently:
 *  - `status`  → task_statuses(key, name) — the estado chip/filter;
 *  - `case`    → cases.caratula (the composite fk_tasks_case);
 *  - `responsable` / `created_by` → profiles.full_name. profiles RLS is
 *    own-row-only, so another member's name comes back null (the UI reads
 *    that as "Otro miembro del estudio"); my own rows always resolve.
 * The two profiles FKs need explicit `!fk` hints — PostgREST cannot pick
 * between them on its own (verified against the dev project: HTTP 200).
 */
const TASK_COLUMNS =
  "id, study_id, case_id, status_id, titulo, prioridad, responsable_id, " +
  "vence_at, created_at, status:task_statuses(key, name), case:cases(caratula), " +
  "responsable:profiles!tasks_responsable_id_fkey(full_name), " +
  "created_by:profiles!tasks_created_by_fkey(full_name)";

interface TaskRow {
  id: string;
  study_id: string;
  case_id: string | null;
  status_id: string;
  titulo: string;
  prioridad: string;
  responsable_id: string | null;
  /** timestamptz written by the user (never computed — F03 edge). */
  vence_at: string | null;
  created_at: string;
  status: { key: string; name: string } | null;
  case: { caratula: string } | null;
  responsable: { full_name: string | null } | null;
  created_by: { full_name: string | null } | null;
}

interface StatusRow {
  id: string;
  key: string;
  name: string;
  position: number;
  is_default: boolean;
}

/** Study tasks, newest first; the default view hides terminal states. */
export async function listTasksSupabase(filter?: TaskFilter): Promise<Task[]> {
  const supabase = getBrowserClient();

  // RLS (`tasks_member` = is_member(study_id)) is the tenancy guard, same
  // as the cases read; the terminal/estado rules below run on the mapped
  // rows so both drivers answer identically.
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .order("created_at", { ascending: false });
  if (error || !data) throw new DataLayerError("save_failed");

  const tasks = (data as unknown as TaskRow[]).map(mapTask);
  if (filter?.estadoKey) {
    return tasks.filter((task) => task.estadoKey === filter.estadoKey);
  }
  if (filter?.incluirTerminadas) return tasks;
  return tasks.filter((task) => !TERMINAL_STATUS_KEYS.has(task.estadoKey));
}

/** The current study's task states in `position` order (S16 picker source). */
export async function listTaskStatusesSupabase(): Promise<TaskStatus[]> {
  // getMyStudy (not requireStudy): before onboarding the read answers the
  // honest empty list, exactly like the fake branch and listStagesSupabase.
  const study = await getMyStudy();
  if (!study) return [];
  const supabase = getBrowserClient();

  // RLS already scopes task_statuses to my memberships; the study filter
  // keeps the answer to THE study (a user may belong to up to five), exactly
  // like listStagesSupabase does for case_stages.
  const { data, error } = await supabase
    .from("task_statuses")
    .select("id, key, name, position, is_default")
    .eq("study_id", study.id)
    .order("position", { ascending: true });
  if (error || !data) throw new DataLayerError("save_failed");

  return (data as unknown as StatusRow[]).map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    position: row.position,
    isDefault: row.is_default,
  }));
}

/** Create a task; the assignee (default: me) gets exactly one alert. */
export async function createTaskSupabase(
  input: CreateTaskInput,
): Promise<Task> {
  const study = await requireStudy();
  const supabase = getBrowserClient();
  const user = await requireUser(supabase);

  // Same validation, same order as the fake branch — nothing reaches the
  // network before the typed failures the screens map through errorCopy().
  const titulo = input.titulo.trim();
  if (!titulo) throw new DataLayerError("missing_fields");
  if (titulo.length > TASK_TITULO_MAX) throw new DataLayerError("save_failed");
  const prioridad = input.prioridad ?? "sin_prioridad";
  if (!TASK_PRIORIDADES.includes(prioridad)) {
    throw new DataLayerError("save_failed");
  }
  const vence = input.vence?.trim() || null;
  if (vence && !isValidVenceDate(vence)) {
    throw new DataLayerError("save_failed");
  }

  // estado: the DB column is NOT NULL with no default, so the key always
  // resolves to a study row first ("pendiente" when the form omits it —
  // a study may rename the state, the key stays stable).
  const estadoKey = input.estadoKey ?? "pendiente";
  const { data: status, error: statusError } = await supabase
    .from("task_statuses")
    .select("id, key, name, position, is_default")
    .eq("study_id", study.id)
    .eq("key", estadoKey)
    .maybeSingle();
  if (statusError || !status) throw new DataLayerError("save_failed");

  const caseId = input.caseId ?? null;
  const responsableId =
    input.responsableId === undefined ? user.id : input.responsableId;

  // caseId is NOT pre-validated: the composite fk_tasks_case rejects a
  // foreign/unknown case with the same save_failed the fake branch raises.
  const { data: row, error } = await supabase
    .from("tasks")
    .insert({
      study_id: study.id,
      case_id: caseId,
      status_id: (status as unknown as StatusRow).id,
      titulo,
      prioridad,
      responsable_id: responsableId,
      vence_at: vence ? `${vence}T12:00:00.000Z` : null,
      created_by: user.id,
    })
    .select(TASK_COLUMNS)
    .single();
  if (error || !row) throw new DataLayerError("save_failed");
  // The type-level select parser cannot resolve embeds without generated
  // database types, so the row arrives loosely typed — retype it once.
  const task = mapTask(row as unknown as TaskRow);

  // No DB trigger writes notifications (replica/schema.sql only triggers on
  // plazos/documents/tasks), so the app side owns the alert — mirroring the
  // fake layer's copy verbatim so both drivers read alike.
  if (task.responsableId === user.id) {
    const copy = taskNotificationCopy(task);
    const notification = await insertTaskNotification({
      studyId: study.id,
      userId: user.id,
      taskId: task.id,
      titulo: copy.titulo,
      detalle: copy.detalle,
    });
    // Same local seam the fake layer fires: the bell re-reads unreadCount().
    emitNotification(notification);
  }

  return task;
}

/** Apply the narrow patch (estado / responsable / vence — nothing else). */
export async function updateTaskSupabase(
  id: string,
  patch: UpdateTaskPatch,
): Promise<Task> {
  // A PATCH with nothing to change is a client bug: fail before any I/O.
  if (
    patch.estadoKey === undefined &&
    patch.responsableId === undefined &&
    patch.vence === undefined
  ) {
    throw new DataLayerError("missing_fields");
  }

  const study = await requireStudy();
  const supabase = getBrowserClient();
  const user = await requireUser(supabase);

  // Pre-read: the row must exist in MY study (fake-driver parity) and its
  // current responsable decides whether the patch below is an assignment.
  const { data: current, error: currentError } = await supabase
    .from("tasks")
    .select("id, responsable_id")
    .eq("id", id)
    .eq("study_id", study.id)
    .maybeSingle();
  if (currentError || !current) throw new DataLayerError("save_failed");
  const previousResponsable = (current as { responsable_id: string | null })
    .responsable_id;

  // Validate the whole patch first: a bad field never half-applies (the
  // UPDATE below is the only write — one statement, all-or-nothing).
  const payload: Record<string, unknown> = {};
  if (patch.estadoKey !== undefined) {
    const { data: status, error: statusError } = await supabase
      .from("task_statuses")
      .select("id, key, name, position, is_default")
      .eq("study_id", study.id)
      .eq("key", patch.estadoKey)
      .maybeSingle();
    if (statusError || !status) throw new DataLayerError("save_failed");
    payload.status_id = (status as unknown as StatusRow).id;
  }
  if (patch.responsableId !== undefined) {
    payload.responsable_id = patch.responsableId;
  }
  if (patch.vence !== undefined) {
    const vence = patch.vence?.trim() || null;
    if (vence && !isValidVenceDate(vence)) {
      throw new DataLayerError("save_failed");
    }
    payload.vence_at = vence ? `${vence}T12:00:00.000Z` : null;
  }

  const { data: row, error } = await supabase
    .from("tasks")
    .update(payload)
    .eq("id", id)
    .eq("study_id", study.id)
    .select(TASK_COLUMNS)
    .single();
  if (error || !row) throw new DataLayerError("save_failed");
  const task = mapTask(row as unknown as TaskRow);

  // F04 assignment alert: only when the task lands on ME — the notification
  // RLS is own-rows-only, so cross-member delivery needs the server-side
  // path (documented M2 constraint; M2 has no member picker anyway).
  if (
    patch.responsableId !== undefined &&
    task.responsableId === user.id &&
    previousResponsable !== user.id
  ) {
    try {
      const copy = taskNotificationCopy(task);
      const notification = await insertTaskNotification({
        studyId: study.id,
        userId: user.id,
        taskId: task.id,
        titulo: copy.titulo,
        detalle: copy.detalle,
      });
      emitNotification(notification);
    } catch {
      // Best-effort: the assignment already committed above, and a repeated
      // flip (me → other → me) hits the (user_id, dedupe_key) unique index.
      // The patch must not fail because an alert could not be written.
    }
  }

  return task;
}

/**
 * Insert one task alert for the signed-in user, mirroring
 * insertNotificationSupabase — including its emission gate (S21): the row
 * only lands while the `tareas` preference bucket allows in-app alerts
 * (the same bucket PREFERENCE_CATEGORY.Sistema names, see
 * lib/supabase/notifications.ts), and a preference read that fails opens
 * so a broken read never drops an alert. Paused → `null` comes back and the
 * caller's `emitNotification(null)` stays silent, exactly like the pruebas
 * path.
 *
 * The row still writes the RAW `tareas` bucket rather than going through
 * insertNotificationSupabase: that helper only speaks the four app
 * categories and would write `sistemas_judiciales`, which the read-collapse
 * (CATEGORY_FROM_DB) would show under the "Plazos" chip instead of
 * "Sistema". `dedupe_key` feeds the (user_id, dedupe_key) unique
 * constraint: a retried emission stays idempotent, like the pruebas alert.
 */
async function insertTaskNotification(input: {
  studyId: string;
  userId: string;
  taskId: string;
  titulo: string;
  detalle: string;
}): Promise<AppNotification | null> {
  // Emission gate first: with "Tareas" paused in Preferencias no row is
  // written and no local seam fires — the alert is simply skipped.
  if (!(await isInAppEnabled(input.userId, "tareas"))) {
    return null;
  }

  const supabase = getBrowserClient();

  const { data: row, error } = await supabase
    .from("notifications")
    .insert({
      study_id: input.studyId,
      user_id: input.userId,
      category: "tareas",
      title: input.titulo,
      body: input.detalle,
      deep_link: "/tareas",
      channel: "in_app",
      dedupe_key: `task:${input.taskId}`,
    })
    .select(
      "id, study_id, user_id, category, title, body, deep_link, read_at, created_at",
    )
    .single();
  if (error || !row) throw new DataLayerError("save_failed");

  const notification = row as unknown as {
    id: string;
    study_id: string;
    user_id: string;
    category: string;
    title: string;
    body: string;
    deep_link: string | null;
    read_at: string | null;
    created_at: string;
  };
  return {
    id: notification.id,
    studyId: notification.study_id,
    userId: notification.user_id,
    titulo: notification.title,
    detalle: notification.body,
    // Same collapse the reader applies to a `tareas` row (Sistema chip).
    categoria: "Sistema",
    leida: notification.read_at !== null,
    createdAt: notification.created_at,
    enlace: notification.deep_link,
  };
}

async function requireUser(
  supabase: SupabaseClient,
): Promise<{ id: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new DataLayerError("not_signed_in");
  return user;
}

/** Same sane-window guard as lib/data/tasks.ts `isValidVenceDate`. */
function isValidVenceDate(vence: string, createdAtMs: number = Date.now()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vence)) return false;
  const day = Date.parse(`${vence}T12:00:00.000Z`);
  if (Number.isNaN(day)) return false;
  return (
    day >= createdAtMs - 365 * DAY_MS && day <= createdAtMs + 30 * 366 * DAY_MS
  );
}

/**
 * Spanish alert copy mirroring lib/data/tasks.ts `taskNotificationCopy`
 * verbatim — one wording, two writers, no drift the tests would miss.
 */
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

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    studyId: row.study_id,
    caseId: row.case_id,
    caseCaratula: row.case?.caratula ?? "",
    statusId: row.status_id,
    estadoKey: row.status?.key ?? "",
    estado: row.status?.name ?? "",
    titulo: row.titulo,
    prioridad: mapPrioridad(row.prioridad),
    responsableId: row.responsable_id,
    responsable: row.responsable?.full_name ?? "",
    venceAt: mapVence(row.vence_at),
    createdBy: row.created_by?.full_name ?? "",
    createdAt: row.created_at,
  };
}

/** `alta` etc.; a value outside the check constraint degrades to the default. */
function mapPrioridad(value: string): TaskPrioridad {
  return TASK_PRIORIDADES.includes(value)
    ? (value as TaskPrioridad)
    : "sin_prioridad";
}

/**
 * `vence_at` → ART calendar day, or null when the DB value cannot be parsed
 * (the BUG-004 lesson): a corrupt/out-of-range timestamp maps to the
 * screens' "—" fallback instead of throwing, so one bad legacy row can never
 * take the whole list down.
 */
function mapVence(value: string | null): string | null {
  if (!value) return null;
  try {
    const instant = new Date(value);
    // Invalid Date (5-digit year, garbage) must never reach toISOString().
    if (Number.isNaN(instant.getTime())) return null;
    return toArtIsoDate(instant);
  } catch {
    // toISOString RangeError at the Date edges — same safe outcome.
    return null;
  }
}
