import { describe, expect, it } from "vitest";
import type { CaseListFilter } from "@/lib/data";
import {
  NATURAL_SORT,
  caseFooterCopy,
  countActiveFilters,
  loadCaseFilters,
  persistCaseFilters,
} from "./case-list";

/**
 * Pure helpers behind the S07 list chrome: the Filtros active-count badge,
 * the footer counter copy and the per-browser-session filter persistence
 * (sessionStorage — the recon says filters persist, scoped to the tab).
 */

/** Minimal Storage stand-in: node has no sessionStorage. */
function fakeStorage(initial?: string) {
  const record = new Map<string, string>();
  if (initial !== undefined) record.set("expedientes.filtros.v1", initial);
  const storage = {
    getItem: (key: string) => record.get(key) ?? null,
    setItem: (key: string, value: string) => {
      record.set(key, value);
    },
  };
  return { storage: storage as unknown as Storage, record };
}

describe("countActiveFilters", () => {
  it("counts nothing for the default state", () => {
    expect(countActiveFilters({})).toBe(0);
    expect(countActiveFilters({ archivedView: false })).toBe(0);
    expect(countActiveFilters({ tipo: "" })).toBe(0);
    expect(countActiveFilters({ responsable: "   " })).toBe(0);
  });

  it("counts each panel criterion once", () => {
    expect(countActiveFilters({ favoritoOnly: true })).toBe(1);
    expect(countActiveFilters({ tipo: "Judicial" })).toBe(1);
    expect(countActiveFilters({ fuero: "Sucesiones" })).toBe(1);
    expect(countActiveFilters({ etapa: "Trámite" })).toBe(1);
    expect(countActiveFilters({ jurisdiccion: "Córdoba" })).toBe(1);
    expect(countActiveFilters({ responsable: "Ana" })).toBe(1);
    expect(countActiveFilters({ archivedView: true })).toBe(1);
  });

  it("sums the whole panel", () => {
    const full: CaseListFilter = {
      favoritoOnly: true,
      tipo: "Judicial",
      fuero: "Civil y Comercial",
      etapa: "Trámite",
      jurisdiccion: "Córdoba",
      responsable: "Ana Beltrán",
      archivedView: true,
    };
    expect(countActiveFilters(full)).toBe(7);
  });
});

describe("caseFooterCopy", () => {
  it("reports the real visible/total counts of the active view", () => {
    expect(caseFooterCopy(2, 2, false)).toBe("Mostrando 2 de 2 expedientes");
    expect(caseFooterCopy(1, 5, false)).toBe("Mostrando 1 de 5 expedientes");
  });

  it("switches the copy when the archived view is on", () => {
    expect(caseFooterCopy(3, 3, true)).toBe(
      "Mostrando 3 de 3 expedientes archivados",
    );
    expect(caseFooterCopy(0, 2, true)).toBe(
      "Mostrando 0 de 2 expedientes archivados",
    );
  });
});

describe("NATURAL_SORT", () => {
  it("defaults dates to newest-first and text to A→Z", () => {
    expect(NATURAL_SORT.fecha).toBe("desc");
    expect(NATURAL_SORT.ultima_actividad).toBe("desc");
    expect(NATURAL_SORT.caratula).toBe("asc");
    expect(NATURAL_SORT.numero).toBe("asc");
  });
});

describe("filter persistence (sessionStorage)", () => {
  it("answers an empty filter set without a window or storage", () => {
    expect(loadCaseFilters()).toEqual({});
  });

  it("round-trips a filter set through persist + load", () => {
    const { storage } = fakeStorage();
    const filters: CaseListFilter = {
      etapa: "Trámite",
      favoritoOnly: true,
      responsable: "Ana",
    };

    persistCaseFilters(filters, storage);
    expect(loadCaseFilters(storage)).toEqual(filters);
  });

  it("drops corrupt JSON, unknown keys and wrong value types", () => {
    expect(loadCaseFilters(fakeStorage("{not json").storage)).toEqual({});

    const dirty = fakeStorage(
      JSON.stringify({
        tipo: "Judicial",
        favoritoOnly: "yes", // wrong type → dropped
        etapa: "", // empty → dropped
        hack: "x", // unknown key → dropped
        archivedView: true,
      }),
    ).storage;
    expect(loadCaseFilters(dirty)).toEqual({
      tipo: "Judicial",
      archivedView: true,
    });
  });

  it("never throws when the browser refuses to write", () => {
    const hostile = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    } as unknown as Storage;

    expect(() => persistCaseFilters({ tipo: "Judicial" }, hostile)).not.toThrow();
    expect(loadCaseFilters(hostile)).toEqual({});
  });
});
