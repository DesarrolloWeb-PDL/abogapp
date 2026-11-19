"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  addStudioDay,
  DataLayerError,
  errorCopy,
  listStudioDays,
  listSystemDays,
  loadNonWorkingDays,
  removeStudioDay,
  type CalendarDay,
} from "@/lib/data";
import { FECHA_EFECTIVA_MAX, FECHA_EFECTIVA_MIN, isValidFechaEfectiva } from "@/lib/data/errors";
import { formatDate } from "@/lib/format";

/**
 * Días inhábiles settings (S30): two groups over one table — "Del sistema"
 * (the feria/feriado rows the migrations seed: read-only here, RLS denies
 * member writes on `study_id is null`) and "De tu estudio" (the study's own
 * `calendar_days` rows: add + delete). Both feed es_habil() through the
 * S12 loader, so a day added here is non-working for every plazo the
 * engine computes from now on.
 *
 * The add form validates inline in Spanish before the typed backstop in
 * the data layer (same window as fecha_efectiva: 1900-01-01..2100-12-31).
 */

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; system: CalendarDay[]; studio: CalendarDay[] };

interface DayFieldErrors {
  day?: string;
  name?: string;
}

const EMPTY_SYSTEM: CalendarDay[] = [];
const EMPTY_STUDIO: CalendarDay[] = [];

/** Spanish copy for a typed data-layer failure, with a screen fallback. */
function messageFor(error: unknown, fallback: string): string {
  return error instanceof DataLayerError ? errorCopy(error.code) : fallback;
}

