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
 */
export function initAuth(onChange?: (s: Session | null) => void): () => void {
  if (!cloudEnabled || !supabase) return () => {};
  const sb = supabase;

  sb.auth.getSession().then(({ data }) => {
    const s = toSession(data.session?.user);
    setSession(s);
    onChange?.(s);
  });

  const { data } = sb.auth.onAuthStateChange((_event, sess) => {
    const s = toSession(sess?.user);
    setSession(s);
    onChange?.(s);
  });
  return () => data.subscription.unsubscribe();
}

/* ── Auth API (identical signatures either side of the backend) ── */

export async function signUp(name: string, email: string, password: string): Promise<Session> {
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
    // With email confirmation switched on there is no session yet — the user
    // has to click the link first, and saying so beats a silent no-op.
    if (!data.session) {
      throw new Error("Check your email to confirm your account, then log in.");
    }
    return toSession(data.user) ?? { email: em, name: nm };
  }

  const users = loadUsers();
  if (users.some((u) => u.email === em)) {
    throw new Error("An account with this email already exists on this device. Try logging in.");
  }

  const passwordHash = await hashPassword(em, password);
  users.push({ name: nm, email: em, passwordHash, createdAt: new Date().toISOString() });
  saveUsers(users);

  return { email: em, name: nm };
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
  if (m.includes("already registered")) return "There's already an account with this email. Try logging in.";
  if (m.includes("email not confirmed")) return "Confirm your email first — check your inbox for the link.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Wait a minute and try again.";
  if (m.includes("password")) return "Password needs at least 8 characters.";
  return msg;
}
