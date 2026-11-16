import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

/**
 * Security contract for `GET /api/wa/conversations`: conversation data is
 * only served to a valid session. Unauthenticated callers get 401 — never
 * an empty 200 that would hide the missing check.
 *
 * Mocked unit tests: no live Supabase project, no network.
 */

const { getSessionMock, getUserMock, inboxMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getUserMock: vi.fn(),
  inboxMock: vi.fn(),
}));

vi.mock("@/lib/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data")>();
  return { ...actual, getSession: getSessionMock };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: getUserMock } }),
}));

vi.mock("@/lib/supabase/inbox", () => ({
  listConversationsSupabase: inboxMock,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  getSessionMock.mockReset();
  getUserMock.mockReset();
  inboxMock.mockReset();
});

describe("GET /api/wa/conversations — fake driver", () => {
  it("answers 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("unauthorized");
  });

  it("lists conversations for a valid session", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1", fullName: "Ana Beltrán", email: "ana@example.com" },
      startedAt: "2026-11-14T10:00:00.000Z",
    });

    const response = await GET();

    expect(response.status).toBe(200);
    const body = (await response.json()) as { conversations: unknown[] };
    expect(Array.isArray(body.conversations)).toBe(true);
    expect(body.conversations.length).toBeGreaterThan(0);
  });
});

describe("GET /api/wa/conversations — supabase driver", () => {
  it("answers 401 when Supabase Auth sees no user", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-demo");
    getUserMock.mockResolvedValue({ data: { user: null } });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(inboxMock).not.toHaveBeenCalled();
  });

  it("serves conversations through the RLS-scoped query when signed in", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-demo");
    getUserMock.mockResolvedValue({
      data: { user: { id: "auth-user-1", email: "ana@example.com" } },
    });
    inboxMock.mockResolvedValue([
      { id: "wa-conv-1", phone: "+5491155550101", status: "bot" },
    ]);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = (await response.json()) as { conversations: unknown[] };
    expect(body.conversations).toHaveLength(1);
    expect(inboxMock).toHaveBeenCalledTimes(1);
  });
});
