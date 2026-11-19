import { Suspense } from "react";
import type { Metadata } from "next";
import { CaseDetailSkeleton, CaseDetailView } from "./case-detail-view";
import { resolveCaseDetailTab } from "./case-tabs";

export const metadata: Metadata = { title: "Expediente" };

/**
 * Case detail hub (S08) — the `?tab=` deep link: the raw query value is
 * validated against the tab vocabulary in `case-tabs.ts` (values are
 * documented as unknown in the recon, so the clone owns them), and an
 * unknown value falls back to Resumen instead of erroring.
 *
 * `params` and `searchParams` are Promises in Next.js 16 and, with
 * cacheComponents enabled, must be awaited inside a Suspense boundary —
 * otherwise the build fails (blocking-prerender-runtime).
 *
 * The data itself loads client-side in CaseDetailView: the fake data store
 * lives in the browser, so a server render could not see cases created
 * during this session.
 */

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

  const tab = resolveCaseDetailTab(
    typeof query.tab === "string" ? query.tab : undefined,
  );

  return <CaseDetailView id={id} tab={tab} />;
}

// Opted out of Next 16 instant-navigation validation: this segment reads
// session/runtime data at request time (migration path per docs
// authentication-with-cache-components.md — remove route by route later).
export const instant = false;
