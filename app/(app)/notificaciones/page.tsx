import type { Metadata } from "next";
import { NotificacionesView } from "./notificaciones-view";

export const metadata: Metadata = { title: "Notificaciones" };

export default function NotificacionesPage() {
  return <NotificacionesView />;
}
