import type { Metadata } from "next";
import { ExpedientesView } from "./expedientes-view";

export const metadata: Metadata = { title: "Expedientes" };

export default function ExpedientesPage() {
  return <ExpedientesView />;
}