export function DiasInhabilesView() {
  const { toast } = useToast();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  // Bumped by "Reintentar" and after every mutation: one read, no cache.
  const [reload, setReload] = useState(0);

  const [formDay, setFormDay] = useState("");
  const [formName, setFormName] = useState("");
  const [fieldErrors, setFieldErrors] = useState<DayFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<CalendarDay | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // The effect only starts the read; state resolves through the promise
  // callbacks (react-hooks/set-state-in-effect forbids sync setState here).
  useEffect(() => {
    let cancelled = false;
    Promise.all([listSystemDays(), listStudioDays()])
      .then(([system, studio]) => {
        if (!cancelled) setState({ status: "ready", system, studio });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  function retry() {
    setState({ status: "loading" });
    setReload((count) => count + 1);
  }

  /** Post-mutation re-read that keeps both groups on screen. */
  function refresh() {
    setReload((count) => count + 1);
  }

  /** Best-effort: refresh the shared S12 set the plazos engine reads. */
  function refreshEngineCalendar(): Promise<void> {
    return loadNonWorkingDays().then(
      () => undefined,
      () => undefined,
    );
  }

  const system = state.status === "ready" ? state.system : EMPTY_SYSTEM;
  const studio = state.status === "ready" ? state.studio : EMPTY_STUDIO;

  async function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const day = formDay.trim();
    const name = formName.trim();
    const errors: DayFieldErrors = {};
    if (!day) {
      errors.day = "Elegí una fecha para el día inhábil.";
    } else if (!isValidFechaEfectiva(day)) {
      errors.day =
        "La fecha tiene que estar entre el 01/01/1900 y el 31/12/2100.";
    } else if (studio.some((row) => row.day === day)) {
      errors.day = "Ya agregaste esa fecha.";
    }
    if (!name) {
      errors.name = "Poné un nombre para identificar el día.";
    }
    if (errors.day || errors.name) {
      setFieldErrors(errors);
      setFormError(null);
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setAdding(true);
    try {
      await addStudioDay({ day, name });
      setFormDay("");
      setFormName("");
      toast("Sumamos el día a los inhábiles del estudio.");
      refresh();
      await refreshEngineCalendar();
    } catch (err) {
      setFormError(
        messageFor(err, "No pudimos agregar el día. Probá otra vez."),
      );
    } finally {
      setAdding(false);
    }
  }

  function requestDelete(row: CalendarDay) {
    setDeleteTarget(row);
    setDeleteError(null);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;

    setDeleting(true);
    setDeleteError(null);
    try {
      await removeStudioDay(deleteTarget.id);
      setDeleteTarget(null);
      toast("Eliminamos el día inhábil del estudio.");
      refresh();
      await refreshEngineCalendar();
    } catch (err) {
      // Stays open so the refusal is readable next to the confirm button.
      setDeleteError(
        messageFor(err, "No pudimos eliminar el día. Probá otra vez."),
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex max-w-2xl flex-col gap-1">
        <h1 className="text-xl font-bold text-text">Días inhábiles</h1>
        <p className="text-base text-text-muted">
          Se suman a los feriados y a la feria para calcular los plazos.
        </p>
      </div>

      <form
        noValidate
        onSubmit={onAdd}
        className="flex max-w-3xl flex-col gap-4 rounded-lg border border-border bg-surface p-6"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-text">
            Agregar un día inhábil
          </h2>
          <p className="text-sm text-text-muted">
            A partir de ese día, los plazos en días hábiles no lo cuentan.
          </p>
        </div>

        <div className="flex flex-wrap items-start gap-4">
          <div className="w-full sm:w-48">
            <FormField
              label="Fecha"
              type="date"
              value={formDay}
              onChange={(event) => setFormDay(event.target.value)}
              min={FECHA_EFECTIVA_MIN}
              max={FECHA_EFECTIVA_MAX}
              required
              error={fieldErrors.day}
            />
          </div>
          <div className="w-full flex-1 sm:min-w-56">
            <FormField
              label="Nombre"
              value={formName}
              onChange={(event) => setFormName(event.target.value)}
              placeholder="Por ejemplo: Asueto del estudio"
              required
              error={fieldErrors.name}
            />
          </div>
        </div>

        {formError && (
          <p role="alert" className="text-sm font-medium text-danger">
            {formError}
          </p>
        )}

        <div>
          <Button type="submit" loading={adding}>
            {adding ? "Agregando…" : "Agregar día"}
          </Button>
        </div>
      </form>

      {state.status === "loading" && (
        <div
          aria-busy="true"
          className="rounded-lg border border-border bg-surface p-4"
        >
          <p role="status" className="sr-only">
            Cargando los días inhábiles
          </p>
          <SkeletonRows rows={5} />
        </div>
      )}

      {state.status === "error" && (
        <div
          role="alert"
          className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface px-6 py-12 text-center"
        >
          <p className="text-base text-text-muted">
            No pudimos cargar los días inhábiles.
          </p>
          <Button variant="secondary" onClick={retry}>
            Reintentar
          </Button>
        </div>
      )}

      {state.status === "ready" && (
        <>
          <section
            aria-labelledby="dias-estudio"
            className="flex flex-col gap-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="dias-estudio" className="text-lg font-semibold text-text">
                De tu estudio
              </h2>
              <p className="text-sm text-text-muted" aria-live="polite">
                {studio.length === 0
                  ? "Sin días cargados"
                  : `${studio.length} ${studio.length === 1 ? "día" : "días"}`}
              </p>
            </div>

            {studio.length === 0 ? (
              <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-base text-text-muted">
                Todavía no agregaste días inhábiles.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
                {studio.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center gap-3 px-4 py-3"
                  >
                    <span className="w-28 shrink-0 font-medium text-text">
                      {formatDate(row.day)}
                    </span>
                    <span className="min-w-40 flex-1 text-text">{row.name}</span>
                    <Badge tone="accent">De tu estudio</Badge>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => requestDelete(row)}
                    >
                      Eliminar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            aria-labelledby="dias-sistema"
            className="flex flex-col gap-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="dias-sistema" className="text-lg font-semibold text-text">
                Del sistema
              </h2>
              <p className="text-sm text-text-muted">
                {`${system.length} ${system.length === 1 ? "día" : "días"} · no se pueden editar`}
              </p>
            </div>

            {system.length === 0 ? (
              <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-base text-text-muted">
                Todavía no hay días cargados por el sistema.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
                {system.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center gap-3 px-4 py-3"
                  >
                    <span className="w-28 shrink-0 font-medium text-text">
                      {formatDate(row.day)}
                    </span>
                    <span className="min-w-40 flex-1 text-text">
                      {row.name || "Día del sistema"}
                    </span>
                    <Badge tone="neutral">Del sistema</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <Modal
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        title={
          deleteTarget
            ? `Eliminar el día ${formatDate(deleteTarget.day)}`
            : "Eliminar día inhábil"
        }
        description={
          deleteTarget
            ? `«${deleteTarget.name}» deja de contar para los plazos del estudio.`
            : undefined
        }
        busy={deleting}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirmDelete} loading={deleting}>
              {deleting ? "Eliminando…" : "Eliminar"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-base text-text-muted">
            Esta acción no se puede deshacer.
          </p>
          {deleteError && (
            <p role="alert" className="text-sm font-medium text-danger">
              {deleteError}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
