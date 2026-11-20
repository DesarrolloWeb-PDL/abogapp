/**
 * Event functions for the shared studio calendar (recon S17) — the ONE data
 * source behind `/agenda` (T2 Lista, T3 case-detail Agenda tab, T4 period
 * views) and the future event popovers (T5).
 *
 * Driver split: same shape as the tasks/movements pairs. The M1 store has no
 * `events` table (store.ts belongs to another unit), so the fake driver keeps
 * its rows in module-local state behind `resetFakeEvents` + the `seedFake*`
 * seams that stand in for T5's deferred event CRUD; the supabase driver runs
 * the same contract against `events` + `event_categories` under the
 * `events_member` / `event_categories_member` RLS — see lib/supabase/events.ts
 * for the query conventions.
 *
 * Window semantics — the one decision every view inherits:
 *  - a row matches a `[from, to)` window when its RANGE OVERLAPS it
 *    (`end_at > from AND start_at < to`), so adjacent periods tile without a
 *    gap or a duplicate (period nav ‹›) and a range crossing midnight
 *    renders on every covered day (week/month views later);
 *  - `listUpcomingEvents` (Lista "Próximos 30 días") fills each bound
 *    independently: `from` = current ART day start, `to` = from + `days`
 *    (default UPCOMING_DAYS = 30);
 *  - bounds and instants are compared as INSTANTS (Date.parse), never as
 *    timestamp strings: rows serialize as `Z` or `+00:00` and a string
 *    compare misorders them. The BUG-004 lesson (Postgres stores a 5-digit
 *    year JS cannot parse) means an unparseable instant never overlaps a
 *    window — dropped, never thrown;
 *  - ART = UTC−3 with no daylight saving since 2009 (calendar.ts
 *    ART_OFFSET_MS), so an ART calendar day starts at 03:00Z.
 *
 * The shared `applyEventFilters` predicate runs in THIS facade for both
 * drivers: the supabase branch pushes every criterion PostgREST speaks to
 * the wire (transport optimization on idx_events_study_start), then the
 * predicate re-checks here — one implementation, no driver drift, and no
 * runtime import cycle (lib/supabase/events.ts imports types only).
 *
 * Evidence gaps honored here (init.sql TODO(gap)): the six default category
 * names and eleven colors are NOT in the recon, so nothing in this module
 * invents them — `listEventCategories` answers whatever the study has (empty
 * until the T6 admin seeds them), and the fake layer starts empty too.
 * Event writes (T5a) are createEvent/updateEvent/removeEvent below: manual
 * rows only — derived sources (audiencia/vencimiento/dia_inhabil) are
 * read-only in the popover AND refused by both driver branches. Search runs
 * through lib/search.ts (accent/typo tolerant, the BUG-003 discipline) over
 * title/location/notes/caratula.
 *
 * Shared bounds/vocabulary are duplicated per driver on purpose (the
 * tasks/movements/pruebas pairs do the same): a value import from
 * lib/supabase/* back through the data-layer facade would close a runtime
 * import cycle.
 */

import { searchMatches } from "@/lib/search";
import { toArtIsoDate } from "./calendar";
import { DataLayerError } from "./errors";
import { getDataDriver } from "./driver";
import { getStore, isoNow } from "./store";
import { getMyStudy, requireStudy } from "./studies";
import {
  createEventSupabase,
  listEventCategoriesSupabase,
  listEventsSupabase,
  removeEventSupabase,
  updateEventSupabase,
} from "@/lib/supabase/events";

/** Recon S17 Lista label: "Próximos 30 días" — the default upcoming horizon. */
export const UPCOMING_DAYS = 30;

/** `events.title` check constraint: char_length between 1 and 300. */
export const EVENT_TITLE_MAX = 300;

/** `events.source` check-constraint vocabulary (init.sql). */
export const EVENT_SOURCES = [
  "manual",
  "audiencia",
  "vencimiento",
  "dia_inhabil",
] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

/** `event_categories.color` default (init.sql) — seeds fall back to it. */
const DEFAULT_CATEGORY_COLOR = "#64748b";

/** `event_categories.position` default (init.sql). */
const DEFAULT_CATEGORY_POSITION = 0;

/* ---------------------------------------------------------- validation --- */

