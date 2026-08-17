// Tests for POST /api/account/delete — self-service account erasure.
//
// The properties under test, stated plainly:
//
//   · nobody is deleted without a verified session: missing and forged
//     tokens get 401 and the delete call never happens
//   · the storage folder goes first, then the auth user — storage does not
//     cascade, so the other order strands files forever
//   · a user who ever acted as staff is refused with 409: self-deletion must
//     never be a way to erase your own audit trail
//   · the ONLY account ever deleted is the token's — a body carrying someone
//     else's id changes nothing
//   · wrong verb → 405, and a burst from one address → 429
//
// Supabase is faked in memory, the same way tests/admin-routes.test.ts does
// it: no network, no project. What is being tested is our decision logic.

import { beforeEach, describe, expect, it, vi } from "vitest";

/* ── An in-memory Supabase, shaped like the calls this route makes ──────── */

const state = {
  user: null as { id: string; email: string } | null,
  /** Object names in the signed-in user's storage folder. */
  files: [] as string[],
  /** admin_audit rows — presence of one for a uid marks them as ex-staff. */
  auditRows: [] as { actor_id: string }[],
  /** When set, auth.admin.deleteUser fails with this error. */
  deleteUserError: null as { message: string } | null,
  /** Every consequential call, in the order it happened. */
  calls: [] as string[],
  deletedIds: [] as string[],
  listedPrefixes: [] as string[],
  removedPaths: [] as string[][],
};

