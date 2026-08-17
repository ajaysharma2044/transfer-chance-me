// The only way this console talks to the backend.
//
// Every call goes to /api/admin/*, over fetch(), carrying the signed-in user's
// Supabase access token in an Authorization: Bearer header. Nothing here reads
// applicant data straight from Supabase, and that is deliberate: the browser's
// anon key would in fact be allowed to read an assigned case (the "staff read
// cases" policy in supabase/admin.sql permits it), but a client-side read
// writes no audit row. The rule this product is built on is that no member of
// staff ever sees a student's file without a row in admin_audit saying so, and
// only api/_admin.ts can write that row. So the console goes the long way
// round, always.
//
// The role the console shows you is likewise never the role it enforces.
// api/_admin.ts re-reads staff_roles from the database on every single
// request; anything this file believes about your privileges is decoration.
//
// ── The routes, as api/admin/ implements them ─────────────────────────────
//   GET  /api/admin/cases      reviewer (scoped)   → CaseListResult
//   GET  /api/admin/case?id=   reviewer (scoped)   → CaseResponse
//   POST /api/admin/document   reviewer (scoped)   → OpenedDocument
//   GET  /api/admin/audit      administrator       → AuditResult
//   GET  /api/admin/alerts     administrator       → AlertsResult
//   POST /api/admin/role       owner, recent auth  → RoleChangeResult
// Also implemented, and not called from this console: POST /api/admin/assign
// (assign or release a reviewer) and POST /api/admin/export (a person's whole
// record). Both are administrator-and-above and both are audited; see
// docs/ADMIN.md §4 and §8.
//
// Called by this console and NOT implemented anywhere. The views that need
// them say so on screen rather than showing a broken panel:
//   GET  /api/admin/staff                  → StaffResult   (roster)
//   GET  /api/admin/notes?subjectId=       → NotesResult   (internal notes)
//   POST /api/admin/notes                  → { note }
// There is no admin_notes table in supabase/ either, so the notes routes are a
// schema change and not only a handler.
//
// Filters travel in the query string, matching the handlers (they read
// req.query). A staff-typed search term therefore reaches the server's request
// log — worth revisiting if searching by applicant email becomes routine.

import { cloudEnabled, supabase } from "../../lib/supabase";

/* ── Failure modes, kept distinct so the UI can say something true ────────── */

export type ApiErrorKind =
  | "no-backend" // this build has no Supabase configured at all
  | "signed-out" // nobody signed in, or the session has gone
  | "unreachable" // network error, timeout, or a non-JSON answer (no API here)
  | "not-found" // the API answered 404 in JSON: the thing does not exist
  | "unauthorized" // 401 — sign in again, or re-authenticate
  | "forbidden" // 403 — the server refused this actor
  | "rate-limited" // 429
  | "server"; // anything else

export class AdminApiError extends Error {
  kind: ApiErrorKind;
  status: number;
  constructor(kind: ApiErrorKind, message: string, status = 0) {
    super(message);
    this.name = "AdminApiError";
    this.kind = kind;
    this.status = status;
  }
}

/** Narrow an unknown catch value without losing the real message. */
export function asApiError(e: unknown): AdminApiError {
  if (e instanceof AdminApiError) return e;
  if (e instanceof Error) return new AdminApiError("server", e.message);
  return new AdminApiError("server", "Something went wrong.");
}

/** True when the failure means "this route is not published here", as opposed
 *  to "the server refused you". The difference matters: one is a missing
 *  feature to explain, the other is a decision to report. */
export function isMissingRoute(e: AdminApiError): boolean {
  return e.kind === "unreachable" || e.kind === "not-found";
}

/** No request may hang forever; a stuck admin screen is a broken one. */
const TIMEOUT_MS = 20_000;

function noApiHere(path: string, status: number): string {
  return (
    `${path} did not answer with JSON (HTTP ${status}). The /api routes only run under ` +
    "`vercel dev` or on a deployment — `npm run dev` serves the front end on its own. " +
    "If this is a deployment, that route is not published here."
  );
}