/**
 * Trim + bound check for `events.title` (mirrors the init.sql
 * `char_length between 1 and 300` check): blank after trim → missing_fields
 * (the screen shows the field error), over the bound → save_failed (the
 * constraint code). Both drivers run THIS shape of validation before any
 * write — supabase/events.ts keeps its own copy, the tasks-pair convention
 * (a value import from a screen-facing module back into a driver branch
 * would close a runtime import cycle; see the header note).
 */
function validateEventTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new DataLayerError("missing_fields");
  if (trimmed.length > EVENT_TITLE_MAX) throw new DataLayerError("save_failed");
  return trimmed;
}

/**
 * `chk_event_range` over parseable instants: end strictly after start.
 * An unparseable instant fails the same way (BUG-004 discipline: never
 * trusted, never thrown to the screen — a typed code instead).
 */
function validateEventRange(startAt: string, endAt: string): void {
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    throw new DataLayerError("save_failed");
  }
}

/** One row of the study's `event_categories` (S17 category checkbox source). */
export interface EventCategory {
  id: string;
  name: string;
  /** Raw hex token as stored; the design tokens own the rendering. */
  color: string;
  position: number;
}

/** One calendar event as every agenda view renders it (recon S17). */
export interface CalendarEvent {
  id: string;
  studyId: string;
  caseId: string | null;
  /** cases.caratula of the linked expediente; "" when there is no case. */
  caseCaratula: string;
  categoryId: string | null;
  /** Embedded category for chips/dots; null when unassigned (or deleted —
   *  the FK is on delete set null, so categoryId collapses with it). */
  category: EventCategory | null;
  title: string;
  /** Raw ISO timestamptz as serialized — windows parse it as an instant. */
  startAt: string;
  endAt: string;
  location: string;
  notes: string;
  source: EventSource;
  createdAt: string;
}

/**
 * Read criteria for every agenda surface. Absent/EMPTY criteria never
 * filter (clearing a checkbox shows rows — applyCaseFilters discipline);
 * `from`/`to` are half-open overlap bounds, filled by listUpcomingEvents
 * when the caller omits them.
 */
export interface EventListFilter {
  /** Scope to one expediente (case-detail tab, top-bar "Expediente" filter). */
  caseId?: string;
  /** Window start: rows must END after it (inclusive overlap bound). */
  from?: string;
  /** Window end: rows must START before it (exclusive overlap bound). */
  to?: string;
  /** Keep only these category ids; empty/absent = no category filter. */
  categoryIds?: readonly string[];
  /** Keep only these sources; empty/absent = no source filter. */
  sources?: readonly EventSource[];
  /** Accent/typo-tolerant search (lib/search.ts) over title/location/notes/caratula. */
  query?: string;
}

/** listUpcomingEvents input: the filter plus the horizon in days. */
export interface UpcomingEventsFilter extends EventListFilter {
  /** Horizon filling a missing `to` (default UPCOMING_DAYS; unusable values clamp). */
  days?: number;
}

/** createEvent input: content only — the source is always `manual` (the
 *  form never creates derived rows; sync owns those, see EVENT_SOURCES). */
export interface CreateEventInput {
  title: string;
  startAt: string;
  endAt: string;
  caseId?: string | null;
  categoryId?: string | null;
  location?: string;
  notes?: string;
}

/** updateEvent patch: any subset of the writable columns; `null` clears
 *  the case/category link. `source` is deliberately absent — derived rows
 *  are read-only in the popover and refused by the driver. */
export interface UpdateEventPatch {
  title?: string;
  startAt?: string;
  endAt?: string;
  caseId?: string | null;
  categoryId?: string | null;
  location?: string;
  notes?: string;
}

/** True when the patch would change nothing (client bug → missing_fields). */
function isEmptyEventPatch(patch: UpdateEventPatch): boolean {
  return (
    patch.title === undefined &&
    patch.startAt === undefined &&
    patch.endAt === undefined &&
    patch.caseId === undefined &&
    patch.categoryId === undefined &&
    patch.location === undefined &&
    patch.notes === undefined
  );
}

export interface UpcomingWindowOptions {
  /** Horizon in days; non-finite or < 1 falls back to UPCOMING_DAYS. */
  days?: number;
  /** Injected clock for tests; default = now. */
  now?: Date;
}

/** Type guard for the check-constraint vocabulary. */
export function isEventSource(value: string): value is EventSource {
  return (EVENT_SOURCES as readonly string[]).includes(value);
}

