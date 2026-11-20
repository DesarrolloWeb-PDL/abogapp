import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/data";
import {
  artIsoFromLocal,
  artLocalValue,
  createInputFromForm,
  defaultEventFormValues,
  eventFormValues,
  eventSourceAction,
  formatSlotHint,
  patchFromForm,
  popoverMenuItems,
  slotFormValues,
  slotRangeFromOffsets,
  validateEventForm,
} from "./agenda-event-editor";

/**
 * Pure logic behind the T5a event editor (S17): ART wall-clock ⇄ ISO
 * conversions for the datetime-local fields, the create/edit form model +
 * its Spanish (rioplatense) validation, the popover's read-only source
 * actions and ⋯ menu derivation, and the Día free-slot drag math. Node-only
 * (no jsdom): every function is side-effect free, and the interaction
 * contract travels to e2e/s17-agenda.spec.ts.
 */

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event-1",
    studyId: "study-1",
    caseId: null,
    caseCaratula: "",
    categoryId: null,
    category: null,
    title: "Audiencia de conciliación",
    startAt: "2026-11-20T17:00:00.000Z", // 14:00 ART
    endAt: "2026-11-20T18:00:00.000Z", // 15:00 ART
    location: "Secretaría 4",
    notes: "Comparición personal",
    source: "manual",
    createdAt: "2026-11-18T10:00:00.000Z",
    ...overrides,
  };
}

describe("ART datetime-local conversions", () => {
  it("formats an instant as the ART wall clock, rolling the day back", () => {
    expect(artLocalValue("2026-11-20T17:00:00.000Z")).toBe("2026-11-20T14:00");
    // 02:00Z is still 23:00 the previous day in ART (UTC−3).
    expect(artLocalValue("2026-11-20T02:00:00.000Z")).toBe("2026-11-19T23:00");
    expect(artLocalValue("not-a-date")).toBe("");
  });

  it("parses a datetime-local value as ART (machine TZ independent)", () => {
    expect(artIsoFromLocal("2026-11-20T14:00")).toBe(
      "2026-11-20T17:00:00.000Z",
    );
    // Round-trip discipline (L8 gotcha): impossible dates never overflow
    // silently into the next month — they are rejected.
    expect(artIsoFromLocal("2026-02-30T10:00")).toBeNull();
    expect(artIsoFromLocal("2026-13-01T10:00")).toBeNull();
    expect(artIsoFromLocal("2026-11-20")).toBeNull();
    expect(artIsoFromLocal("")).toBeNull();
    expect(artLocalValue(artIsoFromLocal("2026-11-20T14:00")!)).toBe(
      "2026-11-20T14:00",
    );
  });
});

describe("form model", () => {
  it("prefills create with the next full hour on today, 09:00 otherwise", () => {
    // 2026-11-20 15:20 ART.
    const now = new Date("2026-11-20T18:20:00.000Z");
    const today = defaultEventFormValues({ now });
    expect(today.start).toBe("2026-11-20T16:00");
    expect(today.end).toBe("2026-11-20T17:00");
    expect(today.title).toBe("");
    expect(today.caseId).toBe("");

    const otherDay = defaultEventFormValues({ now, day: "2026-11-25" });
    expect(otherDay.start).toBe("2026-11-25T09:00");
    expect(otherDay.end).toBe("2026-11-25T10:00");

    // Near midnight the default never overflows the 23:59 field bound.
    const late = defaultEventFormValues({
      now: new Date("2026-11-21T02:30:00.000Z"), // 23:30 ART prev day
    });
    expect(late.end <= "2026-11-21T23:59").toBe(true);
    expect(artIsoFromLocal(late.end)).not.toBeNull();
  });

  it("maps an event into form values (empty links become empty strings)", () => {
    const values = eventFormValues(
      makeEvent({
        caseId: "case-1",
        caseCaratula: "Gómez, Rosa",
        categoryId: "cat-1",
      }),
    );
    expect(values).toEqual({
      title: "Audiencia de conciliación",
      start: "2026-11-20T14:00",
      end: "2026-11-20T15:00",
      location: "Secretaría 4",
      notes: "Comparición personal",
      caseId: "case-1",
      categoryId: "cat-1",
    });
    expect(eventFormValues(makeEvent()).caseId).toBe("");
    expect(eventFormValues(makeEvent()).categoryId).toBe("");
  });

  it("builds the driver inputs, clearing links on empty strings", () => {
    const values = eventFormValues(
      makeEvent({ caseId: "case-1", categoryId: "cat-1" }),
    );
    const input = createInputFromForm({ ...values, title: "  Reunión  " });
    expect(input).toEqual({
      title: "Reunión",
      startAt: "2026-11-20T17:00:00.000Z",
      endAt: "2026-11-20T18:00:00.000Z",
      location: "Secretaría 4",
      notes: "Comparición personal",
      caseId: "case-1",
      categoryId: "cat-1",
    });
    expect(createInputFromForm({ ...values, caseId: "", categoryId: "" })).toMatchObject(
      { caseId: null, categoryId: null },
    );
    expect(patchFromForm({ ...values, title: "Otro" })).toMatchObject({
      title: "Otro",
      caseId: "case-1",
      categoryId: "cat-1",
    });

    // Unparseable datetimes refuse instead of shipping a broken instant.
    expect(createInputFromForm({ ...values, start: "nope" })).toBeNull();
    expect(patchFromForm({ ...values, end: "nope" })).toBeNull();
  });
});

