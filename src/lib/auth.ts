// Accounts. Real ones when Supabase is configured, local-device ones when it
// isn't, behind one unchanged interface — `signUp`, `logIn`, `getSession`,
// `setSession` keep their signatures so the UI never had to learn the
// difference.
//
// getSession() stays synchronous because the whole app reads it during
// render. With Supabase the real session lives in the SDK; we mirror it into
// the same localStorage key on every auth change, and `initAuth()` hydrates
// that mirror once on boot. So the UI keeps its sync read and still tracks
// the true server session.

import { cloudEnabled, supabase } from "./supabase";

export interface Session {
  email: string;
  name: string;
}

export { cloudEnabled };

const SESSION_KEY = "tcm.session.v1";
const USERS_KEY = "tcm.users.v1";

interface StoredUser {
  name: string;
  email: string; // normalized lowercase
  passwordHash: string; // SHA-256 hex, never plaintext
  createdAt: string;
}

/* ── Session ── */

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function setSession(s: Session | null): void {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
}

/* ── Local user store ── */

function loadUsers(): StoredUser[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as StoredUser[]) : [];
  } catch {
    return [];
  }
}

function saveUsers(users: StoredUser[]): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// SHA-256 via Web Crypto. Salted with the email so identical passwords
// don't produce identical hashes across accounts.
async function hashPassword(email: string, password: string): Promise<string> {
  const data = new TextEncoder().encode(`tcm-v1:${email}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ── Reading a Supabase user into our Session shape ── */

interface SbUser {
  email?: string | null;
  user_metadata?: { full_name?: string; name?: string } | null;
}

function toSession(u: SbUser | null | undefined): Session | null {
  if (!u?.email) return null;
  const meta = u.user_metadata ?? {};
  return {
    email: u.email,
    // Google gives a full name; email sign-ups carry the name we sent at
    // sign-up. Falling back to the local part beats showing "undefined".
    name: meta.full_name || meta.name || u.email.split("@")[0],
  };
}

/**
 * Hydrate the session mirror from the real backend and keep it in step.
 * Call once at start-up; returns an unsubscribe. No-ops without Supabase,
 * where localStorage already is the source of truth.
 *
 * The event name is passed through because the app has to react to more
 * than presence/absence of a session: PASSWORD_RECOVERY means "this visit
 * came from a reset-password email and the next screen must be the new
 * password form", and SIGNED_IN right after an OAuth or confirmation
 * redirect is the moment to route to wherever the user was headed.
 */
export function initAuth(onChange?: (s: Session | null, event: string) => void): () => void {
  if (!cloudEnabled || !supabase) return () => {};
  const sb = supabase;

  sb.auth.getSession().then(({ data }) => {
    const s = toSession(data.session?.user);
    setSession(s);
    onChange?.(s, "INITIAL_SESSION");
  });

  const { data } = sb.auth.onAuthStateChange((event, sess) => {
    const s = toSession(sess?.user);
    setSession(s);
    onChange?.(s, event);
  });
  return () => data.subscription.unsubscribe();
}

/* ── Auth API (identical signatures either side of the backend) ── */

export interface SignUpResult {
  /** Present when the account is usable immediately. */
  session: Session | null;
  /** True when the account was created but the email must be confirmed
   *  before the first login. This is a normal outcome, not an error — the
   *  UI shows a "check your inbox" state, never a red failure message. */
  needsConfirmation: boolean;
  email: string;
}

export async function signUp(name: string, email: string, password: string): Promise<SignUpResult> {
  const em = normalizeEmail(email);
  const nm = name.trim();
  if (!nm) throw new Error("Please tell us your name.");
  if (!/^\S+@\S+\.\S+$/.test(em)) throw new Error("That doesn't look like an email address.");
  if (password.length < 8) throw new Error("Password needs at least 8 characters.");

  if (cloudEnabled && supabase) {
    const { data, error } = await supabase.auth.signUp({
      email: em,
      password,
      options: { data: { full_name: nm } },
    });
    if (error) throw new Error(friendly(error.message));
    // Supabase quirk: signing up with an email that already has a confirmed
    // account returns success with an "obfuscated" user and no identities,
    // to avoid disclosing who has an account. Surface it as the confirmation
    // state — the honest message is in the email that account just received.
    if (!data.session) {
      return { session: null, needsConfirmation: true, email: em };
    }
    return { session: toSession(data.user) ?? { email: em, name: nm }, needsConfirmation: false, email: em };
  }

  const users = loadUsers();
  if (users.some((u) => u.email === em)) {
    throw new Error("An account with this email already exists on this device. Try logging in.");
  }

  const passwordHash = await hashPassword(em, password);
  users.push({ name: nm, email: em, passwordHash, createdAt: new Date().toISOString() });
  saveUsers(users);

  return { session: { email: em, name: nm }, needsConfirmation: false, email: em };
}

/** Send the confirmation email again. Rate-limited by Supabase, and the
 *  limiter's message is passed through so the UI can say when to retry. */
export async function resendConfirmation(email: string): Promise<void> {
  if (!cloudEnabled || !supabase) return;
  const { error } = await supabase.auth.resend({ type: "signup", email: normalizeEmail(email) });
  if (error) throw new Error(friendly(error.message));
}

/**
 * Start the forgot-password flow. The email links back to the app with a
 * recovery token; initAuth() then reports PASSWORD_RECOVERY and the app
 * shows the new-password form.
 *
 * Always resolves for a well-formed address, whether or not an account
 * exists — completing the sentence "no account with that email" would tell
 * anyone which addresses have accounts here, and this database holds
 * student records.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const em = normalizeEmail(email);
  if (!/^\S+@\S+\.\S+$/.test(em)) throw new Error("That doesn't look like an email address.");
  if (!cloudEnabled || !supabase) {
    throw new Error("Password reset needs the online account system, which isn't configured.");
  }
  const { error } = await supabase.auth.resetPasswordForEmail(em, {
    redirectTo: window.location.origin,
  });
  if (error) throw new Error(friendly(error.message));
}

/** Set a new password on the CURRENT session — the recovery flow's final
 *  step, and the account page's change-password. Works for Google-created
 *  accounts too: it adds an email+password way in alongside Google. */
export async function setPassword(newPassword: string): Promise<void> {
  if (newPassword.length < 8) throw new Error("Password needs at least 8 characters.");
  if (!cloudEnabled || !supabase) {
    throw new Error("Password changes need the online account system, which isn't configured.");
  }
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(friendly(error.message));
}

/** How this session signed in ("google", "email", …) — the account page
 *  uses it to label the password section correctly. */
export async function authProvider(): Promise<string | null> {
  if (!cloudEnabled || !supabase) return null;
  const { data } = await supabase.auth.getUser();
  return (data.user?.app_metadata?.provider as string | undefined) ?? null;
}

export async function logIn(email: string, password: string): Promise<Session> {
  const em = normalizeEmail(email);

  if (cloudEnabled && supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({ email: em, password });
    if (error) throw new Error(friendly(error.message));
    return toSession(data.user) ?? { email: em, name: em.split("@")[0] };
  }

  const user = loadUsers().find((u) => u.email === em);
  if (!user) {
    throw new Error("No account with this email on this device. Create one first.");
  }

  const passwordHash = await hashPassword(em, password);
  if (passwordHash !== user.passwordHash) {
    throw new Error("That password doesn't match. Try again.");
  }

  return { email: user.email, name: user.name };
}

/** Sign in with Google. Redirects away and comes back to this page. */
export async function signInWithGoogle(): Promise<void> {
  if (!cloudEnabled || !supabase) throw new Error("Google sign-in isn't configured yet.");
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
  if (error) throw new Error(friendly(error.message));
}

export async function logOut(): Promise<void> {
  if (cloudEnabled && supabase) await supabase.auth.signOut();
  setSession(null);
}

/** Supabase's messages are accurate but blunt; these are the ones a student
 *  will actually hit, in the voice the rest of the app uses. */
function friendly(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login")) return "That email and password don't match.";
  // Deliberately NOT "there's already an account with this email": that answer
  // turns the sign-up form into an oracle for whether a given student has an
  // account here, which the forgot-password flow is careful never to reveal.
  // The person who genuinely owns the address learns what to do from the
  // email they just received; an attacker learns nothing either way.
  if (m.includes("already registered")) return "Check your inbox to finish setting up this email.";
  if (m.includes("email not confirmed")) return "Confirm your email first — check your inbox for the link.";
  if (m.includes("only request this")) return "That was requested a moment ago — give it a minute, then try again.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Wait a minute and try again.";
  if (m.includes("different from the old")) return "That's your current password — pick a new one.";
  if (m.includes("session missing") || m.includes("session_not_found") || m.includes("expired"))
    return "That link has expired. Request a fresh one and use it within an hour.";
  if (m.includes("password")) return "Password needs at least 8 characters.";
  return msg;
}
