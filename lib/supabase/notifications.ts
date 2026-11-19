/**
 * Notification functions for the `supabase` driver — browser-safe (anon key;
 * `notifications_self` RLS = user_id = auth.uid() owns the "own rows" rule).
 *
 * Vocabulary mapping: the app speaks the M1 four-value NotificationCategory,
 * the database stores the six S21 categories. The plazo alert written by
 * createPrueba uses `sistemas_judiciales`, exactly like the seed row in
 * supabase/seed.sql, and reads back as "Plazos" so the chip matches the fake
 * driver for the same event.
 *
 * This module also hosts the driver-agnostic S21 contract both drivers
 * share — the six-bucket vocabulary with its Spanish labels, the page/filter
 * option types and the pure predicates — because `lib/data/notifications.ts`
 * already imports from here: a reverse VALUE import would close a runtime
 * cycle, so the reverse edge stays `import type` only.
 */

import type { AppNotification, NotificationCategory } from "@/lib/types";
import { DataLayerError } from "@/lib/data/errors";
import { searchMatches } from "@/lib/search";
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
export const CATEGORY_FROM_DB: Record<string, NotificationCategory> = {
  sistemas_judiciales: "Plazos",
  causas: "Expedientes",
  equipo: "Equipo",
  tareas: "Sistema",
  facturacion: "Sistema",
  novedades_consejos: "Sistema",
};

/* ---------------------------------------------------------------------- */
/* Shared S21 contract (driver-agnostic; the facade re-exports it all so   */
/* screens import everything from "@/lib/data").                           */
/* ---------------------------------------------------------------------- */

/** Estado filter of the S21 page ("Todos los estados"). */
export type NotificationEstado = "todas" | "no_leidas" | "leidas";

/** Preference channels the schema stores (init.sql notification_preferences). */
export type NotificationChannel = "in_app" | "email";

export interface NotificationListOptions {
  /** Matches title + body through lib/search's accent/typo-tolerant matcher. */
  search?: string;
  estado?: NotificationEstado;
  /** Raw DB bucket (one of NOTIFICATION_CATEGORIES); "" or omit = todas. */
  categoria?: string;
  /** Page size; defaults to NOTIFICATIONS_PAGE_SIZE (20). */
  limit?: number;
  /** Rows to skip; 0 or omit = first page. */
  offset?: number;
}

export interface NotificationPage {
  items: AppNotification[];
  /** True when more rows exist after this slice (drives "Cargar más"). */
  hasMore: boolean;
  /** Rows matching the filters, before slicing (footer "Mostrando X de Y"). */
  total: number;
}

export interface NotificationPreference {
  /** Raw DB bucket (one of NOTIFICATION_CATEGORIES). */
  category: string;
  inApp: boolean;
  email: boolean;
}

/** Page size the S21 "Cargar más" button steps by (recon: 20 at a time). */
export const NOTIFICATIONS_PAGE_SIZE = 20;

/**
 * The six buckets `notifications.category` accepts, in recon order, with the
 * Spanish labels every surface shows (filter select + preferences modal).
 */
export const NOTIFICATION_CATEGORIES = [
  { value: "sistemas_judiciales", label: "Sistemas judiciales" },
  { value: "tareas", label: "Tareas" },
  { value: "causas", label: "Causas" },
  { value: "equipo", label: "Equipo" },
  { value: "facturacion", label: "Facturación" },
  { value: "novedades_consejos", label: "Novedades y consejos" },
] as const;

/**
 * Emitter category → the notification_preferences bucket the emission gate
 * checks (both drivers' insert seams import this). Plazos/Expedientes/Equipo
 * follow CATEGORY_TO_DB. `Sistema` maps to `tareas` instead: the F04 task
 * alert is the only M1 emitter behind that chip (supabase task rows write the
 * `tareas` bucket), so pausing "Tareas" stops exactly those alerts.
 */
export const PREFERENCE_CATEGORY: Record<NotificationCategory, string> = {
  Plazos: "sistemas_judiciales",
  Expedientes: "causas",
  Equipo: "equipo",
  Sistema: "tareas",
};

/** estado filter over an already-read flag; unknown/absent → todas. */
export function notificationMatchesEstado(
  leida: boolean,
  estado?: NotificationEstado,
): boolean {
  switch (estado) {
    case "no_leidas":
      return !leida;
    case "leidas":
      return leida;
    default:
      return true;
  }
}

/** Clamp limit/offset onto sane page bounds (default 20, floor 0). */
export function normalizeNotificationPage(opts: NotificationListOptions): {
  limit: number;
  offset: number;
} {
  const limit =
    typeof opts.limit === "number" && Number.isFinite(opts.limit) && opts.limit >= 1
      ? Math.floor(opts.limit)
      : NOTIFICATIONS_PAGE_SIZE;
  const offset =
    typeof opts.offset === "number" && Number.isFinite(opts.offset) && opts.offset >= 1
      ? Math.floor(opts.offset)
      : 0;
  return { limit, offset };
}

