"use client";

import { AgendaPanel } from "./agenda-panel";

/**
 * Agenda page (S17, T2 slice 1): the page header over the shared
 * panel — now carrying the T4 top bar (five views, period navigation,
 * shortcuts, weekend/inhábil toggles). The panel holds every filter,
 * state and row — the case-detail Agenda tab (T3) renders the SAME
 * component with `caseId` pinned to the route's expediente, so the two
 * surfaces can never drift apart. The subtitle stays view-neutral: the
 * panel's own period title states what is on screen.
 */

export function AgendaView() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-text">Agenda</h1>
        <p className="text-base text-text-muted">
          La agenda compartida del estudio.
        </p>
      </div>

      <AgendaPanel />
    </div>
  );
}