/**
 * True when the row's range overlaps `[from, to)` (half-open: ending exactly
 * at `from` or starting exactly at `to` does NOT overlap). A missing bound
 * is open; an unparseable bound or instant never overlaps — the window is
 * strict on purpose, so adjacent periods can tile.
 */
function overlapsWindow(
  row: Pick<CalendarEvent, "startAt" | "endAt">,
  from?: string,
  to?: string,
): boolean {
  if (from) {
    const bound = Date.parse(from);
    const end = Date.parse(row.endAt);
    if (Number.isNaN(bound) || Number.isNaN(end) || end <= bound) return false;
  }
  if (to) {
    const bound = Date.parse(to);
    const start = Date.parse(row.startAt);
    if (Number.isNaN(bound) || Number.isNaN(start) || start >= bound) {
      return false;
    }
  }
  return true;
}

/** The haystack the agenda search folds over — the documented field set. */
function searchText(row: CalendarEvent): string {
  return [row.title, row.location, row.notes, row.caseCaratula].join(" ");
}

/**
 * The ONE predicate both drivers and the screens share (applyCaseFilters
 * discipline): window overlap first, then AND case / category / source /
 * search. Runs here for the supabase branch too — its DB pushes are only a
 * transport optimization, and this re-check is the BUG-004 guard for
 * instants Postgres accepted but JS cannot parse.
 */
export function applyEventFilters(
  events: readonly CalendarEvent[],
  filter?: EventListFilter,
): CalendarEvent[] {
  const caseId = filter?.caseId;
  const from = filter?.from;
  const to = filter?.to;
  const categoryIds = filter?.categoryIds;
  const sources = filter?.sources;
  const query = filter?.query?.trim() ?? "";

  return events.filter((row) => {
    if (!overlapsWindow(row, from, to)) return false;
    if (caseId !== undefined && row.caseId !== caseId) return false;
    if (
      categoryIds?.length &&
      (row.categoryId === null || !categoryIds.includes(row.categoryId))
    ) {
      return false;
    }
    if (sources?.length && !(sources as readonly string[]).includes(row.source)) {
      return false;
    }
    if (query && !searchMatches(query, searchText(row))) return false;
    return true;
  });
}

/**
 * Chronological comparator for the agenda (start time ascending, createdAt
 * ascending inside an instant — both drivers serve the same order).
 * A corrupt/unparseable startAt never crashes or dominates a sort
 * (BUG-004): it falls back to createdAt with every other row.
 */
export function compareEventsByStart(
  a: Pick<CalendarEvent, "startAt" | "createdAt">,
  b: Pick<CalendarEvent, "startAt" | "createdAt">,
): number {
  const at = Date.parse(a.startAt);
  const bt = Date.parse(b.startAt);
  if (!Number.isNaN(at) && !Number.isNaN(bt) && at !== bt) return at - bt;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return 0;
}

/** ART = UTC−3, no DST since 2009 (calendar.ts ART_OFFSET_MS). */
const ART_DAY_MIDNIGHT = "T00:00:00.000-03:00";

/** ISO UTC instant of an ART calendar day's midnight (`YYYY-MM-DD` → 03:00Z).
 *  Precondition: `day` is a well-formed date (toArtIsoDate/addDays output). */
function artDayStart(day: string): string {
  return new Date(`${day}${ART_DAY_MIDNIGHT}`).toISOString();
}

/** `YYYY-MM-DD` shifted by whole days (Date.UTC overflow handles 30/31/leap). */
function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + days))
    .toISOString()
    .slice(0, 10);
}

/**
 * The default Lista window: `[current ART day start, +days)`.
 * Pure and clock-injectable so tests assert exact bounds (freeze the clock,
 * not the module). `days` clamps onto UPCOMING_DAYS when unusable
 * (non-finite, Infinity, < 1) — the normalizeNotificationPage discipline.
 */
export function upcomingEventWindow(
  options?: UpcomingWindowOptions,
): { from: string; to: string } {
  const now = options?.now ?? new Date();
  const requested = options?.days;
  const days =
    typeof requested === "number" && Number.isFinite(requested) && requested >= 1
      ? Math.floor(requested)
      : UPCOMING_DAYS;
  const today = toArtIsoDate(now);
  return { from: artDayStart(today), to: artDayStart(addDays(today, days)) };
}

/* ---------------------------------------------------------------------- */
/* Fake driver: module-local rows + the seed seams standing in for T5     */
/* ---------------------------------------------------------------------- */

