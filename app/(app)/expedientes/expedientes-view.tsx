"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  DataLayerError,
  applyCaseFilters,
  archiveCase,
  bulkArchive,
  compareCasesBy,
  errorCopy,
  listCases,
  listStages,
  softDeleteCase,
  toggleFavorite,
  type CaseListFilter,
  type CaseSortKey,
  type CaseStage,
  type SortDirection,
} from "@/lib/data";
import type { StudyCase } from "@/lib/types";
import { CaseFilters } from "./case-filters";
import {
  NATURAL_SORT,
  caseFooterCopy,
  countActiveFilters,
  loadCaseFilters,
  persistCaseFilters,
} from "./case-list";
import { ExpedientesTable, type CaseRowAction } from "./expedientes-table";

/**
 * Expedientes list (S07): reads the data layer, never the seed directly.
 *
 * Fetch strategy: BOTH row sets (active + archived) load once at mount —
 * `archivedView` is the only split that needs the server, and a single load
 * keeps the "Ver archivados" toggle instant (no refetch, no loading flicker)
 * for the one study's volume this screen serves. Every other criterion
 * (search through lib/search, Tipo, Fuero, Etapa, Jurisdicción,
 * Responsable, favoritos) narrows in memory through the shared pure
 * `applyCaseFilters` — the same fetch-once pattern tareas-view uses.
 *
 * States: loading (skeleton rows), ready, empty (fresh account), archived
 * empty, no-results (+ Limpiar) and error (+ Reintentar). Filters persist
 * per browser session (sessionStorage, see case-list.ts); selection, sort
 * and search stay ephemeral. Column resize/reorder and the read-only
 * padlock are out of this slice (reported as deferred).
 */

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      active: StudyCase[];
      archived: StudyCase[];
      stages: CaseStage[];
    };

interface DeleteTarget {
  ids: string[];
  description: string;
}

/** Stable empty collections so hook dependencies never churn between renders. */
const EMPTY_CASES: StudyCase[] = [];
const EMPTY_STAGE_NAMES: string[] = [];
const EMPTY_IDS: ReadonlySet<string> = new Set();

/** The StudyCase union is the tipo vocabulary — never invented here. */
const TIPO_OPTIONS: StudyCase["tipo"][] = ["Judicial", "Extrajudicial"];

const CLEAR_BUTTON_CLASSES =
  "min-h-11 rounded-md px-4 text-base font-semibold text-accent underline underline-offset-4 hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** Distinct, sorted values of a text column across both row sets. */
function distinctTextValues(
  rows: StudyCase[],
  key: "fuero" | "jurisdiccion",
): string[] {
  const values = new Set<string>();
  for (const row of rows) {
    const value = row[key].trim();
    if (value) values.add(value);
  }
  return [...values].sort((a, b) => a.localeCompare(b, "es"));
}

