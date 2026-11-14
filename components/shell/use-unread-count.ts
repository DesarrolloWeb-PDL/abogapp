"use client";

import { useEffect, useState } from "react";
import {
  onNotification,
  onNotificationsChanged,
  unreadCount,
} from "@/lib/data";

/**
 * Unread badge count for every shell surface (bell, sidebar, bottom bar).
 *
 * The value always comes from the data layer — never from the seed — so the
 * three badges agree with /notificaciones after "Marcar todas como leídas".
 * It refreshes when a notification arrives or when any notification's read
 * state changes. Initial state is 0 on server and client alike, so the count
 * lands after hydration and never mismatches.
 */
export function useUnreadCount(): number {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      unreadCount()
        .then((count) => {
          if (!cancelled) setUnread(count);
        })
        .catch(() => {
          // A failed read keeps the last known count; the badge must not crash.
        });
    };

    refresh();
    const unsubscribeNotification = onNotification(refresh);
    const unsubscribeChanged = onNotificationsChanged(refresh);

    return () => {
      cancelled = true;
      unsubscribeNotification();
      unsubscribeChanged();
    };
  }, []);

  return unread;
}
