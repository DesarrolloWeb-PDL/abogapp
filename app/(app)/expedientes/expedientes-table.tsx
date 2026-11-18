"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Star } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import type { CaseSortKey, SortDirection } from "@/lib/data";
import type { StudyCase } from "@/lib/types";
import { RowMenu, type RowMenuItem } from "./row-menu";

/**
 * Expedientes table (S07): the data-table block rebuilt for this screen's
 * extras — select-all + per-row checkboxes (hidden below 768 px, the
 * recon's "no multi-select on mobile" delta), the studio-wide favorite
 * star, the row ⋯ menu, click-to-sort headers with aria-sort, and
 * `aria-selected` rows. Sorting is controlled by the view so the footer,
 * the bulk bar and the comparators (lib/data/cases) all read one state.
 */

export type CaseRowAction = "detail" | "favorite" | "archive" | "delete";

interface ExpedientesTableProps {
  /** Already filtered AND sorted rows of the current view. */
  rows: StudyCase[];
  sort: { key: CaseSortKey; direction: SortDirection };
  onSort: (key: CaseSortKey) => void;
  selectedIds: ReadonlySet<string>;
  allSelected: boolean;
  someSelected: boolean;
  onToggleAll: (checked: boolean) => void;
  /** `shiftKey` extends the range from the last plain-clicked row. */
  onToggleRow: (id: string, shiftKey: boolean, index: number) => void;
  starPendingIds: ReadonlySet<string>;
  onToggleFavorite: (row: StudyCase) => void;
  onRowAction: (action: CaseRowAction, row: StudyCase) => void;
  emptyMessage: string;
  emptyAction?: ReactNode;
}

const CHECKBOX_CLASSES =
  "size-5 rounded-sm border-border-input accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const etapaTone: Record<string, BadgeTone> = {
  Inicial: "neutral",
  Cita: "info",
  Trámite: "warning",
  Sentencia: "success",
};

const SORTABLE_COLUMNS: Array<{ key: CaseSortKey; header: string }> = [
  { key: "caratula", header: "Carátula" },
  { key: "numero", header: "Número" },
  { key: "fuero", header: "Fuero" },
  { key: "etapa", header: "Etapa" },
  { key: "fecha", header: "Creado" },
  { key: "ultima_actividad", header: "Última actividad" },
];