interface FakeEventRow {
  id: string;
  studyId: string;
  caseId: string | null;
  categoryId: string | null;
  title: string;
  startAt: string;
  endAt: string;
  location: string;
  notes: string;
  source: EventSource;
  createdAt: string;
}

interface FakeCategoryRow extends EventCategory {
  studyId: string;
}

let fakeEventRows: FakeEventRow[] = [];
let fakeEventSeq = 0;
let fakeCategoryRows: FakeCategoryRow[] = [];
let fakeCategorySeq = 0;

/** Rebuild the fake lists — test isolation, like `resetDataStore`. */
export function resetFakeEvents(): void {
  fakeEventRows = [];
  fakeEventSeq = 0;
}

export function resetFakeEventCategories(): void {
  fakeCategoryRows = [];
  fakeCategorySeq = 0;
}

/** What seedFakeEvents accepts: the row's content, ids/study resolved here. */
export interface FakeEventSeed {
  title: string;
  startAt: string;
  endAt: string;
  caseId?: string | null;
  categoryId?: string | null;
  location?: string;
  notes?: string;
  source?: EventSource;
  /** ISO createdAt; defaults to now (pass explicitly for tie-break tests). */
  createdAt?: string;
}

/** What seedFakeEventCategories accepts (DB defaults fill the gaps). */
export interface FakeEventCategorySeed {
  name: string;
  color?: string;
  position?: number;
}

/**
 * Read-time joins (caratula from the store, category from module state) so
 * a renamed expediente or category shows truthfully on the next read — the
 * embeds the supabase branch resolves live over PostgREST.
 */
function mapFakeEvent(row: FakeEventRow): CalendarEvent {
  const linked = row.caseId
    ? getStore().cases.find((entry) => entry.id === row.caseId) ?? null
    : null;
  const category = row.categoryId
    ? fakeCategoryRows.find((entry) => entry.id === row.categoryId) ?? null
    : null;
  return {
    ...row,
    caseCaratula: linked ? linked.caratula : "",
    category: category
      ? {
          id: category.id,
          name: category.name,
          color: category.color,
          position: category.position,
        }
      : null,
  };
}

/**
 * Fake-layer category seed (test/demo seam): the six evidenced defaults do
 * not exist yet (init.sql TODO(gap) — names/colors pending replica-design),
 * so nothing pre-populates this list; T6's admin owns the real writer.
 * Validates the same constraints the DB does, all rows before any write.
 */
export async function seedFakeEventCategories(
  rows: FakeEventCategorySeed[],
): Promise<EventCategory[]> {
  const study = await requireStudy();

  const validated = rows.map((input) => {
    const name = input.name.trim();
    if (!name) throw new DataLayerError("missing_fields");
    // uq_event_categories_study_name: same-study duplicates rejected.
    if (
      fakeCategoryRows.some(
        (row) => row.studyId === study.id && row.name === name,
      )
    ) {
      throw new DataLayerError("save_failed");
    }
    return {
      name,
      color: input.color ?? DEFAULT_CATEGORY_COLOR,
      position: input.position ?? DEFAULT_CATEGORY_POSITION,
    };
  });

  const created: EventCategory[] = [];
  for (const row of validated) {
    const stored: FakeCategoryRow = {
      id: `event-category-${(fakeCategorySeq += 1)}`,
      studyId: study.id,
      ...row,
    };
    fakeCategoryRows.push(stored);
    created.push({
      id: stored.id,
      name: stored.name,
      color: stored.color,
      position: stored.position,
    });
  }
  return created;
}

/**
 * Fake-layer event seed (test/demo seam standing in for T5's createEvent):
 * validates EVERY row before writing anything (bulkArchive discipline — a
 * bad row never half-applies), mirroring the init.sql constraints with the
 * same typed codes both drivers use.
 */
