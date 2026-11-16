import type { Metadata } from "next";
import { ExpedientesView } from "./expedientes-view";

export const metadata: Metadata = { title: "Expedientes" };

export default function ExpedientesPage() {
  return <ExpedientesView />;
}

// Opted out of Next 16 instant-navigation validation: this segment reads
// session/runtime data at request time (migration path per docs
// authentication-with-cache-components.md — remove route by route later).
export const instant = false;
