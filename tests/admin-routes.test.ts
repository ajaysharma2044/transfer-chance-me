// Authorization tests for the admin ROUTES.
//
// tests/admin-authz.test.ts covers the guard itself. This file covers what
// each route does with the guard's answer, which is where a mistake would be
// quiet rather than loud: a route that forgets `min: "administrator"` still
// looks correct, still returns 200, and hands a reviewer the whole audit log.
//
// The properties under test, stated plainly:
//
//   · a reviewer cannot reach an administrator route — assign, audit, export
//     and alerts all refuse them, and the refusal is logged
//   · a reviewer cannot open a case they were not assigned
//   · an export demands a session authenticated in the last few minutes, a
//     written reason, and stays inside its caps
//   · the case view never returns document text
//   · when the audit log cannot be written, no route returns data
//
// Supabase is faked in memory: no network, no project. What is being tested
// is our decision logic, which is where the mistakes that matter live.

import { beforeEach, describe, expect, it, vi } from "vitest";

/* ── An in-memory Supabase, shaped like the calls the routes make ───────── */

type Row = Record<string, unknown>;

const db: Record<string, Row[]> = {
  profiles: [], documents: [], consents: [], case_assignments: [],
  staff_roles: [], admin_audit: [], admin_alerts: [],
};

const state = {
  user: null as { id: string; email: string; email_confirmed_at: string | null } | null,
  failAudit: false,
};

function matches(row: Row, f: Filters): boolean {
  for (const [c, v] of f.eqs) if (row[c] !== v) return false;
  for (const c of f.isNull) if (row[c] !== null && row[c] !== undefined) return false;
  for (const [c, list] of f.ins) if (!list.includes(row[c])) return false;
  for (const [c, v] of f.gtes) if (!(String(row[c]) >= String(v))) return false;
  for (const [c, v] of f.ltes) if (!(String(row[c]) <= String(v))) return false;
  return true;
}

interface Filters {
  eqs: [string, unknown][];
  isNull: string[];
  ins: [string, unknown[]][];
  gtes: [string, unknown][];
  ltes: [string, unknown][];
}

let seq = 0;

function table(name: string) {
  const f: Filters = { eqs: [], isNull: [], ins: [], gtes: [], ltes: [] };
  let head = false;
  let counting = false;
  let sort: { col: string; asc: boolean } | null = null;
  let take: number | null = null;
  let slice: [number, number] | null = null;
  let mode: "select" | "update" | "upsert" = "select";
  let payload: Row = {};
  let returning = false;

  function hits(): Row[] {
    let rows = (db[name] ?? []).filter((r) => matches(r, f));
    if (sort) {
      const { col, asc } = sort;
      rows = [...rows].sort((a, b) => {
        const x = String(a[col] ?? ""), y = String(b[col] ?? "");
        return asc ? (x < y ? -1 : x > y ? 1 : 0) : (x > y ? -1 : x < y ? 1 : 0);
      });
    }
    return rows;
  }

  function run(): { data: Row[] | null; count: number | null; error: null } {
    if (mode === "update") {
      const changed = hits();
      for (const r of changed) Object.assign(r, payload);
      return { data: returning ? changed : null, count: null, error: null };
    }
    const all = hits();
    const total = all.length;
    let rows = all;
    if (slice) rows = rows.slice(slice[0], slice[1] + 1);
    if (take !== null) rows = rows.slice(0, take);
    return {
      data: head ? null : rows,
      count: counting ? total : null,
      error: null,
    };
  }

  const api = {
    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      if (mode === "update") { returning = true; return api; }
      head = opts?.head === true;
      counting = !!opts?.count;
      return api;
    },
    eq(c: string, v: unknown) { f.eqs.push([c, v]); return api; },
    is(c: string, v: unknown) { if (v === null) f.isNull.push(c); return api; },
    in(c: string, v: unknown[]) { f.ins.push([c, v]); return api; },
    or() { return api; },
    gte(c: string, v: unknown) { f.gtes.push([c, v]); return api; },
    lte(c: string, v: unknown) { f.ltes.push([c, v]); return api; },
    order(col: string, opts?: { ascending?: boolean }) {
      sort = { col, asc: opts?.ascending !== false };
      return api;
    },
    limit(n: number) { take = n; return api; },
    range(a: number, b: number) { slice = [a, b]; return api; },
    update(p: Row) { mode = "update"; payload = p; return api; },
    async insert(row: Row) {
      if (name === "admin_audit" && state.failAudit) return { error: new Error("log down") };
      db[name].push({ id: ++seq, created_at: new Date().toISOString(), ...row });
      return { error: null };
    },
    async upsert(row: Row, opts?: { onConflict?: string }) {
      mode = "upsert";
      const keys = (opts?.onConflict ?? "id").split(",").map((k) => k.trim());
      const existing = (db[name] ?? []).find((r) => keys.every((k) => r[k] === row[k]));
      if (existing) Object.assign(existing, row);
      else db[name].push({ id: `row-${++seq}`, ...row });
      return { error: null };
    },
    async maybeSingle() {
      const { data, error } = run();
      return { data: data?.[0] ?? null, error };
    },
    // Awaiting the builder runs the query, exactly like supabase-js.
    then(ok: (v: unknown) => unknown, no?: (e: unknown) => unknown) {
      return Promise.resolve(run()).then(ok, no);
    },
  };
  return api;
}