export async function seedFakeEvents(
  rows: FakeEventSeed[],
): Promise<CalendarEvent[]> {
  const study = await requireStudy();

  const validated = rows.map((input) => {
    const title = input.title.trim();
    if (!title) throw new DataLayerError("missing_fields");
    if (title.length > EVENT_TITLE_MAX) throw new DataLayerError("save_failed");
    const start = Date.parse(input.startAt);
    const end = Date.parse(input.endAt);
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
      throw new DataLayerError("save_failed"); // chk_event_range + sane instants
    }
    const source = input.source ?? "manual";
    if (!isEventSource(source)) throw new DataLayerError("save_failed");
    const caseId = input.caseId ?? null;
    if (
      caseId !== null &&
      !getStore().cases.some(
        (row) => row.id === caseId && row.studyId === study.id,
      )
    ) {
      throw new DataLayerError("save_failed"); // mirrors fk_events_case
    }
    const categoryId = input.categoryId ?? null;
    if (categoryId !== null && !fakeCategoryRows.some((row) => row.id === categoryId)) {
      throw new DataLayerError("save_failed"); // mirrors the category FK
    }
    return { ...input, title, source, caseId, categoryId };
  });

  const created: CalendarEvent[] = [];
  for (const row of validated) {
    const stored: FakeEventRow = {
      id: `event-${(fakeEventSeq += 1)}`,
      studyId: study.id,
      caseId: row.caseId,
      categoryId: row.categoryId,
      title: row.title,
      startAt: row.startAt,
      endAt: row.endAt,
      location: row.location ?? "",
      notes: row.notes ?? "",
      source: row.source,
      createdAt: row.createdAt ?? isoNow(),
    };
    fakeEventRows.push(stored);
    created.push(mapFakeEvent(stored));
  }
  return created;
}

/* ---------------------------------------------------------------------- */
/* Reads (both drivers)                                                   */
/* ---------------------------------------------------------------------- */

/**
 * Study events, chronological ascending, with NO implicit window — callers
 * that want the Lista horizon ask for it (listUpcomingEvents) or pass their
 * own period bounds (Día/Semana/Mes/Año later). Every filter runs through
 * the shared predicate after either transport, so the drivers can never
 * answer differently.
 */
export async function listEvents(filter?: EventListFilter): Promise<CalendarEvent[]> {
  let rows: CalendarEvent[];
  if (getDataDriver() === "supabase") {
    rows = await listEventsSupabase(filter);
  } else {
    const study = await getMyStudy();
    rows = study
      ? fakeEventRows
          .filter((row) => row.studyId === study.id)
          .map(mapFakeEvent)
      : [];
  }
  return applyEventFilters(rows, filter).sort(
    (a, b) => compareEventsByStart(a, b) || seqOf(a.id) - seqOf(b.id),
  );
}

/**
 * The Lista window: upcoming events from the current ART day through
 * `days` ahead (recon S17 "Próximos 30 días"). Each bound fills
 * independently — an explicit `from`/`to` from the caller wins, `days` only
 * supplies what is missing and never reaches the transport.
 */
export async function listUpcomingEvents(
  filter?: UpcomingEventsFilter,
): Promise<CalendarEvent[]> {
  const window = upcomingEventWindow({ days: filter?.days });
  return listEvents({
    ...filter,
    from: filter?.from ?? window.from,
    to: filter?.to ?? window.to,
  });
}

/**
 * One expediente's agenda (S08/S17: the case tab is the scoped version of
 * the same view, opening in Lista) — same upcoming window, pinned to the
 * case. An empty caseId is a caller bug: honest empty before any I/O.
 */
export async function listEventsByCase(
  caseId: string,
  filter?: UpcomingEventsFilter,
): Promise<CalendarEvent[]> {
  if (!caseId) return [];
  return listUpcomingEvents({ ...filter, caseId });
}

/**
 * The study's categories in `position` order — the S17 checkbox source and
 * the color source for dots/chips. Honest empty before onboarding (and until
 * T6 seeds the evidenced defaults): this module never invents them.
 */
export async function listEventCategories(): Promise<EventCategory[]> {
  if (getDataDriver() === "supabase") return listEventCategoriesSupabase();

  const study = await getMyStudy();
  if (!study) return [];
  return fakeCategoryRows
    .filter((row) => row.studyId === study.id)
    .sort((a, b) => a.position - b.position) // stable: equal positions keep insertion order
    .map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      position: row.position,
    }));
}

/**
 * Create a manual event (T5a: the "Nuevo evento" form and Duplicar).
 * Validation runs BEFORE any write in both branches (tasks discipline):
 * trimmed title inside the check bound, a sane `end > start` range, and the
 * two FKs — case study-scoped, category existing. The supabase branch
 * mirrors this order itself (its copy lives in lib/supabase/events.ts).
 */
