import type { Metadata } from "next";
import { ConfiguracionNav } from "../section-nav";
import { EtapasView } from "./etapas-view";

export const metadata: Metadata = { title: "Etapas" };

/**
 * Etapas settings (S30): /configuracion/etapas — the ordered case-stage
 * list with move / rename / counts-as-active / delete. The section tabs
 * above keep the sidebar's single "Configuración" entry as the way in.
 */
export default function ConfiguracionEtapasPage() {
  return (
    <div className="flex flex-col gap-6">
      <ConfiguracionNav />
      <EtapasView />
    </div>
  );
}

// Opted out of Next 16 instant-navigation validation: this segment reads
// session/runtime data at request time (migration path per docs
// authentication-with-cache-components.md — remove route by route later).
export const instant = false;
