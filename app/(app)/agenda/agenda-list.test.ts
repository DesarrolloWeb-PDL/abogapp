import { describe, expect, it } from "vitest";
import { EVENT_SOURCES, type CalendarEvent, type EventCategory } from "@/lib/data";
import {
  DEFAULT_AGENDA_FILTERS,
  SOURCE_FILTER_OPTIONS,
  SOURCE_LABELS,
  agendaSearchShortcut,
  type AgendaFilters,
  agendaFiltersActive,
  agendaLoadReducer,
  buildFilterChips,
  formatDayHeading,
  formatTimeRange,
  groupByDay,
  sourceTone,
  toEventListFilter,
  toggleValue,
} from "./agenda-list";

/**
 * Pure helpers behind the /agenda Lista view (S17, T2 slice 1): the filter
 * set + chips, the load reducer that keeps the previous list visible while
 * a refresh runs (recon: thin top bar), the day grouping and the ART time
 * formatting. Node-only (no jsdom): every function here is side-effect free,
 * and the interaction contract belongs to e2e/s17-agenda.spec.ts.
 */

/** CalendarEvent factory: only id/startAt matter, the rest fills defaults. */
function makeEvent(
  overrides: Partial<CalendarEvent> & Pick<CalendarEvent, "id" | "startAt">,
): CalendarEvent {
  const parsed = Date.parse(overrides.startAt);
  return {
    studyId: "study-1",
    caseId: null,
    caseCaratula: "",
    categoryId: null,
    category: null,
    title: `Evento ${overrides.id}`,
    endAt: Number.isNaN(parsed)
      ? "end-invalid"
      : new Date(parsed + 60 * 60 * 1000).toISOString(),
    location: "",
    notes: "",
    source: "manual",
    createdAt: "2026-11-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("agendaFiltersActive", () => {
  it("is false for the default set and for whitespace-only search", () => {
    expect(agendaFiltersActive(DEFAULT_AGENDA_FILTERS)).toBe(false);
    expect(agendaFiltersActive({ ...DEFAULT_AGENDA_FILTERS, search: "   " })).toBe(
      false,
    );
  });

  it("is true for search, a source toggle or a category selection", () => {
    expect(agendaFiltersActive({ ...DEFAULT_AGENDA_FILTERS, search: "audiencia" })).toBe(
      true,
    );
    expect(
      agendaFiltersActive({ ...DEFAULT_AGENDA_FILTERS, sources: ["audiencia"] }),
    ).toBe(true);
    expect(
      agendaFiltersActive({ ...DEFAULT_AGENDA_FILTERS, categoryIds: ["cat-1"] }),
    ).toBe(true);
  });
});

describe("toEventListFilter", () => {
  it("maps the default set to an all-open read (every criterion absent)", () => {
    expect(toEventListFilter(DEFAULT_AGENDA_FILTERS)).toEqual({
      query: undefined,
      sources: undefined,
      categoryIds: undefined,
    });
  });

  it("trims the query and keeps non-empty criterion sets", () => {
    expect(
      toEventListFilter({
        search: "  audiencia  ",
        sources: ["audiencia"],
        categoryIds: ["cat-1"],
      }),
    ).toEqual({
      query: "audiencia",
      sources: ["audiencia"],
      categoryIds: ["cat-1"],
    });
  });

  it("treats empty criterion sets as no filter (clearing shows rows)", () => {
    expect(
      toEventListFilter({ search: "", sources: [], categoryIds: [] }),
    ).toEqual({
      query: undefined,
      sources: undefined,
      categoryIds: undefined,
    });
  });
});