function fakeClient() {
  return {
    auth: {
      getUser: async (t: string) =>
        t === "forged" || !state.user
          ? { data: { user: null }, error: new Error("bad token") }
          : { data: { user: state.user }, error: null },
      admin: {
        signOut: async () => ({}),
        getUserById: async () => ({ data: { user: state.user }, error: null }),
      },
    },
    from: (name: string) => table(name),
  };
}

vi.mock("@supabase/supabase-js", () => ({ createClient: () => fakeClient() }));

process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key-for-tests";

/* ── Request and response doubles ───────────────────────────────────────── */

function token(claims: Record<string, unknown> = {}): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  // Freshness comes from `amr` (per-factor auth timestamps), not `iat`:
  // `iat` moves on every hourly token refresh, so an idle week-old session
  // would otherwise read as newly authenticated.
  return `${b64({ alg: "HS256" })}.${b64({
    iat: now, aal: "aal2",
    amr: [{ method: "password", timestamp: now }, { method: "totp", timestamp: now }],
    ...claims,
  })}.sig`;
}

/** A stale but otherwise valid session: past the 15-minute re-auth window,
 *  inside the 8-hour session limit. */
const staleToken = () => {
  const now = Math.floor(Date.now() / 1000);
  // Authenticated an hour ago but token refreshed since: fresh `iat`, stale
  // `amr`. This is the shape a real idle admin session has.
  return token({ amr: [{ method: "password", timestamp: now - 60 * 60 }] });
};

// A fresh IP per request: the guard rate-limits 60/minute per IP and this file
// makes more requests than that.
let ipN = 0;
function mkReq(opts: {
  method?: string; token?: string; query?: Record<string, string>; body?: unknown;
} = {}) {
  const ip = `192.0.2.${(ipN++ % 250) + 1}`;
  return {
    method: opts.method ?? "GET",
    headers: {
      authorization: `Bearer ${opts.token ?? token()}`,
      "user-agent": "test",
      "x-forwarded-for": ip,
    },
    socket: { remoteAddress: ip },
    query: opts.query ?? {},
    body: opts.body,
  } as never;
}

function mkRes() {
  const out: { code: number; body: Record<string, unknown>; headers: Record<string, string> } = {
    code: 0, body: {}, headers: {},
  };
  const res = {
    setHeader(k: string, v: string) { out.headers[k.toLowerCase()] = v; },
    status(c: number) { out.code = c; return res; },
    json(b: Record<string, unknown>) { out.body = b; return res; },
  };
  return { res: res as never, out };
}

const audits = () => db.admin_audit;
const auditFor = (action: string) => audits().filter((a) => a.action === action);

/* ── Fixtures ───────────────────────────────────────────────────────────── */

const SUBJECT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const REVIEWER = "33333333-3333-4333-8333-333333333333";
const ADMIN = "44444444-4444-4444-8444-444444444444";
const OUTSIDER = "55555555-5555-4555-8555-555555555555";

const caseHandler = (await import("../api/admin/case.js")).default;
const assignHandler = (await import("../api/admin/assign.js")).default;
const auditHandler = (await import("../api/admin/audit.js")).default;
const exportHandler = (await import("../api/admin/export.js")).default;
const alertsHandler = (await import("../api/admin/alerts.js")).default;

let adminSeq = 0;
/** A distinct administrator per test. /api/admin/export rate-limits per
 *  actor and the limiter is module-level, so one test's exports must not be
 *  what refuses the next test's. */
function freshAdmin(): string {
  const id = `66666666-6666-4666-8666-${String(++adminSeq).padStart(12, "0")}`;
  signInAs(id, "administrator");
  return id;
}

/** Sign in as a given staff member for the next request. */
function signInAs(id: string, role: "reviewer" | "administrator" | "owner") {
  state.user = { id, email: `${role}@example.com`, email_confirmed_at: "2026-01-01T00:00:00Z" };
  if (!db.staff_roles.some((r) => r.user_id === id)) {
    db.staff_roles.push({ user_id: id, role, revoked_at: null, ip_allow: null });
  }
}

