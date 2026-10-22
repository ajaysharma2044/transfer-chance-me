// Who is calling the paid endpoint? Verified against Supabase Auth — never read
// from the body, never inferred from a cookie (docs/spec.md §5: every job is
// started and polled by an authenticated user, and a job belongs to the user
// who started it).
//
// The access token the browser holds is a JWT that Supabase signs. Rather than
// carry a JWT library and the project's signing keys into a function, this asks
// Supabase Auth itself (GET /auth/v1/user with the token) — the same authority
// the database consults for RLS — and caches the answer for a minute, keyed by
// a hash of the token, so a 3-second poll loop is not a verification request
// per poll. The cache means a token revoked server-side stays accepted here for
// up to CACHE_TTL_MS — for polls only, which are read-only on the caller's own
// job. Starting a job passes `fresh: true` and always re-verifies.
//
// Env (server-side): SUPABASE_URL (falls back to VITE_SUPABASE_URL) and
// VITE_SUPABASE_ANON_KEY — the public anon key is all /auth/v1/user needs; the
// service-role key is never involved.

import { createHash } from "node:crypto";

export interface Caller { uid: string; email: string | null }

export type AuthResult =
  | { ok: true; caller: Caller }
  | { ok: false; status: 401 | 503; error: string };

export interface AuthDeps {
  fetch?: typeof fetch;
  url?: string;
  anonKey?: string;
  now?: () => number;
  /** Skip the cache and ask Supabase now. Used when starting a job — the path
   *  that spends money — so a revoked token cannot ride the cache window;
   *  read-only polls keep using it. */
  fresh?: boolean;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { caller: Caller; until: number }>();

/** Exposed for tests only. */
export function resetAuthCache(): void {
  cache.clear();
}

export function bearer(req: Request): string | null {
  const m = /^Bearer\s+(.+)$/i.exec((req.headers.get("authorization") ?? "").trim());
  return m ? m[1].trim() : null;
}

export async function requireUser(req: Request, deps: AuthDeps = {}): Promise<AuthResult> {
  const url = (deps.url ?? process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const anon = deps.anonKey ?? process.env.VITE_SUPABASE_ANON_KEY ?? "";
  if (!url || !anon) return { ok: false, status: 503, error: "Sign-in is not configured on this deployment." };

  const token = bearer(req);
  if (!token) return { ok: false, status: 401, error: "Sign in to run the deep audit." };

  const now = deps.now?.() ?? Date.now();
  const key = createHash("sha256").update(token).digest("hex");
  const hit = deps.fresh ? undefined : cache.get(key);
  if (hit && hit.until > now) return { ok: true, caller: hit.caller };

  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(`${url}/auth/v1/user`, {
      headers: { apikey: anon, authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, status: 503, error: "Could not reach the sign-in service — try again." };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: 401, error: "Your session has expired — sign in again." };
  }
  if (!res.ok) return { ok: false, status: 503, error: "Could not verify your session — try again." };

  const user = (await res.json().catch(() => null)) as { id?: unknown; email?: unknown } | null;
  if (!user || typeof user.id !== "string" || user.id.length === 0) {
    return { ok: false, status: 401, error: "Your session has expired — sign in again." };
  }
  const caller: Caller = { uid: user.id, email: typeof user.email === "string" ? user.email : null };
  if (cache.size > 5_000) cache.clear(); // bound instance memory
  cache.set(key, { caller, until: now + CACHE_TTL_MS });
  return { ok: true, caller };
}
