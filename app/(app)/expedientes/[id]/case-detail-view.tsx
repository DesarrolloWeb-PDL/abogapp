"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCase, listPruebas } from "@/lib/data";
import { formatDate } from "@/lib/format";
import type { Prueba, StudyCase } from "@/lib/types";
import { MovimientosTab } from "./movimientos-tab";

/**
 * Case detail hub (S08) — M1/M2 slice: Resumen + Movimientos + Pruebas
 * tabs with the `?tab=` deep link. Data loads through the data layer in
 * the browser (the fake store lives client-side), with skeleton /
 * missing / error states. The remaining tabs (Actuaciones, Tareas,
 * Audiencias, Agenda, Partes, Documentos, Finanzas) arrive later.
 */

export type CaseDetailTab = "resumen" | "movimientos" | "pruebas";

const TABS: ReadonlyArray<{ value: CaseDetailTab; label: string }> = [
  { value: "resumen", label: "Resumen" },
  { value: "movimientos", label: "Movimientos" },
  { value: "pruebas", label: "Pruebas" },
];

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "missing" }
  | {
      status: "ready";
      /** Which case this payload belongs to (guards stale renders on id change). */
      loadedId: string;
      record: StudyCase;
      pruebas: Prueba[];
    };

export function CaseDetailSkeleton() {
  return (
    <div
      className="flex flex-col gap-6"
      aria-busy="true"
      aria-label="Cargando expediente"
    >
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-12 w-full max-w-2xl" />
      <Skeleton className="h-11 w-64" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  );
}

export function CaseDetailView({ id, tab }: { id: string; tab: CaseDetailTab }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  // The effect only starts the read; state resolves through the promise
  // callbacks (react-hooks/set-state-in-effect forbids sync setState here).
  const fetchDetail = useCallback(() => {
    Promise.all([getCase(id), listPruebas(id)])
      .then(([record, pruebas]) => {
        setState(
          record
            ? { status: "ready", loadedId: id, record, pruebas }
            : { status: "missing" },
        );
      })
      .catch(() => setState({ status: "error" }));
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  function retry() {
    setState({ status: "loading" });
    fetchDetail();
  }

  // A navigation to another expediente keeps the previous payload for a tick;
  // show the skeleton instead of another case's data.
  if (state.status === "ready" && state.loadedId !== id) {
    return <CaseDetailSkeleton />;
  }

  if (state.status === "loading") return <CaseDetailSkeleton />;

  if (state.status === "error") {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-border bg-surface px-6 py-12 text-center">
        <p className="text-base text-text-muted">
          No pudimos cargar el expediente.
        </p>
        <Button variant="secondary" onClick={retry}>
          Reintentar
        </Button>
      </div>
    );
  }

  if (state.status === "missing") {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-border bg-surface px-6 py-12 text-center">
        <p className="text-base text-text-muted">
          No encontramos este expediente. Puede que se haya eliminado.
        </p>
        <ButtonLink href="/expedientes" variant="secondary">
          Volver a expedientes
        </ButtonLink>
      </div>
    );
  }

  const { record, pruebas } = state;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/expedientes"
        className="inline-flex min-h-11 items-center gap-2 self-start rounded-md px-2 text-base font-semibold text-accent hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Volver a expedientes
      </Link>

      <header className="flex flex-col gap-3">
        <h1 className="text-xl font-bold text-text">{record.caratula}</h1>
        <div className="flex flex-wrap gap-2">
          <Badge tone="accent">{record.tipo}</Badge>
          <Badge tone="info">{record.etapa || "Sin etapa"}</Badge>
          <Badge tone="neutral">{record.fuero || "Sin fuero"}</Badge>
          <Badge tone="neutral">{record.numero || "Sin número"}</Badge>
        </div>
      </header>

      <nav aria-label="Secciones del expediente">
        <ul className="flex gap-1 border-b border-border">
          {TABS.map((entry) => {
            const active = entry.value === tab;
            const href =
              entry.value === "resumen"
                ? `/expedientes/${record.id}`
                : `/expedientes/${record.id}?tab=${entry.value}`;

            return (
              <li key={entry.value}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "flex min-h-11 items-center rounded-t-md px-4 text-base",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
                    active
                      ? "border-b-2 border-accent font-semibold text-accent"
                      : "text-text-muted hover:bg-accent-tint hover:text-text",
                  ].join(" ")}
                >
                  {entry.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {tab === "resumen" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Información del expediente" />
            <CardBody>
              <dl className="flex flex-col gap-3 text-base">
                {[
                  ["Número", record.numero],
                  ["Fuero", record.fuero],
                  ["Juzgado", record.juzgado],
                  ["Jurisdicción", record.jurisdiccion],
                  ["Responsable", record.responsable],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex flex-wrap justify-between gap-2 border-b border-border pb-2 last:border-0 last:pb-0"
                  >
                    <dt className="text-text-muted">{label}</dt>
                    <dd className="text-right font-medium text-text">
                      {value || "—"}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Próximos plazos"
              description="Las fechas las calcula el motor de plazos."
            />
            <CardBody>
              {pruebas.length === 0 ? (
                <p className="text-base text-text-muted">
                  Este expediente todavía no tiene plazos cargados.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {pruebas.flatMap((prueba) =>
                    prueba.plazos.map((plazo) => (
                      <li
                        key={plazo.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-bg px-3 py-3"
                      >
                        <span className="text-base text-text">
                          {prueba.titulo}
                        </span>
                        <Badge tone="warning">
                          {plazo.fechaLimite
                            ? `Vence ${formatDate(plazo.fechaLimite)}`
                            : "Fecha pendiente"}
                        </Badge>
                      </li>
                    )),
                  )}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Última actividad" />
            <CardBody>
              <p className="text-base text-text">
                {formatDateTime(record.lastActivityAt)}
              </p>
              <p className="mt-1 text-base text-text-muted">
                {/* Same fallback as the "Información del expediente" card:
                    an empty responsable renders "—", never a dangling label. */}
                Responsable: {record.responsable || "—"}
              </p>
            </CardBody>
          </Card>
        </div>
      ) : tab === "movimientos" ? (
        <MovimientosTab caseId={record.id} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-text">
              Pruebas ({pruebas.length})
            </h2>
            <Link
              href={`/expedientes/${record.id}/pruebas/nueva`}
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-on-primary hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Agregar prueba
            </Link>
          </div>

          {pruebas.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-12 text-center">
              <p className="text-base text-text-muted">
                Todavía no hay pruebas en este expediente.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {pruebas.map((prueba) => (
                <li
                  key={prueba.id}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-4 shadow-card sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-base font-semibold text-text">
                      {prueba.titulo}
                    </span>
                    <span className="text-sm text-text-muted">
                      {prueba.informante} · Fecha efectiva{" "}
                      {formatDate(prueba.fechaEfectiva)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="accent">{prueba.tipo}</Badge>
                    <Badge tone="neutral">{prueba.estado}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