export function ExpedientesTable({
  rows,
  sort,
  onSort,
  selectedIds,
  allSelected,
  someSelected,
  onToggleAll,
  onToggleRow,
  starPendingIds,
  onToggleFavorite,
  onRowAction,
  emptyMessage,
  emptyAction,
}: ExpedientesTableProps) {
  function menuItemsFor(row: StudyCase): RowMenuItem[] {
    return [
      { key: "detail", label: "Ver detalle" },
      {
        key: "favorite",
        label: row.favorite ? "Quitar de favoritos" : "Agregar a favoritos",
      },
      { key: "archive", label: row.archived ? "Desarchivar" : "Archivar" },
      { key: "delete", label: "Eliminar", danger: true },
    ];
  }

  function renderSortableHeader(column: {
    key: CaseSortKey;
    header: string;
  }): ReactNode {
    const active = sort.key === column.key;
    const ariaSort = active
      ? sort.direction === "asc"
        ? "ascending"
        : "descending"
      : "none";
    return (
      <th
        key={column.key}
        scope="col"
        aria-sort={ariaSort}
        className="border-b border-border px-4 py-3 text-xs font-medium uppercase tracking-wide text-text-muted"
      >
        <button
          type="button"
          onClick={() => onSort(column.key)}
          className="flex min-h-11 items-center gap-1.5 rounded-md text-left text-xs font-medium uppercase tracking-wide text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {column.header}
          {active ? (
            sort.direction === "asc" ? (
              <ArrowUp aria-hidden="true" className="size-3.5" />
            ) : (
              <ArrowDown aria-hidden="true" className="size-3.5" />
            )
          ) : (
            <ArrowUpDown aria-hidden="true" className="size-3.5 opacity-60" />
          )}
        </button>
      </th>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-border bg-surface px-6 py-12 text-center">
        <p className="text-base text-text-muted">{emptyMessage}</p>
        {emptyAction}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">Expedientes del estudio</caption>
        <thead className="sticky top-0 bg-bg">
          <tr>
            <th
              scope="col"
              className="hidden border-b border-border px-4 py-3 md:table-cell"
            >
              <span className="sr-only">Seleccionar</span>
              <input
                type="checkbox"
                checked={allSelected}
                aria-label="Seleccionar todos los expedientes visibles"
                ref={(element) => {
                  if (element) element.indeterminate = someSelected;
                }}
                onChange={(event) => onToggleAll(event.target.checked)}
                onClick={(event) => event.stopPropagation()}
                className={CHECKBOX_CLASSES}
              />
            </th>
            <th
              scope="col"
              className="border-b border-border px-4 py-3 text-xs font-medium uppercase tracking-wide text-text-muted"
            >
              <span className="sr-only">Favorito</span>
            </th>
            {SORTABLE_COLUMNS.map((column) => renderSortableHeader(column))}
            <th
              scope="col"
              className="hidden border-b border-border px-4 py-3 text-xs font-medium uppercase tracking-wide text-text-muted md:table-cell"
            >
              Responsable
            </th>
            <th
              scope="col"
              className="border-b border-border px-4 py-3 text-xs font-medium uppercase tracking-wide text-text-muted"
            >
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const selected = selectedIds.has(row.id);
            return (
              <tr
                key={row.id}
                aria-selected={selected}
                onClick={(event) => {
                  const target = event.target as HTMLElement;
                  // Interactive cells own their clicks (menu, star, link…);
                  // only a click on the row's own text opens the detail.
                  if (target.closest("a, button, input")) return;
                  onRowAction("detail", row);
                }}
                className={[
                  "border-b border-border last:border-0",
                  "cursor-pointer hover:bg-accent-tint focus-within:bg-accent-tint",
                  selected ? "bg-accent-tint" : "",
                ].join(" ")}
              >
                <td className="hidden px-4 py-3 md:table-cell">
                  <input
                    type="checkbox"
                    checked={selected}
                    aria-label={`Seleccionar ${row.caratula}`}
                    onChange={(event) =>
                      onToggleRow(
                        row.id,
                        (event.nativeEvent as MouseEvent).shiftKey,
                        index,
                      )
                    }
                    onClick={(event) => event.stopPropagation()}
                    className={CHECKBOX_CLASSES}
                  />
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    aria-pressed={row.favorite}
                    aria-label={
                      row.favorite ? "Quitar de favoritos" : "Agregar a favoritos"
                    }
                    disabled={starPendingIds.has(row.id)}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleFavorite(row);
                    }}
                    className="flex size-11 items-center justify-center rounded-md hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Star
                      aria-hidden="true"
                      className={
                        row.favorite
                          ? "size-5 fill-favorite text-favorite"
                          : "size-5 text-text-muted"
                      }
                    />
                  </button>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/expedientes/${row.id}`}
                    className="font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {row.caratula}
                  </Link>
                </td>
                <td className="px-4 py-3 text-base text-text">
                  <span className="text-text-muted">{row.numero}</span>
                </td>
                <td className="px-4 py-3 text-base text-text">{row.fuero}</td>
                <td className="px-4 py-3">
                  <Badge tone={etapaTone[row.etapa] ?? "neutral"}>
                    {row.etapa || "Sin etapa"}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-base text-text">
                  <span className="text-text-muted">
                    {formatDate(row.createdAt)}
                  </span>
                </td>
                <td className="px-4 py-3 text-base text-text">
                  <span className="text-text-muted">
                    {formatDate(row.lastActivityAt)}
                  </span>
                </td>
                <td className="hidden px-4 py-3 text-base text-text md:table-cell">
                  <span className={row.responsable ? "" : "text-text-muted"}>
                    {row.responsable || "—"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <RowMenu
                    label={`Acciones de ${row.caratula}`}
                    items={menuItemsFor(row)}
                    onSelect={(key) => onRowAction(key as CaseRowAction, row)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
