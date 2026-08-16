// Local-device accounts (beta). Credentials never leave this browser.
// Interface is stable so a real backend (e.g. Supabase) can replace the
// implementation without touching the UI.

export interface Session {
  email: string;
  name: string;
}

const KEY = "tcm.session.v1";

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function setSession(s: Session | null): void {
  if (s) localStorage.setItem(KEY, JSON.stringify(s));
  else localStorage.removeItem(KEY);
}
