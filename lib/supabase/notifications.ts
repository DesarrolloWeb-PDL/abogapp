/**
 * Notification functions for the `supabase` driver — browser-safe (anon key;
 * `notifications_self` RLS = user_id = auth.uid() owns the "own rows" rule).
 *
 * Vocabulary mapping: the app speaks the M1 four-value NotificationCategory,
 * the database stores the six S21 categories. The plazo alert written by
 * createPrueba uses `sistemas_judiciales`, exactly like the seed row in
 * supabase/seed.sql, and reads back as "Plazos" so the chip matches the fake
 * driver for the same event.
 */

import type { AppNotification, NotificationCategory } from "@/lib/types";
import { DataLayerError } from "@/lib/data/errors";
import { getBrowserClient } from "./client";

const NOTIFICATION_COLUMNS =
  "id, study_id, user_id, category, title, body, deep_link, read_at, created_at";

interface NotificationRow {
  id: string;
  study_id: string;
  user_id: string;
  category: string;
  title: string;
  body: string;
  deep_link: string | null;
  read_at: string | null;
  created_at: string;
}

/** App category → DB category (writes). M1 only ever writes Plazos. */
const CATEGORY_TO_DB: Record<NotificationCategory, string> = {
  Plazos: "sistemas_judiciales",
  Expedientes: "causas",
  Sistema: "sistemas_judiciales",
  Equipo: "equipo",
};

/** DB category → app category (reads): six DB buckets collapse onto four. */
const CATEGORY_FROM_DB: Record<string, NotificationCategory> = {
  sistemas_judiciales: "Plazos",
  causas: "Expedientes",
  equipo: "Equipo",
  tareas: "Sistema",
  facturacion: "Sistema",
  novedades_consejos: "Sistema",
};

/** Current user's notifications, newest first (same order as the fake). */
export async function listNotificationsSupabase(): Promise<AppNotification[]> {
  const supabase = getBrowserClient();

  const { data, error } = await supabase
    .from("notifications")
    .select(NOTIFICATION_COLUMNS)
    .order("created_at", { ascending: false });
  if (error || !data) throw new DataLayerError("save_failed");

  return (data as unknown as NotificationRow[]).map(mapNotification);
}

/**
 * Mark one notification read (S21). The `read_at is null` filter makes the
 * update flip exactly the rows the fake layer flips, and the returned flag
 * tells the facade whether to notify subscribers (no double emission when
 * it was already read or the id does not exist).
 */
export async function markNotificationReadSupabase(
  id: string,
): Promise<boolean> {
  const supabase = getBrowserClient();

  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null)
    .select("id");
  if (error) throw new DataLayerError("save_failed");

  return (data?.length ?? 0) > 0;
}

/** Unread badge count for the bell; RLS scopes the count to own rows. */
export async function unreadCountSupabase(): Promise<number> {
  const supabase = getBrowserClient();

  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error) throw new DataLayerError("save_failed");

  return count ?? 0;
}

/**
 * Insert one notification row for the signed-in user.
 *
 * No database trigger emits this alert (replica/schema.sql has triggers on
 * plazos/documents/tasks only — nothing writes notifications), so the app
 * side owns the emission exactly like the fake layer's insertNotification.
 * `dedupeKey` feeds the (user_id, dedupe_key) unique constraint so a retried
 * emission stays idempotent, the way the reminder jobs write in M2.
 *
 * Emits nothing itself: the caller fires the local listener seam, which keeps
 * this module free of a cycle back through lib/data/notifications.
 */
export async function insertNotificationSupabase(input: {
  studyId: string;
  userId: string;
  titulo: string;
  detalle: string;
  categoria: NotificationCategory;
  enlace: string | null;
  dedupeKey?: string;
}): Promise<AppNotification> {
  const supabase = getBrowserClient();

  const { data: row, error } = await supabase
    .from("notifications")
    .insert({
      study_id: input.studyId,
      user_id: input.userId,
      category: CATEGORY_TO_DB[input.categoria],
      title: input.titulo,
      body: input.detalle,
      deep_link: input.enlace,
      channel: "in_app",
      dedupe_key: input.dedupeKey ?? null,
    })
    .select(NOTIFICATION_COLUMNS)
    .single();
  if (error || !row) throw new DataLayerError("save_failed");

  return mapNotification(row as unknown as NotificationRow);
}

function mapNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    studyId: row.study_id,
    userId: row.user_id,
    titulo: row.title,
    detalle: row.body,
    categoria: CATEGORY_FROM_DB[row.category] ?? "Sistema",
    leida: row.read_at !== null,
    createdAt: row.created_at,
    enlace: row.deep_link,
  };
}
