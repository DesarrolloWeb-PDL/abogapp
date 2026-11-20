/**
 * Event functions for the `supabase` driver — browser-safe (anon key +
 * the `events_member` / `event_categories_member` RLS the init migration
 * creates for every table with a `study_id` tenant column).
 *
 * Transport conventions follow the movements pair: every criterion
 * PostgREST speaks (study/case pin, `[from, to)` overlap bounds, category
 * and source sets) travels as `eq`/`gt`/`lt`/`in` steps on top of
 * `idx_events_study_start`; the accent/typo search never travels — the
 * facade's shared applyEventFilters runs it on the mapped rows after the
 * fetch (cases convention). That predicate re-checks EVERY criterion, which
 * doubles as the BUG-004 guard: Postgres stores instants JS cannot parse
 * (5-digit year), and the client window drops them instead of throwing.
 *
 * Imports from the data layer are TYPE-ONLY on purpose: no value crosses
 * back into the facade, so this pair has no runtime import cycle (the
 * shared predicate lives in lib/data/events.ts and runs there).
 *
 * Embeds: `category` → event_categories (FK category_id — single FK to that
 * table, so PostgREST needs no `!fkey` hint, same as tasks' `status`), and
 * `case` → cases.caratula (fk_events_case). The study pin goes through
 * getMyStudy like listTaskStatusesSupabase: RLS answers every study I belong
 * to, while the agenda is THE study's calendar — and the composite
 * idx_events_study_start wants study_id first.
 */

import { DataLayerError } from "@/lib/data/errors";
import type {
  CalendarEvent,
  CreateEventInput,
  EventCategory,
  EventListFilter,
  EventSource,
  UpdateEventPatch,
} from "@/lib/data/events";
import { getMyStudy, requireStudy } from "@/lib/data/studies";
import { getBrowserClient } from "./client";

// --- mirror of lib/data/events.ts (see the header note) --------------------
const EVENT_SOURCES: readonly string[] = [
  "manual",
  "audiencia",
  "vencimiento",
  "dia_inhabil",
];

/** `events.title` check constraint: char_length between 1 and 300. */
const EVENT_TITLE_MAX = 300;
// -----------------------------------------------------------------------------

/**
 * Every column the agenda screens read, plus the two embeds that carry the
 * fields events store as foreign keys:
 *  - `category` → event_categories(name, color, position) — chips, dots and
 *    the category checkboxes' labels;
 *  - `case`     → cases.caratula — the expediente link and the search field.
 */
const EVENT_COLUMNS =
  "id, study_id, case_id, category_id, title, start_at, end_at, " +
  "location, notes, source, created_at, " +
  "category:event_categories(id, name, color, position), case:cases(caratula)";

interface EventRow {
  id: string;
  study_id: string;
  case_id: string | null;
  category_id: string | null;
  title: string;
  /** timestamptz as serialized (`Z` or `+00:00`) — parsed only as instant. */
  start_at: string;
  end_at: string;
  /** Nullable in practice for legacy rows; the screens read "". */
  location: string | null;
  notes: string | null;
  source: string;
  created_at: string;
  category: {
    id: string;
    name: string;
    color: string;
    position: number;
  } | null;
  case: { caratula: string } | null;
}

interface CategoryRow {
  id: string;
  name: string;
  color: string;
  position: number;
}

/**
 * Study events, chronological ascending (`idx_events_study_start`), with the
 * filter pushed to PostgREST. No implicit window here — the facade
 * (listUpcomingEvents) fills the Lista bounds before calling in, and the
 * same facade predicate re-runs every criterion on the mapped rows.
 */
export async function listEventsSupabase(
  filter?: EventListFilter,
): Promise<CalendarEvent[]> {
  // getMyStudy (not RLS alone): the agenda is THE study's calendar, and the
  // honest empty list before onboarding matches the fake branch.
  const study = await getMyStudy();
  if (!study) return [];
  const supabase = getBrowserClient();

  let query = supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("study_id", study.id);
  if (filter?.caseId) query = query.eq("case_id", filter.caseId);
  // Half-open overlap: end_at > from AND start_at < to (see the facade).
  if (filter?.from) query = query.gt("end_at", filter.from);
  if (filter?.to) query = query.lt("start_at", filter.to);
  if (filter?.categoryIds?.length) {
    query = query.in("category_id", [...filter.categoryIds]);
  }
  if (filter?.sources?.length) query = query.in("source", [...filter.sources]);
  const { data, error } = await query
    .order("start_at", { ascending: true })
    .order("created_at", { ascending: true });
  if (error || !data) throw new DataLayerError("save_failed");

  return (data as unknown as EventRow[]).map(mapEvent);
}

/**
 * The current study's categories in `position` order (S17 checkbox source).
 * getMyStudy keeps the pre-onboarding answer honestly empty, exactly like
 * listTaskStatusesSupabase / listStudioDaysSupabase.
 */
export async function listEventCategoriesSupabase(): Promise<EventCategory[]> {
  const study = await getMyStudy();
  if (!study) return [];
  const supabase = getBrowserClient();

  const { data, error } = await supabase
    .from("event_categories")
    .select("id, name, color, position")
    .eq("study_id", study.id)
    .order("position", { ascending: true });
  if (error || !data) throw new DataLayerError("save_failed");

  return (data as unknown as CategoryRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    position: row.position,
  }));
}

/* ---------------------------------------------------- T5a: mutations ------ */

/**
 * Mirror of the facade's title bound/blank check (see the header note
 * above EVENT_SOURCES): trimmed blank → missing_fields, over 300 →
 * save_failed — the init.sql `char_length between 1 and 300` check.
 */
function validateEventTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new DataLayerError("missing_fields");
  if (trimmed.length > EVENT_TITLE_MAX) throw new DataLayerError("save_failed");
  return trimmed;
}

/** Mirror of the facade's `chk_event_range` check over parseable instants. */
function validateEventRange(startAt: string, endAt: string): void {
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    throw new DataLayerError("save_failed");
  }
}

/**
 * Create a MANUAL event (T5a). Same validation order as the fake branch —
 * requireStudy, then title/range — so a typed refusal never depends on the
 * driver; the case/category FKs are left to `fk_events_case` / the category
 * FK (the composite FK rejects a foreign case with the same save_failed the
 * fake branch raises locally). The insert selects EVENT_COLUMNS, so the
 * returned row carries the same embeds the reads map (one mapper).
 */
export async function createEventSupabase(
  input: CreateEventInput,
): Promise<CalendarEvent> {
  const study = await requireStudy();
  const title = validateEventTitle(input.title);
  validateEventRange(input.startAt, input.endAt);

  const { data, error } = await getBrowserClient()
    .from("events")
    .insert({
      study_id: study.id,
      title,
      start_at: input.startAt,
      end_at: input.endAt,
      case_id: input.caseId ?? null,
      category_id: input.categoryId ?? null,
      location: input.location ?? "",
      notes: input.notes ?? "",
      source: "manual", // the form never creates derived rows
    })
    .select(EVENT_COLUMNS)
    .single();
  if (error || !data) throw new DataLayerError("save_failed");

  return mapEvent(data as unknown as EventRow);
}

/**
 * Patch a MANUAL event (T5a). Pre-read first — one round trip buys the
 * read-only guard (derived source → save_failed, no UPDATE ever sent) and
 * the current start/end/title the merged validation needs (bulkArchive
 * discipline: the WHOLE merged result validates before the single UPDATE,
 * which is the only write). Then one UPDATE pinned to id + study, selecting
 * EVENT_COLUMNS so the screen gets the mapped row back (updateTask pattern).
 */
export async function updateEventSupabase(
  id: string,
  patch: UpdateEventPatch,
): Promise<CalendarEvent> {
  // A PATCH with nothing to change is a client bug: fail before any I/O.
  if (
    patch.title === undefined &&
    patch.startAt === undefined &&
    patch.endAt === undefined &&
    patch.caseId === undefined &&
    patch.categoryId === undefined &&
    patch.location === undefined &&
    patch.notes === undefined
  ) {
    throw new DataLayerError("missing_fields");
  }

  const study = await requireStudy();
  const supabase = getBrowserClient();

  const { data: current, error: readError } = await supabase
    .from("events")
    .select("id, source, title, start_at, end_at")
    .eq("id", id)
    .eq("study_id", study.id)
    .maybeSingle();
  if (readError || !current) throw new DataLayerError("save_failed");
  const live = current as { source: string; title: string; start_at: string; end_at: string };
  if (live.source !== "manual") throw new DataLayerError("save_failed");

  // Validate the MERGED result (patch over row) before the write.
  const title =
    patch.title !== undefined ? validateEventTitle(patch.title) : live.title;
  validateEventRange(patch.startAt ?? live.start_at, patch.endAt ?? live.end_at);

  const payload: Record<string, unknown> = {};
  if (patch.title !== undefined) payload.title = title;
  if (patch.startAt !== undefined) payload.start_at = patch.startAt;
  if (patch.endAt !== undefined) payload.end_at = patch.endAt;
  if (patch.caseId !== undefined) payload.case_id = patch.caseId;
  if (patch.categoryId !== undefined) payload.category_id = patch.categoryId;
  if (patch.location !== undefined) payload.location = patch.location;
  if (patch.notes !== undefined) payload.notes = patch.notes;

  const { data, error } = await supabase
    .from("events")
    .update(payload)
    .eq("id", id)
    .eq("study_id", study.id)
    .select(EVENT_COLUMNS)
    .single();
  if (error || !data) throw new DataLayerError("save_failed");

  return mapEvent(data as unknown as EventRow);
}

/**
 * Delete a MANUAL event (T5a). Study AND source pinned on the wire: a
 * foreign id, a derived row or an unknown id deletes zero rows →
 * save_failed (removeStudioDay contract), so RLS, tenancy and the
 * read-only guard are one statement.
 */
export async function removeEventSupabase(id: string): Promise<void> {
  const study = await requireStudy();

  const { data, error } = await getBrowserClient()
    .from("events")
    .delete()
    .eq("id", id)
    .eq("study_id", study.id)
    .eq("source", "manual")
    .select("id");
  if (error || !data || data.length === 0) {
    throw new DataLayerError("save_failed");
  }
}

function mapEvent(row: EventRow): CalendarEvent {
  return {
    id: row.id,
    studyId: row.study_id,
    caseId: row.case_id,
    caseCaratula: row.case?.caratula ?? "",
    categoryId: row.category_id,
    category: row.category
      ? {
          id: row.category.id,
          name: row.category.name,
          color: row.category.color,
          position: row.category.position,
        }
      : null,
    title: row.title,
    // Raw timestamptz: never reformatted here — windows compare instants
    // (Date.parse), so a mixed `Z`/`+00:00` row can never misorder (BUG-004).
    startAt: row.start_at,
    endAt: row.end_at,
    location: row.location ?? "",
    notes: row.notes ?? "",
    source: mapSource(row.source),
    createdAt: row.created_at,
  };
}

/** `events.source` check vocabulary; a value outside it degrades to
 *  `manual` — one bad legacy row can never take a list down (BUG-004). */
function mapSource(value: string): EventSource {
  return EVENT_SOURCES.includes(value) ? (value as EventSource) : "manual";
}
