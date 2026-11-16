/**
 * Notification functions — GET /api/notifications, PATCH /api/notifications/
 * :id/read in miniature. `onNotification` is the seam for Supabase Realtime
 * (or the bell's live region) once the real layer lands.
 *
 * Driver split: the fake layer filters/sorts its in-memory store; the
 * supabase driver runs the same shapes against `notifications` under the
 * `notifications_self` RLS (own rows only) — see lib/supabase/notifications.ts.
 */

import type { AppNotification } from "@/lib/types";
import { getSession } from "./auth";
import { getDataDriver } from "./driver";
import {
  listNotificationsSupabase,
  markNotificationReadSupabase,
  unreadCountSupabase,
} from "@/lib/supabase/notifications";
import { getStore, nextId } from "./store";

type NotificationListener = (notification: AppNotification) => void;
type ChangeListener = () => void;

const listeners = new Set<NotificationListener>();
const changeListeners = new Set<ChangeListener>();

/** Subscribe to emitted notifications; returns the unsubscribe function. */
export function onNotification(
  listener: NotificationListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Subscribe to read-state changes (mark one / mark all read); returns the
 * unsubscribe function. The shell badge re-reads `unreadCount()` on every
 * emission so bell, sidebar and bottom bar stay in step with the page.
 */
export function onNotificationsChanged(listener: ChangeListener): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

function emitChange(): void {
  for (const listener of changeListeners) listener();
}

/** Called by write paths (createPrueba today, plazo-reminders later). */
export function emitNotification(notification: AppNotification): void {
  for (const listener of listeners) listener(notification);
}

/** Current user's notifications, newest first. */
export async function listNotifications(): Promise<AppNotification[]> {
  if (getDataDriver() === "supabase") return listNotificationsSupabase();

  const session = await getSession();
  if (!session) return [];

  return getStore()
    .notifications.filter((entry) => entry.userId === session.user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Mark one notification read (read-on-click deep link, S21). */
export async function markNotificationRead(id: string): Promise<void> {
  if (getDataDriver() === "supabase") {
    // The supabase branch reports whether a row actually flipped, so the
    // change listeners fire exactly once — like the fake branch's guard
    // against re-marking an already-read notification.
    const changed = await markNotificationReadSupabase(id);
    if (changed) emitChange();
    return;
  }

  const record = getStore().notifications.find((entry) => entry.id === id);
  if (!record || record.leida) return;
  record.leida = true;
  emitChange();
}

/** Unread badge count for the bell. */
export async function unreadCount(): Promise<number> {
  if (getDataDriver() === "supabase") return unreadCountSupabase();

  const session = await getSession();
  if (!session) return 0;

  return getStore().notifications.filter(
    (entry) => entry.userId === session.user.id && entry.leida === false,
  ).length;
}

/** Store write used by createPrueba; keeps the notification shape in one place. */
export function insertNotification(input: {
  studyId: string;
  userId: string;
  titulo: string;
  detalle: string;
  categoria: AppNotification["categoria"];
  enlace: string | null;
}): AppNotification {
  const notification: AppNotification = {
    id: nextId("notif"),
    studyId: input.studyId,
    userId: input.userId,
    titulo: input.titulo,
    detalle: input.detalle,
    categoria: input.categoria,
    leida: false,
    createdAt: new Date().toISOString(),
    enlace: input.enlace,
  };

  getStore().notifications.push(notification);
  emitNotification(notification);
  return notification;
}
