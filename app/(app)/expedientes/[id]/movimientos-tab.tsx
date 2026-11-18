"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { Star } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  DataLayerError,
  MOVEMENT_DETALLE_MAX,
  MOVEMENT_TIPOS,
  applyMovementFilter,
  compareMovementsByFecha,
  createMovement,
  errorCopy,
  listMovements,
  movementPinBadge,
  updateMovement,
  type Movement,
} from "@/lib/data";
import { FECHA_EFECTIVA_MAX, FECHA_EFECTIVA_MIN } from "@/lib/data/errors";
import { formatDate } from "@/lib/format";

/**
 * Movimientos tab (S09): the case's MANUAL movement history — rows the
 * study types in by hand, a pin for the most important one, filters by
 * tipo / date range / search. This is NOT the portal-synced Actuaciones
 * tab: nothing here is imported from a court portal, the empty state says
 * so in its own words, and rows are created from this screen.
 *
 * Data shape: fetch once on mount (the fake store lives client-side) and
 * filter client-side through `applyMovementFilter` — the same fetch-once +
 * client filter pattern expedientes/tareas use. Sorting stays fecha DESC
 * with pinned rows badged in place, never re-sorted (lib/data/movements.ts).
 */

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      /** Which case this payload belongs to (guards stale renders on id change). */
      loadedId: string;
      movements: Movement[];
    };

/** Stable empty list so hook dependencies never churn between renders. */
const EMPTY_MOVEMENTS: Movement[] = [];

const TIPO_TONE: Record<string, BadgeTone> = {
  Audiencia: "info",
  "Trámite": "neutral",
  Presentación: "accent",
  Resolución: "success",
  Otro: "neutral",
};

const CLEAR_BUTTON_CLASSES =
  "min-h-11 rounded-md px-4 text-base font-semibold text-accent underline underline-offset-4 hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

interface FieldErrors {
  fecha?: string;
  tipo?: string;
  detalle?: string;
}

