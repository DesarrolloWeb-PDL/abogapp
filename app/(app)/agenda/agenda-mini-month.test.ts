import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/data";
import { agendaMonthGrid, agendaPeriodWindow } from "./agenda-periods";
import { DEFAULT_AGENDA_FILTERS, type AgendaFilters } from "./agenda-list";
import {
  MINI_MONTH_MAX_DOTS,
  MINI_WEEKDAY_HEADERS,
  buildMiniMonth,
  miniMonthEventFilter,
  miniMonthMoveFocus,
} from "./agenda-mini-month";

/**
 * Pure helpers behind the T5b left panel's mini-month (S17): cell layout +
 * dot/hatch derivation, the roving-focus arrow map, and the dot-fetch
 * criteria (filter wiring into the month window). Node-only (no jsdom):
 * every function here is side-effect free, and the interaction contract
 * travels to e2e/s17-agenda.spec.ts.
 */

/** CalendarEvent factory: only the fields the mini-month logic reads matter. */
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

/** An EventCategory row for the dot-colour tests. */
function makeCategory(id: string, color: string) {
  return { id, name: `Cat ${id}`, color, position: 0 };
}

describe("buildMiniMonth", () => {
  const anchor = "2026-11-15";
  const baseOptions = {
    today: "2026-11-20",
    toggles: { weekends: true, nonWorkingDays: true },
    nonWorkingDays: new Set<string>(),
  };

  it("lays out 42 cells starting on the Monday on/before the 1st", () => {
    const cells = buildMiniMonth(anchor, [], baseOptions);
    expect(cells).toHaveLength(42);
    expect(cells[0].day).toBe("2026-10-26"); // Monday
    expect(cells[6].day).toBe("2026-11-01");
    expect(cells.filter((cell) => cell.inMonth)).toHaveLength(30);
    expect(cells[0].inMonth).toBe(false);
    expect(cells[6].inMonth).toBe(true);
  });

  it("returns no cells for an invalid anchor", () => {
    expect(buildMiniMonth("nope", [], baseOptions)).toEqual([]);
  });

  it("marks the configured today", () => {
    const cells = buildMiniMonth(anchor, [], baseOptions);
    const todayCells = cells.filter((cell) => cell.isToday);
    expect(todayCells).toHaveLength(1);
    expect(todayCells[0].day).toBe("2026-11-20");
  });

  it("shades Saturdays only while the weekend toggle is on", () => {
    const saturday = "2026-11-28";
    const on = buildMiniMonth(anchor, [], baseOptions);
    expect(on.find((cell) => cell.day === saturday)?.weekendShaded).toBe(true);

    const off = buildMiniMonth(anchor, [], {
      ...baseOptions,
      toggles: { weekends: false, nonWorkingDays: true },
    });
    expect(off.find((cell) => cell.day === saturday)?.weekendShaded).toBe(false);
  });

  it("never shades a weekday", () => {
    const cells = buildMiniMonth(anchor, [], baseOptions);
    expect(cells.find((cell) => cell.day === "2026-11-25")?.weekendShaded).toBe(
      false,
    );
  });

  it("hatches dated non-working days only while the toggle is on", () => {
    const studioDay = "2026-11-25";
    const nonWorkingDays = new Set([studioDay]);

    const on = buildMiniMonth(anchor, [], { ...baseOptions, nonWorkingDays });
    expect(on.find((cell) => cell.day === studioDay)?.hatched).toBe(true);

    const off = buildMiniMonth(anchor, [], {
      ...baseOptions,
      nonWorkingDays,
      toggles: { weekends: true, nonWorkingDays: false },
    });
    expect(off.find((cell) => cell.day === studioDay)?.hatched).toBe(false);
  });

  it("never hatches days outside the non-working set", () => {
    const nonWorkingDays = new Set(["2026-11-25"]);
    const cells = buildMiniMonth(anchor, [], { ...baseOptions, nonWorkingDays });
    expect(cells.find((cell) => cell.day === "2026-11-20")?.hatched).toBe(false);
  });

  it("derives one dot per distinct colour and caps them", () => {
    const red = makeCategory("cat-red", "#aa1111");
    const blue = makeCategory("cat-blue", "#1111aa");
    const events = [
      makeEvent({
        id: "e1",
        startAt: "2026-11-20T14:00:00.000-03:00",
        categoryId: red.id,
        category: red,
      }),
      makeEvent({
        id: "e2",
        startAt: "2026-11-20T15:00:00.000-03:00",
        categoryId: red.id,
        category: red,
      }),
      makeEvent({
        id: "e3",
        startAt: "2026-11-20T16:00:00.000-03:00",
        categoryId: blue.id,
        category: blue,
      }),
    ];
    const day = buildMiniMonth(anchor, events, baseOptions).find(
      (cell) => cell.day === "2026-11-20",
    );
    expect(day?.dotColors).toEqual(["#aa1111", "#1111aa"]);
    // The count stays honest even when the dots are deduped/capped.
    expect(day?.eventCount).toBe(3);
  });

  it("represents uncategorized events with a null (neutral) dot", () => {
    const events = [
      makeEvent({ id: "e1", startAt: "2026-11-20T14:00:00.000-03:00" }),
      makeEvent({ id: "e2", startAt: "2026-11-20T15:00:00.000-03:00" }),
    ];
    const day = buildMiniMonth(anchor, events, baseOptions).find(
      (cell) => cell.day === "2026-11-20",
    );
    expect(day?.dotColors).toEqual([null]);
    expect(day?.eventCount).toBe(2);
  });

  it(`caps dots at ${MINI_MONTH_MAX_DOTS} while keeping the full count`, () => {
    const categories = ["a", "b", "c", "d"].map((id) =>
      makeCategory(id, `#1100${id}${id}`),
    );
    const events = categories.map((category, index) =>
      makeEvent({
        id: `e${index}`,
        startAt: `2026-11-20T${10 + index}:00:00.000-03:00`,
        categoryId: category.id,
        category,
      }),
    );
    const day = buildMiniMonth(anchor, events, baseOptions).find(
      (cell) => cell.day === "2026-11-20",
    );
    expect(day?.dotColors).toHaveLength(MINI_MONTH_MAX_DOTS);
    expect(day?.eventCount).toBe(4);
  });

  it("buckets a range-crossing event onto every covered cell", () => {
    const spanning = makeEvent({
      id: "e1",
      startAt: "2026-11-30T22:00:00.000-03:00",
      endAt: "2026-12-02T02:00:00.000-03:00",
    });
    const cells = buildMiniMonth(anchor, [spanning], baseOptions);
    expect(
      cells.find((cell) => cell.day === "2026-11-30")?.eventCount,
    ).toBe(1);
    expect(
      cells.find((cell) => cell.day === "2026-12-01")?.eventCount,
    ).toBe(1);
  });

  it("reports zero counts and no dots for days without events", () => {
    const day = buildMiniMonth(anchor, [], baseOptions).find(
      (cell) => cell.day === "2026-11-20",
    );
    expect(day?.eventCount).toBe(0);
    expect(day?.dotColors).toEqual([]);
  });
});