describe("validation (Spanish, rioplatense)", () => {
  const valid = eventFormValues(makeEvent());

  it("accepts a sane form", () => {
    expect(validateEventForm(valid)).toEqual({});
  });

  it("requires the title and bounds its length", () => {
    expect(validateEventForm({ ...valid, title: "   " })).toEqual({
      title: "Poné un título para el evento.",
    });
    expect(validateEventForm({ ...valid, title: "x".repeat(301) })).toEqual({
      title: "El título no puede superar los 300 caracteres.",
    });
  });

  it("requires both datetimes and checks them in order", () => {
    expect(validateEventForm({ ...valid, start: "" }).start).toBe(
      "Completá la fecha y hora de inicio.",
    );
    expect(validateEventForm({ ...valid, start: "ayer" }).start).toBe(
      "Completá la fecha y hora de inicio.",
    );
    expect(validateEventForm({ ...valid, end: "" }).end).toBe(
      "Completá la fecha y hora de fin.",
    );
    // end before start → the range message, never two at once.
    const reversed = validateEventForm({
      ...valid,
      start: "2026-11-20T15:00",
      end: "2026-11-20T14:00",
    });
    expect(reversed).toEqual({
      end: "La fecha y hora de fin tienen que ser posterior al inicio.",
    });
    expect(
      validateEventForm({ ...valid, start: "", end: "" }),
    ).toHaveProperty("start");
  });
});

describe("popover derivations", () => {
  it("maps read-only sources to their recon action and target", () => {
    expect(
      eventSourceAction(makeEvent({ source: "audiencia", caseId: "case-1" })),
    ).toEqual({ label: "Ver audiencia", href: "/expedientes/case-1" });
    expect(
      eventSourceAction(makeEvent({ source: "vencimiento", caseId: "case-1" })),
    ).toEqual({ label: "Ver vencimiento", href: "/expedientes/case-1" });
    expect(eventSourceAction(makeEvent({ source: "dia_inhabil" }))).toEqual({
      label: "Ver la fuente oficial",
      href: "/configuracion/dias-inhabiles",
    });
    expect(eventSourceAction(makeEvent())).toBeNull(); // manual: editable
  });

  it("hides the case-dependent action when the event has no expediente", () => {
    expect(eventSourceAction(makeEvent({ source: "audiencia" }))).toBeNull();
    expect(eventSourceAction(makeEvent({ source: "vencimiento" }))).toBeNull();
  });

  it("builds the ⋯ menu without Google Calendar or the Assistant", () => {
    const manual = popoverMenuItems(makeEvent({ caseId: "case-1" }));
    expect(manual.map((item) => item.key)).toEqual(["copy", "case"]);
    expect(popoverMenuItems(makeEvent()).map((item) => item.key)).toEqual([
      "copy",
    ]);
    // Read-only rows keep the same ⋯ menu (recon lists one ⋯ for every
    // popover); GCal needs credentials and the Assistant has no surface —
    // both are absent by decision, asserted here so the gap stays visible.
    const derived = popoverMenuItems(
      makeEvent({ source: "audiencia", caseId: "case-1" }),
    );
    expect(derived.map((item) => item.key)).toEqual(["copy", "case"]);
    for (const items of [manual, derived]) {
      expect(items.some((item) => item.key === "gcal")).toBe(false);
      expect(items.some((item) => item.key === "assistant")).toBe(false);
    }
  });
});

describe("free-slot drag math (Día)", () => {
  const height = 24 * 44; // 1056px column — the math is height-agnostic

  it("snaps both ends to 15 minutes and orders them", () => {
    const top = height * (8 * 60 + 7) / 1440; // 08:07 → 08:00
    const bottom = height * (9 * 60 + 40) / 1440; // 09:40 → 09:45
    expect(slotRangeFromOffsets(bottom, top, height)).toEqual({
      start: 8 * 60,
      end: 9 * 60 + 45,
    });
  });

  it("keeps a minimum of 15 minutes (a plain click still opens a slot)", () => {
    const y = height * (14 * 60 + 4) / 1440; // 14:04 → snap 14:00
    expect(slotRangeFromOffsets(y, y, height)).toEqual({
      start: 14 * 60,
      end: 14 * 60 + 15,
    });
  });

  it("clamps to the day bounds, including a drag to midnight", () => {
    expect(slotRangeFromOffsets(-40, -40, height)).toEqual({
      start: 0,
      end: 15,
    });
    expect(slotRangeFromOffsets(height + 9, height, height)).toEqual({
      start: 1425,
      end: 1440,
    });
    // Defensive: a zero-height column never yields NaN.
    expect(slotRangeFromOffsets(10, 20, 0)).toEqual({ start: 0, end: 60 });
  });

  it("labels the hover hint in the recon wording", () => {
    expect(formatSlotHint(8 * 60)).toBe(
      "Libre de 08:00 · arrastrá para crear",
    );
    expect(formatSlotHint(8 * 60 + 7)).toBe(
      "Libre de 08:00 · arrastrá para crear",
    );
    expect(formatSlotHint(1440)).toBe("Libre de 23:59 · arrastrá para crear");
  });

  it("turns a slot into prefilled form values, rolling past midnight", () => {
    const values = slotFormValues("2026-11-20", 14 * 60, 15 * 60 + 15);
    expect(values).toMatchObject({
      title: "",
      start: "2026-11-20T14:00",
      end: "2026-11-20T15:15",
      caseId: "",
      categoryId: "",
    });
    const midnight = slotFormValues("2026-11-20", 23 * 60 + 30, 1440);
    expect(midnight?.end).toBe("2026-11-21T00:00");
    expect(slotFormValues("ayer", 0, 60)).toBeNull();
  });
});
