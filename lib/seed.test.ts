import { describe, expect, it } from "vitest";
import {
  seedCases,
  seedNotifications,
  seedPruebas,
  seedStudy,
  seedUnreadCount,
} from "@/lib/seed";

/**
 * Smoke test: proves the Vitest runner works against the project config
 * (path alias, TS) and guards the shape of the seed data the screens read.
 */
describe("seed data", () => {
  it("exposes a study with cases, pruebas and notifications", () => {
    expect(seedStudy.id).toBeTruthy();
    expect(seedCases.length).toBeGreaterThanOrEqual(2);
    expect(seedPruebas.length).toBeGreaterThanOrEqual(2);
    expect(seedNotifications.length).toBeGreaterThan(0);
  });

  it("keeps every case inside the seed study", () => {
    for (const record of seedCases) {
      expect(record.studyId).toBe(seedStudy.id);
    }
  });

  it("counts the unread notifications for the bell badge", () => {
    const expected = seedNotifications.filter((item) => !item.leida).length;
    expect(seedUnreadCount).toBe(expected);
    expect(seedUnreadCount).toBeGreaterThan(0);
  });
});
