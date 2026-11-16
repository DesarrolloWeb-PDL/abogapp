import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Supabase-driver auth contract, fully mocked: no live project, no network.
 * These tests pin the sign-up validation rules and the way Supabase Auth
 * responses map onto the data layer's typed error codes.
 */

const { signUpMock, signInMock, updateUserMock, getUserMock, upsertMock } =
  vi.hoisted(() => ({
    signUpMock: vi.fn(),
    signInMock: vi.fn(),
    updateUserMock: vi.fn(),
    getUserMock: vi.fn(),
    upsertMock: vi.fn(),
  }));

vi.mock("@/lib/supabase/client", () => ({
  getBrowserClient: () => ({
    auth: {
      signUp: signUpMock,
      signInWithPassword: signInMock,
      updateUser: updateUserMock,
      getUser: getUserMock,
    },
    from: () => ({ upsert: upsertMock }),
  }),
}));

import { getSession, signIn, signUp, updateProfile } from "./auth";

const VALID_INPUT = {
  fullName: "Camila Ferreyra",
  email: "camila@example.com",
  password: "clave-de-prueba",
};

afterEach(() => {
  vi.unstubAllEnvs();
  signUpMock.mockReset();
  signInMock.mockReset();
  updateUserMock.mockReset();
  getUserMock.mockReset();
  upsertMock.mockReset();
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
});