beforeEach(() => {
  for (const k of Object.keys(db)) db[k] = [];
  state.failAudit = false;
  state.user = null;

  db.profiles.push(
    {
      id: SUBJECT, email: "student@example.com", name: "Sam Student",
      profile: {
        gpa: 3.8, major: "cs", institution: "cc",
        essayText: "the essay pasted into the form".padEnd(1200, "x"),
        activitiesText: "y".repeat(30), awardsText: "",
      },
      schools: { Cornell: { status: "applied" } },
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-02-01T00:00:00Z",
    },
    { id: OTHER, email: "other@example.com", name: "Other", profile: {}, schools: {} },
    { id: REVIEWER, email: "reviewer@example.com", name: "Rey Reviewer" },
    { id: ADMIN, email: "admin@example.com", name: "Ada Admin" },
  );

  db.documents.push(
    {
      id: "doc-text", user_id: SUBJECT, kind: "essay", name: "personal-statement.txt",
      content: "the essay itself, which must never appear in a case view",
      storage_path: null, mime: "text/plain", bytes: 55, created_at: "2026-01-05T00:00:00Z",
    },
    {
      id: "doc-file", user_id: SUBJECT, kind: "transcript", name: "transcript.pdf",
      content: null, storage_path: `${SUBJECT}/transcript.pdf`,
      mime: "application/pdf", bytes: 90210, created_at: "2026-01-06T00:00:00Z",
    },
  );

  db.consents.push(
    { user_id: SUBJECT, purpose: "service_delivery", granted: true, source: "signup", created_at: "2026-01-01T00:00:00Z" },
    { user_id: SUBJECT, purpose: "human_review", granted: false, source: "settings", created_at: "2026-01-02T00:00:00Z" },
    // A later record overrides the earlier one for the same purpose.
    { user_id: SUBJECT, purpose: "human_review", granted: true, source: "settings", created_at: "2026-01-09T00:00:00Z" },
  );
});

/* ── Reviewers cannot reach administrator routes ────────────────────────── */

describe("a reviewer cannot reach an administrator route", () => {
  const cases: [string, (req: never, res: never) => Promise<void>, "GET" | "POST"][] = [
    ["assign", assignHandler, "POST"],
    ["audit", auditHandler, "GET"],
    ["export", exportHandler, "POST"],
    ["alerts", alertsHandler, "GET"],
  ];

  for (const [name, handler, method] of cases) {
    it(`refuses ${name} with 403 and logs the denial`, async () => {
      signInAs(REVIEWER, "reviewer");
      const { res, out } = mkRes();
      await handler(
        mkReq({
          method,
          body: { subjectId: SUBJECT, reviewerId: REVIEWER, userId: SUBJECT, reason: "a good reason here" },
        }),
        res,
      );
      expect(out.code).toBe(403);
      expect(String(out.body.error)).toMatch(/not authorized/i);
      // No payload of any kind came back with the refusal.
      expect(Object.keys(out.body)).toEqual(["error"]);
      const denial = auditFor("admin_access_denied").at(-1);
      expect(denial?.success).toBe(false);
      expect((denial?.meta as Record<string, unknown>)?.reason).toBe("insufficient_role");
    });
  }

  it("cannot widen its own reach by assigning itself another case", async () => {
    signInAs(REVIEWER, "reviewer");
    const { res, out } = mkRes();
    await assignHandler(
      mkReq({ method: "POST", body: { subjectId: OTHER, reviewerId: REVIEWER } }),
      res,
    );
    expect(out.code).toBe(403);
    expect(db.case_assignments).toHaveLength(0);
  });
});

/* ── Every handler checks its method ────────────────────────────────────── */

describe("method checks", () => {
  const wrongVerb: [string, (req: never, res: never) => Promise<void>, string][] = [
    ["case", caseHandler, "POST"],
    ["assign", assignHandler, "GET"],
    ["audit", auditHandler, "POST"],
    ["export", exportHandler, "GET"],
    ["alerts", alertsHandler, "DELETE"],
  ];

  for (const [name, handler, method] of wrongVerb) {
    it(`${name} refuses ${method} with 405, before authenticating`, async () => {
      signInAs(ADMIN, "administrator");
      const { res, out } = mkRes();
      await handler(mkReq({ method, query: { id: SUBJECT } }), res);
      expect(out.code).toBe(405);
    });
  }
});

/* ── GET /api/admin/case ────────────────────────────────────────────────── */