/* ---------------------------------------------------------------------- */
/* Reads                                                                  */
/* ---------------------------------------------------------------------- */

/** One RLS-scoped read, newest first — the shared fetch both reads use. */
async function fetchNotificationRows(): Promise<NotificationRow[]> {
  const supabase = getBrowserClient();

  const { data, error } = await supabase
    .from("notifications")
    .select(NOTIFICATION_COLUMNS)
    .order("created_at", { ascending: false });
  if (error || !data) throw new DataLayerError("save_failed");

  return data as unknown as NotificationRow[];
}

/** Current user's notifications, newest first (same order as the fake). */
export async function listNotificationsSupabase(): Promise<AppNotification[]> {
  const rows = await fetchNotificationRows();
  return rows.map(mapNotification);
}

/**
 * S21 page: filter first (estado on read_at, categoria on the raw bucket,
 * search through lib/search so typing "gomez" finds "Gómez…"), then slice
 * [offset, offset + limit). The fetch is the same read listNotifications
 * already does, so pagination costs no extra round trip and both drivers
 * share the exact same search/estado semantics.
 */
export async function listNotificationsPageSupabase(
  opts: NotificationListOptions = {},
): Promise<NotificationPage> {
  const rows = await fetchNotificationRows();
  const query = (opts.search ?? "").trim();

  const matched = rows.filter(
    (row) =>
      notificationMatchesEstado(row.read_at !== null, opts.estado) &&
      (opts.categoria === undefined ||
        opts.categoria === "" ||
        row.category === opts.categoria) &&
      searchMatches(query, `${row.title} ${row.body}`),
  );

  const { limit, offset } = normalizeNotificationPage(opts);
  const total = matched.length;
  return {
    items: matched.slice(offset, offset + limit).map(mapNotification),
    hasMore: offset + limit < total,
    total,
  };
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

/* ---------------------------------------------------------------------- */
/* Emission gate + insert                                                 */
/* ---------------------------------------------------------------------- */

/**
 * Cached in_app answers for the emission gate, keyed `${userId}:${category}`.
 * Seeded by the preferences screen's reads/writes and by the gate's own DB
 * read, so a run of emissions in one session costs zero extra queries.
 * `undefined` = never read → the gate asks the DB (and fails open on error).
 */
const inAppCache = new Map<string, boolean>();

function preferenceCacheKey(userId: string, category: string): string {
  return `${userId}:${category}`;
}

/** Record a known in_app answer (preferences write path). */
export function rememberInAppPreference(
  userId: string,
  category: string,
  enabled: boolean,
): void {
  inAppCache.set(preferenceCacheKey(userId, category), enabled);
}

/** Drop every cached gate answer (test isolation / sign-out hygiene). */
export function clearInAppPreferenceCache(): void {
  inAppCache.clear();
}

/**
 * in_app gate for one emission — the cheap short-circuit the seam needs:
 * a cache hit answers with no I/O; a miss reads the row once (RLS-scoped);
 * ANY read failure answers `true`. Fail-open is deliberate: a broken
 * preference read must never silently drop an alert the user may want.
 * Exported for the emitters that write a raw bucket themselves (the task
 * alert in lib/supabase/tasks.ts keeps `tareas` instead of mapping).
 */
export async function isInAppEnabled(
  userId: string,
  category: string,
): Promise<boolean> {
  const key = preferenceCacheKey(userId, category);
  const cached = inAppCache.get(key);
  if (cached !== undefined) return cached;

  try {
    const supabase = getBrowserClient();
    const { data, error } = await supabase
      .from("notification_preferences")
      .select("in_app")
      .eq("user_id", userId)
      .eq("category", category)
      .maybeSingle();
    if (error) return true;
    // No row yet = the migration defaults (in_app true) apply.
    const enabled = data
      ? Boolean((data as { in_app: boolean }).in_app)
      : true;
    inAppCache.set(key, enabled);
    return enabled;
  } catch {
    return true;
  }
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
 * Emission gate (S21): when the user paused this category's in-app channel
 * the insert never runs and `null` comes back — the caller's
 * `emitNotification(null)` stays silent, so an opted-out alert can never
 * surface in the list, the badge or the live region. A preference read that
 * fails opens (isInAppEnabled): a broken read must never drop an alert.
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
}): Promise<AppNotification | null> {
  const preferenceCategory = PREFERENCE_CATEGORY[input.categoria];
  if (!(await isInAppEnabled(input.userId, preferenceCategory))) {
    return null;
  }

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

/* ---------------------------------------------------------------------- */
/* Preferences (S21 "Preferencias" modal)                                 */
/* ---------------------------------------------------------------------- */

interface NotificationPreferenceRow {
  category: string;
  in_app: boolean;
  email: boolean;
}

const PREFERENCE_COLUMNS = "category, in_app, email";
const UNIQUE_VIOLATION = "23505";

function toPreference(row: NotificationPreferenceRow): NotificationPreference {
  return {
    category: row.category,
    inApp: Boolean(row.in_app),
    email: Boolean(row.email),
  };
}

/** Cache the row's in_app answer and hand the preference back. */
function rememberPreference(
  userId: string,
  row: NotificationPreferenceRow,
): NotificationPreference {
  const preference = toPreference(row);
  rememberInAppPreference(userId, row.category, preference.inApp);
  return preference;
}

/** The signed-in user for a preference read/write (RLS owns the scoping). */
async function requirePreferenceUser(): Promise<{ id: string }> {
  const supabase = getBrowserClient();
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) throw new DataLayerError("not_signed_in");
  return { id: user.id };
}

