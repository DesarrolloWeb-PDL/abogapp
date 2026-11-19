"use client";

import { AgendaPanel } from "@/app/(app)/agenda/agenda-panel";

/**
 * Agenda tab (S08/S17): the expediente's scoped version of the studio
 * agenda, opening in Lista — the SAME panel `/agenda` renders, pinned to
 * this case through `listEventsByCase` (recon: "expediente tab Agenda =
 * scoped version (opens in Lista)"). The tab owns only its heading; every
 * filter, state and row comes from the shared panel.
 */

export function AgendaTab({ caseId }: { caseId: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-text">Agenda</h2>
      <AgendaPanel caseId={caseId} />
    </div>
  );
}
