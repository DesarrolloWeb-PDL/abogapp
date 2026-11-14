"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { seedNotifications } from "@/lib/seed";
import type { AppNotification, NotificationCategory } from "@/lib/types";

/**
 * Notifications page (S21) — stub over the seed data: read-on-click with
 * deep links, mark-all-read, unread state carried by weight + dot (never
 * colour alone). The bell panel and pagination arrive with T7.
 */

const CATEGORY_TONE: Record<
  NotificationCategory,
  "neutral" | "info" | "warning" | "accent"
> = {
  Plazos: "warning",
  Expedientes: "info",
  Sistema: "neutral",
  Equipo: "accent",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function NotificacionesView() {
  const { toast } = useToast();
  const [items, setItems] = useState<AppNotification[]>(seedNotifications);
  const unread = items.filter((item) => !item.leida).length;

  function markAllRead() {
    setItems((prev) => prev.map((item) => ({ ...item, leida: true })));
    toast("Listo: marcaste todas como leídas.");
  }

  function markRead(id: string) {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, leida: true } : item)),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold text-text">Notificaciones</h1>
          <p className="text-base text-muted">
            {unread > 0
              ? `Tenés ${unread} notificaciones sin leer.`
              : "Estás al día con las novedades de tu estudio."}
          </p>
        </div>
        <Button
          variant="secondary"
          size="lg"
          onClick={markAllRead}
          disabled={unread === 0}
        >
          Marcar todas como leídas
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-12 text-center">
          <p className="text-base text-muted">
            No hay notificaciones nuevas.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const body = (
              <>
                <span className="flex items-center gap-2">
                  {!item.leida && (
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-pill bg-info"
                    />
                  )}
                  <span
                    className={
                      item.leida
                        ? "text-base font-medium text-text-muted"
                        : "text-base font-semibold text-text"
                    }
                  >
                    {item.titulo}
                  </span>
                  <span className="sr-only">
                    {item.leida ? "(leída)" : "(sin leer)"}
                  </span>
                </span>
                <span className="text-base text-muted">{item.detalle}</span>
                <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
                  <Badge tone={CATEGORY_TONE[item.categoria]}>
                    {item.categoria}
                  </Badge>
                  {formatDateTime(item.createdAt)}
                </span>
              </>
            );

            return (
              <li key={item.id}>
                {item.enlace ? (
                  <Link
                    href={item.enlace}
                    onClick={() => markRead(item.id)}
                    className="flex min-h-11 flex-col gap-1.5 rounded-lg border border-border bg-surface px-4 py-4 shadow-card hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="flex min-h-11 flex-col gap-1.5 rounded-lg border border-border bg-surface px-4 py-4 shadow-card">
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
