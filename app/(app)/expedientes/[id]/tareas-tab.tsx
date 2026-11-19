"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  DataLayerError,
  TASK_TITULO_MAX,
  TERMINAL_STATUS_KEYS,
  compareTasksByDue,
  createTask,
  errorCopy,
  getSession,
  isTaskOverdue,
  listTaskStatuses,
  listTasks,
  updateTask,
  type Session,
  type Task,
  type TaskPrioridad,
  type TaskStatus,
} from "@/lib/data";
import { FECHA_EFECTIVA_MAX, FECHA_EFECTIVA_MIN } from "@/lib/data/errors";
import { formatDate } from "@/lib/format";

/**
 * Tareas tab (S16 scoped): the studio's task list narrowed to THIS
 * expediente — the recon rule for this tab is "same screen scoped".
 *
 * Data shape: the driver signature is study-wide (`listTasks` reads the
 * whole study, as /tareas does), so the tab fetches once and narrows to
 * `caseId` client-side — the same fetch-once + client filter pattern the
 * Resumen/Movimientos/Pruebas tabs use, never a second query path. The
 * create form is the F04 flow minus the case picker: `caseId` is fixed by
 * the route.
 */

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      /** Which case this payload belongs to (guards stale renders on id change). */
      loadedId: string;
      tasks: Task[];
      statuses: TaskStatus[];
      me: Session["user"] | null;
    };

/** Stable empty lists so hook dependencies never churn between renders. */
const EMPTY_TASKS: Task[] = [];
const EMPTY_STATUSES: TaskStatus[] = [];

/** Sentinel filter value for "every state, terminal ones included". */
const ALL_STATES = "__todas__";

const ESTADO_TONE: Record<string, BadgeTone> = {
  pendiente: "neutral",
  en_curso: "info",
  para_revisar: "warning",
  completada: "success",
  cancelada: "neutral",
};

const PRIORIDAD_LABEL: Record<TaskPrioridad, string> = {
  alta: "Alta",
  normal: "Normal",
  baja: "Baja",
  sin_prioridad: "Sin prioridad",
};

const PRIORIDAD_TONE: Record<TaskPrioridad, BadgeTone> = {
  alta: "danger",
  normal: "info",
  baja: "neutral",
  sin_prioridad: "neutral",
};

