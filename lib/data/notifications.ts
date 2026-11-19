/**
 * Notification functions — GET /api/notifications, PATCH /api/notifications/
 * :id/read in miniature, plus the S21 M2 slice: filtered pagination
 * (`listNotificationsPage`) and per-category preferences with the emission
 * gate that makes every insert seam respect them.
 *
 * Driver split: the fake layer filters/sorts its in-memory store; the
 * supabase driver runs the same shapes against `notifications` under the
 * `notifications_self` RLS (own rows only) — see lib/supabase/notifications.ts,
 * which also hosts the shared vocabulary/options contract re-exported here.
 * `onNotification` is the seam for Supabase Realtime (or the bell's live
 * region) once the real layer lands.
 */

import type { AppNotification } from "@/lib/types";
import { getSession } from "./auth";
import { getDataDriver } from "./driver";
import { DataLayerError } from "./errors";
import { searchMatches } from "@/lib/search";
import {
  CATEGORY_FROM_DB,
  NOTIFICATION_CATEGORIES,
  PREFERENCE_CATEGORY,
  clearInAppPreferenceCache,
  listNotificationsPageSupabase,
  listNotificationPreferencesSupabase,
  listNotificationsSupabase,
  markNotificationReadSupabase,
  normalizeNotificationPage,
  notificationMatchesEstado,
  unreadCountSupabase,
  updateNotificationPreferenceSupabase,
  type NotificationChannel,
  type NotificationEstado,
  type NotificationListOptions,
  type NotificationPage,
  type NotificationPreference,
} from "@/lib/supabase/notifications";
import { getStore, nextId } from "./store";

// The shared S21 contract: screens import everything from "@/lib/data".
export type {
  NotificationChannel,
  NotificationEstado,
  NotificationListOptions,
  NotificationPage,
  NotificationPreference,
};
export { NOTIFICATION_CATEGORIES };

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

/**
 * Called by write paths (createPrueba today, plazo-reminders later).
 * `null` = the emission gate (S21 preferences) skipped the row: nothing was
 * persisted, so there is nothing for the bell or the live region to announce.
 */
export function emitNotification(notification: AppNotification | null): void {
  if (!notification) return;
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

/**
 * S21 page (search + estado + categoria + 20-at-a-time pagination).
 *
 * Both drivers fetch the rows they already fetch for `listNotifications`
 * and apply the SAME predicates: estado on the read flag, search through
 * lib/search (accent/typo tolerant, identical on both drivers) and categoria
 * on the raw DB bucket. The fake layer stores only the four-value app
 * vocabulary, so its categoria filter maps the bucket back through
 * CATEGORY_FROM_DB — the three Sistema-side buckets (tareas, facturacion,
 * novedades_consejos) therefore answer with the same "Sistema" rows; the
 * supabase driver filters the raw column and tells them apart.
 */
export async function listNotificationsPage(
  opts: NotificationListOptions = {},
): Promise<NotificationPage> {
  if (getDataDriver() === "supabase") return listNotificationsPageSupabase(opts);

  const session = await getSession();
  if (!session) return { items: [], hasMore: false, total: 0 };

  const query = (opts.search ?? "").trim();
  const appCategory = opts.categoria
    ? CATEGORY_FROM_DB[opts.categoria]
    : undefined;

  const rows = getStore()
    .notifications.filter((entry) => entry.userId === session.user.id)
    .filter((entry) => notificationMatchesEstado(entry.leida, opts.estado))
    // Unknown bucket → no match (the UI only offers the six real ones).
    .filter((entry) => !opts.categoria || entry.categoria === appCategory)
    .filter((entry) => searchMatches(query, `${entry.titulo} ${entry.detalle}`))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const { limit, offset } = normalizeNotificationPage(opts);
  const total = rows.length;
  return {
    items: rows.slice(offset, offset + limit),
    hasMore: offset + limit < total,
    total,
  };
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

/**
 * Fake-driver preference rows, keyed `${userId}:${category}` — the in-memory
 * twin of `notification_preferences`. Module-level on purpose (like the
 * bot-settings overrides): a full page reload re-seeds it to "all on".
 */
const fakePreferences = new Map<string, { inApp: boolean; email: boolean }>();

function preferenceKey(userId: string, category: string): string {
  return `${userId}:${category}`;
}

/**
 * The six categories for the preferences modal. fake: the in-memory rows
 * (absent = migration default = on). supabase: the read path with its
 * upsert-on-missing. Both warm the driver's gate cache as a side effect.
 */
export async function listNotificationPreferences(): Promise<
  NotificationPreference[]
> {
  if (getDataDriver() === "supabase") return listNotificationPreferencesSupabase();

  const session = await getSession();
  if (!session) return [];

  return NOTIFICATION_CATEGORIES.map((category) => {
    const stored = fakePreferences.get(preferenceKey(session.user.id, category.value));
    return {
      category: category.value,
      inApp: stored?.inApp ?? true,
      email: stored?.email ?? true,
    };
  });
}

/**
 * Persist one channel of one category. Validation runs BEFORE the driver
 * switch (the bot-settings order): an unknown category/channel or a
 * non-boolean value is a typed `missing_fields` failure — errors.ts is
 * outside this unit's surfaces, so no dedicated code is added (reported).
 */
export async function updateNotificationPreference(
  category: string,
  channel: NotificationChannel,
  next: boolean,
): Promise<NotificationPreference> {
  const knownCategory = NOTIFICATION_CATEGORIES.some(
    (entry) => entry.value === category,
  );
  if (
    !knownCategory ||
    (channel !== "in_app" && channel !== "email") ||
    typeof next !== "boolean"
  ) {
    throw new DataLayerError("missing_fields");
  }

  if (getDataDriver() === "supabase") {
    return updateNotificationPreferenceSupabase(category, channel, next);
  }

  const session = await getSession();
  if (!session) throw new DataLayerError("not_signed_in");

  const key = preferenceKey(session.user.id, category);
  const stored = fakePreferences.get(key) ?? { inApp: true, email: true };
  const updated =
    channel === "in_app" ? { ...stored, inApp: next } : { ...stored, email: next };
  fakePreferences.set(key, updated);
  return { category, inApp: updated.inApp, email: updated.email };
}

/**
 * Drop every stored/cached preference answer. Test isolation and sign-out
 * hygiene: entries are keyed by user, so a stale key can never leak into
 * another account's gate.
 */
export function clearNotificationPreferenceCache(): void {
  fakePreferences.clear();
  clearInAppPreferenceCache();
}

/** Store write used by createPrueba; keeps the notification shape in one place. */
export function insertNotification(input: {
  studyId: string;
  userId: string;
  titulo: string;
  detalle: string;
  categoria: AppNotification["categoria"];
  enlace: string | null;
}): AppNotification | null {
  // Emission gate (S21): the fake seam is synchronous, so it consults the
  // in-memory rows the preferences screen writes and FAILS OPEN on a miss
  // (never stored = migration default = on). The supabase seam reads the DB
  // on a miss with the same fail-open rule.
  const stored = fakePreferences.get(
    preferenceKey(input.userId, PREFERENCE_CATEGORY[input.categoria]),
  );
  if (stored && !stored.inApp) return null;

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
