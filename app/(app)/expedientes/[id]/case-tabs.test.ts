import { describe, expect, it } from "vitest";
import {
  CASE_DETAIL_TABS,
  caseDetailTabHref,
  resolveCaseDetailTab,
} from "./case-tabs";

/**
 * S08 tab vocabulary: the `?tab=` deep link is a contract shared by the
 * server page (query parsing) and the client view (nav hrefs), so the tab
 * list must live in exactly one module. These tests pin that contract:
 * every shipped tab round-trips through its query value, unknown values
 * fall back to Resumen (F02-E7), and only Resumen omits the query.
 */

describe("case detail tab vocabulary (S08)", () => {
  it("registers the shipped tab strip in recon order", () => {
    expect(CASE_DETAIL_TABS.map((entry) => entry.value)).toEqual([
      "resumen",
      "movimientos",
      "tareas",
      "pruebas",
      "agenda",
    ]);
    expect(CASE_DETAIL_TABS.map((entry) => entry.label)).toEqual([
      "Resumen",
      "Movimientos",
      "Tareas",
      "Pruebas",
      "Agenda",
    ]);
  });

  it("resolves every registered tab from its ?tab= value", () => {
    for (const entry of CASE_DETAIL_TABS) {
      expect(resolveCaseDetailTab(entry.value)).toBe(entry.value);
    }
  });

  it("falls back to Resumen for missing or unknown values", () => {
    expect(resolveCaseDetailTab(undefined)).toBe("resumen");
    expect(resolveCaseDetailTab(null)).toBe("resumen");
    expect(resolveCaseDetailTab("")).toBe("resumen");
    expect(resolveCaseDetailTab("finanzas")).toBe("resumen");
    expect(resolveCaseDetailTab("TAREAS")).toBe("resumen");
  });

  it("builds tab hrefs: Resumen carries no query, every other tab does", () => {
    expect(caseDetailTabHref("case-1", "resumen")).toBe(
      "/expedientes/case-1",
    );
    expect(caseDetailTabHref("case-1", "tareas")).toBe(
      "/expedientes/case-1?tab=tareas",
    );
    expect(caseDetailTabHref("case-1", "pruebas")).toBe(
      "/expedientes/case-1?tab=pruebas",
    );
    expect(caseDetailTabHref("case-1", "agenda")).toBe(
      "/expedientes/case-1?tab=agenda",
    );
  });
});
