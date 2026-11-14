"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

/**
 * Data table basics (components.md block 4): sortable header buttons inside
 * `<th>` with aria-sort, sticky header, row hover, and an empty state.
 * Multi-select, resizing and the row menu arrive with their screens (T5+).
 */

export interface DataTableColumn<T> {
  key: string;
  header: string;
  sortable?: boolean;
  cell: (row: T) => ReactNode;
  /** Value used for sorting; defaults to the stringified cell content. */
  sortValue?: (row: T) => string | number;
}

interface DataTableProps<T> {
  /** Visually hidden caption describing the table for screen readers. */
  caption: string;
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage: string;
  /** Rendered under the empty message (e.g. a "create" action). */
  emptyAction?: ReactNode;
  onRowClick?: (row: T) => void;
}

type SortDirection = "asc" | "desc";

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  emptyMessage,
  emptyAction,
  onRowClick,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(
    null,
  );

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column) return rows;

    const factor = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = column.sortValue ? column.sortValue(a) : "";
      const right = column.sortValue ? column.sortValue(b) : "";
      if (typeof left === "number" && typeof right === "number") {
        return (left - right) * factor;
      }
      return String(left).localeCompare(String(right), "es") * factor;
    });
  }, [rows, sort, columns]);

  function toggleSort(key: string) {
    setSort((prev) => {
      if (prev?.key !== key) return { key, direction: "asc" };
      if (prev.direction === "asc") return { key, direction: "desc" };
      return null;
    });
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
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-bg">
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key;
              const ariaSort = active
                ? sort.direction === "asc"
                  ? "ascending"
                  : "descending"
                : "none";

              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={column.sortable ? ariaSort : undefined}
                  className="border-b border-border px-4 py-3 text-xs font-medium uppercase tracking-wide text-text-muted"
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
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
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={
                onRowClick
                  ? "cursor-pointer border-b border-border last:border-0 hover:bg-accent-tint focus-within:bg-accent-tint"
                  : "border-b border-border last:border-0 hover:bg-accent-tint"
              }
            >
              {columns.map((column) => (
                <td key={column.key} className="px-4 py-3 text-base text-text">
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
