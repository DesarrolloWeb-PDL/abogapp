/**
 * Pure logic behind the T5a event editor (S17): the create/edit form model
 * (ART wall-clock ⇄ ISO conversions for the datetime-local fields, Spanish
 * rioplatense validation), the popover's derivations (read-only source
 * action, ⋯ menu items) and the Día free-slot drag math.
 *
 * Everything here is side-effect free on purpose: vitest is node-only (no
 * jsdom/RTL), so component interaction travels to e2e/s17-agenda.spec.ts
 * and only this logic gets unit tests.
 *
 * Timezone discipline: datetime-local values are NAIVE wall clocks — they
 * are interpreted as ART (UTC−3, no DST since 2009, calendar.ts
 * ART_OFFSET_MS) with an explicit offset, never through the machine's local
 * zone, and validated by round-tripping (L8 gotcha: V8 overflows impossible
 * dates like 2026-02-30 into March instead of rejecting them).
 *
 * Evidence gaps honored: no per-event permalink exists in the recon, so the
 * popover never invents one; the six default category names/11 colors are
 * still unseeded (T6), so the category UI hides itself when the list is
 * empty and "Cambiar color" only exists while there is a color to pick.
 */

import type { CalendarEvent } from "@/lib/data";
import { EVENT_TITLE_MAX } from "@/lib/data";
// Types from the events submodule: the barrel (lib/data/index.ts) is
// parent-owned, and screens already import submodules directly
// (@/lib/data/calendar, @/lib/data/errors) — no barrel re-export needed.
import type { CreateEventInput, UpdateEventPatch } from "@/lib/data/events";
import { toArtIsoDate } from "@/lib/data/calendar";
import { isAgendaDay } from "./agenda-periods";

/** ART = UTC−3, no daylight saving since 2009 (duplicated so this leaf
 *  never imports a module that could grow side effects). */
const ART_OFFSET_MS = -3 * 60 * 60 * 1000;

/** Drag granularity in minutes (15-minute slots, 44px/hour column). */
const SLOT_MINUTES = 15;

const DAY_MINUTES = 24 * 60;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/* ------------------------------------------------- datetime-local ⇄ ISO -- */

/**
 * An instant as the ART wall clock `YYYY-MM-DDTHH:mm` (the datetime-local
 * value), or "" when the instant is unparseable (BUG-004: never throws).
 */
export function artLocalValue(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed + ART_OFFSET_MS).toISOString().slice(0, 16);
}

/**
 * A datetime-local value as an ISO instant, parsed AS ART regardless of the
 * machine zone. Null on any malformed or impossible value: the round-trip
 * through artLocalValue is what rejects V8's silent day overflow
 * (2026-02-30 → 2026-03-02), the L8 date-validation gotcha.
 */
