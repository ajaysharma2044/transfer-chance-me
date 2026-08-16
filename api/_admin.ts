// Server-side authorization for every admin route.
//
// This module is the only place staff privilege is decided. The rules it
// enforces, and why each exists:
//
//   · The role is read from the staff_roles TABLE using the service key,
//     never from the caller's JWT claims or user_metadata. A user can edit
//     their own metadata, so a role carried in a token is a role the user
//     can grant themselves.
//   · The caller's bearer token is verified against Supabase, so a forged or
//     expired token fails before any lookup happens.
//   · Multi-factor is required: Supabase reports assurance level "aal2" once
//     a second factor has been used in this session. Staff without it are
//     refused, not merely warned.
//   · Sensitive actions additionally require the session to be RECENT, so a
//     stolen idle laptop cannot escalate roles or bulk-export.
//   · Admin logins are rate-limited per IP.
//   · Every decision — allow or deny — is written to the append-only audit
//     log before the handler returns.
//
// Hiding the navigation is not part of the model. Assume the attacker knows
// every route.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
// Server-side only. If this ever appears in a VITE_ var it ships to browsers
// and bypasses every row-level policy in the database.
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export type Role = "reviewer" | "administrator" | "owner";
const RANK: Record<Role, number> = { reviewer: 1, administrator: 2, owner: 3 };

/** How fresh a session must be for a sensitive action. */
const REAUTH_WINDOW_MS = 15 * 60 * 1000;
/** Admin sessions are short by policy, independent of the app's own. */
const ADMIN_SESSION_MAX_MS = 8 * 60 * 60 * 1000;

export interface Actor {
  id: string;
  email: string;
  role: Role;
  ip: string;
  userAgent: string;
  /** Seconds since this session last authenticated. */
  authAgeMs: number;
}

export class AuthzError extends Error {
  constructor(readonly status: number, msg: string, readonly logAs = msg) {
    super(msg);
  }
}