export function TareasTab({ caseId }: { caseId: string }) {
  const { toast } = useToast();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [estadoFilter, setEstadoFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // The effect only starts the read; state resolves through the promise
  // callbacks (react-hooks/set-state-in-effect forbids sync setState here).
  const fetchTasks = useCallback(() => {
    Promise.all([
      listTasks({ incluirTerminadas: true }),
      listTaskStatuses(),
      getSession(),
    ])
      .then(([tasks, statuses, session]) =>
        setState({
          status: "ready",
          loadedId: caseId,
          tasks: tasks.filter((task) => task.caseId === caseId),
          statuses,
          me: session?.user ?? null,
        }),
      )
      .catch(() => setState({ status: "error" }));
  }, [caseId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  function retry() {
    setState({ status: "loading" });
    fetchTasks();
  }

  // A navigation to another expediente keeps the previous payload for a
  // tick; show the skeleton instead of another case's tasks.
  const ready =
    state.status === "ready" && state.loadedId === caseId ? state : null;
  const stale = state.status === "ready" && state.loadedId !== caseId;

  const tasks = ready?.tasks ?? EMPTY_TASKS;
  const statuses = ready?.statuses ?? EMPTY_STATUSES;
  const me = ready?.me ?? null;

  const visible = useMemo(() => {
    if (!ready) return EMPTY_TASKS;
    const scoped =
      estadoFilter === ALL_STATES
        ? ready.tasks
        : estadoFilter
          ? ready.tasks.filter((task) => task.estadoKey === estadoFilter)
          : // Default view: active work only (terminal states need a filter).
            ready.tasks.filter(
              (task) => !TERMINAL_STATUS_KEYS.has(task.estadoKey),
            );
    // S16 default order: due date ascending, no due date last.
    return [...scoped].sort(compareTasksByDue);
  }, [ready, estadoFilter]);

  const filtersActive = Boolean(estadoFilter);

  function clearFilters() {
    setEstadoFilter("");
  }

  function openModal() {
    setModalOpen(true);
  }

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const responsableId = String(form.get("responsable") ?? "");

    setCreating(true);
    try {
      const task = await createTask({
        titulo: String(form.get("titulo") ?? ""),
        caseId,
        // "" = the explicit "Sin responsable" option (no alerts, F04 edge);
        // an absent field would default to me inside the data layer.
        responsableId: responsableId || null,
        prioridad: String(form.get("prioridad") ?? "sin_prioridad") as
          TaskPrioridad,
        vence: String(form.get("vence") ?? "") || null,
        estadoKey: String(form.get("estado") ?? "") || undefined,
      });
      setState((prev) =>
        prev.status === "ready" && prev.loadedId === caseId
          ? { ...prev, tasks: [task, ...prev.tasks] }
          : prev,
      );
      setModalOpen(false);
      toast("Tarea creada.", { variant: "success" });
    } catch (error) {
      toast(
        error instanceof DataLayerError
          ? errorCopy(error.code)
          : "No pudimos crear la tarea. Probá otra vez.",
        { variant: "error" },
      );
    } finally {
      setCreating(false);
    }
  }

  function changeEstado(task: Task, estadoKey: string) {
    if (!estadoKey || estadoKey === task.estadoKey) return;
    setUpdatingId(task.id);
    updateTask(task.id, { estadoKey })
      .then((updated) => {
        setState((prev) =>
          prev.status === "ready" && prev.loadedId === caseId
            ? {
                ...prev,
                tasks: prev.tasks.map((row) =>
                  row.id === updated.id ? updated : row,
                ),
              }
            : prev,
        );
        toast("Estado actualizado.", { variant: "success" });
      })
      .catch((error: unknown) => {
        toast(
          error instanceof DataLayerError
            ? errorCopy(error.code)
            : "No pudimos actualizar la tarea. Probá otra vez.",
          { variant: "error" },
        );
      })
      .finally(() => setUpdatingId(null));
  }

  /** Honest responsable text: profiles RLS hides other members' names. */
  function responsableLabel(task: Task): string {
    if (!task.responsableId) return "Sin responsable";
    if (task.responsable) return task.responsable;
    if (task.responsableId === me?.id) return me.fullName;
    return "Otro miembro del estudio";
  }

  function estadoCell(task: Task) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={ESTADO_TONE[task.estadoKey] ?? "neutral"}>
          {task.estado}
        </Badge>
        <div className="w-44">
          <Select
            value={task.estadoKey}
            onChange={(event) => changeEstado(task, event.target.value)}
            aria-label={`Cambiar estado de «${task.titulo}»`}
            disabled={updatingId === task.id}
          >
            {statuses.map((status) => (
              <option key={status.key} value={status.key}>
                {status.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
    );
  }

  function venceCell(task: Task) {
    if (!task.venceAt) {
      return (
        <span className="text-text-muted" aria-label="Sin fecha de vencimiento">
          —
        </span>
      );
    }
    const overdue = isTaskOverdue(task);
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span className={overdue ? "font-semibold text-danger" : "text-text"}>
          {formatDate(task.venceAt)}
        </span>
        {overdue && <Badge tone="danger">Vencida</Badge>}
      </span>
    );
  }

  const columns: DataTableColumn<Task>[] = [
    {
      key: "titulo",
      header: "Título",
      cell: (row) => <span className="font-semibold">{row.titulo}</span>,
    },
    { key: "estado", header: "Estado", cell: (row) => estadoCell(row) },
    {
      key: "prioridad",
      header: "Prioridad",
      cell: (row) => (
        <Badge tone={PRIORIDAD_TONE[row.prioridad] ?? "neutral"}>
          {PRIORIDAD_LABEL[row.prioridad] ?? row.prioridad}
        </Badge>
      ),
    },
    {
      key: "responsable",
      header: "Responsable",
      cell: (row) => {
        const label = responsableLabel(row);
        return (
          <span className={label === "Sin responsable" ? "text-text-muted" : ""}>
            {label}
          </span>
        );
      },
    },
    { key: "vence", header: "Vence", cell: (row) => venceCell(row) },
    {
      key: "creada-por",
      header: "Creada por",
      cell: (row) => (
        <span className="text-text-muted">{row.createdBy || "—"}</span>
      ),
    },
  ];

  const emptyMessage = ready
    ? tasks.length === 0
      ? "Todavía no hay tareas en este expediente."
      : filtersActive
        ? "No encontramos tareas con ese estado"
        : "Todavía no hay tareas activas"
    : "";

  const emptyAction = ready ? (
    tasks.length === 0 ? (
      <Button onClick={openModal}>Crear la primera tarea</Button>
    ) : filtersActive ? (
      <button
        type="button"
        onClick={clearFilters}
        className="min-h-11 rounded-md px-4 text-base font-semibold text-accent underline underline-offset-4 hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Limpiar filtros
      </button>
    ) : (
      <Button variant="secondary" onClick={() => setEstadoFilter(ALL_STATES)}>
        Ver todas las tareas
      </Button>
    )
  ) : null;

  // The estado picker defaults to `pendiente` — a study may rename the
  // state, but the key is stable (task_statuses unique on study + key).
  const defaultEstadoKey = statuses.some((status) => status.key === "pendiente")
    ? "pendiente"
    : (statuses[0]?.key ?? "");

  const loading = state.status === "loading" || stale;
  const failed = state.status === "error";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text">
          Tareas{ready ? ` (${tasks.length})` : ""}
        </h2>
        <Button onClick={openModal} disabled={!ready}>
          Nueva tarea
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <FormField
          as="select"
          label="Estado"
          value={estadoFilter}
          onChange={(event) => setEstadoFilter(event.target.value)}
          className="sm:w-56"
        >
          <option value="">Solo activas</option>
          <option value={ALL_STATES}>Todas</option>
          {statuses.map((status) => (
            <option key={status.key} value={status.key}>
              {status.name}
            </option>
          ))}
        </FormField>
        {filtersActive && (
          <button
            type="button"
            onClick={clearFilters}
            className="min-h-11 rounded-md px-4 text-base font-semibold text-accent underline underline-offset-4 hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {loading && (
        <div
          className="rounded-lg border border-border bg-surface p-4"
          aria-busy="true"
        >
          <p role="status" className="sr-only">
            Cargando tareas
          </p>
          <SkeletonRows rows={4} />
        </div>
      )}

      {failed && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-border bg-surface px-6 py-12 text-center">
          <p className="text-base text-text-muted">
            No pudimos cargar las tareas.
          </p>
          <Button variant="secondary" onClick={retry}>
            Reintentar
          </Button>
        </div>
      )}

      {ready && (
        <>
          <DataTable
            caption="Tareas de este expediente"
            columns={columns}
            rows={visible}
            rowKey={(row) => row.id}
            emptyMessage={emptyMessage}
            emptyAction={emptyAction}
          />
          <p className="text-sm text-text-muted" aria-live="polite">
            Mostrando {visible.length} de {tasks.length} tareas
          </p>
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Nueva tarea"
        description="Cargá qué hay que hacer, cuándo vence y quién lo toma."
        busy={creating}
      >
        <form onSubmit={onCreate} noValidate className="flex flex-col gap-5">
          <FormField
            label="Título"
            name="titulo"
            placeholder="Qué hay que hacer"
            maxLength={TASK_TITULO_MAX}
            required
          />

          <FormField
            as="select"
            label="Estado"
            name="estado"
            defaultValue={defaultEstadoKey}
          >
            {statuses.map((status) => (
              <option key={status.key} value={status.key}>
                {status.name}
              </option>
            ))}
          </FormField>

          <FormField
            as="select"
            label="Prioridad"
            name="prioridad"
            defaultValue="sin_prioridad"
          >
            {(Object.keys(PRIORIDAD_LABEL) as TaskPrioridad[]).map(
              (prioridad) => (
                <option key={prioridad} value={prioridad}>
                  {PRIORIDAD_LABEL[prioridad]}
                </option>
              ),
            )}
          </FormField>

          <FormField
            as="select"
            label="Responsable"
            name="responsable"
            defaultValue={me?.id ?? ""}
            hint="Sin responsable no recibe ninguna alerta. La lista de miembros del estudio llega con una próxima actualización."
          >
            {me && <option value={me.id}>{me.fullName} (vos)</option>}
            <option value="">Sin responsable</option>
          </FormField>

          <FormField
            label="Vence"
            name="vence"
            type="date"
            min={FECHA_EFECTIVA_MIN}
            max={FECHA_EFECTIVA_MAX}
            hint="Opcional. Cargá una fecha entre 01/01/1900 y 31/12/2100."
          />

          <div className="flex flex-wrap gap-3">
            <Button type="submit" size="lg" disabled={creating}>
              {creating ? "Creando…" : "Crear tarea"}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              onClick={() => setModalOpen(false)}
              disabled={creating}
            >
              Cancelar
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
