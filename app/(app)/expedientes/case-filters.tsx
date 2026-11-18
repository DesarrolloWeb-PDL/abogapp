"use client";

import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import type { CaseListFilter } from "@/lib/data";

/**
 * Filtros panel (S07): the toggle carries the active-count badge, and the
 * collapsible panel holds every recon criterion this slice ships — Tipo,
 * Fuero, Etapa procesal, Jurisdicción, Responsable (free text, no members
 * directory), "Solo favoritos" and "Ver archivados". The sync-system filter
 * has no field on StudyCase yet and is deferred (reported, not rendered).
 *
 * Layout: the toggle sits next to the search field; the panel is `w-full`
 * inside the same flex-wrap row, so it wraps to its own line when open.
 */

interface CaseFiltersProps {
  filters: CaseListFilter;
  /** Active-criteria count for the badge (query excluded: it is not here). */
  activeCount: number;
  open: boolean;
  onToggleOpen: () => void;
  onChange: (next: CaseListFilter) => void;
  onClear: () => void;
  /** Distinct values loaded with the rows (no fuero/jurisdiccion directory). */
  tipoOptions: string[];
  fueroOptions: string[];
  etapaOptions: string[];
  jurisdiccionOptions: string[];
}

const CHECKBOX_CLASSES =
  "size-5 rounded-sm border-border-input accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

type TextFilterKey = "tipo" | "fuero" | "etapa" | "jurisdiccion" | "responsable";

export function CaseFilters({
  filters,
  activeCount,
  open,
  onToggleOpen,
  onChange,
  onClear,
  tipoOptions,
  fueroOptions,
  etapaOptions,
  jurisdiccionOptions,
}: CaseFiltersProps) {
  /** "" clears the key entirely: an absent criterion never filters. */
  function setText(key: TextFilterKey, value: string) {
    const next: CaseListFilter = { ...filters };
    if (value.trim()) next[key] = value;
    else delete next[key];
    onChange(next);
  }

  function setFlag(key: "favoritoOnly" | "archivedView", value: boolean) {
    const next: CaseListFilter = { ...filters };
    if (value) next[key] = true;
    else delete next[key];
    onChange(next);
  }

  return (
    <>
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        className="inline-flex h-11 items-center gap-2 self-end rounded-md border border-border-input bg-surface px-4 text-sm font-semibold text-text hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <SlidersHorizontal aria-hidden="true" className="size-4" />
        Filtros
        {activeCount > 0 && (
          <>
            {/* Explicit space: JSX strips newline whitespace, and the
                accessible name must read "Filtros 1 filtros activos". */}
            {" "}
            <span
              aria-hidden="true"
              className="inline-flex size-5 items-center justify-center rounded-pill bg-accent px-1.5 text-xs font-semibold text-on-accent"
            >
              {activeCount}
            </span>
            <span className="sr-only">{activeCount} filtros activos</span>
          </>
        )}
      </button>

      {open && (
        <section
          aria-label="Filtros de expedientes"
          className="grid w-full gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <FormField
            as="select"
            label="Tipo"
            value={filters.tipo ?? ""}
            onChange={(event) => setText("tipo", event.target.value)}
          >
            <option value="">Cualquier tipo</option>
            {tipoOptions.map((tipo) => (
              <option key={tipo} value={tipo}>
                {tipo}
              </option>
            ))}
          </FormField>

          <FormField
            as="select"
            label="Fuero"
            value={filters.fuero ?? ""}
            onChange={(event) => setText("fuero", event.target.value)}
          >
            <option value="">Cualquier fuero</option>
            {fueroOptions.map((fuero) => (
              <option key={fuero} value={fuero}>
                {fuero}
              </option>
            ))}
          </FormField>

          <FormField
            as="select"
            label="Etapa procesal"
            value={filters.etapa ?? ""}
            onChange={(event) => setText("etapa", event.target.value)}
            hint="Etapa procesal del expediente según tu estudio."
          >
            <option value="">Todas las etapas</option>
            {etapaOptions.map((etapa) => (
              <option key={etapa} value={etapa}>
                {etapa}
              </option>
            ))}
          </FormField>

          <FormField
            as="select"
            label="Jurisdicción"
            value={filters.jurisdiccion ?? ""}
            onChange={(event) => setText("jurisdiccion", event.target.value)}
          >
            <option value="">Todas las jurisdicciones</option>
            {jurisdiccionOptions.map((jurisdiccion) => (
              <option key={jurisdiccion} value={jurisdiccion}>
                {jurisdiccion}
              </option>
            ))}
          </FormField>

          <FormField
            label="Responsable"
            value={filters.responsable ?? ""}
            onChange={(event) => setText("responsable", event.target.value)}
            placeholder="Nombre de quien lo lleva"
            hint="Busca por parte del nombre, sin distinguir mayúsculas."
          />

          <div className="flex flex-col justify-end gap-2 sm:col-span-2 lg:col-span-1">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-text">
              <input
                type="checkbox"
                checked={filters.favoritoOnly ?? false}
                onChange={(event) => setFlag("favoritoOnly", event.target.checked)}
                className={CHECKBOX_CLASSES}
              />
              Solo favoritos
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-text">
              <input
                type="checkbox"
                checked={filters.archivedView ?? false}
                onChange={(event) => setFlag("archivedView", event.target.checked)}
                className={CHECKBOX_CLASSES}
              />
              Ver archivados
            </label>
          </div>

          <div className="flex items-end sm:col-span-2 lg:col-span-3">
            <Button
              variant="ghost"
              onClick={onClear}
              disabled={activeCount === 0}
            >
              Limpiar filtros
            </Button>
          </div>
        </section>
      )}
    </>
  );
}
