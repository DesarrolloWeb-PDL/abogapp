"use client";

import Link from "next/link";
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
import { Input, Select } from "@/components/ui/input";
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
  listCases,
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
import { searchMatches } from "@/lib/search";
import type { StudyCase } from "@/lib/types";

/**
 * Tareas list (S16, M2 slice): reads the data layer, never the seed. The
 * board/kanban view (drag-drop, grouping, bulk bar) is deferred — this is
 * the list half of the screen plus F04's ~3-click create flow.
 *
 * Filter split: `listTasks` owns persistence (active-by-default + estado at
 * the API), the screen fetches once with `incluirTerminadas` and drives its
 * own display rules client-side — the same fetch-once + client filter shape
 * expedientes-view uses (search through lib/search.ts, BUG-003 fix).
 */

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      tasks: Task[];
      statuses: TaskStatus[];
      cases: StudyCase[];
      me: Session["user"] | null;
    };

/** Stable empty lists so hook dependencies never churn between renders. */
const EMPTY_TASKS: Task[] = [];
const EMPTY_STATUSES: TaskStatus[] = [];
const EMPTY_CASES: StudyCase[] = [];

/** Sentinel filter value for "every state, terminal ones included". */
const ALL_STATES = "__todas__";

const ESTADO_TONE: Record<string, BadgeTone> = {
  pendiente: "neutral",
  en_curso: "info",
  para_revisar: "warning",
  completada: "success",
  cancelada: "neutral",
};

const PRIORIDAD_OPTIONS: ReadonlyArray<{ value: TaskPrioridad; label: string }> =
  [
    { value: "alta", label: "Alta" },
    { value: "normal", label: "Normal" },
    { value: "baja", label: "Baja" },
    { value: "sin_prioridad", label: "Sin prioridad" },
  ];

const PRIORIDAD_LABEL = new Map(
  PRIORIDAD_OPTIONS.map((option) => [option.value, option.label]),
);

const PRIORIDAD_TONE: Record<TaskPrioridad, BadgeTone> = {
  alta: "danger",
  normal: "info",
  baja: "neutral",
  sin_prioridad: "neutral",
};

