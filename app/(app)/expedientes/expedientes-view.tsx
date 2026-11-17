"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { SkeletonRows } from "@/components/ui/skeleton";
import { listCases } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { searchMatches } from "@/lib/search";
import type { StudyCase } from "@/lib/types";

/**
 * Expedientes list (S07): reads the data layer, never the seed directly.
 * States: loading (skeleton rows), ready (seeded cases), empty (fresh
 * account) and error (+ Reintentar). Filters/favorites/archive are out of
 * M1 (M2 scope).
 */

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; cases: StudyCase[] };

/** Stable empty list so hook dependencies never churn between renders. */
const EMPTY_CASES: StudyCase[] = [];

const etapaTone: Record<string, "neutral" | "info" | "warning" | "success"> = {
  Inicial: "neutral",
  Cita: "info",
  Trámite: "warning",
  Sentencia: "success",
};

export function ExpedientesView() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<LoadState>({ status: "loading" });

  // No sync setState here: the effect only kicks off the read and resolves
  // into state through the promise callbacks (react-hooks/set-state-in-effect).
  const fetchCases = useCallback(() => {
    listCases()
      .then((cases) => setState({ status: "ready", cases }))
      .catch(() => setState({ status: "error" }));
  }, []);

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  function retry() {
    setState({ status: "loading" });
    fetchCases();
  }

  const cases = useMemo(
    () => (state.status === "ready" ? state.cases : EMPTY_CASES),
    [state],
  );
  const filtered = useMemo(() => {
    if (!query.trim()) return cases;
    // BUG-003: accent-stripping + bounded typo tolerance (lib/search.ts)
    // instead of a plain case-folded includes.
    return cases.filter((item) =>
      searchMatches(
        query,
        [item.caratula, item.numero, item.juzgado, item.fuero].join(" "),
      ),
    );
  }, [cases, query]);

  const columns: DataTableColumn<StudyCase>[] = [
    {
      key: "caratula",
      header: "Carátula",
      sortable: true,
      sortValue: (row) => row.caratula,
      cell: (row) => (
        <Link
          href={`/expedientes/${row.id}`}
          className="font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {row.caratula}
        </Link>
      ),
    },
    {
      key: "numero",
      header: "Número",
      sortable: true,
      sortValue: (row) => row.numero,
      cell: (row) => <span className="text-text-muted">{row.numero}</span>,
    },
    {
      key: "fuero",
      header: "Fuero",
      sortable: true,
      sortValue: (row) => row.fuero,
      cell: (row) => row.fuero,
    },
    {
      key: "etapa",
      header: "Etapa",
      sortable: true,
      sortValue: (row) => row.etapa,
      cell: (row) => (
        <Badge tone={etapaTone[row.etapa] ?? "neutral"}>
          {row.etapa || "Sin etapa"}
        </Badge>
      ),
    },
    {
      key: "actividad",
      header: "Última actividad",
      sortable: true,
      sortValue: (row) => row.lastActivityAt,
      cell: (row) => (
        <span className="text-text-muted">{formatDate(row.lastActivityAt)}</span>
      ),
    },
  ];

  const emptyMessage =
    query.trim().length > 0
      ? "No encontramos coincidencias con tu búsqueda"
      : "Todavía no hay expedientes";

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
        <label className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-text">
            Buscar expedientes
          </span>
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Escribí la carátula, el número o el juzgado"
            className="max-w-lg"
          />
        </label>

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

        {state.status === "ready" && (
          <>
            <DataTable
              caption="Expedientes del estudio"
              columns={columns}
              rows={filtered}
              rowKey={(row) => row.id}
              emptyMessage={emptyMessage}
              emptyAction={
                query.trim().length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="min-h-11 rounded-md px-4 text-base font-semibold text-accent underline underline-offset-4 hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Limpiar búsqueda
                  </button>
                ) : (
                  <ButtonLink href="/expedientes/nueva" variant="secondary">
                    Crear el primero
                  </ButtonLink>
                )
              }
              onRowClick={(row) => router.push(`/expedientes/${row.id}`)}
            />

            <p className="text-sm text-text-muted" aria-live="polite">
              Mostrando {filtered.length} de {cases.length} expedientes
            </p>
          </>
        )}
      </div>
    </>
  );
}
