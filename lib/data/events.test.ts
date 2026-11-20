import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDataStore } from "./store";

/**
 * Event contract for both drivers, fully mocked: no live project, no network.
 *
 * The seams under test:
 *  - the [from, to) OVERLAP window the agenda period views tile with, and its
 *    default "Próximos 30 días" from the current ART day (recon S17 Lista);
 *  - the one shared predicate (search / category / source / case / window)
 *    both drivers answer with, so a screen can never see driver drift;
 *  - the DB pushes in lib/supabase/events.ts (filters travel to PostgREST,
 *    search stays client-side — the movements/cases convention);
 *  - the fake seed seams that stand in for T5's deferred event CRUD.
 */

interface QueryResponse {
  data?: unknown;
  error?: { message: string } | null;
  count?: number | null;
}

interface RecordedCall {
  table: string;
  steps: Array<{ name: string; args: unknown[] }>;
}

interface MockQuery extends PromiseLike<QueryResponse> {
  select: (...args: unknown[]) => MockQuery;
  insert: (...args: unknown[]) => MockQuery;
  update: (...args: unknown[]) => MockQuery;
  delete: (...args: unknown[]) => MockQuery;
  eq: (...args: unknown[]) => MockQuery;
  gt: (...args: unknown[]) => MockQuery;
  lt: (...args: unknown[]) => MockQuery;
  in: (...args: unknown[]) => MockQuery;
  order: (...args: unknown[]) => MockQuery;
  limit: (...args: unknown[]) => MockQuery;
  single: () => PromiseLike<QueryResponse>;
  maybeSingle: () => PromiseLike<QueryResponse>;
}

const { fromMock, getUserMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  getUserMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getBrowserClient: () => ({
    from: fromMock,
    auth: { getUser: getUserMock },
  }),
}));

import {
  EVENT_SOURCES,
  EVENT_TITLE_MAX,
  UPCOMING_DAYS,
  applyEventFilters,
  compareEventsByStart,
  createEvent,
  isEventSource,
  listEventCategories,
  listEvents,
  listEventsByCase,
  listUpcomingEvents,
  removeEvent,
  resetFakeEventCategories,
  resetFakeEvents,
  seedFakeEventCategories,
  seedFakeEvents,
  upcomingEventWindow,
  updateEvent,
  type CalendarEvent,
} from "./events";
import { getSession, signUp } from "./auth";
import { createCase } from "./cases";
import { createStudy, getMyStudy } from "./studies";

const calls: RecordedCall[] = [];
const responses = new Map<string, QueryResponse[]>();

function queueResponse(table: string, response: QueryResponse): void {
  const queue = responses.get(table) ?? [];
  queue.push(response);
  responses.set(table, queue);
}

function respond(table: string): QueryResponse {
  const next = responses.get(table)?.shift();
  if (!next) throw new Error(`unexpected supabase query: ${table}`);
  return next;
}

function asSingle(response: QueryResponse): QueryResponse {
  if (Array.isArray(response.data)) {
    return { ...response, data: response.data[0] ?? null };
  }
  return response;
}

function buildQuery(call: RecordedCall): MockQuery {
  const step =
    (name: string) =>
    (...args: unknown[]) => {
      call.steps.push({ name, args });
      return query;
    };
  const query: MockQuery = {
    select: step("select"),
    insert: step("insert"),
    update: step("update"),
    delete: step("delete"),
    eq: step("eq"),
    gt: step("gt"),
    lt: step("lt"),
    in: step("in"),
    order: step("order"),
    limit: step("limit"),
    single: () => {
      call.steps.push({ name: "single", args: [] });
      return Promise.resolve(asSingle(respond(call.table)));
    },
    maybeSingle: () => {
      call.steps.push({ name: "maybeSingle", args: [] });
      return Promise.resolve(asSingle(respond(call.table)));
    },
    // PromiseLike-compatible so `await chain` resolves to QueryResponse.
    then<T1 = QueryResponse, T2 = never>(
      onFulfilled?: ((value: QueryResponse) => T1 | PromiseLike<T1>) | null,
      onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ): PromiseLike<T1 | T2> {
      return Promise.resolve(respond(call.table)).then(onFulfilled, onRejected);
    },
  };
  return query;
}

