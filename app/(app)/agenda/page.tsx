import type { Metadata } from "next";
import { AgendaView } from "./agenda-view";

export const metadata: Metadata = { title: "Agenda" };

export default function AgendaPage() {
  return <AgendaView />;
}

// Opted out of Next 16 instant-navigation validation: this segment reads
// session/runtime data at request time (migration path per docs
// authentication-with-cache-components.md — remove route by route later).
export const instant = false;