describe("the case view", () => {
  it("lets an assigned reviewer open the case, and logs it", async () => {
    signInAs(REVIEWER, "reviewer");
    db.case_assignments.push({
      subject_id: SUBJECT, reviewer_id: REVIEWER, assigned_by: ADMIN,
      assigned_at: "2026-01-03T00:00:00Z", released_at: null,
    });

    const { res, out } = mkRes();
    await caseHandler(mkReq({ query: { id: SUBJECT } }), res);

    expect(out.code).toBe(200);
    expect((out.body.case as Record<string, unknown>).email).toBe("student@example.com");
    const logged = auditFor("view_case").at(-1);
    expect(logged?.subject_id).toBe(SUBJECT);
    expect(logged?.success).toBe(true);
  });

  it("does not show a reviewer who else has been reading the file", async () => {
    // admin_audit is closed to reviewers by policy; this route holds the
    // service key, so it has to hold that line itself.
    db.case_assignments.push({
      subject_id: SUBJECT, reviewer_id: REVIEWER, assigned_by: ADMIN,
      assigned_at: "2026-01-03T00:00:00Z", released_at: null,
    });
    db.admin_audit.push({
      actor_id: ADMIN, actor_role: "administrator", action: "view_case",
      subject_id: SUBJECT, success: true, created_at: "2026-02-01T10:00:00Z",
    });

    signInAs(REVIEWER, "reviewer");
    const asReviewer = mkRes();
    await caseHandler(mkReq({ query: { id: SUBJECT } }), asReviewer.res);
    expect(asReviewer.out.code).toBe(200);
    expect(asReviewer.out.body.history).toEqual([]);

    // The same request from an administrator does return the trail.
    signInAs(ADMIN, "administrator");
    const asAdmin = mkRes();
    await caseHandler(mkReq({ query: { id: SUBJECT } }), asAdmin.res);
    expect((asAdmin.out.body.history as unknown[]).length).toBeGreaterThan(0);
  });

  it("refuses a case the reviewer was not assigned, and records the attempt", async () => {
    signInAs(REVIEWER, "reviewer");
    const { res, out } = mkRes();
    await caseHandler(mkReq({ query: { id: SUBJECT } }), res);

    expect(out.code).toBe(403);
    expect(out.body.case).toBeUndefined();
    const denied = auditFor("view_case").at(-1);
    expect(denied?.success).toBe(false);
    expect((denied?.meta as Record<string, unknown>)?.reason).toBe("not_assigned");
  });

  it("refuses a case whose assignment was released", async () => {
    signInAs(REVIEWER, "reviewer");
    db.case_assignments.push({
      subject_id: SUBJECT, reviewer_id: REVIEWER, assigned_by: ADMIN,
      assigned_at: "2026-01-03T00:00:00Z", released_at: "2026-02-01T00:00:00Z",
    });
    const { res, out } = mkRes();
    await caseHandler(mkReq({ query: { id: SUBJECT } }), res);
    expect(out.code).toBe(403);
  });

  it("never returns document text — only metadata", async () => {
    signInAs(ADMIN, "administrator");
    const { res, out } = mkRes();
    await caseHandler(mkReq({ query: { id: SUBJECT } }), res);

    expect(out.code).toBe(200);
    const docs = out.body.documents as Record<string, unknown>[];
    expect(docs).toHaveLength(2);
    for (const d of docs) {
      expect(d).not.toHaveProperty("content");
      expect(d).not.toHaveProperty("storage_path");
      expect(d).not.toHaveProperty("url");
    }
    // Belt and braces: the essay text is nowhere in the response at all.
    expect(JSON.stringify(out.body)).not.toMatch(/the essay itself/);
    expect(docs.find((d) => d.id === "doc-file")?.stored).toBe(true);
  });

  it("withholds the long free-text fields but reports how much there is", async () => {
    signInAs(ADMIN, "administrator");
    const { res, out } = mkRes();
    await caseHandler(mkReq({ query: { id: SUBJECT } }), res);

    const c = out.body.case as Record<string, unknown>;
    const profile = c.profile as Record<string, unknown>;
    expect(profile.gpa).toBe(3.8);
    expect(profile.essayText).toBeUndefined();
    expect(profile.activitiesText).toBeUndefined();
    expect(c.written).toEqual({ essayText: 1200, activitiesText: 30, awardsText: 0 });
  });

  it("reports the current answer for every consent purpose", async () => {
    signInAs(ADMIN, "administrator");
    const { res, out } = mkRes();
    await caseHandler(mkReq({ query: { id: SUBJECT } }), res);

    const consents = out.body.consents as Record<string, unknown>[];
    expect(consents).toHaveLength(6);
    const human = consents.find((c) => c.purpose === "human_review")!;
    // The later record wins, and "never asked" is distinguishable from "no".
    expect(human.granted).toBe(true);
    expect(human.answered).toBe(true);
    const marketing = consents.find((c) => c.purpose === "marketing")!;
    expect(marketing.granted).toBe(false);
    expect(marketing.answered).toBe(false);
  });

  it("rejects a malformed case id before it reaches a query", async () => {
    signInAs(ADMIN, "administrator");
    for (const id of ["", "not-a-uuid", "*", `${SUBJECT}') or '1'='1`]) {
      const { res, out } = mkRes();
      await caseHandler(mkReq({ query: { id } }), res);
      expect(out.code).toBe(400);
    }
  });

  it("returns 404 for an id that is not a case, having logged the look", async () => {
    signInAs(ADMIN, "administrator");
    const { res, out } = mkRes();
    await caseHandler(mkReq({ query: { id: OUTSIDER } }), res);
    expect(out.code).toBe(404);
    expect(auditFor("view_case").at(-1)?.subject_id).toBe(OUTSIDER);
  });

  it("returns nothing when the access cannot be logged", async () => {
    signInAs(ADMIN, "administrator");
    state.failAudit = true;
    const { res, out } = mkRes();
    await caseHandler(mkReq({ query: { id: SUBJECT } }), res);
    expect(out.code).toBe(500);
    expect(out.body.case).toBeUndefined();
  });
});