describe("miniMonthMoveFocus", () => {
  const cells = agendaMonthGrid("2026-11-15"); // Monday-first, 42 cells

  it("moves one day left/right and seven days up/down", () => {
    expect(miniMonthMoveFocus(cells[10].day, "ArrowRight", cells)).toBe(
      cells[11].day,
    );
    expect(miniMonthMoveFocus(cells[10].day, "ArrowLeft", cells)).toBe(
      cells[9].day,
    );
    expect(miniMonthMoveFocus(cells[10].day, "ArrowDown", cells)).toBe(
      cells[17].day,
    );
    expect(miniMonthMoveFocus(cells[17].day, "ArrowUp", cells)).toBe(
      cells[10].day,
    );
  });

  it("clamps at the grid edges instead of wrapping", () => {
    expect(miniMonthMoveFocus(cells[0].day, "ArrowLeft", cells)).toBeNull();
    expect(miniMonthMoveFocus(cells[0].day, "ArrowUp", cells)).toBeNull();
    expect(miniMonthMoveFocus(cells[41].day, "ArrowRight", cells)).toBeNull();
    expect(miniMonthMoveFocus(cells[41].day, "ArrowDown", cells)).toBeNull();
  });

  it("ignores other keys and unknown days", () => {
    expect(miniMonthMoveFocus(cells[10].day, "Enter", cells)).toBeNull();
    expect(miniMonthMoveFocus(cells[10].day, "a", cells)).toBeNull();
    expect(miniMonthMoveFocus("2020-01-01", "ArrowRight", cells)).toBeNull();
  });
});

describe("miniMonthEventFilter", () => {
  it("wires the panel filters into the month window read", () => {
    const filters: AgendaFilters = {
      search: "  audiencia  ",
      sources: ["audiencia"],
      categoryIds: ["cat-1"],
    };
    const bounds = agendaPeriodWindow("mes", "2026-11-15");
    expect(bounds).not.toBeNull();
    expect(miniMonthEventFilter(filters, "case-9", "2026-11-15")).toEqual({
      query: "audiencia",
      sources: ["audiencia"],
      categoryIds: ["cat-1"],
      caseId: "case-9",
      from: bounds?.from,
      to: bounds?.to,
    });
  });

  it("omits caseId for the studio scope and keeps absent criteria absent", () => {
    const result = miniMonthEventFilter(
      DEFAULT_AGENDA_FILTERS,
      undefined,
      "2026-11-15",
    );
    expect(result).toEqual({
      query: undefined,
      sources: undefined,
      categoryIds: undefined,
      from: expect.any(String),
      to: expect.any(String),
    });
    expect(result && "caseId" in result).toBe(false);
  });

  it("returns null for an invalid anchor instead of reading garbage", () => {
    expect(
      miniMonthEventFilter(DEFAULT_AGENDA_FILTERS, undefined, "nope"),
    ).toBeNull();
  });
});

describe("MINI_WEEKDAY_HEADERS", () => {
  it("is Monday-first", () => {
    expect(MINI_WEEKDAY_HEADERS).toEqual([
      "lun",
      "mar",
      "mié",
      "jue",
      "vie",
      "sáb",
      "dom",
    ]);
  });

  it("aligns with every agendaMonthGrid column (column 0 is a Monday)", () => {
    const cells = agendaMonthGrid("2026-11-15");
    for (let index = 0; index < cells.length; index += 1) {
      const dow = (new Date(`${cells[index].day}T12:00:00Z`).getUTCDay() + 6) % 7;
      expect(dow).toBe(index % 7); // the grid contract the headers ride on
      expect(MINI_WEEKDAY_HEADERS[index % 7]).toBe(MINI_WEEKDAY_HEADERS[dow]);
    }
  });
});
