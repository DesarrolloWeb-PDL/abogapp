import { Suspense } from "react";
import type { Metadata } from "next";
import {
  CaseDetailSkeleton,
  CaseDetailView,
  type CaseDetailTab,
} from "./case-detail-view";

export const metadata: Metadata = { title: "Expediente" };

/**
 * Case detail hub (S08) — M2 slice with the Resumen + Movimientos +
 * Pruebas tabs and the `?tab=` deep link (values are documented as unknown
 * in the recon, so the clone owns its own values: `resumen` |
 * `movimientos` | `pruebas`).
 *
 * `params` and `searchParams` are Promises in Next.js 16 and, with
 * cacheComponents enabled, must be awaited inside a Suspense boundary —
 * otherwise the build fails (blocking-prerender-runtime).
 *
 * The data itself loads client-side in CaseDetailView: the fake data store
 * lives in the browser, so a server render could not see cases created
 * during this session.
 */

const TAB_VALUES = ["resumen", "movimientos", "pruebas"] as const;

export default function CaseDetailPage({
  params,
  searchParams,
}: PageProps<"/expedientes/[id]">) {
  return (
    <Suspense fallback={<CaseDetailSkeleton />}>
      <CaseDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function CaseDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const query = await searchParams;

  const rawTab = typeof query.tab === "string" ? query.tab : "resumen";
  const tab: CaseDetailTab = TAB_VALUES.some((value) => value === rawTab)
    ? (rawTab as CaseDetailTab)
    : "resumen";

  return <CaseDetailView id={id} tab={tab} />;
}

// Opted out of Next 16 instant-navigation validation: this segment reads
// session/runtime data at request time (migration path per docs
// authentication-with-cache-components.md — remove route by route later).
export const instant = false;
