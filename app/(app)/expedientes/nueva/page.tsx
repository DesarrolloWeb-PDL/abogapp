import type { Metadata } from "next";
import { NuevaExpedienteForm } from "./nueva-expediente-form";

export const metadata: Metadata = { title: "Nuevo expediente" };

/**
 * Manual case creation entry point (S07). The form is a stub in T2 — the
 * real POST /api/cases wiring lands with T5.
 */
export default function NuevoExpedientePage() {
  return <NuevaExpedienteForm />;
}

// Opted out of Next 16 instant-navigation validation: this segment reads
// session/runtime data at request time (migration path per docs
// authentication-with-cache-components.md — remove route by route later).
export const instant = false;
