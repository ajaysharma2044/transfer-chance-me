// Unit tests for src/lib/auth.ts — the cloud (Supabase) paths.
//
// The module reads its backend from src/lib/supabase, which is mocked here as
// "configured": cloudEnabled true and a client whose auth methods are spies.
// So these tests prove what OUR wrapper does around the SDK — validation
// before any network call, normalized emails on the wire, Supabase's
// no-session sign-up quirk surfaced as a confirmation state, and blunt SDK
// errors translated into the app's voice.
//
// The local-device fallback (cloudEnabled false: localStorage users, SHA-256
// via crypto.subtle) is NOT covered here — it would need a second module
// graph with a different mock plus DOM globals, and faking that in the same
// file muddies what each test proves. See the module's local branches.

import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  signUp: vi.fn(),
  resend: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("../src/lib/supabase", () => ({
  cloudEnabled: true,
  supabase: { auth: sdk },
}));

import {
  requestPasswordReset,
  resendConfirmation,
  setPassword,
  signUp,
} from "../src/lib/auth";

// requestPasswordReset builds its redirect from window.location.origin, and
// vitest runs these in node where there is no window.
const ORIGIN = "https://transferchance.example";
vi.stubGlobal("window", { location: { origin: ORIGIN } });

beforeEach(() => {
  vi.clearAllMocks();
  sdk.signUp.mockResolvedValue({ data: { user: null, session: null }, error: null });
  sdk.resend.mockResolvedValue({ error: null });
  sdk.resetPasswordForEmail.mockResolvedValue({ error: null });
  sdk.updateUser.mockResolvedValue({ data: {}, error: null });
});

/* ── signUp: validation happens before any network call ─────────────────── */

describe("signUp validation", () => {
  it("rejects a missing name without calling the SDK", async () => {
    await expect(signUp("   ", "sam@example.com", "long-enough-pw")).rejects.toThrow(/name/i);
    expect(sdk.signUp).not.toHaveBeenCalled();
  });

  it("rejects a malformed email without calling the SDK", async () => {
    for (const bad of ["not-an-email", "sam@", "@example.com", "sam@example"]) {
      await expect(signUp("Sam", bad, "long-enough-pw")).rejects.toThrow(/email/i);
    }
    expect(sdk.signUp).not.toHaveBeenCalled();
  });

  it("rejects a short password without calling the SDK", async () => {
    await expect(signUp("Sam", "sam@example.com", "seven77")).rejects.toThrow(/8 characters/);
    expect(sdk.signUp).not.toHaveBeenCalled();
  });
});

/* ── signUp: what comes back from Supabase ──────────────────────────────── */

describe("signUp against the cloud", () => {
  it("normalizes the email and sends the name as metadata", async () => {
    await signUp("Sam Tran", "  Sam@Example.COM ", "long-enough-pw");
    expect(sdk.signUp).toHaveBeenCalledWith({
      email: "sam@example.com",
      password: "long-enough-pw",
      options: { data: { full_name: "Sam Tran" } },
    });
  });

  it("surfaces no-session as the confirmation state, not an error", async () => {
    // Supabase returns a user but no session when the address must confirm
    // first — and also when the address already has a confirmed account
    // (deliberately indistinguishable, to not disclose who has an account).
    sdk.signUp.mockResolvedValue({
      data: { user: { email: "sam@example.com" }, session: null },
      error: null,
    });
    const r = await signUp("Sam", "sam@example.com", "long-enough-pw");
    expect(r).toEqual({ session: null, needsConfirmation: true, email: "sam@example.com" });
  });

  it("returns a usable session when Supabase grants one immediately", async () => {
    sdk.signUp.mockResolvedValue({
      data: {
        user: { email: "sam@example.com", user_metadata: { full_name: "Sam Tran" } },
        session: { access_token: "t" },
      },
      error: null,
    });
    const r = await signUp("Sam Tran", "sam@example.com", "long-enough-pw");
    expect(r.needsConfirmation).toBe(false);
    expect(r.session).toEqual({ email: "sam@example.com", name: "Sam Tran" });
  });

  it("falls back to the email's local part when there is no name metadata", async () => {
    sdk.signUp.mockResolvedValue({
      data: { user: { email: "sam@example.com" }, session: { access_token: "t" } },
      error: null,
    });
    const r = await signUp("Sam", "sam@example.com", "long-enough-pw");
    expect(r.session?.name).toBe("sam");
  });

  it("translates the SDK's blunt error into the app's voice", async () => {
    sdk.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "User already registered" },
    });
    await expect(signUp("Sam", "sam@example.com", "long-enough-pw")).rejects.toThrow(
      /already an account/i,
    );
  });
});

/* ── resendConfirmation ─────────────────────────────────────────────────── */

describe("resendConfirmation", () => {
  it("asks for a signup resend with the normalized email", async () => {
    await resendConfirmation("  Sam@Example.COM ");
    expect(sdk.resend).toHaveBeenCalledWith({ type: "signup", email: "sam@example.com" });
  });

  it("passes the rate limiter's guidance through", async () => {
    sdk.resend.mockResolvedValue({
      error: { message: "For security purposes, you can only request this once every 60 seconds" },
    });
    await expect(resendConfirmation("sam@example.com")).rejects.toThrow(/give it a minute/i);
  });
});

/* ── requestPasswordReset ───────────────────────────────────────────────── */

describe("requestPasswordReset", () => {
  it("rejects a malformed address before any network call", async () => {
    await expect(requestPasswordReset("not-an-email")).rejects.toThrow(/email/i);
    expect(sdk.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("sends the normalized email with a redirect back to this app", async () => {
    await requestPasswordReset("  Sam@Example.COM ");
    expect(sdk.resetPasswordForEmail).toHaveBeenCalledWith("sam@example.com", {
      redirectTo: ORIGIN,
    });
  });

  it("resolves quietly for an unknown address — no account disclosure", async () => {
    // Supabase answers success either way; our wrapper must not turn that
    // into anything a caller could use to probe who has an account.
    await expect(requestPasswordReset("nobody@example.com")).resolves.toBeUndefined();
  });
});

/* ── setPassword ────────────────────────────────────────────────────────── */

describe("setPassword", () => {
  it("rejects a short password before calling the SDK", async () => {
    await expect(setPassword("seven77")).rejects.toThrow(/8 characters/);
    expect(sdk.updateUser).not.toHaveBeenCalled();
  });

  it("updates the current session's password", async () => {
    await setPassword("long-enough-pw");
    expect(sdk.updateUser).toHaveBeenCalledWith({ password: "long-enough-pw" });
  });

  it("says so plainly when the new password is the old one", async () => {
    sdk.updateUser.mockResolvedValue({
      data: null,
      error: { message: "New password should be different from the old password." },
    });
    await expect(setPassword("long-enough-pw")).rejects.toThrow(/current password/i);
  });
});