beforeEach(() => {
  // Fresh store per test: the fake-driver cases below write users/studies and
  // the module-local event/category lists must never leak between tests.
  resetDataStore();
  resetFakeEvents();
  resetFakeEventCategories();
  calls.length = 0;
  responses.clear();
  fromMock.mockReset();
  getUserMock.mockReset();
  fromMock.mockImplementation((table: string) => {
    const call: RecordedCall = { table, steps: [] };
    calls.push(call);
    return buildQuery(call);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** Membership row that makes `getMyStudy()` resolve (studies driver path). */
function queueMembership(): void {
  queueResponse("memberships", {
    data: {
      study: {
        id: "study-9",
        name: "Estudio Demo",
        plan_key: "trial",
        created_at: "2026-11-01T00:00:00.000Z",
      },
    },
    error: null,
  });
  getUserMock.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
}

/** Sign up + wizard: the fake store's study + membership path. */
async function startStudy(): Promise<void> {
  const signed = await signUp({
    fullName: "Ana Beltrán",
    email: "ana.agenda@ejemplo.test",
    password: "clave-de-prueba",
  });
  if (!signed.ok) throw new Error(`signUp failed: ${signed.error}`);
  await createStudy({ name: "Estudio Agenda", jurisdictions: ["Córdoba"] });
  const session = await getSession();
  if (!session) throw new Error("no session after signUp");
}

/** Deterministic clock for window tests: 2026-11-19 12:00 ART. */
function freezeClock(): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T15:00:00.000Z"));
}

function makeEvent(
  overrides: Partial<CalendarEvent> & Pick<CalendarEvent, "id">,
): CalendarEvent {
  return {
    studyId: "study-9",
    caseId: null,
    caseCaratula: "",
    categoryId: null,
    category: null,
    title: "Evento",
    location: "",
    notes: "",
    source: "manual",
    createdAt: "2026-11-01T10:00:00.000Z",
    // Irrelevant defaults for the predicate cases that skip them; the
    // window tests always pass explicit instants.
    startAt: "2026-11-20T12:00:00.000Z",
    endAt: "2026-11-20T13:00:00.000Z",
    ...overrides,
  };
}

describe("pure helpers", () => {
  it("upcomingEventWindow anchors on the ART day and defaults to 30 days", () => {
    const now = new Date("2026-11-19T15:00:00.000Z");
    expect(upcomingEventWindow({ now })).toEqual({
      from: "2026-11-19T03:00:00.000Z",
      to: "2026-12-19T03:00:00.000Z",
    });
    expect(UPCOMING_DAYS).toBe(30);
  });

  it("upcomingEventWindow walks days past the ART midnight boundary", () => {
    // 2026-11-19T01:30Z is still 2026-11-18 22:30 in ART (UTC−3).
    expect(upcomingEventWindow({ now: new Date("2026-11-19T01:30:00.000Z") })).toEqual({
      from: "2026-11-18T03:00:00.000Z",
      to: "2026-12-18T03:00:00.000Z",
    });
    expect(
      upcomingEventWindow({ now: new Date("2026-11-19T15:00:00.000Z"), days: 7 }),
    ).toEqual({ from: "2026-11-19T03:00:00.000Z", to: "2026-11-26T03:00:00.000Z" });
  });

  it("upcomingEventWindow clamps unusable days onto the default horizon", () => {
    const now = new Date("2026-11-19T15:00:00.000Z");
    const defaultTo = "2026-12-19T03:00:00.000Z";
    expect(upcomingEventWindow({ now, days: 0 }).to).toBe(defaultTo);
    expect(upcomingEventWindow({ now, days: -3 }).to).toBe(defaultTo);
    expect(upcomingEventWindow({ now, days: 0.9 }).to).toBe(defaultTo);
    expect(upcomingEventWindow({ now, days: Number.NaN }).to).toBe(defaultTo);
    // Fractional but usable horizons floor to whole days.
    expect(upcomingEventWindow({ now, days: 7.9 }).to).toBe(
      "2026-11-26T03:00:00.000Z",
    );
  });

  it("isEventSource only accepts the init.sql check vocabulary", () => {
    expect(EVENT_SOURCES).toEqual([
      "manual",
      "audiencia",
      "vencimiento",
      "dia_inhabil",
    ]);
    for (const source of EVENT_SOURCES) expect(isEventSource(source)).toBe(true);
    expect(isEventSource("Audiencia")).toBe(false);
    expect(isEventSource("fiesta")).toBe(false);
    expect(isEventSource("")).toBe(false);
  });

  it("applyEventFilters keeps rows overlapping [from, to) and drops boundary hits", () => {
    const inside = makeEvent({
      id: "e1",
      startAt: "2026-11-20T14:00:00.000Z",
      endAt: "2026-11-20T15:00:00.000Z",
    });
    const spanning = makeEvent({
      id: "e2",
      startAt: "2026-11-10T10:00:00.000Z",
      endAt: "2026-11-21T10:00:00.000Z",
    });
    // Half-open bounds: end == from and start == to never overlap.
    const endsAtFrom = makeEvent({
      id: "e3",
      startAt: "2026-11-19T08:00:00.000Z",
      endAt: "2026-11-20T00:00:00.000Z",
    });
    const startsAtTo = makeEvent({
      id: "e4",
      startAt: "2026-11-30T00:00:00.000Z",
      endAt: "2026-11-30T01:00:00.000Z",
    });
    const past = makeEvent({
      id: "e5",
      startAt: "2026-11-01T10:00:00.000Z",
      endAt: "2026-11-02T10:00:00.000Z",
    });

    const rows = applyEventFilters(
      [inside, spanning, endsAtFrom, startsAtTo, past],
      { from: "2026-11-20T00:00:00.000Z", to: "2026-11-30T00:00:00.000Z" },
    );
    expect(rows.map((row) => row.id)).toEqual(["e1", "e2"]);
  });

  it("applyEventFilters compares INSTANTS, not timestamp strings", () => {
    // `+00:00` rows against `Z` bounds: a string compare would misorder them.
    const row = makeEvent({
      id: "e1",
      startAt: "2026-11-19T04:00:00+00:00",
      endAt: "2026-11-19T05:00:00+00:00",
    });
    expect(
      applyEventFilters([row], {
        from: "2026-11-19T03:00:00.000Z",
        to: "2026-11-20T03:00:00.000Z",
      }),
    ).toHaveLength(1);
    // A JS-unparseable instant (the BUG-004 5-digit-year lesson) is excluded
    // from a window instead of throwing, and survives an unwindowed read.
    const corrupt = makeEvent({
      id: "e2",
      startAt: "61116-02-10T02:59:59+00:00",
      endAt: "61116-02-10T03:59:59+00:00",
    });
    expect(
      applyEventFilters([corrupt], {
        from: "2026-11-19T03:00:00.000Z",
        to: "2026-11-20T03:00:00.000Z",
      }),
    ).toEqual([]);
    expect(applyEventFilters([corrupt])).toHaveLength(1);
  });

  it("applyEventFilters runs the accent/typo-tolerant search over all text fields", () => {
    const rows = [
      makeEvent({ id: "e1", title: "Audiencia de conciliación" }),
      makeEvent({ id: "e2", location: "Palacio de Justicia, sala 12" }),
      makeEvent({ id: "e3", notes: "Presentar el escrito inicial" }),
      makeEvent({
        id: "e4",
        caseCaratula: "Gómez, Rosa c/ Empresa de Luz S.A. s/ cobro de pesos",
      }),
      makeEvent({ id: "e5", title: "Reunión de equipo" }),
    ];

    // Accent-free needle matches the accented title (BUG-003 discipline).
    expect(
      applyEventFilters(rows, { query: "conciliacion" }).map((row) => row.id),
    ).toEqual(["e1"]);
    // Typo in the last token (distance 1, >= 4 chars).
    expect(
      applyEventFilters(rows, { query: "conciliacoin" }).map((row) => row.id),
    ).toEqual(["e1"]);
    expect(
      applyEventFilters(rows, { query: "justicia" }).map((row) => row.id),
    ).toEqual(["e2"]);
    expect(
      applyEventFilters(rows, { query: "escrito" }).map((row) => row.id),
    ).toEqual(["e3"]);
    expect(
      applyEventFilters(rows, { query: "empresa de luz" }).map((row) => row.id),
    ).toEqual(["e4"]);
    expect(applyEventFilters(rows, { query: "zzzzzzzz" })).toEqual([]);
    // An empty query never narrows anything.
    expect(applyEventFilters(rows, { query: "   " })).toHaveLength(5);
  });

  it("applyEventFilters treats empty category/source criteria as no filter", () => {
    const rows = [
      makeEvent({ id: "e1", categoryId: "cat-1", source: "audiencia" }),
      makeEvent({ id: "e2", categoryId: "cat-2", source: "vencimiento" }),
      makeEvent({ id: "e3", categoryId: null, source: "manual" }),
    ];

    expect(applyEventFilters(rows, { categoryIds: [] })).toHaveLength(3);
    expect(applyEventFilters(rows, { sources: [] })).toHaveLength(3);
    expect(
      applyEventFilters(rows, { categoryIds: ["cat-1"] }).map((row) => row.id),
    ).toEqual(["e1"]);
    // NULL category never matches a concrete category filter.
    expect(
      applyEventFilters(rows, {
        categoryIds: ["cat-1", "cat-2"],
      }).map((row) => row.id),
    ).toEqual(["e1", "e2"]);
    expect(
      applyEventFilters(rows, { sources: ["vencimiento"] }).map((row) => row.id),
    ).toEqual(["e2"]);
    // Absent caseId shows every row; a concrete one narrows to the expediente.
    expect(applyEventFilters(rows)).toHaveLength(3);
    expect(
      applyEventFilters(
        [...rows, makeEvent({ id: "e4", caseId: "case-a" })],
        { caseId: "case-a" },
      ).map((row) => row.id),
    ).toEqual(["e4"]);
  });

  it("compareEventsByStart sorts chronologically with createdAt as tie-break", () => {
    const later = { startAt: "2026-11-20T18:00:00.000Z", createdAt: "2026-11-01T10:00:00.000Z" };
    const sooner = { startAt: "2026-11-20T09:00:00.000Z", createdAt: "2026-11-02T10:00:00.000Z" };
    const tiedNewer = { startAt: "2026-11-20T09:00:00.000Z", createdAt: "2026-11-03T10:00:00.000Z" };

    expect([later, tiedNewer, sooner].sort(compareEventsByStart)).toEqual([
      sooner,
      tiedNewer,
      later,
    ]);
    // A corrupt instant must never crash a sort (BUG-004 discipline).
    const corrupt = { startAt: "61116-02-10T02:59:59+00:00", createdAt: "2026-11-01T10:00:00.000Z" };
    expect(() => [corrupt, sooner].sort(compareEventsByStart)).not.toThrow();
  });
});

describe("fake driver", () => {
  it("answers honestly before onboarding and never touches the network", async () => {
    expect(await listEvents()).toEqual([]);
    expect(await listUpcomingEvents()).toEqual([]);
    expect(await listEventsByCase("case-a")).toEqual([]);
    expect(await listEventCategories()).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("seedFakeEvents refuses to write without a study or against broken rows", async () => {
    await expect(
      seedFakeEvents([
        { title: "Sin estudio", startAt: "2026-11-20T14:00:00.000Z", endAt: "2026-11-20T15:00:00.000Z" },
      ]),
    ).rejects.toMatchObject({ code: "no_study" });

    await startStudy();
    const startAt = "2026-11-20T14:00:00.000Z";
    const endAt = "2026-11-20T15:00:00.000Z";

    // Missing/blank title (the NOT NULL check) before any row lands.
    await expect(
      seedFakeEvents([{ title: "   ", startAt, endAt }]),
    ).rejects.toMatchObject({ code: "missing_fields" });
    // chk_event_range: end_at must be strictly after start_at.
    await expect(
      seedFakeEvents([
        { title: "Al revés", startAt: "2026-11-20T15:00:00.000Z", endAt: "2026-11-20T14:00:00.000Z" },
      ]),
    ).rejects.toMatchObject({ code: "save_failed" });
    await expect(
      seedFakeEvents([
        { title: "Iparseable", startAt: "ayer", endAt: "2026-11-20T15:00:00.000Z" },
      ]),
    ).rejects.toMatchObject({ code: "save_failed" });
    // Title bound mirrors char_length between 1 and 300.
    await expect(
      seedFakeEvents([
        { title: "x".repeat(EVENT_TITLE_MAX + 1), startAt, endAt },
      ]),
    ).rejects.toMatchObject({ code: "save_failed" });
    // Composite fk_events_case and the category FK reject foreign ids.
    await expect(
      seedFakeEvents([
        { title: "Caso fantasma", startAt, endAt, caseId: "case-unknown" },
      ]),
    ).rejects.toMatchObject({ code: "save_failed" });
    await expect(
      seedFakeEvents([
        { title: "Categoría fantasma", startAt, endAt, categoryId: "cat-unknown" },
      ]),
    ).rejects.toMatchObject({ code: "save_failed" });
    // chk_event_source: the check vocabulary, not free text.
    await expect(
      seedFakeEvents([
        { title: "Fuente rara", startAt, endAt, source: "fiesta" as never },
      ]),
    ).rejects.toMatchObject({ code: "save_failed" });

    // Every rejection wrote nothing.
    expect(await listEvents()).toEqual([]);
  });

  it("listEvents serves study rows chronologically, past included (no implicit window)", async () => {
    await startStudy();
    const [first] = await seedFakeEvents([
      {
        title: "Vencimiento viejo",
        startAt: "2026-10-01T14:00:00.000Z",
        endAt: "2026-10-01T15:00:00.000Z",
        source: "vencimiento",
      },
    ]);
    const [second] = await seedFakeEvents([
      {
        title: "Mismo instante",
        startAt: "2026-11-20T14:00:00.000Z",
        endAt: "2026-11-20T15:00:00.000Z",
        createdAt: "2026-11-18T10:00:00.000Z",
      },
    ]);
    const [third] = await seedFakeEvents([
      {
        title: "Mismo instante, después",
        startAt: "2026-11-20T14:00:00.000Z",
        endAt: "2026-11-20T15:00:00.000Z",
        createdAt: "2026-11-18T10:00:00.000Z",
      },
    ]);

    const rows = await listEvents();
    // start_at asc → createdAt asc → insertion order for a full tie.
    expect(rows.map((row) => row.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
    const study = await getMyStudy();
    expect(rows[0]).toMatchObject({
      studyId: study?.id,
      caseId: null,
      categoryId: null,
      category: null,
      source: "vencimiento",
      caseCaratula: "",
    });
  });

  it("listUpcomingEvents shows the 30-day ART window and respects days/bounds", async () => {
    freezeClock();
    await startStudy();
    const [today] = await seedFakeEvents([
      { title: "Hoy", startAt: "2026-11-19T18:00:00.000Z", endAt: "2026-11-19T19:00:00.000Z" },
    ]);
    const [tomorrow] = await seedFakeEvents([
      { title: "Mañana", startAt: "2026-11-20T18:00:00.000Z", endAt: "2026-11-20T19:00:00.000Z" },
    ]);
    // Started before the window but still running → overlap keeps it.
    const [running] = await seedFakeEvents([
      { title: "En curso", startAt: "2026-11-18T10:00:00.000Z", endAt: "2026-11-21T10:00:00.000Z" },
    ]);
    // Ended before today's ART start → out of the upcoming window.
    await seedFakeEvents([
      { title: "Ayer", startAt: "2026-11-18T18:00:00.000Z", endAt: "2026-11-18T19:00:00.000Z" },
    ]);
    // First day outside the horizon: 2026-11-19 + 30 = 2026-12-19 (03:00Z).
    await seedFakeEvents([
      { title: "Fuera", startAt: "2026-12-19T12:00:00.000Z", endAt: "2026-12-19T13:00:00.000Z" },
    ]);
    const [lastDay] = await seedFakeEvents([
      { title: "Último día", startAt: "2026-12-18T12:00:00.000Z", endAt: "2026-12-18T13:00:00.000Z" },
    ]);

    const rows = await listUpcomingEvents();
    expect(rows.map((row) => row.id)).toEqual([
      running.id,
      today.id,
      tomorrow.id,
      lastDay.id,
    ]);

    // A shorter horizon cuts the tail; explicit bounds override the defaults.
    const week = await listUpcomingEvents({ days: 5 });
    expect(week.map((row) => row.id)).toEqual([running.id, today.id, tomorrow.id]);
    const custom = await listUpcomingEvents({
      from: "2026-11-20T00:00:00.000Z",
      to: "2026-11-21T00:00:00.000Z",
    });
    // The running range still overlaps the explicit window (overlap, not
    // "starts inside"), and `tomorrow` falls fully within it.
    expect(custom.map((row) => row.id)).toEqual([running.id, tomorrow.id]);
  });

  it("listEventsByCase scopes to the expediente in the upcoming window", async () => {
    await startStudy();
    const kase = await createCase({ caratula: "Pérez, Juan c/ Seguros S.A. s/ daños" });
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const soonEnd = new Date(Date.now() + 7_200_000).toISOString();
    const [scoped] = await seedFakeEvents([
      { title: "Audiencia del caso", startAt: soon, endAt: soonEnd, caseId: kase.id },
    ]);
    await seedFakeEvents([
      { title: "Estudio", startAt: soon, endAt: soonEnd, caseId: null },
    ]);

    const rows = await listEventsByCase(kase.id);
    expect(rows.map((row) => row.id)).toEqual([scoped.id]);
    expect(rows[0]?.caseCaratula).toBe(kase.caratula);

    // An empty caseId is a caller bug: honest empty (see supabase suite for
    // the no-query proof — the fake branch never reaches the network anyway).
    expect(await listEventsByCase("")).toEqual([]);
  });

  it("listEvents narrows through the shared search predicate", async () => {
    await startStudy();
    const [hit] = await seedFakeEvents([
      { title: "Audiencia de conciliación", startAt: "2026-11-20T14:00:00.000Z", endAt: "2026-11-20T15:00:00.000Z" },
    ]);
    await seedFakeEvents([
      { title: "Reunión de equipo", startAt: "2026-11-21T14:00:00.000Z", endAt: "2026-11-21T15:00:00.000Z" },
    ]);

    const rows = await listEvents({ query: "conciliacion" });
    expect(rows.map((row) => row.id)).toEqual([hit.id]);
  });

  it("listEventCategories serves position-ordered copies and joins onto events", async () => {
    await startStudy();
    const categories = await seedFakeEventCategories([
      { name: "Vencimientos", color: "#f59e0b", position: 2 },
      { name: "Audiencias", color: "#ef4444", position: 1 },
    ]);

    const listed = await listEventCategories();
    expect(listed.map((row) => row.name)).toEqual(["Audiencias", "Vencimientos"]);
    // Copies: a screen mutating its view cannot corrupt the store.
    listed[0]!.name = "Alterada";
    expect((await listEventCategories())[0]?.name).toBe("Audiencias");

    // Same-study duplicate names are rejected (uq_event_categories_study_name).
    await expect(
      seedFakeEventCategories([{ name: "Audiencias" }]),
    ).rejects.toMatchObject({ code: "save_failed" });

    const [event] = await seedFakeEvents([
      {
        title: "Audiencia con categoría",
        startAt: "2026-11-20T14:00:00.000Z",
        endAt: "2026-11-20T15:00:00.000Z",
        categoryId: categories[1]!.id,
      },
    ]);
    const rows = await listEvents();
    expect(rows[0]?.id).toBe(event.id);
    expect(rows[0]?.category).toEqual({
      id: categories[1]!.id,
      name: "Audiencias",
      color: "#ef4444",
      position: 1,
    });
  });
});

describe("supabase driver", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-demo");
  });

  const EVENT_ROW = {
    id: "event-9",
    study_id: "study-9",
    case_id: "case-a",
    category_id: "cat-1",
    title: "Audiencia de conciliación",
    start_at: "2026-11-20T14:00:00+00:00",
    end_at: "2026-11-20T15:00:00+00:00",
    location: "Secretaría 4",
    notes: "Comparición personal",
    source: "audiencia",
    created_at: "2026-11-18T10:00:00.000Z",
    category: { id: "cat-1", name: "Audiencias", color: "#ef4444", position: 1 },
    case: { caratula: "Gómez, Rosa c/ Empresa de Luz S.A. s/ cobro de pesos" },
  };

  it("listEvents maps embeds, pins the study and orders chronologically", async () => {
    queueMembership();
    queueResponse("events", { data: [EVENT_ROW], error: null });

    const rows = await listEvents();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: "event-9",
      studyId: "study-9",
      caseId: "case-a",
      caseCaratula: "Gómez, Rosa c/ Empresa de Luz S.A. s/ cobro de pesos",
      categoryId: "cat-1",
      category: { id: "cat-1", name: "Audiencias", color: "#ef4444", position: 1 },
      title: "Audiencia de conciliación",
      // Raw timestamptz string: windows parse instants, never reformat.
      startAt: "2026-11-20T14:00:00+00:00",
      endAt: "2026-11-20T15:00:00+00:00",
      location: "Secretaría 4",
      notes: "Comparición personal",
      source: "audiencia",
      createdAt: "2026-11-18T10:00:00.000Z",
    });

    const read = calls.find((call) => call.table === "events");
    expect(read?.steps[0]?.args[0]).toContain("category:event_categories");
    expect(read?.steps[0]?.args[0]).toContain("case:cases(caratula)");
    expect(read?.steps).toContainEqual({ name: "eq", args: ["study_id", "study-9"] });
    expect(read?.steps).toContainEqual({
      name: "order",
      args: ["start_at", { ascending: true }],
    });
    expect(read?.steps).toContainEqual({
      name: "order",
      args: ["created_at", { ascending: true }],
    });
    // No window/case/criteria → no extra predicates on the wire.
    expect(read?.steps.filter((step) => step.name === "eq")).toHaveLength(1);
  });

  it("listEvents pushes case/window/category/source filters to PostgREST", async () => {
    queueMembership();
    queueResponse("events", { data: [], error: null });

    await listEvents({
      caseId: "case-a",
      from: "2026-11-19T03:00:00.000Z",
      to: "2026-12-19T03:00:00.000Z",
      categoryIds: ["cat-1", "cat-2"],
      sources: ["audiencia", "vencimiento"],
      query: "conciliacion",
    });

    const read = calls.find((call) => call.table === "events");
    expect(read?.steps).toContainEqual({ name: "eq", args: ["case_id", "case-a"] });
    expect(read?.steps).toContainEqual({
      name: "gt",
      args: ["end_at", "2026-11-19T03:00:00.000Z"],
    });
    expect(read?.steps).toContainEqual({
      name: "lt",
      args: ["start_at", "2026-12-19T03:00:00.000Z"],
    });
    expect(read?.steps).toContainEqual({
      name: "in",
      args: ["category_id", ["cat-1", "cat-2"]],
    });
    expect(read?.steps).toContainEqual({
      name: "in",
      args: ["source", ["audiencia", "vencimiento"]],
    });
    // The search needle never travels: it runs on the mapped rows instead.
    expect(
      read?.steps.some(
        (step) => step.name !== "select" && step.args.includes("conciliacion"),
      ),
    ).toBe(false);
  });

  it("listUpcomingEvents resolves the ART window on the wire (days never travel)", async () => {
    freezeClock();
    queueMembership();
    queueResponse("events", { data: [], error: null });

    await listUpcomingEvents({ days: 5 });

    const read = calls.find((call) => call.table === "events");
    expect(read?.steps).toContainEqual({
      name: "gt",
      args: ["end_at", "2026-11-19T03:00:00.000Z"],
    });
    expect(read?.steps).toContainEqual({
      name: "lt",
      args: ["start_at", "2026-11-24T03:00:00.000Z"],
    });
  });

  it("the facade window drops rows PostgREST accepted but JS cannot parse (BUG-004)", async () => {
    queueMembership();
    queueResponse("events", {
      data: [
        // A 5-digit year Postgres happily stores; out-of-window row for good
        // measure. The client-side predicate must drop both without throwing.
        { ...EVENT_ROW, id: "event-corrupt", start_at: "61116-02-10T02:59:59+00:00", end_at: "61116-02-10T03:59:59+00:00" },
        { ...EVENT_ROW, id: "event-old", start_at: "2020-01-05T10:00:00+00:00", end_at: "2020-01-05T11:00:00+00:00" },
      ],
      error: null,
    });

    expect(await listUpcomingEvents()).toEqual([]);

    // Without a window the same corrupt row is served, not thrown.
    queueMembership();
    queueResponse("events", {
      data: [
        { ...EVENT_ROW, start_at: "61116-02-10T02:59:59+00:00", end_at: "61116-02-10T03:59:59+00:00" },
      ],
      error: null,
    });
    const rows = await listEvents();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("event-9");
  });

  it("listEvents filters search client-side over the mapped rows", async () => {
    queueMembership();
    queueResponse("events", {
      data: [
        EVENT_ROW,
        { ...EVENT_ROW, id: "event-10", title: "Reunión de equipo" },
        // NULL embeds degrade to the honest empty values, not crashes.
        {
          ...EVENT_ROW,
          id: "event-11",
          title: "Trámite interno",
          category: null,
          case: null,
          location: null,
          notes: null,
          category_id: null,
        },
      ],
      error: null,
    });

    const rows = await listEvents({ query: "conciliacion" });
    expect(rows.map((row) => row.id)).toEqual(["event-9"]);

    queueMembership();
    queueResponse("events", {
      data: [
        { ...EVENT_ROW, id: "event-11", category: null, case: null, location: null, notes: null, category_id: null },
        // Corrupt source degrades to `manual` (the check vocabulary floor).
        { ...EVENT_ROW, id: "event-12", source: "magia" },
      ],
      error: null,
    });
    const degraded = await listEvents();
    expect(degraded[0]).toMatchObject({
      categoryId: null,
      category: null,
      caseCaratula: "",
      location: "",
      notes: "",
    });
    expect(degraded[1]?.source).toBe("manual");
  });

  it("a failed read raises the typed error the agenda error state maps", async () => {
    queueMembership();
    queueResponse("events", { data: null, error: { message: "boom" } });
    await expect(listEvents()).rejects.toMatchObject({ code: "save_failed" });

    queueMembership();
    queueResponse("event_categories", { data: null, error: { message: "boom" } });
    await expect(listEventCategories()).rejects.toMatchObject({
      code: "save_failed",
    });
  });

  it("pre-onboarding answers the honest empty list without querying", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });

    expect(await listEvents()).toEqual([]);
    expect(await listEventCategories()).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("listEventCategories maps study rows in position order", async () => {
    queueMembership();
    queueResponse("event_categories", {
      data: [
        { id: "cat-1", name: "Audiencias", color: "#ef4444", position: 1 },
        { id: "cat-2", name: "Vencimientos", color: "#f59e0b", position: 2 },
      ],
      error: null,
    });

    const categories = await listEventCategories();
    expect(categories).toEqual([
      { id: "cat-1", name: "Audiencias", color: "#ef4444", position: 1 },
      { id: "cat-2", name: "Vencimientos", color: "#f59e0b", position: 2 },
    ]);
    const read = calls.find((call) => call.table === "event_categories");
    expect(read?.steps).toContainEqual({ name: "eq", args: ["study_id", "study-9"] });
    expect(read?.steps).toContainEqual({
      name: "order",
      args: ["position", { ascending: true }],
    });
  });

  it("listEventsByCase pushes an empty caseId guard before any query", async () => {
    expect(await listEventsByCase("")).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------- T5a: event CRUD mutations ---- */

describe("event mutations (T5a)", () => {
  /** One manual `events` row as PostgREST serializes it (embeds included). */
  const MANUAL_ROW = {
    id: "event-9",
    study_id: "study-9",
    case_id: "case-a",
    category_id: "cat-1",
    title: "Audiencia de conciliación",
    start_at: "2026-11-20T14:00:00+00:00",
    end_at: "2026-11-20T15:00:00+00:00",
    location: "Secretaría 4",
    notes: "Comparición personal",
    source: "manual",
    created_at: "2026-11-18T10:00:00.000Z",
    category: { id: "cat-1", name: "Audiencias", color: "#ef4444", position: 1 },
    case: { caratula: "Gómez, Rosa c/ Empresa de Luz S.A. s/ cobro de pesos" },
  };

  it("createEvent writes a study-scoped manual row and serves it back", async () => {
    await startStudy();
    const kase = await createCase({ caratula: "Gómez, Rosa c/ Empresa de Luz S.A. s/ cobro de pesos" });

    const created = await createEvent({
      title: "  Audiencia de conciliación  ",
      startAt: "2026-11-25T14:00:00.000Z",
      endAt: "2026-11-25T15:00:00.000Z",
      caseId: kase.id,
      location: "Secretaría 4",
      notes: "Comparición personal",
    });

    // Trimmed title, always-manual source (the form never creates derived
    // rows), and the read-time joins resolved (caratula from the store).
    expect(created).toMatchObject({
      title: "Audiencia de conciliación",
      source: "manual",
      caseId: kase.id,
      caseCaratula: kase.caratula,
      location: "Secretaría 4",
      notes: "Comparición personal",
    });
    const rows = await listEvents();
    expect(rows.map((row) => row.id)).toEqual([created.id]);
  });

  it("createEvent refuses broken input before writing anything", async () => {
    await expect(
      createEvent({ title: "X", startAt: "2026-11-25T14:00:00Z", endAt: "2026-11-25T15:00:00Z" }),
    ).rejects.toMatchObject({ code: "no_study" });

    await startStudy();
    const startAt = "2026-11-25T14:00:00.000Z";
    const endAt = "2026-11-25T15:00:00.000Z";

    await expect(
      createEvent({ title: "   ", startAt, endAt }),
    ).rejects.toMatchObject({ code: "missing_fields" });
    await expect(
      createEvent({ title: "x".repeat(EVENT_TITLE_MAX + 1), startAt, endAt }),
    ).rejects.toMatchObject({ code: "save_failed" });
    await expect(
      createEvent({ title: "Al revés", startAt: endAt, endAt: startAt }),
    ).rejects.toMatchObject({ code: "save_failed" });
    await expect(
      createEvent({ title: "Iparseable", startAt: "ayer", endAt }),
    ).rejects.toMatchObject({ code: "save_failed" });
    await expect(
      createEvent({ title: "Caso fantasma", startAt, endAt, caseId: "case-unknown" }),
    ).rejects.toMatchObject({ code: "save_failed" });
    await expect(
      createEvent({ title: "Categoría fantasma", startAt, endAt, categoryId: "cat-unknown" }),
    ).rejects.toMatchObject({ code: "save_failed" });

    expect(await listEvents()).toEqual([]);
  });

  it("updateEvent patches a manual row and returns the mapped result", async () => {
    await startStudy();
    const kase = await createCase({ caratula: "Pérez, Juan c/ Constructora del Sur SRL s/ despido" });
    const [created] = await seedFakeEvents([
      {
        title: "Reunión previa",
        startAt: "2026-11-25T14:00:00.000Z",
        endAt: "2026-11-25T15:00:00.000Z",
        caseId: kase.id,
      },
    ]);

    const updated = await updateEvent(created.id, {
      title: "Reunión previa reprogramada",
      endAt: "2026-11-25T16:30:00.000Z",
      location: "Oficina 2",
      caseId: null,
    });

    expect(updated).toMatchObject({
      id: created.id,
      title: "Reunión previa reprogramada",
      endAt: "2026-11-25T16:30:00.000Z",
      location: "Oficina 2",
      caseId: null,
      caseCaratula: "",
      startAt: created.startAt, // untouched fields survive the patch
    });
    const rows = await listEvents();
    expect(rows[0]).toMatchObject({ title: "Reunión previa reprogramada" });
  });

  it("updateEvent refuses empty patches, foreign rows and non-manual sources", async () => {
    await startStudy();
    const [manual] = await seedFakeEvents([
      { title: "Manual", startAt: "2026-11-25T14:00:00.000Z", endAt: "2026-11-25T15:00:00.000Z" },
    ]);
    const [derived] = await seedFakeEvents([
      {
        title: "Del sistema",
        startAt: "2026-11-26T14:00:00.000Z",
        endAt: "2026-11-26T15:00:00.000Z",
        source: "vencimiento",
      },
    ]);

    // A PATCH with nothing to change is a client bug: no write, typed code.
    await expect(updateEvent(manual.id, {})).rejects.toMatchObject({
      code: "missing_fields",
    });
    // Unknown/foreign id and a derived (read-only) source share one refusal.
    await expect(
      updateEvent("event-unknown", { title: "Nuevo" }),
    ).rejects.toMatchObject({ code: "save_failed" });
    await expect(
      updateEvent(derived.id, { title: "Nuevo" }),
    ).rejects.toMatchObject({ code: "save_failed" });

    // Validation failures leave the row untouched.
    await expect(
      updateEvent(manual.id, { title: "  " }),
    ).rejects.toMatchObject({ code: "missing_fields" });
    await expect(
      updateEvent(manual.id, { startAt: "2026-11-26T10:00:00.000Z" }),
    ).rejects.toMatchObject({ code: "save_failed" }); // end before the new start
    await expect(
      updateEvent(manual.id, { caseId: "case-unknown" }),
    ).rejects.toMatchObject({ code: "save_failed" });

    const rows = await listEvents();
    expect(rows.map((row) => row.title).sort()).toEqual(["Del sistema", "Manual"]);
  });

  it("createEvent inserts a manual row pinned to the study (supabase)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-demo");
    queueMembership();
    queueResponse("events", { data: [MANUAL_ROW], error: null });

    const created = await createEvent({
      title: "Audiencia de conciliación",
      startAt: "2026-11-20T14:00:00+00:00",
      endAt: "2026-11-20T15:00:00+00:00",
      caseId: "case-a",
      categoryId: "cat-1",
    });

    expect(created).toMatchObject({
      id: "event-9",
      title: "Audiencia de conciliación",
      source: "manual",
      caseCaratula: "Gómez, Rosa c/ Empresa de Luz S.A. s/ cobro de pesos",
    });

    const write = calls.find(
      (call) => call.table === "events" && call.steps.some((step) => step.name === "insert"),
    );
    expect(write?.steps[0]).toEqual({
      name: "insert",
      args: [
        {
          study_id: "study-9",
          title: "Audiencia de conciliación",
          start_at: "2026-11-20T14:00:00+00:00",
          end_at: "2026-11-20T15:00:00+00:00",
          case_id: "case-a",
          category_id: "cat-1",
          location: "",
          notes: "",
          source: "manual",
        },
      ],
    });
    // The insert selects the same embeds the reads map (one mapper).
    expect(write?.steps.some((step) => step.name === "select")).toBe(true);
    expect(write?.steps.some((step) => step.name === "single")).toBe(true);
  });

  it("createEvent validates before the insert (supabase)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-demo");
    // One membership read per createEvent attempt (requireStudy runs before
    // validation in both branches — no_study outranks missing_fields).
    queueMembership();
    queueMembership();

    await expect(
      createEvent({ title: "   ", startAt: "2026-11-20T14:00:00Z", endAt: "2026-11-20T15:00:00Z" }),
    ).rejects.toMatchObject({ code: "missing_fields" });
    await expect(
      createEvent({
        title: "Al revés",
        startAt: "2026-11-20T15:00:00Z",
        endAt: "2026-11-20T14:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "save_failed" });

    expect(
      calls.some((call) => call.steps.some((step) => step.name === "insert")),
    ).toBe(false);
  });

  it("updateEvent pre-reads the row, validates merged values and sends only provided columns (supabase)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-demo");
    queueMembership();
    // Pre-read answers the current MANUAL row…
    queueResponse("events", { data: [MANUAL_ROW], error: null });
    // …then the UPDATE itself answers the mapped result.
    queueResponse("events", {
      data: [{ ...MANUAL_ROW, title: "Reunión reprogramada" }],
      error: null,
    });

    const updated = await updateEvent("event-9", { title: "Reunión reprogramada" });
    expect(updated.title).toBe("Reunión reprogramada");

    const updateWrite = calls.find(
      (call) => call.table === "events" && call.steps.some((step) => step.name === "update"),
    );
    expect(updateWrite?.steps[0]).toEqual({
      name: "update",
      args: [{ title: "Reunión reprogramada" }],
    });
    expect(updateWrite?.steps).toContainEqual({ name: "eq", args: ["id", "event-9"] });
    expect(updateWrite?.steps).toContainEqual({ name: "eq", args: ["study_id", "study-9"] });

    // The pre-read asks only for what validation needs (merged range +
    // the manual-source guard), not the full embed row.
    const read = calls.filter((call) => call.table === "events")[0];
    expect(read?.steps[0]?.args[0]).toContain("start_at");
    expect(read?.steps[0]?.args[0]).toContain("source");
  });

  it("a read-only source row never reaches an UPDATE (supabase)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-demo");
    queueMembership();
    // Pre-read answers a derived row (source = vencimiento): the write must
    // be refused before any UPDATE step is recorded.
    queueResponse("events", { data: [{ ...MANUAL_ROW, source: "vencimiento" }], error: null });

    await expect(
      updateEvent("event-9", { title: "Nuevo" }),
    ).rejects.toMatchObject({ code: "save_failed" });

    expect(
      calls.some((call) => call.steps.some((step) => step.name === "update")),
    ).toBe(false);
  });

  it("removeEvent deletes a manual study row and refuses the rest", async () => {
    await startStudy();
    const [manual] = await seedFakeEvents([
      { title: "Borrable", startAt: "2026-11-25T14:00:00.000Z", endAt: "2026-11-25T15:00:00.000Z" },
    ]);
    const [derived] = await seedFakeEvents([
      {
        title: "Del sistema",
        startAt: "2026-11-26T14:00:00.000Z",
        endAt: "2026-11-26T15:00:00.000Z",
        source: "dia_inhabil",
      },
    ]);

    await expect(removeEvent("event-unknown")).rejects.toMatchObject({
      code: "save_failed",
    });
    await expect(removeEvent(derived.id)).rejects.toMatchObject({
      code: "save_failed",
    });
    expect(await listEvents()).toHaveLength(2);

    await removeEvent(manual.id);
    const rows = await listEvents();
    expect(rows.map((row) => row.id)).toEqual([derived.id]);
  });

  it("removeEvent pins the study and the manual source on the wire (supabase)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-demo");
    queueMembership();
    queueResponse("events", { data: [{ id: "event-9" }], error: null });

    await removeEvent("event-9");

    const write = calls.find(
      (call) => call.table === "events" && call.steps.some((step) => step.name === "delete"),
    );
    expect(write?.steps).toContainEqual({ name: "eq", args: ["id", "event-9"] });
    expect(write?.steps).toContainEqual({ name: "eq", args: ["study_id", "study-9"] });
    expect(write?.steps).toContainEqual({ name: "eq", args: ["source", "manual"] });

    // Zero rows deleted (foreign/derived/unknown id) → typed refusal.
    queueMembership();
    queueResponse("events", { data: [], error: null });
    await expect(removeEvent("event-9")).rejects.toMatchObject({ code: "save_failed" });
  });
});