function fakeClient() {
  return {
    auth: {
      getUser: async (token: string) =>
        token === "forged" || !state.user
          ? { data: { user: null }, error: new Error("bad token") }
          : { data: { user: state.user }, error: null },
      admin: {
        deleteUser: async (id: string) => {
          state.calls.push("auth.deleteUser");
          state.deletedIds.push(id);
          return state.deleteUserError
            ? { data: { user: null }, error: state.deleteUserError }
            : { data: { user: null }, error: null };
        },
      },
    },
    storage: {
      from: (bucket: string) => ({
        list: async (prefix: string, _opts?: { limit?: number; offset?: number }) => {
          state.calls.push("storage.list");
          state.listedPrefixes.push(`${bucket}/${prefix}`);
          return { data: state.files.map((name) => ({ name })), error: null };
        },
        remove: async (paths: string[]) => {
          state.calls.push("storage.remove");
          state.removedPaths.push(paths);
          return { data: [], error: null };
        },
      }),
    },
    from(table: string) {
      const eqs: [string, unknown][] = [];
      let take: number | null = null;
      const api = {
        select(_cols?: string) { return api; },
        eq(c: string, v: unknown) { eqs.push([c, v]); return api; },
        limit(n: number) { take = n; return api; },
        // Awaiting the builder runs the query, exactly like supabase-js.
        then(ok: (v: unknown) => unknown, no?: (e: unknown) => unknown) {
          let rows: Record<string, unknown>[] =
            table === "admin_audit" ? state.auditRows.map((r, i) => ({ id: i + 1, ...r })) : [];
          rows = rows.filter((r) => eqs.every(([c, v]) => r[c] === v));
          if (take !== null) rows = rows.slice(0, take);
          return Promise.resolve({ data: rows, error: null }).then(ok, no);
        },
      };
      return api;
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({ createClient: () => fakeClient() }));

process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key-for-tests";

/* ── Request and response doubles ───────────────────────────────────────── */

// A fresh IP per request by default: the route rate-limits per IP and one
// test's requests must not be what refuses the next test's.
let ipN = 0;
function mkReq(opts: { method?: string; token?: string | null; body?: unknown; ip?: string } = {}) {
  const ip = opts.ip ?? `198.51.100.${(ipN++ % 250) + 1}`;
  const headers: Record<string, string> = { "user-agent": "test", "x-forwarded-for": ip };
  if (opts.token !== null) headers.authorization = `Bearer ${opts.token ?? "good-token"}`;
  return {
    method: opts.method ?? "POST",
    headers,
    socket: { remoteAddress: ip },
    query: {},
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

/* ── Fixtures ───────────────────────────────────────────────────────────── */

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOMEONE_ELSE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const handler = (await import("../api/account/delete.js")).default;

beforeEach(() => {
  state.user = { id: ME, email: "me@example.com" };
  state.files = ["transcript.pdf", "essay.txt"];
  state.auditRows = [];
  state.deleteUserError = null;
  state.calls = [];
  state.deletedIds = [];
  state.listedPrefixes = [];
  state.removedPaths = [];
});

/* ── Nobody is deleted without a verified session ───────────────────────── */

describe("authorization", () => {
  it("refuses a request with no token, deleting nothing", async () => {
    const { res, out } = mkRes();
    await handler(mkReq({ token: null }), res);
    expect(out.code).toBe(401);
    expect(Object.keys(out.body)).toEqual(["error"]);
    expect(state.calls).toEqual([]);
  });

  it("refuses a forged token, deleting nothing", async () => {
    const { res, out } = mkRes();
    await handler(mkReq({ token: "forged" }), res);
    expect(out.code).toBe(401);
    expect(state.calls).toEqual([]);
    expect(state.deletedIds).toEqual([]);
  });

  it("refuses when there is no session behind the token", async () => {
    state.user = null;
    const { res, out } = mkRes();
    await handler(mkReq({}), res);
    expect(out.code).toBe(401);
    expect(state.calls).toEqual([]);
  });
});

/* ── The happy path, and its order ──────────────────────────────────────── */

describe("deletion", () => {
  it("removes the storage folder first, then the auth user", async () => {
    const { res, out } = mkRes();
    await handler(mkReq({}), res);

    expect(out.code).toBe(200);
    expect(out.body.ok).toBe(true);
    // Storage does not cascade: files must be gone before the user is.
    expect(state.calls).toEqual(["storage.list", "storage.remove", "auth.deleteUser"]);
    expect(state.listedPrefixes).toEqual([`documents/${ME}`]);
    expect(state.removedPaths).toEqual([[`${ME}/transcript.pdf`, `${ME}/essay.txt`]]);
    expect(state.deletedIds).toEqual([ME]);
  });

  it("still deletes an account whose folder is empty, without a remove call", async () => {
    state.files = [];
    const { res, out } = mkRes();
    await handler(mkReq({}), res);

    expect(out.code).toBe(200);
    // remove([]) is an error in supabase-js; an empty folder skips straight
    // to the account.
    expect(state.calls).toEqual(["storage.list", "auth.deleteUser"]);
    expect(state.deletedIds).toEqual([ME]);
  });

  it("responds with no-store cache headers, success or not", async () => {
    const ok = mkRes();
    await handler(mkReq({}), ok.res);
    expect(ok.out.headers["cache-control"]).toMatch(/no-store/);

    const refused = mkRes();
    await handler(mkReq({ token: "forged" }), refused.res);
    expect(refused.out.headers["cache-control"]).toMatch(/no-store/);
  });
});

/* ── Only the token's account, ever ─────────────────────────────────────── */

describe("the id comes from the token, never the body", () => {
  it("ignores a body naming somebody else and deletes only the caller", async () => {
    const { res, out } = mkRes();
    await handler(
      mkReq({ body: { userId: SOMEONE_ELSE, id: SOMEONE_ELSE, user_id: SOMEONE_ELSE } }),
      res,
    );

    expect(out.code).toBe(200);
    expect(state.deletedIds).toEqual([ME]);
    expect(state.listedPrefixes).toEqual([`documents/${ME}`]);
    for (const batch of state.removedPaths) {
      for (const p of batch) expect(p.startsWith(`${ME}/`)).toBe(true);
    }
  });
});

/* ── The staff edge: no erasing your own audit trail ────────────────────── */

describe("a user who ever acted as staff", () => {
  it("is refused with 409 before anything is touched", async () => {
    // admin_audit.actor_id is ON DELETE RESTRICT: rows here mean deleteUser
    // would fail anyway. The route refuses up front, files intact.
    state.auditRows = [{ actor_id: ME }];
    const { res, out } = mkRes();
    await handler(mkReq({}), res);

    expect(out.code).toBe(409);
    expect(String(out.body.error)).toMatch(/staff.*owner/i);
    expect(state.calls).toEqual([]);
    expect(state.deletedIds).toEqual([]);
  });

  it("maps the FK refusal to the same 409 if the delete call itself fails", async () => {
    // The belt-and-braces path: the pre-check saw nothing, but the database
    // RESTRICT still refused. Same honest answer, not a generic 500.
    state.deleteUserError = {
      message: 'update or delete on table "users" violates foreign key constraint "admin_audit_actor_id_fkey"',
    };
    const { res, out } = mkRes();
    await handler(mkReq({}), res);

    expect(out.code).toBe(409);
    expect(String(out.body.error)).toMatch(/staff.*owner/i);
  });

  it("does not touch someone whose audit rows belong to another actor", async () => {
    state.auditRows = [{ actor_id: SOMEONE_ELSE }];
    const { res, out } = mkRes();
    await handler(mkReq({}), res);
    expect(out.code).toBe(200);
    expect(state.deletedIds).toEqual([ME]);
  });
});

/* ── Method and rate limit ──────────────────────────────────────────────── */

describe("the route's outer defences", () => {
  it("refuses GET with 405, before authenticating", async () => {
    const { res, out } = mkRes();
    await handler(mkReq({ method: "GET" }), res);
    expect(out.code).toBe(405);
    expect(state.calls).toEqual([]);
  });

  it("rate-limits a burst from one address", async () => {
    const ip = "203.0.113.77";
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const { res, out } = mkRes();
      await handler(mkReq({ ip }), res);
      codes.push(out.code);
    }
    expect(codes.at(-1)).toBe(429);
    expect(codes.filter((c) => c === 200).length).toBeLessThanOrEqual(5);
  });

  it("returns a plain 500 when something unexpected breaks, leaking nothing", async () => {
    state.deleteUserError = { message: "connection reset by peer at 10.0.3.7:5432" };
    const { res, out } = mkRes();
    await handler(mkReq({}), res);
    expect(out.code).toBe(500);
    expect(out.body.error).toBe("Something went wrong.");
    expect(JSON.stringify(out.body)).not.toMatch(/10\.0\.3\.7/);
  });
});