describe("toggleValue", () => {
  it("adds an absent value and removes a present one", () => {
    expect(toggleValue<string>([], "a")).toEqual(["a"]);
    expect(toggleValue(["a"], "a")).toEqual([]);
  });

  it("never duplicates a value", () => {
    expect(toggleValue(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleValue(toggleValue([], "a"), "a")).toEqual([]);
  });
});

describe("buildFilterChips", () => {
  const categories: EventCategory[] = [
    { id: "cat-1", name: "Laboral", color: "#123456", position: 0 },
    { id: "cat-2", name: "Civil", color: "#654321", position: 1 },
  ];

  it("returns no chips while nothing narrows the list", () => {
    expect(buildFilterChips(DEFAULT_AGENDA_FILTERS, categories)).toEqual([]);
  });

  it("builds a search chip whose removal clears only the search", () => {
    const filters: AgendaFilters = {
      search: "  audiencia  ",
      sources: ["vencimiento"],
      categoryIds: ["cat-1"],
    };
    const chips = buildFilterChips(filters, categories);
    // One chip per active criterion; the search chip is first.
    expect(chips.map((chip) => chip.key)).toEqual([
      "search",
      "source:vencimiento",
      "category:cat-1",
    ]);
    expect(chips[0].label).toBe("Búsqueda: audiencia");
    expect(chips[0].filters.search).toBe("");
    expect(chips[0].filters.sources).toEqual(["vencimiento"]);
    expect(chips[0].filters.categoryIds).toEqual(["cat-1"]);
  });

  it("builds one chip per selected source with the left-panel label", () => {
    const chips = buildFilterChips(
      { ...DEFAULT_AGENDA_FILTERS, sources: ["audiencia", "vencimiento"] },
      categories,
    );
    expect(chips.map((chip) => chip.key)).toEqual([
      "source:audiencia",
      "source:vencimiento",
    ]);
    expect(chips.map((chip) => chip.label)).toEqual([
      "Audiencias",
      "Vencimientos",
    ]);
    // Removing one source keeps the other selected.
    expect(chips[0].filters.sources).toEqual(["vencimiento"]);
  });

  it("labels category chips from the loaded categories and drops exactly one", () => {
    const chips = buildFilterChips(
      { ...DEFAULT_AGENDA_FILTERS, categoryIds: ["cat-1", "cat-2"] },
      categories,
    );
    expect(chips.map((chip) => chip.label)).toEqual(["Laboral", "Civil"]);
    expect(chips[0].filters.categoryIds).toEqual(["cat-2"]);
  });

  it("keeps a chip honest when its category no longer exists", () => {
    const chips = buildFilterChips(
      { ...DEFAULT_AGENDA_FILTERS, categoryIds: ["deleted"] },
      categories,
    );
    expect(chips).toHaveLength(1);
    expect(chips[0].label.trim()).not.toBe("");
    expect(chips[0].filters.categoryIds).toEqual([]);
  });
});

describe("agendaLoadReducer", () => {
  const events = [makeEvent({ id: "e1", startAt: "2026-11-25T13:00:00.000Z" })];

  it("stays loading until the first answer lands", () => {
    const loading = agendaLoadReducer({ status: "loading" }, { type: "load" });
    expect(loading).toEqual({ status: "loading" });
  });

  it("resolves success into a ready, non-refreshing list", () => {
    const ready = agendaLoadReducer(
      { status: "loading" },
      { type: "success", events },
    );
    expect(ready).toEqual({ status: "ready", events, refreshing: false });
  });

  it("keeps the previous list visible while a refresh runs", () => {
    const ready = { status: "ready", events, refreshing: false } as const;
    const refreshing = agendaLoadReducer(ready, { type: "load" });
    expect(refreshing.status).toBe("ready");
    if (refreshing.status !== "ready") throw new Error("unreachable");
    expect(refreshing.refreshing).toBe(true);
    // Same rows stay on screen (the thin top bar marks the pending load).
    expect(refreshing.events).toBe(events);
  });

  it("replaces the rows and clears refreshing on the new answer", () => {
    const next = [
      makeEvent({ id: "e2", startAt: "2026-11-26T13:00:00.000Z" }),
    ];
    const ready = agendaLoadReducer(
      { status: "ready", events, refreshing: true },
      { type: "success", events: next },
    );
    expect(ready).toEqual({ status: "ready", events: next, refreshing: false });
  });

  it("turns a failed read into the error state, from loading or refreshing", () => {
    expect(agendaLoadReducer({ status: "loading" }, { type: "failure" })).toEqual({
      status: "error",
    });
    expect(
      agendaLoadReducer(
        { status: "ready", events, refreshing: true },
        { type: "failure" },
      ),
    ).toEqual({ status: "error" });
  });

  it("clears the error on retry (load) and accepts a late success", () => {
    expect(agendaLoadReducer({ status: "error" }, { type: "load" })).toEqual({
      status: "loading",
    });
    expect(
      agendaLoadReducer({ status: "error" }, { type: "success", events }),
    ).toEqual({ status: "ready", events, refreshing: false });
  });
});

describe("groupByDay", () => {
  it("returns no groups for an empty list", () => {
    expect(groupByDay([])).toEqual([]);
  });

  it("groups by the ART calendar day of startAt, preserving input order", () => {
    const e1 = makeEvent({ id: "e1", startAt: "2026-11-25T13:00:00.000Z" });
    const e2 = makeEvent({ id: "e2", startAt: "2026-11-25T20:00:00.000Z" });
    const e3 = makeEvent({ id: "e3", startAt: "2026-11-26T13:00:00.000Z" });
    const groups = groupByDay([e1, e2, e3]);
    expect(groups.map((group) => group.day)).toEqual([
      "2026-11-25",
      "2026-11-26",
    ]);
    expect(groups[0].events).toEqual([e1, e2]);
    expect(groups[1].events).toEqual([e3]);
  });

  it("splits on ART midnight (an instant at 03:00Z starts its day)", () => {
    const midnight = makeEvent({
      id: "midnight",
      startAt: "2026-11-25T03:00:00.000Z",
    });
    const oneSecondBefore = makeEvent({
      id: "before",
      startAt: "2026-11-25T02:59:59.000Z",
    });
    const groups = groupByDay([midnight, oneSecondBefore]);
    expect(groups.map((group) => group.day)).toEqual([
      "2026-11-25",
      "2026-11-24",
    ]);
  });

  it("never crashes on a corrupt instant (BUG-004 discipline)", () => {
    const corrupt = makeEvent({ id: "bad", startAt: "not-a-date" });
    const groups = groupByDay([corrupt]);
    expect(groups).toHaveLength(1);
    expect(groups[0].day).toBe("");
    expect(groups[0].events).toEqual([corrupt]);
  });
});

describe("formatDayHeading", () => {
  it("renders weekday + dd/mm/yyyy deterministically", () => {
    // 2026-11-25 is a Wednesday.
    expect(formatDayHeading("2026-11-25")).toBe("Miércoles 25/11/2026");
  });

  it("degrades safely for empty or malformed days", () => {
    expect(formatDayHeading("")).toBe("Sin fecha");
    expect(formatDayHeading("not-a-date")).toBe("Sin fecha");
    expect(formatDayHeading("2026-13-01")).toBe("Sin fecha");
  });
});

describe("formatTimeRange", () => {
  it("renders the ART wall clock of both bounds", () => {
    expect(
      formatTimeRange(
        "2026-11-25T13:00:00.000Z",
        "2026-11-25T15:00:00.000Z",
      ),
    ).toBe("10:00 a 12:00");
  });

  it("marks full-day ranges (>= 24h) as Todo el día", () => {
    expect(
      formatTimeRange(
        "2026-11-25T03:00:00.000Z",
        "2026-11-26T03:00:00.000Z",
      ),
    ).toBe("Todo el día");
    // One minute short of 24h keeps the clock range.
    expect(
      formatTimeRange(
        "2026-11-25T13:00:00.000Z",
        "2026-11-26T12:59:00.000Z",
      ),
    ).toBe("10:00 a 09:59");
  });

  it("returns an em dash for unparseable instants instead of throwing", () => {
    expect(formatTimeRange("not-a-date", "2026-11-25T15:00:00.000Z")).toBe("—");
    expect(formatTimeRange("2026-11-25T13:00:00.000Z", "nope")).toBe("—");
  });
});

describe("source vocabulary", () => {
  it("labels every events.source value (check-constraint completeness)", () => {
    expect(Object.keys(SOURCE_LABELS).sort()).toEqual([...EVENT_SOURCES].sort());
    for (const source of EVENT_SOURCES) {
      expect(SOURCE_LABELS[source].trim()).not.toBe("");
    }
  });

  it("exposes exactly the two recon source overlays as filter options", () => {
    expect(SOURCE_FILTER_OPTIONS.map((option) => option.value)).toEqual([
      "audiencia",
      "vencimiento",
    ]);
    for (const option of SOURCE_FILTER_OPTIONS) {
      expect(option.label.trim()).not.toBe("");
    }
  });

  it("maps sources to badge tones without ever relying on colour alone", () => {
    expect(sourceTone("manual")).toBe("neutral");
    expect(sourceTone("audiencia")).toBe("info");
    expect(sourceTone("vencimiento")).toBe("warning");
    expect(sourceTone("dia_inhabil")).toBe("neutral");
  });
});

describe("agendaSearchShortcut", () => {
  it("matches Ctrl+K and Cmd+K, case-insensitively", () => {
    expect(agendaSearchShortcut({ key: "k", ctrlKey: true })).toBe(true);
    expect(agendaSearchShortcut({ key: "K", ctrlKey: true })).toBe(true);
    expect(agendaSearchShortcut({ key: "k", metaKey: true })).toBe(true);
    expect(
      agendaSearchShortcut({ key: "k", ctrlKey: true, metaKey: true }),
    ).toBe(true);
  });

  it("refuses plain keys and other chords", () => {
    expect(agendaSearchShortcut({ key: "k" })).toBe(false);
    expect(agendaSearchShortcut({ key: "d", ctrlKey: true })).toBe(false);
    expect(agendaSearchShortcut({ key: "j", metaKey: true })).toBe(false);
    expect(agendaSearchShortcut({ key: "Enter", ctrlKey: true })).toBe(false);
  });

  it("refuses AltGr (ctrl+alt) and Shift combinations", () => {
    expect(agendaSearchShortcut({ key: "k", ctrlKey: true, altKey: true })).toBe(
      false,
    );
    expect(
      agendaSearchShortcut({ key: "k", ctrlKey: true, shiftKey: true }),
    ).toBe(false);
    expect(
      agendaSearchShortcut({ key: "k", metaKey: true, altKey: true }),
    ).toBe(false);
  });
});