/* ── POST /api/admin/assign ─────────────────────────────────────────────── */

describe("assignment", () => {
  beforeEach(() => {
    db.staff_roles.push({ user_id: REVIEWER, role: "reviewer", revoked_at: null, ip_allow: null });
  });

  it("lets an administrator assign a reviewer, and logs who did it", async () => {
    signInAs(ADMIN, "administrator");
    const { res, out } = mkRes();
    await assignHandler(
      mkReq({ method: "POST", body: { subjectId: SUBJECT, reviewerId: REVIEWER, reason: "intake" } }),
      res,
    );

    expect(out.code).toBe(200);
    expect(db.case_assignments).toHaveLength(1);
    expect(db.case_assignments[0].released_at).toBeNull();
    const row = auditFor("assign_case").at(-1)!;
    expect(row.actor_id).toBe(ADMIN);
    expect(row.subject_id).toBe(SUBJECT);
    expect((row.meta as Record<string, unknown>).reviewerId).toBe(REVIEWER);
  });

  it("refuses to assign a case to somebody who is not staff", async () => {
    signInAs(ADMIN, "administrator");
    const { res, out } = mkRes();
    await assignHandler(
      mkReq({ method: "POST", body: { subjectId: SUBJECT, reviewerId: OUTSIDER } }),
      res,
    );
    expect(out.code).toBe(409);
    expect(db.case_assignments).toHaveLength(0);
    expect(auditFor("assign_case").at(-1)?.success).toBe(false);
  });

  it("refuses an assignment to a case that does not exist", async () => {
    signInAs(ADMIN, "administrator");
    const { res, out } = mkRes();
    await assignHandler(
      mkReq({ method: "POST", body: { subjectId: OUTSIDER, reviewerId: REVIEWER } }),
      res,
    );
    expect(out.code).toBe(404);
    expect(db.case_assignments).toHaveLength(0);
  });

  it("releases an assignment by timestamp, not by deleting it", async () => {
    signInAs(ADMIN, "administrator");
    db.case_assignments.push({
      subject_id: SUBJECT, reviewer_id: REVIEWER, assigned_by: ADMIN,
      assigned_at: "2026-01-03T00:00:00Z", released_at: null,
    });

    const { res, out } = mkRes();
    await assignHandler(
      mkReq({ method: "POST", body: { subjectId: SUBJECT, reviewerId: REVIEWER, release: true } }),
      res,
    );

    expect(out.code).toBe(200);
    expect(db.case_assignments).toHaveLength(1);
    expect(db.case_assignments[0].released_at).toBeTruthy();
    expect(auditFor("release_case")).toHaveLength(1);
  });

  it("reports a release of something that was never assigned", async () => {
    signInAs(ADMIN, "administrator");
    const { res, out } = mkRes();
    await assignHandler(
      mkReq({ method: "POST", body: { subjectId: SUBJECT, reviewerId: REVIEWER, release: true } }),
      res,
    );
    expect(out.code).toBe(404);
    expect(auditFor("release_case").at(-1)?.success).toBe(false);
  });

  it("rejects malformed ids", async () => {
    signInAs(ADMIN, "administrator");
    const { res, out } = mkRes();
    await assignHandler(
      mkReq({ method: "POST", body: { subjectId: "all", reviewerId: REVIEWER } }),
      res,
    );
    expect(out.code).toBe(400);
    expect(db.case_assignments).toHaveLength(0);
  });

  it("caps how many reviewers one case can carry", async () => {
    signInAs(ADMIN, "administrator");
    for (let i = 0; i < 10; i++) {
      db.case_assignments.push({
        subject_id: SUBJECT, reviewer_id: `rev-${i}`, assigned_at: "2026-01-01T00:00:00Z", released_at: null,
      });
    }
    const { res, out } = mkRes();
    await assignHandler(
      mkReq({ method: "POST", body: { subjectId: SUBJECT, reviewerId: REVIEWER } }),
      res,
    );
    expect(out.code).toBe(409);
    expect(db.case_assignments).toHaveLength(10);
  });
});

