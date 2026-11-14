"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useUnreadCount } from "@/components/shell/use-unread-count";

/**
 * Notification bell with unread badge (components.md block 2).
 * 44x44 target, count exposed in the accessible name ("N sin leer"),
 * badge capped at "9+". The count comes from the data layer (see
 * `useUnreadCount`), so it matches what /notificaciones shows.
 */

export function NotificationBell() {
  const unread = useUnreadCount();
  const label =
    unread > 0 ? `Notificaciones, ${unread} sin leer` : "Notificaciones";

  return (
    <Link
      href="/notificaciones"
      aria-label={label}
      title="Notificaciones"
      className="relative flex size-11 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-accent-tint hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <Bell aria-hidden="true" className="size-5" />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 flex min-w-5 items-center justify-center rounded-pill bg-info px-1 text-xs font-semibold leading-5 text-on-accent"
        >
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