async function accessToken(): Promise<string> {
  if (!cloudEnabled || !supabase) {
    throw new AdminApiError(
      "no-backend",
      "This build has no Supabase backend configured (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are unset), so there is no session to authorize an admin request with.",
    );
  }
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new AdminApiError("signed-out", error.message);
  const token = data.session?.access_token;
  if (!token) {
    throw new AdminApiError("signed-out", "You are not signed in. Sign in to use the admin console.");
  }
  return token;
}

function kindFor(status: number): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  return "server";
}

interface RequestOpts {
  method?: "GET" | "POST";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const token = await accessToken();

  const url = new URL(path, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v === undefined || v === "") continue;
    url.searchParams.set(k, String(v));
  }

  const ctl = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, TIMEOUT_MS);
  const relay = () => ctl.abort();
  opts.signal?.addEventListener("abort", relay);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: opts.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(opts.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: ctl.signal,
      // The bearer token is the only credential this API accepts; sending
      // cookies as well would only widen what a CSRF attempt could reach.
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "same-origin",
    });
  } catch {
    if (timedOut) {
      throw new AdminApiError("unreachable", `${path} did not answer within ${TIMEOUT_MS / 1000}s.`);
    }
    if (opts.signal?.aborted) throw new AdminApiError("unreachable", "Request cancelled.");
    throw new AdminApiError(
      "unreachable",
      `Could not reach ${path}. The /api routes need \`vercel dev\` or a deployment; \`npm run dev\` serves the front end alone.`,
    );
  } finally {
    window.clearTimeout(timer);
    opts.signal?.removeEventListener("abort", relay);
  }

  // A dev server or a static host answers /api/* with HTML or with the route's
  // own source. Reading that as data is how a console ends up showing
  // "undefined" instead of the truth.
  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.includes("json")) {
    throw new AdminApiError("unreachable", noApiHere(path, res.status), res.status);
  }

  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new AdminApiError("unreachable", noApiHere(path, res.status), res.status);
  }

  if (res.ok) return body as T;

  // api/_admin.ts always answers failures as { error }. Show that string as
  // written — it is the only account the operator gets of why they were
  // refused, and softening it would hide a real MFA or re-auth requirement.
  const msg =
    typeof body.error === "string" && body.error.trim()
      ? body.error.trim()
      : `The admin API returned HTTP ${res.status}.`;
  throw new AdminApiError(kindFor(res.status), msg, res.status);
}

/* ── Roles ─────────────────────────────────────────────────────────────────
 * Ranked reviewer < administrator < owner, mirroring api/_admin.ts. */

export type StaffRole = "reviewer" | "administrator" | "owner";
export const STAFF_ROLES: StaffRole[] = ["reviewer", "administrator", "owner"];

/* ── Case list ─ GET /api/admin/cases ─────────────────────────────────────── */

export interface CaseRow {
  id: string;
  email: string | null;
  name: string | null;
  gpa: number | string | null;
  major: string | null;
  institution: string | null;
  schoolName: string | null;
  targets: number;
  updatedAt: string | null;
}

export interface CaseListResult {
  cases: CaseRow[];
  total: number;
  /** Server-decided: "assigned" for reviewers, "all" for administrators+. */
  scope: "assigned" | "all";
}

/** Rows the server has already sent us, so a case page opened from the list
 *  can show a header even when the detail request fails. Nothing is ever put
 *  here that did not arrive through an audited request. */
const seenCases = new Map<string, CaseRow>();

export function rememberedCase(id: string): CaseRow | null {
  return seenCases.get(id) ?? null;
}

/** The server supports exactly these filters (api/admin/cases.ts):
 *  `q` over email and name, `status=no_profile`, and `page`. Nothing else is
 *  offered in the UI, because a control that silently does nothing is a lie. */
