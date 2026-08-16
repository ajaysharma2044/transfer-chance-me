// Authorization tests for the admin portal.
//
// These prove the properties that matter even when nobody is watching: that a
// normal user cannot reach admin data, that a reviewer cannot read a case
// they were not assigned, that a removed admin loses access at once, and that
// no route can be talked into skipping the audit log.
//
// The Supabase client is faked, so these run with no network and no project —
// what is under test is OUR decision logic, which is where the mistakes that
// matter would live. The policies in supabase/*.sql are the second line of
// defence and are exercised separately against a real project (see
// supabase/SETUP.md → "Verifying authorization").

import { beforeEach, describe, expect, it, vi } from "vitest";

/* ── A fake Supabase, shaped like the calls the guard actually makes ────── */

interface FakeState {
  user: { id: string; email: string; email_confirmed_at: string | null } | null;
  staffRow: { role: string; revoked_at: string | null; ip_allow: string[] | null } | null;
  assignments: { subject_id: string; reviewer_id: string; released_at: string | null }[];
  audits: Record<string, unknown>[];
  failAudit: boolean;
}

const state: FakeState = {
  user: null, staffRow: null, assignments: [], audits: [], failAudit: false,
};

function fakeClient() {
  return {
    auth: {
      getUser: async (token: string) =>
        token === "forged" || !state.user
          ? { data: { user: null }, error: new Error("bad token") }
          : { data: { user: state.user }, error: null },
      admin: { signOut: async () => ({}), getUserById: async () => ({ data: { user: state.user }, error: null }) },
    },
    from(table: string) {
      const api = {
        _filters: {} as Record<string, unknown>,
        select() { return api; },
        eq(col: string, val: unknown) { api._filters[col] = val; return api; },
        is() { return api; },
        async maybeSingle() {
          if (table === "staff_roles") return { data: state.staffRow, error: null };
          if (table === "case_assignments") {
            const hit = state.assignments.find(
              (a) => a.subject_id === api._filters.subject_id &&
                     a.reviewer_id === api._filters.reviewer_id && a.released_at === null,
            );
            return { data: hit ?? null, error: null };
          }
          return { data: null, error: null };
        },
        async insert(row: Record<string, unknown>) {
          if (table === "admin_audit") {
            if (state.failAudit) return { error: new Error("log down") };
            state.audits.push(row);
          }
          return { error: null };
        },
      };
      return api;
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({ createClient: () => fakeClient() }));

process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key-for-tests";

/** A token whose payload carries the claims the guard reads. Its signature is
 *  irrelevant here because getUser() is what validates it — which is exactly
 *  the property we want: claims are read only after verification. */
function token(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64({ iat: Math.floor(Date.now() / 1000), ...claims })}.sig`;
}

const req = (t: string, extra: Record<string, unknown> = {}) =>
  ({
    headers: { authorization: `Bearer ${t}`, "user-agent": "test", "x-forwarded-for": "203.0.113.9" },
    socket: { remoteAddress: "203.0.113.9" },
    ...extra,
  }) as never;

const { requireStaff, canViewCase, audit, AuthzError } = await import("../api/_admin.js");

beforeEach(() => {
  state.user = { id: "user-1", email: "a@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" };
  state.staffRow = null;
  state.assignments = [];
  state.audits = [];
  state.failAudit = false;
});

describe("a normal user cannot reach admin data", () => {
  it("is refused when they hold no staff row at all", async () => {
    state.staffRow = null;
    await expect(requireStaff(req(token({ aal: "aal2" })))).rejects.toThrow(/not authorized/i);
  });

  it("cannot promote themselves by putting a role in their own token", async () => {
    // user_metadata and custom claims are user-influencable; the guard must
    // ignore them entirely and read the table instead.
    state.staffRow = null;
    const forged = token({ aal: "aal2", role: "owner", user_metadata: { role: "owner" } });
    await expect(requireStaff(req(forged))).rejects.toThrow(/not authorized/i);
  });

  it("cannot escalate an existing low role by forging a higher one in the token", async () => {
    // The dangerous version of the previous test: this caller IS staff, so
    // the guard runs all the way through role resolution. If the role were
    // ever read from the token instead of the table, a reviewer would reach
    // an owner-only route — so this is the test that must fail loudly if
    // that regression is introduced.
    state.staffRow = { role: "reviewer", revoked_at: null, ip_allow: null };
    const escalating = token({ aal: "aal2", role: "owner", user_metadata: { role: "owner" } });

    const actor = await requireStaff(req(escalating));
    expect(actor.role).toBe("reviewer");

    await expect(
      requireStaff(req(escalating), { min: "owner" }),
    ).rejects.toThrow(/not authorized/i);
  });

  it("is refused with a forged or unparseable token", async () => {
    state.staffRow = { role: "owner", revoked_at: null, ip_allow: null };
    await expect(requireStaff(req("forged"))).rejects.toThrow(/sign in/i);
  });

  it("is refused with no Authorization header", async () => {
    await expect(requireStaff({ headers: {}, socket: {} } as never)).rejects.toThrow(/sign in/i);
  });
});

describe("multi-factor and email verification are mandatory for staff", () => {
  it("refuses a staff session that has not completed a second factor", async () => {
    state.staffRow = { role: "administrator", revoked_at: null, ip_allow: null };
    await expect(requireStaff(req(token({ aal: "aal1" })))).rejects.toThrow(/multi-factor/i);
  });

  it("refuses an unconfirmed email address", async () => {
    state.user = { id: "user-1", email: "a@example.com", email_confirmed_at: null };
    state.staffRow = { role: "owner", revoked_at: null, ip_allow: null };
    await expect(requireStaff(req(token({ aal: "aal2" })))).rejects.toThrow(/confirm your email/i);
  });
});

describe("role ranking", () => {
  it("lets a reviewer through a reviewer-level route", async () => {
    state.staffRow = { role: "reviewer", revoked_at: null, ip_allow: null };
    const actor = await requireStaff(req(token({ aal: "aal2" })));
    expect(actor.role).toBe("reviewer");
  });

  it("stops a reviewer reaching an administrator route", async () => {
    state.staffRow = { role: "reviewer", revoked_at: null, ip_allow: null };
    await expect(
      requireStaff(req(token({ aal: "aal2" })), { min: "administrator" }),
    ).rejects.toThrow(/not authorized/i);
  });

  it("stops an administrator reaching an owner route", async () => {
    state.staffRow = { role: "administrator", revoked_at: null, ip_allow: null };
    await expect(
      requireStaff(req(token({ aal: "aal2" })), { min: "owner" }),
    ).rejects.toThrow(/not authorized/i);
  });
});

describe("a removed administrator loses access immediately", () => {
  it("is refused on the very next request after revocation", async () => {
    state.staffRow = { role: "administrator", revoked_at: null, ip_allow: null };
    await expect(requireStaff(req(token({ aal: "aal2" })))).resolves.toBeTruthy();

    // The query filters on revoked_at is null, so a revoked grant returns no
    // row — modelled here as the row disappearing.
    state.staffRow = null;
    await expect(requireStaff(req(token({ aal: "aal2" })))).rejects.toThrow(/not authorized/i);
  });
});

describe("reviewers are confined to assigned cases", () => {
  const reviewer = { id: "rev-1", role: "reviewer" as const, email: "r@x.com", ip: "1.1.1.1", userAgent: "t", authAgeMs: 0 };

  it("can open a case assigned to them", async () => {
    state.assignments = [{ subject_id: "subj-1", reviewer_id: "rev-1", released_at: null }];
    expect(await canViewCase(reviewer, "subj-1")).toBe(true);
  });

  it("cannot open a case assigned to somebody else", async () => {
    state.assignments = [{ subject_id: "subj-1", reviewer_id: "other", released_at: null }];
    expect(await canViewCase(reviewer, "subj-1")).toBe(false);
  });

  it("cannot open a case whose assignment was released", async () => {
    state.assignments = [{ subject_id: "subj-1", reviewer_id: "rev-1", released_at: "2026-01-01" }];
    expect(await canViewCase(reviewer, "subj-1")).toBe(false);
  });

  it("administrators and owners are not confined by assignment", async () => {
    const adminActor = { ...reviewer, role: "administrator" as const };
    const owner = { ...reviewer, role: "owner" as const };
    expect(await canViewCase(adminActor, "any-subject")).toBe(true);
    expect(await canViewCase(owner, "any-subject")).toBe(true);
  });
});

describe("sensitive actions need a recent session", () => {
  it("refuses a stale session even for an owner", async () => {
    state.staffRow = { role: "owner", revoked_at: null, ip_allow: null };
    const old = token({ aal: "aal2", iat: Math.floor(Date.now() / 1000) - 60 * 60 });
    await expect(
      requireStaff(req(old), { min: "owner", sensitive: true }),
    ).rejects.toThrow(/confirm your password/i);
  });

  it("allows a fresh session", async () => {
    state.staffRow = { role: "owner", revoked_at: null, ip_allow: null };
    await expect(
      requireStaff(req(token({ aal: "aal2" })), { min: "owner", sensitive: true }),
    ).resolves.toBeTruthy();
  });
});

describe("owner IP allow-list", () => {
  it("refuses an owner connecting from outside their allow-list", async () => {
    state.staffRow = { role: "owner", revoked_at: null, ip_allow: ["198.51.100.4"] };
    await expect(requireStaff(req(token({ aal: "aal2" })))).rejects.toThrow(/network/i);
  });

  it("allows one that matches", async () => {
    state.staffRow = { role: "owner", revoked_at: null, ip_allow: ["203.0.113.9"] };
    await expect(requireStaff(req(token({ aal: "aal2" })))).resolves.toBeTruthy();
  });
});

describe("the audit log", () => {
  it("records denials, not just successes", async () => {
    state.staffRow = { role: "reviewer", revoked_at: null, ip_allow: null };
    await expect(
      requireStaff(req(token({ aal: "aal2" })), { min: "owner" }),
    ).rejects.toThrow();
    const denial = state.audits.find((a) => a.action === "admin_access_denied");
    expect(denial).toBeTruthy();
    expect(denial?.success).toBe(false);
  });

  it("captures actor, ip and user agent", async () => {
    const actor = { id: "a-1", role: "owner" as const, email: "o@x.com", ip: "203.0.113.9", userAgent: "UA/1", authAgeMs: 0 };
    await audit(actor, { action: "view_document", subjectId: "s-1", documentId: "d-1" });
    const row = state.audits.at(-1)!;
    expect(row.actor_id).toBe("a-1");
    expect(row.ip).toBe("203.0.113.9");
    expect(row.user_agent).toBe("UA/1");
    expect(row.document_id).toBe("d-1");
  });

  it("never carries document contents", async () => {
    const actor = { id: "a-1", role: "owner" as const, email: "o@x.com", ip: "1.1.1.1", userAgent: "t", authAgeMs: 0 };
    await audit(actor, { action: "view_document", meta: { kind: "transcript", name: "t.pdf" } });
    expect(JSON.stringify(state.audits.at(-1))).not.toMatch(/content/i);
  });

  it("fails the request when the log cannot be written, rather than proceeding unlogged", async () => {
    state.failAudit = true;
    const actor = { id: "a-1", role: "owner" as const, email: "o@x.com", ip: "1.1.1.1", userAgent: "t", authAgeMs: 0 };
    await expect(audit(actor, { action: "view_document" })).rejects.toThrow(AuthzError);
  });
});