/* ── GET /api/admin/audit ───────────────────────────────────────────────── */

describe("the audit log", () => {
  beforeEach(() => {
    db.admin_audit.push(
      { id: 1, actor_id: ADMIN, actor_role: "administrator", action: "view_case", subject_id: SUBJECT, success: true, created_at: "2026-02-01T10:00:00Z" },
      { id: 2, actor_id: REVIEWER, actor_role: "reviewer", action: "view_document", subject_id: SUBJECT, document_id: "doc-text", success: true, created_at: "2026-02-02T10:00:00Z" },
      { id: 3, actor_id: REVIEWER, actor_role: "reviewer", action: "view_case", subject_id: OTHER, success: false, created_at: "2026-02-03T10:00:00Z" },
    );
  });

  it("gives an administrator the log, and records that they read it", async () => {
    signInAs(ADMIN, "administrator");
    const { res, out } = mkRes();
    await auditHandler(mkReq({}), res);

    expect(out.code).toBe(200);
    expect((out.body.entries as unknown[]).length).toBeGreaterThanOrEqual(3);
    expect(auditFor("read_audit_log")).toHaveLength(1);
  });

  it("filters by actor, subject and action", async () => {
    signInAs(ADMIN, "administrator");

    const byActor = mkRes();
    await auditHandler(mkReq({ query: { actor: REVIEWER } }), byActor.res);
    expect((byActor.out.body.entries as Row[]).every((e) => e.actorId === REVIEWER)).toBe(true);

    const bySubject = mkRes();
    await auditHandler(mkReq({ query: { subject: OTHER } }), bySubject.res);
    expect((bySubject.out.body.entries as Row[]).every((e) => e.subjectId === OTHER)).toBe(true);

    const byAction = mkRes();
    await auditHandler(mkReq({ query: { action: "view_document" } }), byAction.res);
    expect((byAction.out.body.entries as Row[]).every((e) => e.action === "view_document")).toBe(true);
  });

  it("applies a date range", async () => {
    signInAs(ADMIN, "administrator");
    const { res, out } = mkRes();
    await auditHandler(
      mkReq({ query: { from: "2026-02-02T00:00:00Z", to: "2026-02-02T23:59:59Z" } }),
      res,
    );
    const entries = out.body.entries as Row[];
    expect(entries.every((e) => String(e.at).startsWith("2026-02-02"))).toBe(true);
  });

  it("refuses an unreadable date rather than ignoring the filter", async () => {
    signInAs(ADMIN, "administrator");
    const { res, out } = mkRes();
    await auditHandler(mkReq({ query: { from: "last tuesday" } }), res);
    expect(out.code).toBe(400);
  });

  it("refuses an action filter that is not an action name", async () => {
    signInAs(ADMIN, "administrator");
    const { res, out } = mkRes();
    await auditHandler(mkReq({ query: { action: "view_case,*" } }), res);
    expect(out.code).toBe(400);
  });

  it("clamps the page size instead of honouring it", async () => {
    signInAs(ADMIN, "administrator");
    const { res, out } = mkRes();
    await auditHandler(mkReq({ query: { limit: "100000", page: "-4" } }), res);
    expect(out.code).toBe(200);
    expect(out.body.limit).toBe(100);
    expect(out.body.page).toBe(0);
  });

  it("returns nothing when its own read cannot be logged", async () => {
    signInAs(ADMIN, "administrator");
    state.failAudit = true;
    const { res, out } = mkRes();
    await auditHandler(mkReq({}), res);
    expect(out.code).toBe(500);
    expect(out.body.entries).toBeUndefined();
  });
});

/* ── POST /api/admin/export ─────────────────────────────────────────────── */

