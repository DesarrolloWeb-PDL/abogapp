import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { esHabil, feriaDays, type NonWorkingDays } from "./calendar.ts";
import { computeFechaLimite } from "./compute.ts";

/**
 * Golden tests for the plazos engine, mirroring public.compute_fecha_limite()
 * and public.es_habil() in replica/schema.sql.
 *
 * Feriado dates here are FIXTURES (the official 2026/2027 Argentine holiday
 * list is a known TODO(gap) and must be loaded from an authoritative source
 * before M2). These tests prove the engine's rules, not the holiday data.
 */
const FERIADOS_2026: string[] = [
  "2026-04-02", // fixture: Jueves Santo (jueves)
  "2026-05-01", // fixture: Día del Trabajador (viernes)
];
const FERIA_2026 = feriaDays(2026); // whole January and July (F03)
const ESTUDIO_INHABIL: string[] = ["2026-09-09"]; // studio non-working day

function buildCalendar(extra: string[] = []): NonWorkingDays {
  return new Set([...FERIADOS_2026, ...FERIA_2026, ...ESTUDIO_INHABIL, ...extra]);
}

const calendar = buildCalendar();

describe("es_habil", () => {
  it("weekday with no calendar row is a working day", () => {
    assert.equal(esHabil("2026-03-10", calendar), true); // martes
  });

  it("a weekday absent from the calendar counts (provincial holidays are never system rows)", () => {
    assert.equal(esHabil("2026-09-10", calendar), true); // jueves, no row
  });

  it("weekends are not working days", () => {
    assert.equal(esHabil("2026-03-14", calendar), false); // sábado
    assert.equal(esHabil("2026-03-15", calendar), false); // domingo
  });

  it("system feriados are not working days", () => {
    assert.equal(esHabil("2026-04-02", calendar), false);
    assert.equal(esHabil("2026-05-01", calendar), false);
  });

  it("judicial feria days are not working days", () => {
    assert.equal(esHabil("2026-07-01", calendar), false);
    assert.equal(esHabil("2026-01-15", calendar), false);
  });

  it("studio dias inhabiles are not working days", () => {
    assert.equal(esHabil("2026-09-09", calendar), false);
  });
});

describe("feriaDays", () => {
  it("covers 1–31 January and 1–31 July", () => {
    const days = feriaDays(2026);
    assert.equal(days.length, 62);
    assert.ok(days.includes("2026-01-01"));
    assert.ok(days.includes("2026-01-31"));
    assert.ok(days.includes("2026-07-01"));
    assert.ok(days.includes("2026-07-31"));
    assert.ok(!days.includes("2026-02-01"));
  });
});

describe("computeFechaLimite — corridos", () => {
  it("counts from the day after and ends 23:59:59 ART", () => {
    // 2026-03-10 (mar) + 5 = 2026-03-15 (domingo): corridos ignore calendars
    const got = computeFechaLimite({
      fechaEfectiva: "2026-03-10",
      tipo: "corridos",
      cantidad: 5,
      nonWorkingDays: calendar,
    });
    assert.equal(got.toISOString(), "2026-03-16T02:59:59.000Z");
  });

  it("does NOT roll over when the last day is inhábil", () => {
    // 2026-03-11 (mié) + 3 = 2026-03-14 (sábado) stays on Saturday
    const got = computeFechaLimite({
      fechaEfectiva: "2026-03-11",
      tipo: "corridos",
      cantidad: 3,
      nonWorkingDays: calendar,
    });
    assert.equal(got.toISOString(), "2026-03-15T02:59:59.000Z");
  });

  it("crosses feria without skipping", () => {
    const got = computeFechaLimite({
      fechaEfectiva: "2026-06-30",
      tipo: "corridos",
      cantidad: 3,
      nonWorkingDays: calendar,
    });
    assert.equal(got.toISOString(), "2026-07-04T02:59:59.000Z");
  });
});