export function MovimientosTab({ caseId }: { caseId: string }) {
  const { toast } = useToast();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [tipoFilter, setTipoFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // The effect only starts the read; state resolves through the promise
  // callbacks (react-hooks/set-state-in-effect forbids sync setState here).
  const fetchMovements = useCallback(() => {
    listMovements(caseId)
      .then((movements) =>
        setState({ status: "ready", loadedId: caseId, movements }),
      )
      .catch(() => setState({ status: "error" }));
  }, [caseId]);

  useEffect(() => {
    fetchMovements();
  }, [fetchMovements]);

  function retry() {
    setState({ status: "loading" });
    fetchMovements();
  }

  // A navigation to another expediente keeps the previous payload for a
  // tick; show the skeleton instead of another case's rows.
  const ready =
    state.status === "ready" && state.loadedId === caseId ? state : null;
  const stale = state.status === "ready" && state.loadedId !== caseId;

  const movements = ready?.movements ?? EMPTY_MOVEMENTS;
  const visible = useMemo(
    () => applyMovementFilter(movements, { tipo: tipoFilter, from, to, query }),
    [movements, tipoFilter, from, to, query],
  );
  const filtersActive = Boolean(query.trim() || tipoFilter || from || to);

  function clearFilters() {
    setQuery("");
    setTipoFilter("");
    setFrom("");
    setTo("");
  }

  function openModal() {
    setFieldErrors({});
    setModalOpen(true);
  }

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fecha = String(form.get("fecha") ?? "").trim();
    const tipo = String(form.get("tipo") ?? "").trim();
    const detalle = String(form.get("detalle") ?? "").trim();

    // Field-level first: an empty fecha (the S09 negative path) never
    // reaches the data layer — the typed codes stay the backstop below.
    const errors: FieldErrors = {};
    if (!fecha) errors.fecha = "Elegí la fecha del movimiento.";
    if (!tipo) errors.tipo = "Elegí el tipo de movimiento.";
    if (!detalle) errors.detalle = "Escribí qué pasó en el expediente.";
    if (errors.fecha || errors.tipo || errors.detalle) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    setCreating(true);
    try {
      const movement = await createMovement({ caseId, fecha, tipo, detalle });
      setState((prev) =>
        prev.status === "ready" && prev.loadedId === caseId
          ? {
              ...prev,
              // Prepend + stable sort: a movement with an older fecha lands
              // in its chronological slot, same-fecha ties keep newest first.
              movements: [movement, ...prev.movements].sort(
                compareMovementsByFecha,
              ),
            }
          : prev,
      );
      setModalOpen(false);
      toast("Movimiento agregado.", { variant: "success" });
    } catch (error) {
      toast(
        error instanceof DataLayerError
          ? errorCopy(error.code)
          : "No pudimos agregar el movimiento. Probá otra vez.",
        { variant: "error" },
      );
    } finally {
      setCreating(false);
    }
  }

  function togglePin(movement: Movement) {
    setUpdatingId(movement.id);
    updateMovement(movement.id, { pinned: !movement.pinned })
      .then((updated) => {
        setState((prev) =>
          prev.status === "ready"
            ? {
                ...prev,
                movements: prev.movements.map((row) =>
                  row.id === updated.id ? updated : row,
                ),
              }
            : prev,
        );
        toast(updated.pinned ? "Movimiento fijado." : "Movimiento desfijado.", {
          variant: "success",
        });
      })
      .catch((error: unknown) => {
        toast(
          error instanceof DataLayerError
            ? errorCopy(error.code)
            : "No pudimos actualizar el movimiento. Probá otra vez.",
          { variant: "error" },
        );
      })
      .finally(() => setUpdatingId(null));
  }

  const loading = state.status === "loading" || stale;
  const failed = state.status === "error";

  const emptyBlock =
    movements.length === 0 ? (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-12 text-center">
        <p className="text-base text-text-muted">
          Todavía no hay movimientos en este expediente.
        </p>
        <p className="text-sm text-text-muted">
          Este historial lo carga el estudio a mano, no lo sincroniza el
          portal judicial.
        </p>
        <Button onClick={openModal}>Agregar el primer movimiento</Button>
      </div>
    ) : visible.length === 0 ? (
      // The filter bar always renders its own "Limpiar filtros" while a
      // filter is active (that is the only way this branch can show), so
      // the message here must not duplicate the button.
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-12 text-center">
        <p className="text-base text-text-muted">
          No encontramos movimientos con esos filtros.
        </p>
      </div>
    ) : (
      <ul className="flex flex-col gap-3">
        {visible.map((movement) => {
          const pinLabel = movementPinBadge(movement.pinned);
          return (
            <li
              key={movement.id}
              className={[
                "flex flex-col gap-3 rounded-lg border px-4 py-4 shadow-card sm:flex-row sm:items-start sm:justify-between",
                movement.pinned
                  ? "border-accent bg-accent-tint"
                  : "border-border bg-surface",
              ].join(" ")}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <time
                    dateTime={movement.fecha}
                    className="text-sm font-semibold text-text"
                  >
                    {formatDate(movement.fecha)}
                  </time>
                  <Badge tone={TIPO_TONE[movement.tipo] ?? "neutral"}>
                    {movement.tipo || "Sin tipo"}
                  </Badge>
                  {pinLabel && (
                    <Badge tone="accent">
                      <Star aria-hidden="true" className="size-3" />
                      {pinLabel}
                    </Badge>
                  )}
                </div>
                <p className="whitespace-pre-wrap break-words text-base text-text">
                  {movement.detalle}
                </p>
                {movement.createdBy && (
                  <span className="text-sm text-text-muted">
                    Cargado por {movement.createdBy}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => togglePin(movement)}
                disabled={updatingId === movement.id}
                aria-pressed={movement.pinned}
                aria-label={
                  movement.pinned ? "Desfijar movimiento" : "Fijar movimiento"
                }
                className={[
                  "inline-flex min-h-11 shrink-0 items-center gap-2 self-start rounded-md px-3 text-sm font-semibold",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                  movement.pinned
                    ? "bg-surface text-accent hover:opacity-90"
                    : "text-text-muted hover:bg-accent-tint hover:text-text",
                ].join(" ")}
              >
                <Star
                  aria-hidden="true"
                  className={movement.pinned ? "size-4 fill-current" : "size-4"}
                />
                {movement.pinned ? "Desfijar" : "Fijar"}
              </button>
            </li>
          );
        })}
      </ul>
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text">
          Movimientos{ready ? ` (${movements.length})` : ""}
        </h2>
        <Button onClick={openModal} disabled={!ready}>
          Agregar movimiento
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-2 sm:max-w-lg">
          <span className="text-sm font-semibold text-text">
            Buscar movimientos
          </span>
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Escribí el detalle del movimiento"
          />
        </label>
        <FormField
          as="select"
          label="Tipo"
          value={tipoFilter}
          onChange={(event) => setTipoFilter(event.target.value)}
          className="sm:w-48"
        >
          <option value="">Todos los tipos</option>
          {MOVEMENT_TIPOS.map((tipo) => (
            <option key={tipo} value={tipo}>
              {tipo}
            </option>
          ))}
        </FormField>
        <FormField
          label="Desde"
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          className="sm:w-44"
        />
        <FormField
          label="Hasta"
          type="date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          className="sm:w-44"
        />
        {filtersActive && (
          <button
            type="button"
            onClick={clearFilters}
            className={CLEAR_BUTTON_CLASSES}
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
            Cargando movimientos
          </p>
          <SkeletonRows rows={4} />
        </div>
      )}

      {failed && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-border bg-surface px-6 py-12 text-center">
          <p className="text-base text-text-muted">
            No pudimos cargar los movimientos.
          </p>
          <Button variant="secondary" onClick={retry}>
            Reintentar
          </Button>
        </div>
      )}

      {ready && (
        <>
          {emptyBlock}
          <p className="text-sm text-text-muted" aria-live="polite">
            Mostrando {visible.length} de {movements.length} movimientos
          </p>
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Agregar movimiento"
        description="Cargá a mano un paso del expediente: una audiencia, una presentación, una resolución."
        busy={creating}
      >
        <form onSubmit={onCreate} noValidate className="flex flex-col gap-5">
          <FormField
            label="Fecha"
            name="fecha"
            type="date"
            // Same sane window as the data layer's isValidFechaEfectiva.
            min={FECHA_EFECTIVA_MIN}
            max={FECHA_EFECTIVA_MAX}
            required
            error={fieldErrors.fecha}
            hint="Entre 01/01/1900 y 31/12/2100."
          />

          <FormField
            as="select"
            label="Tipo"
            name="tipo"
            defaultValue=""
            required
            error={fieldErrors.tipo}
          >
            <option value="">Elegí un tipo</option>
            {MOVEMENT_TIPOS.map((tipo) => (
              <option key={tipo} value={tipo}>
                {tipo}
              </option>
            ))}
          </FormField>

          <DetalleField error={fieldErrors.detalle} />

          <div className="flex flex-wrap gap-3">
            <Button type="submit" size="lg" disabled={creating}>
              {creating ? "Agregando…" : "Agregar movimiento"}
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

/** Label + textarea + hint + inline error — FormField only renders input/select. */
function DetalleField({ error }: { error?: string }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hintId, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-text">
        Detalle
      </label>
      <textarea
        id={id}
        name="detalle"
        rows={4}
        required
        maxLength={MOVEMENT_DETALLE_MAX}
        placeholder="Qué pasó en el expediente"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={[
          "min-h-28 w-full resize-y rounded-md border bg-surface px-3 py-2 text-base text-text",
          "placeholder:text-text-muted",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          "disabled:cursor-not-allowed disabled:bg-bg disabled:text-text-muted",
          error ? "border-danger" : "border-border-input",
        ].join(" ")}
      />
      <p id={hintId} className="text-sm text-text-muted">
        Hasta {MOVEMENT_DETALLE_MAX} caracteres.
      </p>
      {error && (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