export async function listCases(
  params: { q?: string; status?: string; page?: number },
  signal?: AbortSignal,
): Promise<CaseListResult> {
  const out = await request<CaseListResult>("/api/admin/cases", {
    query: { q: params.q, status: params.status, page: params.page },
    signal,
  });
  for (const c of out.cases ?? []) if (c?.id) seenCases.set(c.id, c);
  return out;
}

/** Rows per page, fixed server-side in api/admin/cases.ts. */
export const CASES_PER_PAGE = 50;

/* ── Case detail ─ GET /api/admin/case?id=&trail= ─────────────────────────── */

export interface CaseDocument {
  id: string;
  kind: string;
  name: string | null;
  mime: string | null;
  bytes: number | null;
  /** A file in private storage, as opposed to text pasted into the app.
   *  Either way it opens through /api/admin/document; the permanent storage
   *  path is never sent to the browser. */
  stored: boolean;
  createdAt: string;
}

export interface CaseConsent {
  purpose: string;
  granted: boolean;
  recordedAt: string | null;
  source: string | null;
  /** False when the person has never answered for this purpose at all —
   *  which is not the same as having declined, and must not be shown as one. */
  answered: boolean;
}

export interface CaseReviewer {
  reviewerId: string;
  email: string | null;
  name: string | null;
  assignedAt: string | null;
  assignedBy: string | null;
  assignedByEmail: string | null;
}

export interface CaseHistoryRow {
  action: string;
  actorId: string;
  actorEmail: string | null;
  actorRole: string | null;
  success: boolean;
  at: string;
}

export interface CaseRecord {
  id: string;
  email: string | null;
  name: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** The engine Profile with the long free-text fields removed server-side. */
  profile: Record<string, unknown>;
  /** Character counts for the fields that were withheld: essayText,
   *  activitiesText, awardsText. The words come from /api/admin/document. */
  written: Record<string, number>;
  schools: Record<string, { status?: string; notes?: string }>;
}

export interface CaseResponse {
  case: CaseRecord;
  documents: CaseDocument[];
  consents: CaseConsent[];
  reviewers: CaseReviewer[];
  /** Recent audit rows for this applicant. Empty for reviewers by design. */
  history: CaseHistoryRow[];
  viewerRole: StaffRole;
}

export function getCase(id: string, signal?: AbortSignal): Promise<CaseResponse> {
  return request<CaseResponse>("/api/admin/case", { query: { id, trail: 10 }, signal });
}

/* ── Documents ─ POST /api/admin/document ─────────────────────────────────── */

export interface OpenedDocument {
  id: string;
  kind: string;
  name: string | null;
  mime: string | null;
  createdAt: string;
  /** Short-lived signed URL for a stored file, or null for a text record. */
  url: string | null;
  /** Seconds the signed URL remains valid. Null when there is no URL. */
  expiresIn: number | null;
  /** Extracted text, for records with no stored file. */
  content: string | null;
}

/**
 * Ask the server to open one document. The server authorizes, writes the
 * audit row, and only then mints a signed URL — so calling this IS the access,
 * whether or not the operator goes on to click the link.
 */
export function openDocument(
  documentId: string,
  reason: string,
  signal?: AbortSignal,
): Promise<OpenedDocument> {
  return request<OpenedDocument>("/api/admin/document", {
    method: "POST",
    body: { documentId, reason },
    signal,
  });
}

/* ── Audit log ─ GET /api/admin/audit ─────────────────────────────────────── */

/** Every action name audit() writes, from docs/ADMIN.md §7. The route matches
 *  `action` exactly and rejects anything outside its own name pattern, so this
 *  list is offered as a menu rather than as a free-text box that mostly
 *  returns nothing. */
export const ADMIN_ACTIONS = [
  "list_cases",
  "view_case",
  "view_document",
  "download_document",
  "export_user",
  "export_user_manifest",
  "assign_case",
  "release_case",
  "change_role",
  "read_audit_log",
  "read_alerts",
  "admin_access_denied",
] as const;

