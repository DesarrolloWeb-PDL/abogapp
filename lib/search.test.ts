import { describe, expect, it } from "vitest";

/**
 * BUG-003 — accent/typo tolerant search (features.csv must-row: "accent and
 * typo tolerant search"). The Expedientes list filter runs through
 * `searchMatches`, so these tests pin the helper contract the F02-E3 e2e
 * asserts end to end.
 */

import { foldForSearch, levenshtein, searchMatches } from "./search";

const GOMEZ_ROW =
  "Gómez, Rosa c/ Empresa de Luz S.A. s/ cobro de pesos 90.111/2026 " +
  "Juzgado Nº 1 Civil y Comercial";
const PEREZ_ROW = "Pérez, Juan c/ Constructora del Sur SRL s/ despido";

describe("foldForSearch", () => {
  it("strips accents and case-folds", () => {
    expect(foldForSearch("Gómez")).toBe("gomez");
    expect(foldForSearch("GÓMEZ")).toBe("gomez");
    expect(foldForSearch("ÁÉÍÓÚÜÑ")).toBe("aeiouun");
    expect(foldForSearch("  Rosa  ")).toBe("rosa");
  });

  it("is safe on emoji and empty strings", () => {
    expect(foldForSearch("🚀")).toBe("🚀");
    expect(foldForSearch("")).toBe("");
  });
});

describe("searchMatches — exact / substring (existing behavior preserved)", () => {
  it("matches the exact accented spelling (workaround case from BUG-003)", () => {
    expect(searchMatches("gómez", GOMEZ_ROW)).toBe(true);
    expect(searchMatches("Gómez, Rosa", GOMEZ_ROW)).toBe(true);
  });

  it("matches case-insensitively across the joined fields", () => {
    expect(searchMatches("EMPRESA DE LUZ", GOMEZ_ROW)).toBe(true);
    expect(searchMatches("civil y comercial", GOMEZ_ROW)).toBe(true);
  });

  it("keeps punctuation-bearing queries (numero) working", () => {
    expect(searchMatches("90.111", GOMEZ_ROW)).toBe(true);
    expect(searchMatches("90.111/2026", GOMEZ_ROW)).toBe(true);
  });

  it("an empty query matches everything (the list shows all rows)", () => {
    expect(searchMatches("", GOMEZ_ROW)).toBe(true);
    expect(searchMatches("   ", GOMEZ_ROW)).toBe(true);
  });
});

describe("searchMatches — accent tolerance (BUG-003)", () => {
  it("gomez finds the Gómez case without the accent", () => {
    expect(searchMatches("gomez", GOMEZ_ROW)).toBe(true);
    expect(searchMatches("GOMEZ", GOMEZ_ROW)).toBe(true);
  });

  it("accent-insensitive in the other direction too", () => {
    expect(searchMatches("néstor", "Nestor Cardozo")).toBe(true);
    expect(searchMatches("núñez", "Nunez, Carlos")).toBe(true);
  });
});

describe("searchMatches — bounded typo tolerance (BUG-003)", () => {
  it("gomezz (1 typo) finds the Gómez case", () => {
    expect(searchMatches("gomezz", GOMEZ_ROW)).toBe(true);
  });

  it("tolerates up to distance 2 on the whole query / last token", () => {
    expect(searchMatches("gomezzz", GOMEZ_ROW)).toBe(true); // distance 2
    expect(searchMatches("rosa perezz", PEREZ_ROW)).toBe(true); // last token
  });

  it("a typo outside the last token never turns the query into an OR", () => {
    // "civil" alone is in the row, but the typo'd FIRST token must not be
    // silently dropped: only the last token / whole query get tolerance.
    expect(searchMatches("civil 4444", GOMEZ_ROW)).toBe(false);
    expect(searchMatches("gomezz zzz", GOMEZ_ROW)).toBe(false);
  });

  it("never stretches past the bound (distance 3 stays a miss)", () => {
    expect(searchMatches("gomezxxxx", GOMEZ_ROW)).toBe(false);
    expect(searchMatches("zzzzzzz", GOMEZ_ROW)).toBe(false);
    expect(searchMatches("perez", GOMEZ_ROW)).toBe(false);
  });

  it("short queries and numbers do not fuzzy-match unrelated rows", () => {
    // "4444" has no near haystack word; numbers must stay exact-only.
    expect(searchMatches("4444", GOMEZ_ROW)).toBe(false);
    expect(searchMatches("civil 4444", GOMEZ_ROW)).toBe(false);
  });
});

describe("searchMatches — emoji / crash safety (F02-E3)", () => {
  it("an emoji query finds nothing and never throws", () => {
    expect(searchMatches("🚀", GOMEZ_ROW)).toBe(false);
    expect(searchMatches("🚀🚀🚀", `${GOMEZ_ROW} 🎉`)).toBe(false);
  });

  it("an emoji inside the haystack does not break matching", () => {
    expect(searchMatches("gomez", `Gómez 🚀 Rosa`)).toBe(true);
  });

  it("a 1000-char query stays a miss without exploding", () => {
    expect(searchMatches("x".repeat(1000), GOMEZ_ROW)).toBe(false);
  });
});

describe("levenshtein", () => {
  it("computes small distances", () => {
    expect(levenshtein("gomez", "gomezz")).toBe(1);
    expect(levenshtein("casa", "mesa")).toBe(2);
    expect(levenshtein("gomez", "gomez")).toBe(0);
  });

  it("bails out above the cap instead of computing the full matrix", () => {
    expect(levenshtein("a".repeat(500), "b".repeat(500))).toBeGreaterThan(2);
    expect(levenshtein("gomez", "zzzzzzzzzz")).toBeGreaterThan(2);
  });

  it("counts by code point, so surrogate pairs (emoji) are safe", () => {
    expect(levenshtein("🚀", "🚀")).toBe(0);
    expect(levenshtein("🚀🚀", "🚀")).toBe(1);
  });
});
