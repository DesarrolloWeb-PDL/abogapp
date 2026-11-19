"use client";

import { UPCOMING_DAYS } from "@/lib/data";
import { AgendaPanel } from "./agenda-panel";

/**
 * Agenda page (S17, T2 slice 1): the page header over the shared Lista
 * panel. The panel holds every filter, state and row — the case-detail
 * Agenda tab (T3) renders the SAME component with `caseId` pinned to the
 * route's expediente, so the two surfaces can never drift apart.
 */

export function AgendaView() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-text">Agenda</h1>
        <p className="text-base text-text-muted">
          Los próximos {UPCOMING_DAYS} días del estudio, en una sola lista.
        </p>
      </div>

      <AgendaPanel />
    </div>
  );
}
