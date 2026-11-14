import { describe, expect, it } from "vitest";
import { formatDate } from "@/lib/format";

/**
 * Contract for the one shared date helper: a date-only ISO value must show
 * the very same calendar day (the UTC-midnight trap that made the list and
 * the detail view disagree).
 */
describe("formatDate", () => {
  it("renders a YYYY-MM-DD value as that same day, in any timezone", () => {
    expect(formatDate("2026-03-09")).toBe("09/03/2026");
    expect(formatDate("2026-12-31")).toBe("31/12/2026");
    expect(formatDate("2026-01-01")).toBe("01/01/2026");
  });

  it("renders a full timestamp as a dd/mm/yyyy date", () => {
    expect(formatDate("2026-06-10T12:00:00.000Z")).toMatch(
      /^\d{2}\/\d{2}\/2026$/,
    );
  });

  it("returns a value it cannot parse unchanged", () => {
    expect(formatDate("")).toBe("");
    expect(formatDate("sin fecha")).toBe("sin fecha");
  });
});