export function artIsoFromLocal(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}:00.000-03:00`);
  // Impossible months (2026-13-01) are Invalid Date → toISOString throws;
  // guard before formatting (BUG-004: corrupt values never throw).
  if (Number.isNaN(parsed.getTime())) return null;
  const iso = parsed.toISOString();
  return artLocalValue(iso) === value ? iso : null;
}

/* ------------------------------------------------------------ form model -- */

/** One form's worth of state: the datetime-local values stay naive (ART). */
export interface EventFormValues {
  title: string;
  /** `YYYY-MM-DDTHH:mm` in ART. */
  start: string;
  end: string;
  location: string;
  notes: string;
  /** "" = no expediente (the driver maps it to null). */
  caseId: string;
  /** "" = no category — hidden entirely while the study has none (T6). */
  categoryId: string;
}

export interface EventFormErrors {
  title?: string;
  start?: string;
  end?: string;
}

interface DefaultFormOptions {
  /** Injected clock for tests; default = now. */
  now?: Date;
  /** Create day; default = today in ART. */
  day?: string;
  /** Prefill the expediente (the case-detail tab pins its own case). */
  caseId?: string;
}

/** ART day start instant for a well-formed `YYYY-MM-DD`. */
function artDayStart(day: string): string {
  return new Date(`${day}T00:00:00.000-03:00`).toISOString();
}

/**
 * Blank form for "Nuevo evento": today (or the chosen day) with the start
 * on the NEXT full hour when that day is today (so a create never lands in
 * the past) and 09:00 otherwise; end = start + 1h. Near midnight the start
 * rolls to 00:00 of the next day instead of overflowing the field bound.
 */
export function defaultEventFormValues(
  options?: DefaultFormOptions,
): EventFormValues {
  const now = options?.now ?? new Date();
  const today = toArtIsoDate(now);
  const day =
    options?.day && isAgendaDay(options.day) ? options.day : today;

  let startIso: string;
  if (day === today) {
    const art = new Date(now.getTime() + ART_OFFSET_MS);
    const minutes = art.getUTCHours() * 60 + art.getUTCMinutes();
    const startMinutes = (Math.floor(minutes / 60) + 1) * 60;
    startIso = new Date(
      Date.parse(artDayStart(day)) + startMinutes * 60_000,
    ).toISOString();
  } else {
    startIso = new Date(
      Date.parse(artDayStart(day)) + 9 * 60 * 60_000,
    ).toISOString();
  }
  const endIso = new Date(Date.parse(startIso) + 60 * 60_000).toISOString();

  return {
    title: "",
    start: artLocalValue(startIso),
    end: artLocalValue(endIso),
    location: "",
    notes: "",
    caseId: options?.caseId ?? "",
    categoryId: "",
  };
}

/** Prefill the form from an existing event ("Editar"). */
export function eventFormValues(event: CalendarEvent): EventFormValues {
  return {
    title: event.title,
    start: artLocalValue(event.startAt),
    end: artLocalValue(event.endAt),
    location: event.location,
    notes: event.notes,
    caseId: event.caseId ?? "",
    categoryId: event.categoryId ?? "",
  };
}

/**
 * Create input from the form; null when either datetime does not parse —
 * the caller shows the field errors first, so null means a broken value the
 * native input somehow let through (defensive, never ships a bad instant).
 */
export function createInputFromForm(
  values: EventFormValues,
): CreateEventInput | null {
  const startAt = artIsoFromLocal(values.start);
  const endAt = artIsoFromLocal(values.end);
  if (!startAt || !endAt) return null;
  return {
    title: values.title.trim(),
    startAt,
    endAt,
    location: values.location,
    notes: values.notes,
    caseId: values.caseId || null,
    categoryId: values.categoryId || null,
  };
}

/** The same mapping as a full update patch (the form submits every field). */
export function patchFromForm(
  values: EventFormValues,
): UpdateEventPatch | null {
  const input = createInputFromForm(values);
  return input ? { ...input } : null;
}

/**
 * Field errors in rioplatense Spanish, checked in order (title → start →
 * end → range); an end-before-start range error lands on the end field so
 * exactly one message shows per field.
 */
export function validateEventForm(
  values: EventFormValues,
): EventFormErrors {
  const errors: EventFormErrors = {};
  const title = values.title.trim();
  if (!title) {
    errors.title = "Poné un título para el evento.";
  } else if (title.length > EVENT_TITLE_MAX) {
    errors.title = `El título no puede superar los ${EVENT_TITLE_MAX} caracteres.`;
  }
  const start = artIsoFromLocal(values.start);
  if (!start) errors.start = "Completá la fecha y hora de inicio.";
  const end = artIsoFromLocal(values.end);
  if (!end) errors.end = "Completá la fecha y hora de fin.";
  if (start && end && Date.parse(end) <= Date.parse(start)) {
    errors.end = "La fecha y hora de fin tienen que ser posterior al inicio.";
  }
  return errors;
}

/* ------------------------------------------------------ popover derivations -- */

/** A navigable action for a read-only (derived) source, or null. */
export interface EventSourceAction {
  label: string;
  href: string;
}

/**
 * The recon's read-only action pattern: audiencias and vencimientos open
 * their expediente (the clone has no Audiencias surface yet — S13 pending;
 * the case hub is where both live), días inhábiles open the official-source
 * list. Sources without an derivable target (a case-less audiencia or
 * vencimiento) answer null — the popover then shows no action instead of a
 * dead link.
 */
export function eventSourceAction(
  event: CalendarEvent,
): EventSourceAction | null {
  switch (event.source) {
    case "audiencia":
      return event.caseId
        ? { label: "Ver audiencia", href: `/expedientes/${event.caseId}` }
        : null;
    case "vencimiento":
      return event.caseId
        ? { label: "Ver vencimiento", href: `/expedientes/${event.caseId}` }
        : null;
    case "dia_inhabil":
      return { label: "Ver la fuente oficial", href: "/configuracion/dias-inhabiles" };
    default:
      return null; // manual rows are edited, not sourced
  }
}

/** One ⋯ menu row (structurally the RowMenu item shape). */
export interface PopoverMenuItem {
  key: string;
  label: string;
}

/**
 * The popover's ⋯ menu (recon: Copiar enlace, Abrir en Google Calendar,
 * Ver el expediente, Preguntar al Asistente IA). GCal is ABSENT — no
 * credentials exist in this build (features.csv could/not built, no sync
 * to link against) — and the Assistant is ABSENT — no assistant deep-link
 * pattern exists anywhere in the clone (S22–S24 unbuilt), so there is
 * nothing to reuse; both absences are asserted in the unit tests.
 */
export function popoverMenuItems(event: CalendarEvent): PopoverMenuItem[] {
  const items: PopoverMenuItem[] = [{ key: "copy", label: "Copiar enlace" }];
  if (event.caseId) {
    items.push({ key: "case", label: "Ver el expediente" });
  }
  return items;
}

/* --------------------------------------------------- free-slot drag math -- */

export interface SlotRange {
  /** Inclusive start, minutes after midnight. */
  start: number;
  /** Exclusive end, minutes after midnight (≤ 1440). */
  end: number;
}

/**
 * The Día drag range from two pointer offsets inside the 24-hour column:
 * both ends snap to 15 minutes, the lower one wins as start, and a range
 * smaller than one slot (a plain click) grows to 15 minutes — except at
 * the very bottom, where the range slides back to end at midnight instead
 * of exceeding the day. A zero-height column (defensive) answers an hour.
 */
export function slotRangeFromOffsets(
  y1: number,
  y2: number,
  height: number,
): SlotRange {
  if (!(height > 0)) return { start: 0, end: 60 };
  const toMinutes = (y: number): number => {
    const clamped = Math.min(Math.max(y, 0), height);
    return Math.round(((clamped / height) * DAY_MINUTES) / SLOT_MINUTES) * SLOT_MINUTES;
  };
  const a = toMinutes(y1);
  const b = toMinutes(y2);
  let start = Math.min(a, b);
  let end = Math.max(a, b);
  if (end - start < SLOT_MINUTES) end = start + SLOT_MINUTES;
  if (end > DAY_MINUTES) {
    end = DAY_MINUTES;
    start = Math.min(start, DAY_MINUTES - SLOT_MINUTES);
  }
  return { start, end };
}

function minutesToClock(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

/**
 * The hover hint in the recon's wording — "Libre de 14:00 · arrastrá para
 * crear" — over the snapped slot the click would create.
 */
export function formatSlotHint(minutes: number): string {
  const snapped =
    Math.round(Math.min(Math.max(minutes, 0), DAY_MINUTES) / SLOT_MINUTES) *
    SLOT_MINUTES;
  const clamped = Math.min(snapped, DAY_MINUTES - 1);
  return `Libre de ${minutesToClock(clamped)} · arrastrá para crear`;
}

/**
 * Drag range → prefilled form values on an ART day (end may roll to
 * 00:00 of the next day). Null for an invalid day (BUG-004 discipline).
 */
export function slotFormValues(
  day: string,
  startMinutes: number,
  endMinutes: number,
  caseId?: string,
): EventFormValues | null {
  if (!isAgendaDay(day)) return null;
  const dayStart = Date.parse(artDayStart(day));
  const start = new Date(dayStart + startMinutes * 60_000).toISOString();
  const end = new Date(dayStart + endMinutes * 60_000).toISOString();
  return {
    title: "",
    start: artLocalValue(start),
    end: artLocalValue(end),
    location: "",
    notes: "",
    caseId: caseId ?? "",
    categoryId: "",
  };
}