/**
 * All six categories for the modal, newest truth first:
 * upsert-on-missing (the bot_settings read pattern) — a fresh account gets
 * the migration's defaults written once, so the modal and the gate always
 * find a row. A lost race means someone wrote the SAME defaults; a real
 * insert failure still surfaces as save_failed. Every returned row warms the
 * gate cache, so the next emission in this tab needs no extra read.
 */
export async function listNotificationPreferencesSupabase(): Promise<
  NotificationPreference[]
> {
  const supabase = getBrowserClient();
  const user = await requirePreferenceUser();

  const { data, error } = await supabase
    .from("notification_preferences")
    .select(PREFERENCE_COLUMNS)
    .eq("user_id", user.id);
  if (error) throw new DataLayerError("save_failed");

  const present = new Map<string, NotificationPreferenceRow>(
    ((data ?? []) as unknown as NotificationPreferenceRow[]).map((row) => [
      row.category,
      row,
    ]),
  );
  const missing = NOTIFICATION_CATEGORIES.filter(
    (category) => !present.has(category.value),
  );
  if (missing.length > 0) {
    const { error: insertError } = await supabase
      .from("notification_preferences")
      .insert(
        missing.map((category) => ({
          user_id: user.id,
          category: category.value,
          in_app: true,
          email: true,
        })),
      );
    if (insertError && insertError.code !== UNIQUE_VIOLATION) {
      throw new DataLayerError("save_failed");
    }
  }

  return NOTIFICATION_CATEGORIES.map((category) => {
    const row = present.get(category.value);
    const preference: NotificationPreference = row
      ? toPreference(row)
      : { category: category.value, inApp: true, email: true };
    rememberInAppPreference(user.id, category.value, preference.inApp);
    return preference;
  });
}

/**
 * Persist one channel of one category. Update first, insert when the user
 * has no row yet (first save before the read's upsert, or a row removed
 * out-of-band), with the same lost-race re-read the bot_settings writer
 * uses. The caller (lib/data/notifications.ts) validates category/channel
 * before the driver switch.
 */
export async function updateNotificationPreferenceSupabase(
  category: string,
  channel: NotificationChannel,
  next: boolean,
): Promise<NotificationPreference> {
  const supabase = getBrowserClient();
  const user = await requirePreferenceUser();
  const column = channel === "in_app" ? "in_app" : "email";

  const { data, error } = await supabase
    .from("notification_preferences")
    .update({ [column]: next })
    .eq("user_id", user.id)
    .eq("category", category)
    .select(PREFERENCE_COLUMNS)
    .maybeSingle();
  if (error) throw new DataLayerError("save_failed");
  if (data) {
    return rememberPreference(
      user.id,
      data as unknown as NotificationPreferenceRow,
    );
  }

  const payload = {
    user_id: user.id,
    category,
    in_app: channel === "in_app" ? next : true,
    email: channel === "email" ? next : true,
  };
  const { data: created, error: insertError } = await supabase
    .from("notification_preferences")
    .insert(payload)
    .select(PREFERENCE_COLUMNS)
    .single();
  if (insertError) {
    if (insertError.code === UNIQUE_VIOLATION) {
      const { data: existing, error: reselectError } = await supabase
        .from("notification_preferences")
        .select(PREFERENCE_COLUMNS)
        .eq("user_id", user.id)
        .eq("category", category)
        .maybeSingle();
      if (!reselectError && existing) {
        return rememberPreference(
          user.id,
          existing as unknown as NotificationPreferenceRow,
        );
      }
    }
    throw new DataLayerError("save_failed");
  }
  if (!created) throw new DataLayerError("save_failed");
  return rememberPreference(
    user.id,
    created as unknown as NotificationPreferenceRow,
  );
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