export async function createEvent(input: CreateEventInput): Promise<CalendarEvent> {
  if (getDataDriver() === "supabase") return createEventSupabase(input);

  const study = await requireStudy();
  const title = validateEventTitle(input.title);
  validateEventRange(input.startAt, input.endAt);

  const caseId = input.caseId ?? null;
  if (
    caseId !== null &&
    !getStore().cases.some(
      (row) => row.id === caseId && row.studyId === study.id,
    )
  ) {
    throw new DataLayerError("save_failed"); // mirrors fk_events_case
  }
  const categoryId = input.categoryId ?? null;
  if (categoryId !== null && !fakeCategoryRows.some((row) => row.id === categoryId)) {
    throw new DataLayerError("save_failed"); // mirrors the category FK
  }

  const stored: FakeEventRow = {
    id: `event-${(fakeEventSeq += 1)}`,
    studyId: study.id,
    caseId,
    categoryId,
    title,
    startAt: input.startAt,
    endAt: input.endAt,
    location: input.location ?? "",
    notes: input.notes ?? "",
    source: "manual", // the form never creates derived rows
    createdAt: isoNow(),
  };
  fakeEventRows.push(stored);
  return mapFakeEvent(stored);
}

/**
 * Patch a MANUAL event (T5a "Editar" / "Cambiar color"). Derived rows
 * (audiencia/vencimiento/dia_inhabil) are read-only at the driver level,
 * not just in the popover: a stale screen can never desync them from their
 * origin rows. The whole merged result validates before anything is written
 * (bulkArchive discipline) — the supabase branch pre-reads for the same
 * reasons (manual guard + merged range).
 */
export async function updateEvent(
  id: string,
  patch: UpdateEventPatch,
): Promise<CalendarEvent> {
  if (getDataDriver() === "supabase") return updateEventSupabase(id, patch);

  // A PATCH with nothing to change is a client bug: fail before any I/O.
  if (isEmptyEventPatch(patch)) throw new DataLayerError("missing_fields");

  const study = await requireStudy();
  const row = fakeEventRows.find(
    (entry) => entry.id === id && entry.studyId === study.id,
  );
  if (!row) throw new DataLayerError("save_failed");
  if (row.source !== "manual") throw new DataLayerError("save_failed");

  // Validate the MERGED result (patch over row) before touching the row.
  const title =
    patch.title !== undefined ? validateEventTitle(patch.title) : row.title;
  const startAt = patch.startAt ?? row.startAt;
  const endAt = patch.endAt ?? row.endAt;
  validateEventRange(startAt, endAt);
  const caseId = patch.caseId !== undefined ? patch.caseId : row.caseId;
  if (
    caseId !== null &&
    !getStore().cases.some(
      (entry) => entry.id === caseId && entry.studyId === study.id,
    )
  ) {
    throw new DataLayerError("save_failed");
  }
  const categoryId =
    patch.categoryId !== undefined ? patch.categoryId : row.categoryId;
  if (
    categoryId !== null &&
    !fakeCategoryRows.some((entry) => entry.id === categoryId)
  ) {
    throw new DataLayerError("save_failed");
  }

  row.title = title;
  row.startAt = startAt;
  row.endAt = endAt;
  row.caseId = caseId;
  row.categoryId = categoryId;
  if (patch.location !== undefined) row.location = patch.location;
  if (patch.notes !== undefined) row.notes = patch.notes;
  return mapFakeEvent(row);
}

/**
 * Delete a MANUAL event (T5a "Eliminar", behind the confirm dialog).
 * The same read-only guard as updateEvent: derived rows stay with their
 * origin. Zero rows matched (unknown/foreign/derived) → save_failed, the
 * removeStudioDay contract; the supabase branch pins study + source on the
 * wire so RLS and the guard are one statement.
 */
export async function removeEvent(id: string): Promise<void> {
  if (getDataDriver() === "supabase") return removeEventSupabase(id);

  const study = await requireStudy();
  const index = fakeEventRows.findIndex(
    (entry) => entry.id === id && entry.studyId === study.id,
  );
  if (index === -1) throw new DataLayerError("save_failed");
  if (fakeEventRows[index].source !== "manual") {
    throw new DataLayerError("save_failed");
  }
  fakeEventRows.splice(index, 1);
}

/** Insertion order behind a full tie: fake ids are `event-{n}`; uuids score 0. */
function seqOf(id: string): number {
  const match = /^event-(\d+)$/.exec(id);
  return match ? Number(match[1]) : 0;
}
