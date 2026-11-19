"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  DataLayerError,
  createStage,
  deleteStage,
  errorCopy,
  listStages,
  moveStage,
  renameStage,
  setStageCountsAsActive,
  STAGE_NAME_MAX,
  type CaseStage,
  type StageMoveDirection,
} from "@/lib/data";

/**
 * Etapas settings (S30): the study's `case_stages` in position order with
 * the actions the recon evidences — move up/down (buttons, no drag),
 * rename, the counts_as_active toggle Inicio reads, and delete behind a
 * confirm modal. Every mutation re-reads through the data layer, so the
 * S07 surfaces (the Etapa filter of the list and the Etapa select of the
 * new-expediente form) pick the change up on their next navigation — no
 * caching lives on either side.
 *
 * States: loading skeleton, error + Reintentar, ready (list or the honest
 * "no stages yet" fallback — init_study_defaults seeds five, so this is a
 * guard rail, not the normal path), plus inline Spanish validation in the
 * editor modal and the typed-error copy in the delete modal.
 */

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; stages: CaseStage[] };

type EditorState =
  | { kind: "create" }
  | { kind: "rename"; stage: CaseStage };

const EMPTY_STAGES: CaseStage[] = [];

/** Spanish copy for a typed data-layer failure, with a screen fallback. */
function messageFor(error: unknown, fallback: string): string {
  return error instanceof DataLayerError ? errorCopy(error.code) : fallback;
}

