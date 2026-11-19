import type { Metadata } from "next";
import { ConfiguracionNav } from "../section-nav";
import { DiasInhabilesView } from "./dias-inhabiles-view";

export const metadata: Metadata = { title: "Días inhábiles" };

/**
 * Días inhábiles settings (S30): /configuracion/dias-inhabiles — the
 * read-only system group plus the study's own non-working days. The
 * section tabs above keep the sidebar's single "Configuración" entry as
 * the way in.
 */
export default function ConfiguracionDiasInhabilesPage() {
  return (
    <div className="flex flex-col gap-6">
      <ConfiguracionNav />
      <DiasInhabilesView />
    </div>
  );
}

// Opted out of Next 16 instant-navigation validation: this segment reads
// session/runtime data at request time (migration path per docs
// authentication-with-cache-components.md — remove route by route later).
export const instant = false;
