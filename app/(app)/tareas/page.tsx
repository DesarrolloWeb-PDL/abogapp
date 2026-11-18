import type { Metadata } from "next";
import { TareasView } from "./tareas-view";

export const metadata: Metadata = { title: "Tareas" };

export default function TareasPage() {
  return <TareasView />;
}

// Opted out of Next 16 instant-navigation validation: this segment reads
// session/runtime data at request time (migration path per docs
// authentication-with-cache-components.md — remove route by route later).
export const instant = false;
