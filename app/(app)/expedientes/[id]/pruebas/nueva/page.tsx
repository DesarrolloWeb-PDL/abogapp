import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@/components/ui/skeleton";
import { NuevaPruebaForm } from "./nueva-prueba-form";

export const metadata: Metadata = { title: "Agregar prueba" };

/**
 * Add a prueba (S12) — stub form. The live fecha límite is computed by the
 * plazos engine in the data layer (T6), never in the client, so the result
 * row only explains where the value comes from. `params` is awaited inside
 * the Suspense boundary (required with cacheComponents).
 */
export default function NuevaPruebaPage({
  params,
}: PageProps<"/expedientes/[id]/pruebas/nueva">) {
  return (
    <Suspense fallback={<PruebaFormSkeleton />}>
      <NuevaPrueba params={params} />
    </Suspense>
  );
}

function PruebaFormSkeleton() {
  return (
    <div
      className="flex flex-col gap-4"
      aria-busy="true"
      aria-label="Cargando formulario"
    >
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-11 w-40" />
    </div>
  );
}

async function NuevaPrueba({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NuevaPruebaForm caseId={id} />;
}
