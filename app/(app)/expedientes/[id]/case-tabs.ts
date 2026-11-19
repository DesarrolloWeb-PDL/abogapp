/**
 * Case detail hub (S08) — the tab vocabulary behind the `?tab=` deep link.
 *
 * The server page (query parsing) and the client view (nav hrefs) both
 * read this ONE module, so a tab can never be valid in one place and
 * silently fall back to Resumen in the other. Values are the clone's own:
 * the recon states the original's docs print `?tab=` in the address but
 * never print its values (recon.md "open questions").
 *
 * Order follows the recon's tab strip (Resumen → Movimientos → Actuaciones*
 * → Tareas → Pruebas → Audiencias → Agenda → Partes → Documentos →
 * Finanzas). Tabs whose data layer does not exist in the clone yet are
 * not registered here — the pending list lives in the task log, not in
 * half-wired hrefs.
 */

export const CASE_DETAIL_TABS = [
  { value: "resumen", label: "Resumen" },
  { value: "movimientos", label: "Movimientos" },
  { value: "tareas", label: "Tareas" },
  { value: "pruebas", label: "Pruebas" },
] as const;

export type CaseDetailTab = (typeof CASE_DETAIL_TABS)[number]["value"];

export const DEFAULT_CASE_DETAIL_TAB: CaseDetailTab = "resumen";

/**
 * `?tab=` → the tab to render. Missing, empty or unknown values resolve to
 * Resumen: a shared link with a stale or foreign value keeps working
 * instead of erroring (the F02-E7 contract).
 */
export function resolveCaseDetailTab(
  raw: string | undefined | null,
): CaseDetailTab {
  if (!raw) return DEFAULT_CASE_DETAIL_TAB;
  return CASE_DETAIL_TABS.some((entry) => entry.value === raw)
    ? (raw as CaseDetailTab)
    : DEFAULT_CASE_DETAIL_TAB;
}

/** Resumen is the bare URL; every other tab carries its `?tab=` value. */
export function caseDetailTabHref(caseId: string, tab: CaseDetailTab): string {
  return tab === DEFAULT_CASE_DETAIL_TAB
    ? `/expedientes/${caseId}`
    : `/expedientes/${caseId}?tab=${tab}`;
}
