import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Supabase-driver auth contract, fully mocked: no live project, no network.
 * These tests pin the sign-up validation rules and the way Supabase Auth
 * responses map onto the data layer's typed error codes.
 */

const { signUpMock, signInMock, updateUserMock, getUserMock, upsertMock, signOutMock } =
  vi.hoisted(() => ({
    signUpMock: vi.fn(),
    signInMock: vi.fn(),
    updateUserMock: vi.fn(),
    getUserMock: vi.fn(),
    upsertMock: vi.fn(),
    signOutMock: vi.fn(),
  }));

// Partial mock: the sign-out gate/drain helpers (BUG-002) are the REAL
// implementations; only the browser client itself is stubbed, no network.
vi.mock("@/lib/supabase/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/client")>();
  return {
    ...actual,
    getBrowserClient: () => ({
      auth: {
        signUp: signUpMock,
        signInWithPassword: signInMock,
        updateUser: updateUserMock,
        getUser: getUserMock,
        signOut: signOutMock,
      },
      from: () => ({ upsert: upsertMock }),
    }),
  };
});

import { getSession, signIn, signOut, signUp, updateProfile } from "./auth";

const VALID_INPUT = {
  fullName: "Camila Ferreyra",
  email: "camila@example.com",
  password: "clave-de-prueba",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  signUpMock.mockReset();
  signInMock.mockReset();
  updateUserMock.mockReset();
  getUserMock.mockReset();
  upsertMock.mockReset();
  signOutMock.mockReset();
});

describe("signUp validation (both drivers)", () => {
  it("rejects a blank name, a malformed email and a short password", async () => {
    // No env vars → fake driver: validation must run before any store write.
    expect(await signUp({ ...VALID_INPUT, fullName: "  " })).toEqual({
      ok: false,
      error: "missing_fields",
    });
    expect(await signUp({ ...VALID_INPUT, email: "no-es-correo" })).toEqual({
      ok: false,
      error: "invalid_email",
    });
    expect(await signUp({ ...VALID_INPUT, password: "corta" })).toEqual({
      ok: false,
      error: "weak_password",
    });
    expect(signUpMock).not.toHaveBeenCalled();
  });
});

describe("supabase driver", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-demo");
  });

  it("returns confirmation_pending when Supabase sends no session (email verification)", async () => {
    signUpMock.mockResolvedValue({
      data: {
        user: { id: "auth-user-1", email: VALID_INPUT.email },
        session: null,
      },
      error: null,
    });

    const result = await signUp(VALID_INPUT);

    expect(result).toEqual({ ok: false, error: "confirmation_pending" });
    expect(signUpMock).toHaveBeenCalledWith({
      email: VALID_INPUT.email,
      password: VALID_INPUT.password,
      options: { data: { full_name: VALID_INPUT.fullName } },
    });
  });

  it("maps a duplicate email onto email_taken", async () => {
    signUpMock.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "User already registered" },
    });

    const result = await signUp(VALID_INPUT);

    expect(result).toEqual({ ok: false, error: "email_taken" });
  });

  it("validates before calling Supabase", async () => {
    const result = await signUp({ ...VALID_INPUT, password: "corta" });

    expect(result).toEqual({ ok: false, error: "weak_password" });
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("maps bad credentials on signIn onto invalid_credentials", async () => {
    signInMock.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Invalid login credentials" },
    });

    const result = await signIn({
      email: VALID_INPUT.email,
      password: "otra-clave",
    });

    expect(result).toEqual({ ok: false, error: "invalid_credentials" });
  });

  it("maps an unconfirmed email onto email_not_confirmed", async () => {
    signInMock.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Email not confirmed" },
    });

    const result = await signIn({
      email: VALID_INPUT.email,
      password: VALID_INPUT.password,
    });

    expect(result).toEqual({ ok: false, error: "email_not_confirmed" });
  });

  it("getSession answers null outside the browser (server reads go through lib/supabase/server)", async () => {
    expect(await getSession()).toBeNull();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("updateProfile writes the full name through Supabase Auth", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "auth-user-1", email: VALID_INPUT.email } },
    });
    updateUserMock.mockResolvedValue({ data: {}, error: null });
    upsertMock.mockResolvedValue({ error: null });

    const result = await updateProfile({
      fullName: "Camila Ferreyra",
      email: VALID_INPUT.email,
    });

    expect(result.ok).toBe(true);
    expect(updateUserMock).toHaveBeenCalledWith({
      data: { full_name: VALID_INPUT.fullName },
    });
  });

  describe("sign-out determinism (BUG-002)", () => {
    it("signOut revokes through the browser client, even if the revoke fails", async () => {
      signOutMock.mockResolvedValueOnce({ error: null });
      await expect(signOut()).resolves.toBeUndefined();
      expect(signOutMock).toHaveBeenCalledTimes(1);

      // Best effort: a failed revoke must never reject the sign-out flow.
      signOutMock.mockRejectedValueOnce(new Error("network down"));
      await expect(signOut()).resolves.toBeUndefined();
      expect(signOutMock).toHaveBeenCalledTimes(2);
    });

    it("waits for in-flight auth requests to settle BEFORE revoking", async () => {
      const client = await import("@/lib/supabase/client");

      let release!: (value: Response) => void;
      const pending = new Promise<Response>((resolve) => {
        release = resolve;
      });
      const fetchSpy = vi.fn(() => pending);
      vi.stubGlobal("fetch", fetchSpy);

      // A session read already on the wire (the sidebar's getMyStudy →
      // GET /auth/v1/user that used to race the revoke into a 403).
      const inFlight = client.authFetch(
        "https://demo.supabase.co/auth/v1/user",
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      let revoked = false;
      signOutMock.mockImplementation(async () => {
        revoked = true;
        return { error: null };
      });

      const signingOut = signOut();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(revoked, "revoke must wait for the in-flight read").toBe(false);

      release(new Response("{}", { status: 200 }));
      await inFlight;
      await signingOut;
      expect(revoked, "revoke proceeds once the read settled").toBe(true);
    });

    it("answers auth reads locally while signing out — no request leaves the tab", async () => {
      const client = await import("@/lib/supabase/client");

      const fetchSpy = vi.fn(() =>
        Promise.resolve(new Response("{}", { status: 200 })),
      );
      vi.stubGlobal("fetch", fetchSpy);

      await client.startSignOut();
      try {
        const read = await client.authFetch(
          "https://demo.supabase.co/auth/v1/user",
        );
        expect(read.status).toBe(401);
        expect(fetchSpy, "gated read never hits the network").not.toHaveBeenCalled();

        // The revoke itself is the one auth call still allowed out.
        await client.authFetch(
          "https://demo.supabase.co/auth/v1/logout?scope=global",
          { method: "POST" },
        );
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      } finally {
        client.endSignOut();
      }

      // Gate released: normal reads go to the network again.
      await client.authFetch("https://demo.supabase.co/auth/v1/user");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("passes non-auth requests through untouched", async () => {
      const client = await import("@/lib/supabase/client");

      const fetchSpy = vi.fn(() =>
        Promise.resolve(new Response("[]", { status: 200 })),
      );
      vi.stubGlobal("fetch", fetchSpy);

      const response = await client.authFetch(
        "https://demo.supabase.co/rest/v1/cases?select=id",
      );
      expect(response.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
