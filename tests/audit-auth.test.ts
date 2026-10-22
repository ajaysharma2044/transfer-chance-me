// Stage B (docs/spec.md §5): the paid endpoint knows who is calling.
//
// requireUser asks Supabase Auth, so Supabase is faked here as a fetch: what is
// under test is our handling of its answers and the token cache, which is
// where a mistake would be quiet — a 500 from Auth read as "signed in", or a
// cache keyed so one user's token answers for another.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { bearer, requireUser, resetAuthCache } from "../netlify/functions/_auth";

const deps = { url: "https://example.supabase.co", anonKey: "sb_publishable_test" };

function req(auth?: string): Request {
  return new Request("https://site.test/api/review", { headers: auth ? { authorization: auth } : {} });
}

function authServer(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

beforeEach(() => resetAuthCache());

describe("bearer", () => {
  it("reads a Bearer token and nothing else", () => {
    expect(bearer(req("Bearer abc.def.ghi"))).toBe("abc.def.ghi");
    expect(bearer(req("bearer  spaced  "))).toBe("spaced");
    expect(bearer(req("Basic abc"))).toBeNull();
    expect(bearer(req())).toBeNull();
  });
});

describe("requireUser", () => {
  it("is 503, not 401, when sign-in is not configured — so the client can say so", async () => {
    const r = await requireUser(req("Bearer t"), { url: "", anonKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(503);
  });

  it("is 401 without a token, and never calls Supabase", async () => {
    const fetch = authServer(200, { id: "u1" });
    const r = await requireUser(req(), { ...deps, fetch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks /auth/v1/user with the anon key and returns the caller", async () => {
    const fetch = authServer(200, { id: "user-1", email: "a@example.com" });
    const r = await requireUser(req("Bearer tok1"), { ...deps, fetch });
    expect(r).toEqual({ ok: true, caller: { uid: "user-1", email: "a@example.com" } });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.supabase.co/auth/v1/user");
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe(deps.anonKey);
    expect(headers.authorization).toBe("Bearer tok1");
  });

  it("a rejected token is 401; an Auth outage is 503 — never a signed-in caller", async () => {
    const bad = await requireUser(req("Bearer tok2"), { ...deps, fetch: authServer(401, { msg: "invalid" }) });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.status).toBe(401);
    const down = await requireUser(req("Bearer tok3"), { ...deps, fetch: authServer(500, {}) });
    expect(down.ok).toBe(false);
    if (!down.ok) expect(down.status).toBe(503);
    const noId = await requireUser(req("Bearer tok4"), { ...deps, fetch: authServer(200, { email: "x" }) });
    expect(noId.ok).toBe(false);
  });

  it("caches a verified token for a minute, per token", async () => {
    let now = 1_000_000;
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const auth = ((init?.headers ?? {}) as Record<string, string>).authorization;
      const id = auth === "Bearer alice" ? "alice-id" : "bob-id";
      return new Response(JSON.stringify({ id }), { status: 200 });
    });
    const d = { ...deps, fetch, now: () => now };
    const a1 = await requireUser(req("Bearer alice"), d);
    const a2 = await requireUser(req("Bearer alice"), d);
    const b1 = await requireUser(req("Bearer bob"), d);
    expect(a1.ok && a1.caller.uid).toBe("alice-id");
    expect(a2.ok && a2.caller.uid).toBe("alice-id");
    expect(b1.ok && b1.caller.uid).toBe("bob-id");
    expect(fetch).toHaveBeenCalledTimes(2); // alice once, bob once
    now += 61_000;
    await requireUser(req("Bearer alice"), d);
    expect(fetch).toHaveBeenCalledTimes(3); // re-verified after the TTL
  });
});