describe("computeFechaLimite — hábiles", () => {
  it("one working day from a Tuesday lands on Wednesday", () => {
    const got = computeFechaLimite({
      fechaEfectiva: "2026-03-10",
      tipo: "habiles",
      cantidad: 1,
      nonWorkingDays: calendar,
    });
    assert.equal(got.toISOString(), "2026-03-12T02:59:59.000Z");
  });

  it("skips the weekend", () => {
    // jue 2026-03-12 + 2 hábiles -> vie 13 (1), lunes 16 (2)
    const got = computeFechaLimite({
      fechaEfectiva: "2026-03-12",
      tipo: "habiles",
      cantidad: 2,
      nonWorkingDays: calendar,
    });
    assert.equal(got.toISOString(), "2026-03-17T02:59:59.000Z");
  });

  it("skips national feriados", () => {
    // mié 2026-04-01 + 1 hábil -> 04-02 feriado -> vie 04-03
    const got = computeFechaLimite({
      fechaEfectiva: "2026-04-01",
      tipo: "habiles",
      cantidad: 1,
      nonWorkingDays: calendar,
    });
    assert.equal(got.toISOString(), "2026-04-04T02:59:59.000Z");
  });

  it("skips the whole July feria and the intervening weekend", () => {
    // mar 2026-06-30 + 1 hábil -> todo julio feria, 1-2 ago fin de semana -> lun 3 ago
    const got = computeFechaLimite({
      fechaEfectiva: "2026-06-30",
      tipo: "habiles",
      cantidad: 1,
      nonWorkingDays: calendar,
    });
    assert.equal(got.toISOString(), "2026-08-04T02:59:59.000Z");
  });

  it("skips studio dias inhabiles", () => {
    // mar 2026-09-08 + 1 hábil -> mié 09-09 es de estudio -> jue 09-10
    const got = computeFechaLimite({
      fechaEfectiva: "2026-09-08",
      tipo: "habiles",
      cantidad: 1,
      nonWorkingDays: calendar,
    });
    assert.equal(got.toISOString(), "2026-09-11T02:59:59.000Z");
  });

  it("returns the wall clock as 23:59:59 in America/Argentina/Buenos_Aires", () => {
    const got = computeFechaLimite({
      fechaEfectiva: "2026-03-10",
      tipo: "habiles",
      cantidad: 1,
      nonWorkingDays: calendar,
    });
    const art = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(got);
    assert.equal(art, "2026-03-11 23:59:59");
  });
});

describe("computeFechaLimite — horas", () => {
  it("adds calendar hours from midnight ART of the effective date", () => {
    const got = computeFechaLimite({
      fechaEfectiva: "2026-03-10",
      tipo: "horas",
      cantidad: 12,
      nonWorkingDays: calendar,
    });
    assert.equal(got.toISOString(), "2026-03-10T15:00:00.000Z"); // 12:00 ART
  });

  it("includes nights (48 h crosses two midnights)", () => {
    const got = computeFechaLimite({
      fechaEfectiva: "2026-03-10",
      tipo: "horas",
      cantidad: 48,
      nonWorkingDays: calendar,
    });
    assert.equal(got.toISOString(), "2026-03-12T03:00:00.000Z"); // 00:00 ART
  });
});

describe("computeFechaLimite — validation", () => {
  it("rejects quantities outside 1..5000", () => {
    const base = {
      fechaEfectiva: "2026-03-10",
      tipo: "corridos" as const,
      nonWorkingDays: calendar,
    };
    assert.throws(
      () => computeFechaLimite({ ...base, cantidad: 0 }),
      /invalid plazo quantity: 0/,
    );
    assert.throws(
      () => computeFechaLimite({ ...base, cantidad: 5001 }),
      /invalid plazo quantity: 5001/,
    );
  });

  it("rejects unknown plazo types", () => {
    assert.throws(
      () =>
        computeFechaLimite({
          fechaEfectiva: "2026-03-10",
          // @ts-expect-error intentionally invalid domain value
          tipo: "meses",
          cantidad: 1,
          nonWorkingDays: calendar,
        }),
      /unknown plazo type: meses/,
    );
  });

  it("stops after ten years of calendar time instead of looping forever", () => {
    // Every weekday in the window is also marked: nothing is ever hábil.
    const forever: string[] = [];
    const start = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 3700; i++) {
      forever.push(new Date(start + i * 86_400_000).toISOString().slice(0, 10));
    }
    assert.throws(
      () =>
        computeFechaLimite({
          fechaEfectiva: "2026-01-01",
          tipo: "habiles",
          cantidad: 1,
          nonWorkingDays: new Set(forever),
        }),
      /plazo exceeds 10 years of calendar time/,
    );
  });
});
