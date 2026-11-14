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