const LINK_CLASSES =
  "font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const CLEAR_BUTTON_CLASSES =
  "min-h-11 rounded-md px-4 text-base font-semibold text-accent underline underline-offset-4 hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function TareasView() {
  const { toast } = useToast();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [estadoFilter, setEstadoFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // No sync setState here: the effect only kicks off the reads and resolves
  // into state through the promise callbacks (react-hooks/set-state-in-effect).
  const fetchAll = useCallback(() => {
    Promise.all([
      listTasks({ incluirTerminadas: true }),
      listTaskStatuses(),
      listCases(),
      getSession(),
    ])
      .then(([tasks, statuses, cases, session]) =>
        setState({
          status: "ready",
          tasks,
          statuses,
          cases,
          me: session?.user ?? null,
        }),
      )
      .catch(() => setState({ status: "error" }));
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  function retry() {
    setState({ status: "loading" });
    fetchAll();
  }

  const ready = state.status === "ready" ? state : null;
  const statuses = ready?.statuses ?? EMPTY_STATUSES;
  const cases = ready?.cases ?? EMPTY_CASES;
  const me = ready?.me ?? null;

  const visible = useMemo(() => {
    if (!ready) return EMPTY_TASKS;
    const byEstado =
      estadoFilter === ALL_STATES
        ? ready.tasks
        : estadoFilter
          ? ready.tasks.filter((task) => task.estadoKey === estadoFilter)
          : // Default view: active work only (terminal states need a filter).
            ready.tasks.filter(
              (task) => !TERMINAL_STATUS_KEYS.has(task.estadoKey),
            );
    // BUG-003: accent-stripping + bounded typo tolerance (lib/search.ts).
    const searched = query.trim()
      ? byEstado.filter((task) => searchMatches(query, task.titulo))
      : byEstado;
    // S16 default order: due date ascending, no due date last.
    return [...searched].sort(compareTasksByDue);
  }, [ready, estadoFilter, query]);

  const filtersActive = Boolean(query.trim() || estadoFilter);

  function clearFilters() {
    setQuery("");
    setEstadoFilter("");
  }

  function openModal() {
    setModalOpen(true);
  }

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const caseId = String(form.get("case_id") ?? "");
    const responsableId = String(form.get("responsable") ?? "");

    setCreating(true);
    try {
      const task = await createTask({
        titulo: String(form.get("titulo") ?? ""),
        caseId: caseId || null,
        // "" = the explicit "Sin responsable" option (no alerts, F04 edge);
        // an absent field would default to me inside the data layer.
        responsableId: responsableId || null,
        prioridad: String(form.get("prioridad") ?? "sin_prioridad") as
          TaskPrioridad,
        vence: String(form.get("vence") ?? "") || null,
        estadoKey: String(form.get("estado") ?? "") || undefined,
      });
      setState((prev) =>
        prev.status === "ready"
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
          prev.status === "ready"
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
          {PRIORIDAD_LABEL.get(row.prioridad) ?? row.prioridad}
        </Badge>
      ),
    },
    {
      key: "expediente",
      header: "Expediente",
      cell: (row) =>
        row.caseId && row.caseCaratula ? (
          <Link href={`/expedientes/${row.caseId}`} className={LINK_CLASSES}>
            {row.caseCaratula}
          </Link>
        ) : (
          <span className="text-text-muted" aria-label="Sin expediente">
            —
          </span>
        ),
    },
    {
      key: "responsable",
      header: "Responsable",
      cell: (row) => {
        const label = responsableLabel(row);
        return (
          <span
            className={label === "Sin responsable" ? "text-text-muted" : ""}
          >
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
    ? ready.tasks.length === 0
      ? "Todavía no hay tareas"
      : filtersActive
        ? "No encontramos tareas con esos filtros"
        : "Todavía no hay tareas activas"
    : "";

  const emptyAction = ready ? (
    ready.tasks.length === 0 ? (
      <Button onClick={openModal}>Crear la primera tarea</Button>
    ) : filtersActive ? (
      <button
        type="button"
        onClick={clearFilters}
        className={CLEAR_BUTTON_CLASSES}
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

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold text-text">Tareas</h1>
          <p className="text-base text-text-muted">
            Todo lo que el estudio tiene que hacer, en una sola lista.
          </p>
        </div>
        <Button size="lg" onClick={openModal} disabled={!ready}>
          Nueva tarea
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-56 flex-1 flex-col gap-2 sm:max-w-lg">
            <span className="text-sm font-semibold text-text">
              Buscar tareas
            </span>
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Escribí el título de la tarea"
            />
          </label>
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
        </div>

        {state.status === "loading" && (
          <div
            className="rounded-lg border border-border bg-surface p-4"
            aria-busy="true"
          >
            <p role="status" className="sr-only">
              Cargando tareas
            </p>
            <SkeletonRows rows={5} />
          </div>
        )}

        {state.status === "error" && (
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
              caption="Tareas del estudio"
              columns={columns}
              rows={visible}
              rowKey={(row) => row.id}
              emptyMessage={emptyMessage}
              emptyAction={emptyAction}
            />
            <p className="text-sm text-text-muted" aria-live="polite">
              Mostrando {visible.length} de {ready.tasks.length} tareas
            </p>
          </>
        )}
      </div>

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

          <FormField as="select" label="Expediente" name="case_id" defaultValue="">
            <option value="">Sin expediente</option>
            {cases.map((kase) => (
              <option key={kase.id} value={kase.id}>
                {kase.caratula}
              </option>
            ))}
          </FormField>

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
            {PRIORIDAD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
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
    </>
  );
}