export function ExpedientesView() {
  const router = useRouter();
  const { toast } = useToast();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<CaseListFilter>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<{
    key: CaseSortKey;
    direction: SortDirection;
  }>({ key: "ultima_actividad", direction: "desc" });
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [starPendingIds, setStarPendingIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);

  // No sync setState here: the effect only kicks off the reads and resolves
  // into state through the promise callbacks (react-hooks/set-state-in-effect).
  const fetchAll = useCallback(() => {
    Promise.all([
      listCases(),
      listCases({ archivedView: true }),
      listStages(),
    ])
      .then(([active, archived, stages]) =>
        setState({ status: "ready", active, archived, stages }),
      )
      .catch(() => setState({ status: "error" }));
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Hydrate the persisted filters. The read is synchronous (it must happen
  // before the persist effect can ever write), the setState is deferred to
  // a callback so SSR markup and hydration stay identical.
  useEffect(() => {
    const stored = loadCaseFilters();
    if (countActiveFilters(stored) === 0) return;
    Promise.resolve().then(() => setFilters(stored));
  }, []);

  // Write-through persistence; the first run is the mount itself (nothing
  // to persist yet, and never clobber a just-loaded state with `{}`).
  const persistSkippedRef = useRef(true);
  useEffect(() => {
    if (persistSkippedRef.current) {
      persistSkippedRef.current = false;
      return;
    }
    persistCaseFilters(filters);
  }, [filters]);

  const ready = state.status === "ready" ? state : null;
  const archivedView = Boolean(filters.archivedView);

  const rowSet = ready
    ? archivedView
      ? ready.archived
      : ready.active
    : EMPTY_CASES;

  const visible = useMemo(
    () => applyCaseFilters(rowSet, { ...filters, query }),
    [rowSet, filters, query],
  );
  const sorted = useMemo(
    () => [...visible].sort(compareCasesBy(sort.key, sort.direction)),
    [visible, sort],
  );
  const visibleIds = useMemo(
    () => new Set(sorted.map((row) => row.id)),
    [sorted],
  );

  // Selection DERIVED against the visible rows: rows that leave the view
  // (archive, filter, delete) silently drop out of the effective set — no
  // effect needed to scrub the selection after every mutation.
  const effectiveSelected = useMemo(() => {
    if (selectedIds.size === 0) return EMPTY_IDS;
    const next = new Set<string>();
    for (const id of selectedIds) {
      if (visibleIds.has(id)) next.add(id);
    }
    return next;
  }, [selectedIds, visibleIds]);

  const allSelected =
    sorted.length > 0 && effectiveSelected.size === sorted.length;
  const someSelected =
    effectiveSelected.size > 0 && effectiveSelected.size < sorted.length;

  const activeFilterCount = countActiveFilters(filters);

  const fueroOptions = useMemo(
    () =>
      ready ? distinctTextValues([...ready.active, ...ready.archived], "fuero") : [],
    [ready],
  );
  const jurisdiccionOptions = useMemo(
    () =>
      ready
        ? distinctTextValues([...ready.active, ...ready.archived], "jurisdiccion")
        : [],
    [ready],
  );
  const etapaOptions = useMemo(
    () => ready?.stages.map((stage) => stage.name) ?? EMPTY_STAGE_NAMES,
    [ready],
  );

  function retry() {
    setState({ status: "loading" });
    fetchAll();
  }

  /** Panel "Limpiar filtros": clears every criterion AND the search box. */
  function clearFilters() {
    setFilters({});
    setQuery("");
  }

  /** "Ver expedientes activos": leaves the archived view, keeps the rest. */
  function exitArchivedView() {
    setFilters((current) => {
      const next: CaseListFilter = { ...current };
      delete next.archivedView;
      return next;
    });
  }

  function handleSort(key: CaseSortKey) {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: NATURAL_SORT[key] },
    );
  }

  function handleToggleRow(id: string, shiftKey: boolean, index: number) {
    if (shiftKey && anchorId && anchorId !== id) {
      const anchorIndex = sorted.findIndex((row) => row.id === anchorId);
      if (anchorIndex !== -1) {
        const from = Math.min(anchorIndex, index);
        const to = Math.max(anchorIndex, index);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (let cursor = from; cursor <= to; cursor += 1) {
            next.add(sorted[cursor].id);
          }
          return next;
        });
        return; // the anchor stays where the range started
      }
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setAnchorId(id);
  }

  function handleToggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(visibleIds) : new Set());
    setAnchorId(null);
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setAnchorId(null);
  }

  /** Esc clears the selection — but only when no menu/modal owns the key. */
  useEffect(() => {
    if (selectedIds.size === 0) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setSelectedIds(new Set());
      setAnchorId(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedIds.size]);

  /** Optimistic favorite flip; a failed write reverts the star in place. */
  function handleToggleFavorite(row: StudyCase) {
    const next = !row.favorite;
    setStarPendingIds((prev) => new Set(prev).add(row.id));
    patchCase(row.id, { favorite: next });

    toggleFavorite(row.id, next)
      .then((updated) => placeCase(updated))
      .catch((error: unknown) => {
        patchCase(row.id, { favorite: row.favorite });
        toast(
          error instanceof DataLayerError
            ? errorCopy(error.code)
            : "No pudimos guardar el favorito. Probá otra vez.",
          { variant: "error" },
        );
      })
      .finally(() =>
        setStarPendingIds((prev) => {
          const nextSet = new Set(prev);
          nextSet.delete(row.id);
          return nextSet;
        }),
      );
  }

  function runArchive(row: StudyCase) {
    const next = !row.archived;
    archiveCase(row.id, next)
      .then((updated) => {
        placeCase(updated);
        toast(next ? "Expediente archivado." : "Expediente desarchivado.", {
          variant: "success",
        });
      })
      .catch((error: unknown) => {
        toast(
          error instanceof DataLayerError
            ? errorCopy(error.code)
            : "No pudimos actualizar el expediente. Probá otra vez.",
          { variant: "error" },
        );
      });
  }

  function runBulkArchive(archived: boolean) {
    const ids = [...effectiveSelected];
    if (ids.length === 0) return;
    bulkArchive(ids, archived)
      .then((updated) => {
        updated.forEach((row) => placeCase(row));
        clearSelection();
        toast(
          archived
            ? `Se archivaron ${updated.length} expedientes.`
            : `Se desarchivaron ${updated.length} expedientes.`,
          { variant: "success" },
        );
      })
      .catch((error: unknown) => {
        toast(
          error instanceof DataLayerError
            ? errorCopy(error.code)
            : "No pudimos actualizar los expedientes. Probá otra vez.",
          { variant: "error" },
        );
      });
  }

  function requestRowDelete(row: StudyCase) {
    setDeleteTarget({
      ids: [row.id],
      description: `¿Seguro que querés eliminar «${row.caratula}»? Esta acción no se puede deshacer.`,
    });
  }

  function requestBulkDelete() {
    const count = effectiveSelected.size;
    if (count === 0) return;
    setDeleteTarget({
      ids: [...effectiveSelected],
      description: `¿Seguro que querés eliminar ${
        count === 1 ? "el expediente seleccionado" : `estos ${count} expedientes`
      }? Esta acción no se puede deshacer.`,
    });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const ids = deleteTarget.ids;
    setDeleting(true);
    // Per-id narrow patch (the only delete primitive in the data layer):
    // Promise.all can leave a partial write behind, so a failure toasts the
    // typed error AND re-reads both partitions to resync the list.
    Promise.all(ids.map((id) => softDeleteCase(id)))
      .then(() => {
        removeCases(ids);
        clearSelection();
        setDeleteTarget(null);
        toast(
          ids.length === 1
            ? "Expediente eliminado."
            : `Se eliminaron ${ids.length} expedientes.`,
          { variant: "success" },
        );
      })
      .catch((error: unknown) => {
        setDeleteTarget(null);
        fetchAll();
        toast(
          error instanceof DataLayerError
            ? errorCopy(error.code)
            : "No pudimos eliminar el expediente. Probá otra vez.",
          { variant: "error" },
        );
      })
      .finally(() => setDeleting(false));
  }

  /** Merge a server-confirmed row into the partition it now belongs to. */
  function placeCase(updated: StudyCase) {
    setState((prev) => {
      if (prev.status !== "ready") return prev;
      if (updated.archived) {
        return {
          ...prev,
          archived: prev.archived.some((row) => row.id === updated.id)
            ? prev.archived.map((row) =>
                row.id === updated.id ? updated : row,
              )
            : [updated, ...prev.archived],
          active: prev.active.filter((row) => row.id !== updated.id),
        };
      }
      return {
        ...prev,
        active: prev.active.some((row) => row.id === updated.id)
          ? prev.active.map((row) => (row.id === updated.id ? updated : row))
          : [updated, ...prev.active],
        archived: prev.archived.filter((row) => row.id !== updated.id),
      };
    });
  }

  /** Optimistic local patch (favorite revert path). */
  function patchCase(id: string, patch: Partial<StudyCase>) {
    setState((prev) => {
      if (prev.status !== "ready") return prev;
      const apply = (list: StudyCase[]) =>
        list.map((row) => (row.id === id ? { ...row, ...patch } : row));
      return { ...prev, active: apply(prev.active), archived: apply(prev.archived) };
    });
  }

  function removeCases(ids: string[]) {
    setState((prev) => {
      if (prev.status !== "ready") return prev;
      const drop = (row: StudyCase) => !ids.includes(row.id);
      return {
        ...prev,
        active: prev.active.filter(drop),
        archived: prev.archived.filter(drop),
      };
    });
  }

  function handleRowAction(action: CaseRowAction, row: StudyCase) {
    switch (action) {
      case "detail":
        router.push(`/expedientes/${row.id}`);
        break;
      case "favorite":
        handleToggleFavorite(row);
        break;
      case "archive":
        runArchive(row);
        break;
      case "delete":
        requestRowDelete(row);
        break;
    }
  }

  const emptyMessage = ready
    ? rowSet.length === 0
      ? archivedView
        ? "Todavía no hay expedientes archivados"
        : "Todavía no hay expedientes"
      : activeFilterCount > 0
        ? "No encontramos expedientes con esos filtros"
        : query.trim()
          ? "No encontramos coincidencias con tu búsqueda"
          : "Todavía no hay expedientes"
    : "";

  const emptyAction: ReactNode = ready
    ? rowSet.length === 0
      ? archivedView ? (
          <Button variant="secondary" onClick={exitArchivedView}>
            Ver expedientes activos
          </Button>
        ) : (
          <ButtonLink href="/expedientes/nueva" variant="secondary">
            Crear el primero
          </ButtonLink>
        )
      : activeFilterCount > 0 ? (
          // Clears the panel criteria AND the search box: after this the
          // list must show rows again, whatever combination hid them.
          <button type="button" onClick={clearFilters} className={CLEAR_BUTTON_CLASSES}>
            Limpiar filtros
          </button>
        ) : query.trim() ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className={CLEAR_BUTTON_CLASSES}
          >
            Limpiar búsqueda
          </button>
        ) : null
    : null;

  const footerCopy = ready
    ? caseFooterCopy(sorted.length, rowSet.length, archivedView)
    : "";

  const deleteTitle =
    deleteTarget && deleteTarget.ids.length > 1
      ? "Eliminar expedientes"
      : "Eliminar expediente";

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold text-text">Expedientes</h1>
          <p className="text-base text-text-muted">
            Todas las causas del estudio, en un solo lugar.
          </p>
        </div>
        <ButtonLink href="/expedientes/nueva" size="lg">
          Nuevo expediente
        </ButtonLink>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-56 flex-1 flex-col gap-2 sm:max-w-lg">
            <span className="text-sm font-semibold text-text">
              Buscar expedientes
            </span>
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Escribí la carátula, el número o el juzgado"
            />
          </label>
          <CaseFilters
            filters={filters}
            activeCount={activeFilterCount}
            open={filtersOpen}
            onToggleOpen={() => setFiltersOpen((open) => !open)}
            onChange={setFilters}
            onClear={clearFilters}
            tipoOptions={TIPO_OPTIONS}
            fueroOptions={fueroOptions}
            etapaOptions={etapaOptions}
            jurisdiccionOptions={jurisdiccionOptions}
          />
        </div>

        {state.status === "loading" && (
          <div
            className="rounded-lg border border-border bg-surface p-4"
            aria-busy="true"
          >
            <p role="status" className="sr-only">
              Cargando expedientes
            </p>
            <SkeletonRows rows={5} />
          </div>
        )}

        {state.status === "error" && (
          <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-border bg-surface px-6 py-12 text-center">
            <p className="text-base text-text-muted">
              No pudimos cargar los expedientes.
            </p>
            <Button variant="secondary" onClick={retry}>
              Reintentar
            </Button>
          </div>
        )}

        {ready && (
          <>
            {effectiveSelected.size > 0 && (
              <div className="hidden flex-wrap items-center gap-3 rounded-lg border border-border bg-accent-tint px-4 py-3 md:flex">
                <span
                  aria-live="polite"
                  className="text-sm font-semibold text-accent"
                >
                  {effectiveSelected.size}{" "}
                  {effectiveSelected.size === 1 ? "seleccionado" : "seleccionados"}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => runBulkArchive(!archivedView)}
                >
                  {archivedView ? "Desarchivar" : "Archivar"}
                </Button>
                <Button size="sm" variant="danger" onClick={requestBulkDelete}>
                  Eliminar
                </Button>
                <Button size="sm" variant="ghost" onClick={clearSelection}>
                  Quitar selección
                </Button>
              </div>
            )}

            <ExpedientesTable
              rows={sorted}
              sort={sort}
              onSort={handleSort}
              selectedIds={effectiveSelected}
              allSelected={allSelected}
              someSelected={someSelected}
              onToggleAll={handleToggleAll}
              onToggleRow={handleToggleRow}
              starPendingIds={starPendingIds}
              onToggleFavorite={handleToggleFavorite}
              onRowAction={handleRowAction}
              emptyMessage={emptyMessage}
              emptyAction={emptyAction}
            />

            <p className="text-sm text-text-muted" aria-live="polite">
              {footerCopy}
            </p>
          </>
        )}
      </div>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={deleteTitle}
        description={deleteTarget?.description}
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
        <p className="text-base text-text-muted">
          Se quita de la lista del estudio para todos los miembros.
        </p>
      </Modal>
    </>
  );
}
