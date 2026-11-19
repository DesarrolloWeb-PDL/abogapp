"use client";

import { useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AGENDA_VIEW_LABELS,
  AGENDA_VIEW_SHORTCUTS,
  type AgendaPeriodTitle,
  type AgendaViewKind,
} from "./agenda-periods";

/**
 * The S17 top bar (T4): Hoy (H), ‹ › period navigation, the period title
 * (+ the recon's "Semana N" badge), the Día/Semana/Mes/Año/Lista selector
 * (D/S/M/A/L) and the Fines de semana / Días inhábiles toggles. It renders
 * only the views available at the current width — the selector itself is
 * how "Lista or Día only (no Año)" reaches the narrow screen, backed by
 * `clampAgendaView` in the panel so a resize can never strand an
 * unavailable view.
 */

/** Below the md breakpoint (768px) — the shell swaps the sidebar for the
 *  mobile bottom bar at the same cutoff (tailwind-theme breakpoints). */
const NARROW_QUERY = "(max-width: 767px)";

/**
 * Is the viewport narrow? `useSyncExternalStore` keeps the SSR markup and
 * the first client render in agreement (server snapshot: false) and
 * re-renders on every matchMedia change — no setState inside an effect
 * (react-hooks/set-state-in-effect).
 */
export function useAgendaNarrowViewport(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(NARROW_QUERY);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
}

const CHECKBOX_CLASSES =
  "size-5 rounded-sm border-border-input accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const VIEW_BUTTON_BASE =
  "min-h-9 rounded-md border px-3 text-sm font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const VIEW_BUTTON_IDLE =
  "border-border-input bg-surface text-text hover:bg-accent-tint";
const VIEW_BUTTON_ACTIVE = "border-accent bg-accent-tint text-accent";

interface AgendaTopBarProps {
  /** The view actually rendered (already clamped to availability). */
  view: AgendaViewKind;
  /** Views available at this width, in selector order. */
  views: readonly AgendaViewKind[];
  title: AgendaPeriodTitle;
  /** ‹ › do nothing in Lista (its window is anchored to today). */
  navDisabled: boolean;
  showWeekends: boolean;
  showNonWorkingDays: boolean;
  onSwitchView: (view: AgendaViewKind) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onToggleWeekends: (checked: boolean) => void;
  onToggleNonWorkingDays: (checked: boolean) => void;
}

export function AgendaTopBar({
  view,
  views,
  title,
  navDisabled,
  showWeekends,
  showNonWorkingDays,
  onSwitchView,
  onPrev,
  onNext,
  onToday,
  onToggleWeekends,
  onToggleNonWorkingDays,
}: AgendaTopBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={onToday}
        aria-keyshortcuts="H"
      >
        Hoy
      </Button>

      <div className="flex items-center gap-1">
        <Button
          variant="secondary"
          size="sm"
          aria-label="Periodo anterior"
          disabled={navDisabled}
          onClick={onPrev}
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </Button>
        <Button
          variant="secondary"
          size="sm"
          aria-label="Periodo siguiente"
          disabled={navDisabled}
          onClick={onNext}
        >
          <ChevronRight aria-hidden="true" className="size-4" />
        </Button>
      </div>

      <h2 className="flex min-w-0 flex-wrap items-center gap-2 text-base font-semibold text-text">
        {title.main}
        {title.badge && (
          <span className="rounded-pill border border-border-input bg-bg px-2 py-0.5 text-xs font-medium text-text-muted">
            {title.badge}
          </span>
        )}
      </h2>

      <div
        role="group"
        aria-label="Vista de la agenda"
        className="flex flex-wrap items-center gap-1"
      >
        {views.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onSwitchView(option)}
            aria-pressed={view === option}
            aria-keyshortcuts={AGENDA_VIEW_SHORTCUTS[option].toUpperCase()}
            className={`${VIEW_BUTTON_BASE} ${
              view === option ? VIEW_BUTTON_ACTIVE : VIEW_BUTTON_IDLE
            }`}
          >
            {AGENDA_VIEW_LABELS[option]}
          </button>
        ))}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-x-4">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            className={CHECKBOX_CLASSES}
            checked={showWeekends}
            onChange={(event) => onToggleWeekends(event.target.checked)}
          />
          Fines de semana
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            className={CHECKBOX_CLASSES}
            checked={showNonWorkingDays}
            onChange={(event) => onToggleNonWorkingDays(event.target.checked)}
          />
          Días inhábiles
        </label>
      </div>
    </div>
  );
}
