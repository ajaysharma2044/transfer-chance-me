// Local-device accounts (beta). Credentials never leave this browser.
// Interface is stable so a real backend (e.g. Supabase) can replace the
// implementation without touching the UI: keep `signUp`, `logIn`,
// `getSession`, and `setSession` signatures and swap the internals.

export interface Session {
  email: string;
  name: string;
}

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

/* ── Auth API (same signatures a real backend would expose) ── */

export async function signUp(name: string, email: string, password: string): Promise<Session> {
  const em = normalizeEmail(email);
  const nm = name.trim();
  if (!nm) throw new Error("Please tell us your name.");
  if (!/^\S+@\S+\.\S+$/.test(em)) throw new Error("That doesn't look like an email address.");
  if (password.length < 8) throw new Error("Password needs at least 8 characters.");

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