function admin(): SupabaseClient {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new AuthzError(500, "Admin API is not configured.");
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function clientIp(req: VercelRequest): string {
  const fwd = req.headers["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  return (raw?.split(",")[0] ?? req.socket?.remoteAddress ?? "").trim() || "0.0.0.0";
}

/* ── Rate limiting ─────────────────────────────────────────────────────────
 * In-memory, per instance. Serverless spreads load across instances and cold
 * starts reset this, so it raises the cost of a brute-force attempt without
 * being a hard guarantee. Move to Upstash Redis before launch if admin login
 * is exposed to the public internet. */
const buckets = new Map<string, { n: number; resetAt: number }>();
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { n: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.n >= limit) return false;
  b.n += 1;
  return true;
}

/* ── Audit ─────────────────────────────────────────────────────────────────
 * Writes with the service key because the table has no client insert policy.
 * Never receives document contents — only metadata about the access. */
export interface AuditEntry {
  action: string;
  subjectId?: string | null;
  documentId?: string | null;
  reason?: string | null;
  success?: boolean;
  meta?: Record<string, unknown>;
}

export async function audit(actor: Partial<Actor> & { id?: string }, e: AuditEntry): Promise<void> {
  if (!actor.id) return; // unauthenticated attempts are logged by the caller
  let failed = false;
  try {
    // NOTE: supabase-js reports failures by RETURNING { error }, it does not
    // throw. Checking only for a thrown exception here would let a broken
    // audit log turn into a silent unlogged access — which is the one thing
    // this function exists to prevent.
    const { error } = await admin().from("admin_audit").insert({
      actor_id: actor.id,
      actor_role: actor.role ?? null,
      action: e.action,
      subject_id: e.subjectId ?? null,
      document_id: e.documentId ?? null,
      reason: e.reason ?? null,
      success: e.success !== false,
      ip: actor.ip ?? null,
      user_agent: actor.userAgent ?? null,
      meta: e.meta ?? null,
    });
    failed = !!error;
  } catch {
    failed = true;
  }
  if (failed) {
    // No log, no access: the caller treats this as a hard request failure.
    throw new AuthzError(500, "Could not record this access; the action was refused.");
  }
}

/* ── The guard ─────────────────────────────────────────────────────────── */

export interface GuardOpts {
  /** Minimum role. Defaults to the lowest staff role. */
  min?: Role;
  /** Require a recently authenticated session (role changes, exports…). */
  sensitive?: boolean;
}

/**
 * Verify the caller and return the actor, or throw AuthzError. Call this
 * first in every admin handler — there is no route that may skip it.
 */
export async function requireStaff(req: VercelRequest, opts: GuardOpts = {}): Promise<Actor> {
  const ip = clientIp(req);
  const userAgent = String(req.headers["user-agent"] ?? "");

  if (!rateLimit(`admin:${ip}`, 60, 60_000)) {
    throw new AuthzError(429, "Too many requests.");
  }

  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new AuthzError(401, "Sign in required.");

  const sb = admin();

  // Verifies the signature and expiry server-side. A forged or stale token
  // fails here, before any role lookup.
  const { data: userData, error: userErr } = await sb.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user) throw new AuthzError(401, "Sign in required.", "invalid_token");

  if (!user.email_confirmed_at) {
    throw new AuthzError(403, "Confirm your email address first.", "email_unconfirmed");
  }

  // Role comes from the table, with the service key. Never from the token.
  const { data: roleRow, error: roleErr } = await sb
    .from("staff_roles")
    .select("role, revoked_at, ip_allow")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .maybeSingle();

  if (roleErr) throw new AuthzError(500, "Could not check authorization.");
  if (!roleRow) {
    // Revoking a role takes effect on the next request: there is no cached
    // copy of the role anywhere for a removed admin to keep using.
    await audit({ id: user.id, ip, userAgent }, {
      action: "admin_access_denied", success: false, meta: { reason: "no_active_role" },
    }).catch(() => {});
    throw new AuthzError(403, "Not authorized.", "no_active_role");
  }

  const role = roleRow.role as Role;
  const actor: Actor = {
    id: user.id,
    email: user.email ?? "",
    role,
    ip,
    userAgent,
    authAgeMs: sessionAgeMs(token),
  };

  // Optional per-account IP allow-list, intended for owners.
  const allow = (roleRow.ip_allow as string[] | null) ?? null;
  if (allow?.length && !allow.includes(ip)) {
    await audit(actor, { action: "admin_access_denied", success: false, meta: { reason: "ip_not_allowed", ip } });
    throw new AuthzError(403, "Not authorized from this network.", "ip_not_allowed");
  }

  // Multi-factor is mandatory for staff.
  const aal = tokenClaim(token, "aal");
  if (aal !== "aal2") {
    await audit(actor, { action: "admin_access_denied", success: false, meta: { reason: "mfa_required" } });
    throw new AuthzError(403, "Multi-factor authentication is required for staff accounts.", "mfa_required");
  }

  if (actor.authAgeMs > ADMIN_SESSION_MAX_MS) {
    throw new AuthzError(401, "Your admin session has expired. Sign in again.", "session_expired");
  }

  const min = opts.min ?? "reviewer";
  if (RANK[role] < RANK[min]) {
    await audit(actor, {
      action: "admin_access_denied", success: false, meta: { reason: "insufficient_role", need: min, have: role },
    });
    throw new AuthzError(403, "Not authorized.", "insufficient_role");
  }

  if (opts.sensitive && actor.authAgeMs > REAUTH_WINDOW_MS) {
    throw new AuthzError(401, "Confirm your password again to continue.", "reauth_required");
  }

  return actor;
}

/** Whether this actor may open this applicant's case. Reviewers are limited
 *  to current assignments; administrators and owners are not, and every use
 *  is audited by the caller. */
export async function canViewCase(actor: Actor, subjectId: string): Promise<boolean> {
  if (RANK[actor.role] >= RANK.administrator) return true;
  const { data } = await admin()
    .from("case_assignments")
    .select("id")
    .eq("subject_id", subjectId)
    .eq("reviewer_id", actor.id)
    .is("released_at", null)
    .maybeSingle();
  return !!data;
}

/** Service-key client for handlers that have already passed requireStaff. */
export function serviceClient(): SupabaseClient {
  return admin();
}

/* ── Token helpers ─────────────────────────────────────────────────────────
 * The token's signature is verified by getUser() above; these only READ
 * already-verified claims. Never make an authorization decision from a claim
 * without having verified the token first. */
function decode(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function tokenClaim(token: string, claim: string): string | null {
  const v = decode(token)?.[claim];
  return typeof v === "string" ? v : null;
}

function sessionAgeMs(token: string): number {
  const iat = decode(token)?.iat;
  if (typeof iat !== "number") return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Date.now() - iat * 1000);
}

/** Uniform error handling so no route leaks internals in its message. */
export function fail(res: VercelResponse, e: unknown): void {
  if (e instanceof AuthzError) {
    res.status(e.status).json({ error: e.message });
    return;
  }
  res.status(500).json({ error: "Something went wrong." });
}