export function EtapasView() {
  const { toast } = useToast();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  // Bumped by "Reintentar" and after every mutation: one read, no cache.
  const [reload, setReload] = useState(0);

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorName, setEditorName] = useState("");
  const [editorCountsAsActive, setEditorCountsAsActive] = useState(true);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<CaseStage | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // The effect only starts the read; state resolves through the promise
  // callbacks (react-hooks/set-state-in-effect forbids sync setState here).
  useEffect(() => {
    let cancelled = false;
    listStages()
      .then((stages) => {
        if (!cancelled) setState({ status: "ready", stages });
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

  /** Post-mutation re-read that keeps the list on screen (no skeleton flash). */
  function refresh() {
    setReload((count) => count + 1);
  }

  const stages = state.status === "ready" ? state.stages : EMPTY_STAGES;

  function openCreate() {
    setEditor({ kind: "create" });
    setEditorName("");
    setEditorCountsAsActive(true);
    setEditorError(null);
  }

  function openRename(stage: CaseStage) {
    setEditor({ kind: "rename", stage });
    setEditorName(stage.name);
    setEditorCountsAsActive(stage.countsAsActive);
    setEditorError(null);
  }

  function closeEditor() {
    if (saving) return;
    setEditor(null);
    setEditorError(null);
  }

  async function onEditorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;

    const name = editorName.trim();
    const excludeId = editor.kind === "rename" ? editor.stage.id : undefined;
    let error: string | null = null;
    if (!name) {
      error = "Poné un nombre para la etapa.";
    } else if (name.length > STAGE_NAME_MAX) {
      error = `El nombre puede tener hasta ${STAGE_NAME_MAX} caracteres.`;
    } else if (
      stages.some(
        (stage) =>
          stage.id !== excludeId &&
          stage.name.trim().toLowerCase() === name.toLowerCase(),
      )
    ) {
      error = "Ya existe una etapa con ese nombre.";
    }
    if (error) {
      setEditorError(error);
      return;
    }

    setEditorError(null);
    setSaving(true);
    try {
      if (editor.kind === "create") {
        await createStage({ name, countsAsActive: editorCountsAsActive });
        toast("Etapa creada.");
      } else {
        await renameStage(editor.stage.id, name);
        toast("Guardamos el nombre de la etapa.");
      }
      setEditor(null);
      refresh();
    } catch (err) {
      setEditorError(
        messageFor(err, "No pudimos guardar la etapa. Probá otra vez."),
      );
    } finally {
      setSaving(false);
    }
  }

  function toggleCountsAsActive(stage: CaseStage, next: boolean) {
    setActionError(null);
    setPendingId(stage.id);
    setStageCountsAsActive(stage.id, next)
      .then(() => refresh())
      .catch((err: unknown) =>
        setActionError(
          messageFor(err, "No pudimos actualizar la etapa. Probá otra vez."),
        ),
      )
      .finally(() => setPendingId(null));
  }

  function move(stage: CaseStage, direction: StageMoveDirection, index: number) {
    const atEdge =
      (direction === "up" && index === 0) ||
      (direction === "down" && index === stages.length - 1);
    if (atEdge || pendingId) return;

    setActionError(null);
    setPendingId(stage.id);
    moveStage(stage.id, direction)
      .then(() => refresh())
      .catch((err: unknown) =>
        setActionError(
          messageFor(err, "No pudimos mover la etapa. Probá otra vez."),
        ),
      )
      .finally(() => setPendingId(null));
  }

  function requestDelete(stage: CaseStage) {
    setDeleteTarget(stage);
    setDeleteError(null);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;

    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteStage(deleteTarget.id);
      setDeleteTarget(null);
      toast("Etapa eliminada.");
      refresh();
    } catch (err) {
      // Stays open on purpose: the last-stage refusal must be readable next
      // to the confirm button that triggered it.
      setDeleteError(
        messageFor(err, "No pudimos eliminar la etapa. Probá otra vez."),
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1">
          <h1 className="text-xl font-bold text-text">Etapas</h1>
          <p className="text-base text-text-muted">
            Definí las etapas de tus causas. Las que cuentan como activas son
            las que se destacan en el panel de Inicio.
          </p>
        </div>
        <Button onClick={openCreate} disabled={state.status !== "ready"}>
          Nueva etapa
        </Button>
      </div>

      {actionError && (
        <p
          role="alert"
          className="rounded-lg border border-danger bg-danger-tint px-4 py-3 text-sm font-medium text-danger"
        >
          {actionError}
        </p>
      )}

      {state.status === "loading" && (
        <div
          aria-busy="true"
          className="rounded-lg border border-border bg-surface p-4"
        >
          <p role="status" className="sr-only">
            Cargando las etapas del estudio
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
            No pudimos cargar las etapas del estudio.
          </p>
          <Button variant="secondary" onClick={retry}>
            Reintentar
          </Button>
        </div>
      )}

      {state.status === "ready" &&
        (stages.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface px-6 py-12 text-center">
            <p className="text-base text-text-muted">
              Todavía no hay etapas en tu estudio.
            </p>
            <Button onClick={openCreate}>Crear la primera etapa</Button>
          </div>
        ) : (
          <ol className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
            {stages.map((stage, index) => {
              const busy = pendingId === stage.id;
              return (
                <li
                  key={stage.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <span
                    aria-hidden="true"
                    className="w-6 shrink-0 text-sm font-semibold text-text-muted"
                  >
                    {stage.position}
                  </span>

                  <div className="flex min-w-44 flex-1 flex-col gap-1">
                    <span className="font-semibold text-text">{stage.name}</span>
                    <Badge tone={stage.countsAsActive ? "accent" : "neutral"}>
                      {stage.countsAsActive
                        ? "Cuenta como activa"
                        : "No cuenta como activa"}
                    </Badge>
                  </div>

                  <label className="flex min-h-11 items-center gap-2 text-sm text-text">
                    <input
                      type="checkbox"
                      checked={stage.countsAsActive}
                      disabled={busy}
                      onChange={(event) =>
                        toggleCountsAsActive(stage, event.target.checked)
                      }
                      className="size-5 rounded-sm border-border-input accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    />
                    Cuenta como activa
                  </label>

                  <div className="flex flex-wrap items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Subir «${stage.name}»`}
                      disabled={index === 0 || pendingId !== null}
                      onClick={() => move(stage, "up", index)}
                    >
                      <ArrowUp aria-hidden="true" className="size-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Bajar «${stage.name}»`}
                      disabled={
                        index === stages.length - 1 || pendingId !== null
                      }
                      onClick={() => move(stage, "down", index)}
                    >
                      <ArrowDown aria-hidden="true" className="size-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => openRename(stage)}
                      disabled={pendingId !== null}
                    >
                      Renombrar
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => requestDelete(stage)}
                      disabled={pendingId !== null}
                    >
                      Eliminar
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        ))}

      <Modal
        open={editor !== null}
        onClose={closeEditor}
        title={editor?.kind === "rename" ? "Renombrar la etapa" : "Nueva etapa"}
        description={
          editor?.kind === "rename"
            ? "El nombre nuevo se muestra en los filtros y en el formulario de expedientes."
            : "La etapa queda disponible para todas las causas del estudio."
        }
        busy={saving}
      >
        <form
          noValidate
          onSubmit={onEditorSubmit}
          className="flex flex-col gap-5"
        >
          <FormField
            label="Nombre"
            name="name"
            value={editorName}
            onChange={(event) => setEditorName(event.target.value)}
            placeholder="Por ejemplo: Prueba"
            maxLength={STAGE_NAME_MAX}
            required
            error={editorError ?? undefined}
          />

          {editor?.kind === "create" && (
            <label className="flex items-center gap-3 text-sm text-text">
              <input
                type="checkbox"
                checked={editorCountsAsActive}
                onChange={(event) =>
                  setEditorCountsAsActive(event.target.checked)
                }
                className="size-5 rounded-sm border-border-input accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
              Cuenta como activa en Inicio
            </label>
          )}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={saving}>
              {saving ? "Guardando…" : editor?.kind === "rename" ? "Guardar" : "Crear etapa"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={closeEditor}
              disabled={saving}
            >
              Cancelar
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        title={
          deleteTarget ? `Eliminar la etapa «${deleteTarget.name}»` : "Eliminar etapa"
        }
        description="Las causas con esta etapa quedan sin etapa."
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
