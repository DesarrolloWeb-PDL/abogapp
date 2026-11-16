import { describe, expect, it } from "vitest";
import { getDataDriver } from "./driver";

/**
 * Driver-switch contract: the data layer runs on Supabase only when the
 * project keys exist, and falls back to the fake layer otherwise — so unit
 * tests and `next dev` without `.env.local` keep working unchanged.
 */
describe("data driver", () => {
  it("defaults to fake when no Supabase env vars are present", () => {
    expect(getDataDriver({})).toBe("fake");
  });

  it("picks supabase only when both public vars are set", () => {
    expect(
      getDataDriver({
        NEXT_PUBLIC_SUPABASE_URL: "https://demo.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "anon-demo",
      }),
    ).toBe("supabase");

    // Half-configured stays fake: one var alone can never build a client.
    expect(
      getDataDriver({ NEXT_PUBLIC_SUPABASE_URL: "https://demo.supabase.co" }),
    ).toBe("fake");
  });

  it("honours an explicit DATA_DRIVER override in both directions", () => {
    expect(
      getDataDriver({
        DATA_DRIVER: "fake",
        NEXT_PUBLIC_SUPABASE_URL: "https://demo.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "anon-demo",
      }),
    ).toBe("fake");

    expect(getDataDriver({ DATA_DRIVER: "supabase" })).toBe("supabase");
  });
});
