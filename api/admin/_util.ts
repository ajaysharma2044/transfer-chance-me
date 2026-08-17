// Input validation shared by the admin routes.
//
// Underscore-prefixed files under api/ are helpers, not routes — Vercel does
// not expose them, the same way api/_admin.ts is not reachable as a URL.
//
// Everything here throws AuthzError, so a bad input travels through the same
// fail() funnel as an authorization failure and the client learns nothing
// about the query that was refused. Rules of the house:
//
//   · every identifier is checked against a UUID shape before it reaches a
//     query, so a filter value can never carry PostgREST syntax
//   · every number is clamped, never trusted — page=1e9 is a table scan
//   · every free-text field is trimmed and length-capped
//
// None of this is a substitute for the row-level policies; it exists so a
// malformed request is refused early and cheaply.

import type { VercelRequest } from "@vercel/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthzError } from "../_admin.js";

/** Lenient on version/variant bits, strict on shape: the point is to keep
 *  arbitrary strings out of a filter, not to police UUID versions. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Action names we write ourselves — an audit filter may only ask for one of
 *  these, so the filter value is never attacker-shaped free text. */
const ACTION_NAME = /^[a-z][a-z0-9_]{1,63}$/;

/** The long free-text fields inside profiles.profile. They are the same
 *  material as the documents table — an essay is an essay whether it was
 *  pasted into the intake form or uploaded — so the routes treat them as
 *  document content rather than as profile fields. Shared here so a field
 *  added to one route's rule cannot be forgotten in the other's. */
export const FREE_TEXT = ["essayText", "activitiesText", "awardsText"] as const;

/** Strip the free text from a profile blob, and count what was withheld. */
export function splitProfile(blob: unknown): {
  profile: Record<string, unknown>;
  written: Record<string, number>;
} {
  const raw = (blob ?? {}) as Record<string, unknown>;
  const profile: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!(FREE_TEXT as readonly string[]).includes(k)) profile[k] = v;
  }
  const written: Record<string, number> = {};
  for (const k of FREE_TEXT) written[k] = typeof raw[k] === "string" ? (raw[k] as string).length : 0;
  return { profile, written };
}

/** Every handler method-checks. A GET route that quietly accepts POST is a
 *  CSRF target and a cache-poisoning one. */
export function requireMethod(req: VercelRequest, method: "GET" | "POST"): void {
  if (req.method !== method) throw new AuthzError(405, "Method not allowed.");
}

/** Admin responses are never cacheable: they carry other people's records. */
export function noStore(res: { setHeader: (k: string, v: string) => void }): void {
  res.setHeader("Cache-Control", "no-store, private");
}

export function queryParam(req: VercelRequest, name: string): string {
  const raw = req.query?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value.trim() : "";
}

export function uuid(value: unknown, label: string): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!UUID.test(s)) throw new AuthzError(400, `Which ${label}?`);
  return s;
}

export function optionalUuid(value: unknown, label: string): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return null;
  return uuid(s, label);
}

export function boundedInt(value: unknown, min: number, max: number, fallback: number): number {
  // An absent parameter is the default, not zero: Number("") is 0, which
  // would silently clamp an omitted ?limit= to the minimum and return one row.
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** An ISO timestamp, or null when the filter was omitted. Anything else is a
 *  400 rather than a silently ignored filter — a date filter that quietly
 *  does nothing is how an audit search misses the row it was looking for. */
export function optionalDate(value: unknown, label: string): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new AuthzError(400, `Couldn't read the ${label} date.`);
  return new Date(t).toISOString();
}

export function optionalAction(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return null;
  if (!ACTION_NAME.test(s)) throw new AuthzError(400, "Unknown action filter.");
  return s;
}

export function text(value: unknown, max: number): string {
  return (typeof value === "string" ? value : "").trim().slice(0, max);
}

/** Names and addresses for a set of staff ids, for display in the admin UI.
 *  Bounded, and it reads profiles rather than the auth admin API so one slow
 *  lookup per row cannot turn a list view into a timeout. */
export async function directory(
  sb: SupabaseClient,
  ids: (string | null | undefined)[],
): Promise<Map<string, { email: string | null; name: string | null }>> {
  const out = new Map<string, { email: string | null; name: string | null }>();
  const unique = [...new Set(ids.filter((id): id is string => !!id))].slice(0, 200);
  if (unique.length === 0) return out;
  const { data } = await sb.from("profiles").select("id, email, name").in("id", unique);
  for (const r of data ?? []) {
    out.set(r.id as string, {
      email: (r.email as string | null) ?? null,
      name: (r.name as string | null) ?? null,
    });
  }
  return out;
}