describe("exporting one person's record", () => {
  const goodReason = "support request #4120, user asked for their file";

  it("demands a recently authenticated session", async () => {
    freshAdmin();
    const { res, out } = mkRes();
    await exportHandler(
      mkReq({ method: "POST", token: staleToken(), body: { userId: SUBJECT, reason: goodReason } }),
      res,
    );
    expect(out.code).toBe(401);
    expect(String(out.body.error)).toMatch(/confirm your password/i);
    expect(out.body.subject).toBeUndefined();
    expect(auditFor("export_user")).toHaveLength(0);
  });

  it("demands a written reason", async () => {
    freshAdmin();
    for (const reason of [undefined, "", "  ", "because"]) {
      const { res, out } = mkRes();
      await exportHandler(mkReq({ method: "POST", body: { userId: SUBJECT, reason } }), res);
      expect(out.code).toBe(400);
      expect(out.body.subject).toBeUndefined();
    }
    expect(auditFor("export_user").every((a) => a.success === false)).toBe(true);
  });

  it("exports the record and logs the reason and the manifest", async () => {
    freshAdmin();
    const { res, out } = mkRes();
    await exportHandler(
      mkReq({ method: "POST", body: { userId: SUBJECT, reason: goodReason } }),
      res,
    );

    expect(out.code).toBe(200);
    expect((out.body.subject as Row).email).toBe("student@example.com");
    expect(out.headers["cache-control"]).toMatch(/no-store/);

    const access = auditFor("export_user").at(-1)!;
    expect(access.reason).toBe(goodReason);
    expect(access.subject_id).toBe(SUBJECT);

    const manifest = auditFor("export_user_manifest").at(-1)!;
    const meta = manifest.meta as Record<string, unknown>;
    expect(meta.documents).toBe(2);
    expect(meta.documentIds).toEqual(["doc-file", "doc-text"]);
  });

  it("withholds document text unless it was explicitly asked for", async () => {
    freshAdmin();
    const { res, out } = mkRes();
    await exportHandler(
      mkReq({ method: "POST", body: { userId: SUBJECT, reason: goodReason } }),
      res,
    );
    const docs = out.body.documents as Row[];
    expect(docs.every((d) => d.content === null)).toBe(true);
    expect(JSON.stringify(out.body)).not.toMatch(/the essay itself/);
  });

  it("leaves the profile's written answers out unless content was asked for", async () => {
    // The intake form's essay box lands in profiles.profile, not in the
    // documents table. An export that says it carried no written material
    // must not be quietly shipping it inside the profile blob.
    freshAdmin();

    const without = mkRes();
    await exportHandler(
      mkReq({ method: "POST", body: { userId: SUBJECT, reason: goodReason } }),
      without.res,
    );
    expect(JSON.stringify(without.out.body)).not.toMatch(/the essay pasted into the form/);
    expect((without.out.body.subject as Row).written).toEqual({
      essayText: 1200, activitiesText: 30, awardsText: 0,
    });
    expect((without.out.body.manifest as Row).profileTextWithheld).toBe(1230);

    const with_ = mkRes();
    await exportHandler(
      mkReq({ method: "POST", body: { userId: SUBJECT, reason: goodReason, includeContent: true } }),
      with_.res,
    );
    expect(JSON.stringify(with_.out.body)).toMatch(/the essay pasted into the form/);
    expect((with_.out.body.manifest as Row).profileChars).toBe(1230);
  });

  it("includes text records on request but never a stored file or its URL", async () => {
    freshAdmin();
    const { res, out } = mkRes();
    await exportHandler(
      mkReq({ method: "POST", body: { userId: SUBJECT, reason: goodReason, includeContent: true } }),
      res,
    );

    const docs = out.body.documents as Row[];
    const text = docs.find((d) => d.id === "doc-text")!;
    const file = docs.find((d) => d.id === "doc-file")!;
    expect(String(text.content)).toMatch(/the essay itself/);
    // The PDF in private storage is listed, not handed over.
    expect(file.content).toBeNull();
    expect(file.stored).toBe(true);
    expect(JSON.stringify(out.body)).not.toMatch(/transcript\.pdf\?|signedUrl|token=/);
    expect(JSON.stringify(out.body)).not.toMatch(new RegExp(`${SUBJECT}/transcript`));
  });

  it("caps how many documents one export can carry, and says so", async () => {
    freshAdmin();
    for (let i = 0; i < 150; i++) {
      db.documents.push({
        id: `bulk-${String(i).padStart(3, "0")}`, user_id: SUBJECT, kind: "essay",
        name: `essay-${i}.txt`, content: "z", storage_path: null,
        created_at: `2026-03-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
      });
    }
    const { res, out } = mkRes();
    await exportHandler(
      mkReq({ method: "POST", body: { userId: SUBJECT, reason: goodReason } }),
      res,
    );

    expect((out.body.documents as unknown[]).length).toBe(100);
    const manifest = out.body.manifest as Record<string, unknown>;
    expect(manifest.documents).toBe(100);
    expect(manifest.documentsOmitted).toBe(52);
    expect(String((out.body.notes as string[])[0])).toMatch(/100 most recent/);
  });

  it("truncates a single oversized document rather than streaming it whole", async () => {
    freshAdmin();
    db.documents.push({
      id: "doc-huge", user_id: SUBJECT, kind: "statement", name: "huge.txt",
      content: "q".repeat(250_000), storage_path: null, created_at: "2026-04-01T00:00:00Z",
    });
    const { res, out } = mkRes();
    await exportHandler(
      mkReq({ method: "POST", body: { userId: SUBJECT, reason: goodReason, includeContent: true } }),
      res,
    );

    const huge = (out.body.documents as Row[]).find((d) => d.id === "doc-huge")!;
    expect(String(huge.content).length).toBe(100_000);
    expect(huge.truncated).toBe(true);
    expect((out.body.manifest as Row).truncatedDocuments).toBe(1);
  });

  it("rate-limits an administrator running export after export", async () => {
    freshAdmin();
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      const { res, out } = mkRes();
      await exportHandler(
        mkReq({ method: "POST", body: { userId: SUBJECT, reason: goodReason } }),
        res,
      );
      codes.push(out.code);
    }
    expect(codes.filter((c) => c === 200).length).toBeLessThanOrEqual(5);
    expect(codes.at(-1)).toBe(429);
  });

  it("returns nothing when the export cannot be logged", async () => {
    // A different actor id so the rate limiter from the previous test is not
    // what refuses this one.
    signInAs(OTHER, "administrator");
    state.failAudit = true;
    const { res, out } = mkRes();
    await exportHandler(
      mkReq({ method: "POST", body: { userId: SUBJECT, reason: goodReason } }),
      res,
    );
    expect(out.code).toBe(500);
    expect(out.body.subject).toBeUndefined();
  });
});

/* ── GET /api/admin/alerts ──────────────────────────────────────────────── */

describe("alerts", () => {
  beforeEach(() => {
    db.admin_alerts.push(
      { actor_id: ADMIN, kind: "many_subjects", value: 31, last_seen: "2026-02-03T09:00:00Z" },
      { actor_id: REVIEWER, kind: "bulk_export", value: 22, last_seen: "2026-02-03T11:00:00Z" },
    );
  });

  it("gives an administrator the list and logs the read", async () => {
    signInAs(ADMIN, "administrator");
    const { res, out } = mkRes();
    await alertsHandler(mkReq({}), res);

    expect(out.code).toBe(200);
    const alerts = out.body.alerts as Row[];
    expect(alerts).toHaveLength(2);
    // Ordered most recent first, with the real count from the view.
    expect(alerts[0].kind).toBe("bulk_export");
    expect(alerts[0].value).toBe(22);
    expect(auditFor("read_alerts")).toHaveLength(1);
  });

  it("marks an alert that is about the person reading it", async () => {
    signInAs(ADMIN, "administrator");
    const { res, out } = mkRes();
    await alertsHandler(mkReq({}), res);
    const mine = (out.body.alerts as Row[]).find((a) => a.actorId === ADMIN)!;
    expect(mine.aboutViewer).toBe(true);
  });

  it("clamps the row limit", async () => {
    signInAs(ADMIN, "administrator");
    const { res, out } = mkRes();
    await alertsHandler(mkReq({ query: { limit: "9999" } }), res);
    expect(out.code).toBe(200);
    expect((out.body.alerts as unknown[]).length).toBeLessThanOrEqual(200);
  });

  it("returns nothing when the read cannot be logged", async () => {
    signInAs(ADMIN, "administrator");
    state.failAudit = true;
    const { res, out } = mkRes();
    await alertsHandler(mkReq({}), res);
    expect(out.code).toBe(500);
    expect(out.body.alerts).toBeUndefined();
  });
});

/* ── Nothing reaches these routes without a session ─────────────────────── */

describe("an anonymous or non-staff caller", () => {
  const all: [string, (req: never, res: never) => Promise<void>, "GET" | "POST"][] = [
    ["case", caseHandler, "GET"],
    ["assign", assignHandler, "POST"],
    ["audit", auditHandler, "GET"],
    ["export", exportHandler, "POST"],
    ["alerts", alertsHandler, "GET"],
  ];

  for (const [name, handler, method] of all) {
    it(`${name} refuses a signed-in user who holds no staff role`, async () => {
      state.user = { id: OUTSIDER, email: "nobody@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" };
      const { res, out } = mkRes();
      await handler(
        mkReq({ method, query: { id: SUBJECT }, body: { subjectId: SUBJECT, reviewerId: REVIEWER, userId: SUBJECT, reason: "any reason at all" } }),
        res,
      );
      expect(out.code).toBe(403);
      expect(Object.keys(out.body)).toEqual(["error"]);
    });

    it(`${name} refuses a forged token`, async () => {
      signInAs(ADMIN, "administrator");
      const { res, out } = mkRes();
      await handler(
        mkReq({ method, token: "forged", query: { id: SUBJECT }, body: { userId: SUBJECT, reason: "any reason at all" } }),
        res,
      );
      expect(out.code).toBe(401);
    });

    it(`${name} refuses a staff session that never completed a second factor`, async () => {
      signInAs(ADMIN, "administrator");
      const { res, out } = mkRes();
      await handler(
        mkReq({
          method, token: token({ aal: "aal1" }), query: { id: SUBJECT },
          body: { userId: SUBJECT, reason: "any reason at all" },
        }),
        res,
      );
      expect(out.code).toBe(403);
      expect(String(out.body.error)).toMatch(/multi-factor/i);
    });
  }
});