export interface AuditRow {
  id: number | string;
  at: string;
  action: string;
  actorId: string;
  actorEmail: string | null;
  actorRole: string | null;
  subjectId: string | null;
  subjectEmail: string | null;
  documentId: string | null;
  reason: string | null;
  success: boolean;
  ip: string | null;
  userAgent: string | null;
  meta: Record<string, unknown> | null;
}

export interface AuditResult {
  entries: AuditRow[];
  total: number;
  page: number;
  limit: number;
}

export interface AuditQuery {
  actor?: string;
  subject?: string;
  action?: string;
  from?: string;
  to?: string;
  onlyFailures?: boolean;
  page?: number;
  limit?: number;
}

export function listAudit(params: AuditQuery, signal?: AbortSignal): Promise<AuditResult> {
  return request<AuditResult>("/api/admin/audit", {
    query: {
      actor: params.actor,
      subject: params.subject,
      action: params.action,
      from: params.from,
      to: params.to,
      // The route reads this as the string "false" and ignores anything else.
      success: params.onlyFailures ? "false" : undefined,
      page: params.page,
      limit: params.limit,
    },
    signal,
  });
}

/* ── Alerts ─ GET /api/admin/alerts ───────────────────────────────────────── */

export interface AlertRow {
  actorId: string;
  actorEmail: string | null;
  actorName: string | null;
  kind: string;
  /** The real count behind the threshold, from the admin_alerts view. */
  value: number;
  lastSeen: string;
  explanation: string;
  /** True when the alert is about the person reading it. */
  aboutViewer: boolean;
}

export interface AlertsResult {
  alerts: AlertRow[];
  count: number;
  truncated: boolean;
}

export function listAlerts(signal?: AbortSignal): Promise<AlertsResult> {
  return request<AlertsResult>("/api/admin/alerts", { signal });
}

/* ── Role changes ─ POST /api/admin/role ──────────────────────────────────── */

export interface RoleChangeResult {
  ok: boolean;
  role?: StaffRole;
  revoked?: boolean;
}

/**
 * Owner only, and the server additionally demands a recently authenticated
 * session, refuses self-modification, and refuses to strip the last owner.
 * None of those three are checked here — they are the server's to enforce, and
 * it returns a plain-English message for each.
 */
export function changeRole(
  input: { userId: string; role?: StaffRole; revoke?: boolean; reason: string },
  signal?: AbortSignal,
): Promise<RoleChangeResult> {
  return request<RoleChangeResult>("/api/admin/role", {
    method: "POST",
    body: input,
    signal,
  });
}

/* ── Not implemented anywhere yet ─────────────────────────────────────────── */

export interface StaffRow {
  userId: string;
  email: string | null;
  role: StaffRole;
  grantedAt?: string | null;
  grantedBy?: string | null;
  grantedByEmail?: string | null;
  revokedAt?: string | null;
  note?: string | null;
}

export interface StaffResult {
  staff: StaffRow[];
}

/** GET /api/admin/staff. No such handler exists: reviewing who holds what is
 *  a SQL-editor task today (docs/ADMIN.md §6). Called anyway so the roster
 *  appears by itself if the route is ever added. */
export function listStaff(signal?: AbortSignal): Promise<StaffResult> {
  return request<StaffResult>("/api/admin/staff", { signal });
}

export interface NoteRow {
  id: string;
  subjectId: string;
  body: string;
  authorId: string;
  authorEmail?: string | null;
  createdAt: string;
}

export interface NotesResult {
  notes: NoteRow[];
}

/** GET/POST /api/admin/notes. No handler and no table — internal notes are a
 *  schema change as well as a route. Same reasoning as listStaff. */
export function listNotes(subjectId: string, signal?: AbortSignal): Promise<NotesResult> {
  return request<NotesResult>("/api/admin/notes", { query: { subjectId }, signal });
}

export function addNote(
  subjectId: string,
  body: string,
  signal?: AbortSignal,
): Promise<{ note: NoteRow }> {
  return request<{ note: NoteRow }>("/api/admin/notes", {
    method: "POST",
    body: { subjectId, body },
    signal,
  });
}
