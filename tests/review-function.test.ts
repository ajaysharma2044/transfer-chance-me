// The paid request path, end to end, without a network: review.ts (start +
// poll) and review-background.ts (claim, prompt, model call, validate, store)
// against an in-memory Netlify Blobs, an injected session check, and a mock
// model. The browser-side proxyTransport consumes the REAL handler's
// responses here, so the wire contract is asserted against the server rather
// than against a hand-written fake of it.

import { beforeEach, describe, expect, it, vi } from "vitest";

/* ── An in-memory Netlify Blobs with the calls the store makes ──────────── */
const blobs = new Map<string, string>();
vi.mock("@netlify/blobs", () => ({
  getStore: () => ({
    async get(key: string, opts?: { type?: string }) {
      const v = blobs.get(key);
      if (v == null) return null;
      return opts?.type === "json" ? JSON.parse(v) : v;
    },
    async setJSON(key: string, value: unknown) { blobs.set(key, JSON.stringify(value)); },
    async set(key: string, value: string, opts?: { onlyIfNew?: boolean }) {
      if (opts?.onlyIfNew && blobs.has(key)) return { modified: false };
      blobs.set(key, String(value));
      return { modified: true };
    },
    async delete(key: string) { blobs.delete(key); },
  }),
}));

/* ── Sessions: two users, verified by a fake Supabase ───────────────────── */
vi.mock("../netlify/functions/_auth", () => ({
  requireUser: vi.fn(async (req: Request) => {
    const h = req.headers.get("authorization") ?? "";
    if (h === "Bearer alice") return { ok: true, caller: { uid: "alice-id", email: null } };
    if (h === "Bearer bob") return { ok: true, caller: { uid: "bob-id", email: null } };
    return { ok: false, status: 401, error: "Sign in to run the deep audit." };
  }),
}));

/* ── The model: a canned, valid specialist / lead reply through a fake ledger ── */
const section = {
  grade: "B+", headline: "Solid.", notes: [{ quote: "q", issue: "i", fix: "f" }], actions: ["a"], missing: [],
};
const leadSection = { grade: "B", summary: "Fine.", strengths: ["s"], risks: ["r"], priorities: ["p"] };
const validReply = async (args: { kind: string }) => ({
  text: JSON.stringify(args.kind === "audit:lead" ? leadSection : section),
  model: "mock", costUsd: 0.001, inputTokens: 10, outputTokens: 5,
});
const callModel = vi.fn(validReply);
vi.mock("../netlify/functions/_llm", () => ({
  callModel: (args: { kind: string }) => callModel(args),
  openRouterProvider: {},
  anthropicProvider: {},
}));

import startHandler from "../netlify/functions/review";
import workerHandler from "../netlify/functions/review-background";
import { proxyTransport } from "../src/lib/audit/client";
import { DEFAULT_PROFILE } from "../src/engine";
import { toAuditProfile } from "../src/lib/panel";

const ORIGIN = "https://site.test";
const body = {
  schemaVersion: 1, kind: "specialist", specialist: "essay",
  input: { profile: toAuditProfile(DEFAULT_PROFILE), targets: ["Cornell"], whyTransfer: "I want Cornell.", statement: "", activities: "" },
};

function post(json: unknown, token?: string, extra: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/review`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
    body: JSON.stringify(json),
  });
}
function get(jobId: string, token?: string): Request {
  return new Request(`${ORIGIN}/api/review?job=${jobId}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
}

/** Routes the worker trigger (an HTTP call in production) straight to the
 *  worker handler, so a start runs the whole pipeline inside the test. */
const workerRuns: string[] = [];
beforeEach(() => {
  blobs.clear();
  workerRuns.length = 0;
  callModel.mockReset();
  callModel.mockImplementation(validReply); // a test that swaps the reply must not leak into the next
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  vi.stubEnv("OPENROUTER_MODEL", "mock-model");
  vi.stubEnv("ALLOWED_ORIGIN", "");
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/.netlify/functions/review-background")) {
      const { jobId } = JSON.parse(String(init?.body)) as { jobId: string };
      workerRuns.push(jobId);
      await workerHandler(new Request(u, { method: "POST", body: JSON.stringify({ jobId }) }));
      return new Response(null, { status: 202 });
    }
    throw new Error(`unexpected fetch ${u}`);
  }));
});

describe("POST /api/review", () => {
  it("refuses without a session, before any store write", async () => {
    const res = await startHandler(post(body));
    expect(res.status).toBe(401);
    expect(blobs.size).toBe(0);
  });

  it("refuses the legacy { prompt } body", async () => {
    const res = await startHandler(post({ prompt: "You are a reviewer" }, "alice"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/structured|prompt/i);
  });

  it("queues a typed request under the caller, fires the worker, answers 202 with the poll contract", async () => {
    const res = await startHandler(post(body, "alice"));
    expect(res.status).toBe(202);
    const j = (await res.json()) as Record<string, unknown>;
    expect(j.status).toBe("pending");
    expect(typeof j.jobId).toBe("string");
    expect(j.pollAfterMs).toBeGreaterThan(0);
    expect(j.expiresInMs).toBeGreaterThan(Number(j.pollAfterMs));
    expect(workerRuns).toEqual([j.jobId]);
  });

  it("allows the site's own origin without listing it, and refuses a foreign one when a list is set", async () => {
    vi.stubEnv("ALLOWED_ORIGIN", "https://other.example");
    expect((await startHandler(post(body, "alice", { origin: ORIGIN }))).status).toBe(202);
    expect((await startHandler(post(body, "alice", { origin: "https://evil.example" }))).status).toBe(403);
  });
});

describe("the worker", () => {
  it("runs once per job, validates per section, stores only the picked fields, and the request text is gone", async () => {
    const start = await startHandler(post(body, "alice"));
    const { jobId } = (await start.json()) as { jobId: string };
    expect(callModel).toHaveBeenCalledTimes(1);
    // The applicant's request record was consumed; the result is there.
    expect([...blobs.keys()].some((k) => k.startsWith("req/"))).toBe(false);
    const job = JSON.parse(blobs.get(`job/${jobId}`)!) as { value: { status: string; result: { kind: string; section: unknown }; uid: string } };
    expect(job.value.status).toBe("done");
    expect(job.value.result).toEqual({ kind: "specialist", section });
    expect(job.value.uid).toBe("alice-id");
    // A replayed trigger finds the job no longer pending and does nothing.
    await workerHandler(new Request(`${ORIGIN}/.netlify/functions/review-background`, { method: "POST", body: JSON.stringify({ jobId }) }));
    expect(callModel).toHaveBeenCalledTimes(1);
  });

  it("ignores a made-up job id without writing anything", async () => {
    await workerHandler(new Request(`${ORIGIN}/.netlify/functions/review-background`, {
      method: "POST", body: JSON.stringify({ jobId: "11111111-2222-4333-8444-555555555555" }),
    }));
    expect(blobs.size).toBe(0);
    expect(callModel).not.toHaveBeenCalled();
  });

  it("an unreadable model reply is retried once, then recorded as a safe error", async () => {
    callModel.mockImplementation(async () => ({ text: "I cannot do JSON today.", model: "mock", costUsd: 0.001, inputTokens: 1, outputTokens: 1 }));
    const start = await startHandler(post(body, "alice"));
    const { jobId } = (await start.json()) as { jobId: string };
    expect(callModel).toHaveBeenCalledTimes(2);
    const job = JSON.parse(blobs.get(`job/${jobId}`)!) as { value: { status: string; error: string } };
    expect(job.value.status).toBe("error");
    expect(job.value.error).toMatch(/unreadable/);
    expect(job.value.error).not.toMatch(/JSON today/); // never the model's text
  });
});

describe("GET /api/review?job=", () => {
  it("is owner-only, and delivers a finished section exactly once", async () => {
    const start = await startHandler(post(body, "alice"));
    const { jobId } = (await start.json()) as { jobId: string };
    expect((await startHandler(get(jobId, "bob"))).status).toBe(404);
    expect((await startHandler(get(jobId))).status).toBe(401);
    const first = await startHandler(get(jobId, "alice"));
    expect(first.status).toBe(200);
    const state = (await first.json()) as Record<string, unknown>;
    expect(state.status).toBe("done");
    expect("uid" in state).toBe(false);
    expect((state.result as { section: unknown }).section).toEqual(section);
    expect((await startHandler(get(jobId, "alice"))).status).toBe(404); // one-shot delivery
    expect(blobs.has(`job/${jobId}`)).toBe(false);
  });
});

describe("proxyTransport against the real handler", () => {
  it("round-trips a section through start → worker → poll", async () => {
    const t = proxyTransport({
      endpoint: `${ORIGIN}/api/review`,
      getToken: async () => "alice",
      fetch: (input, init) => startHandler(new Request(String(input), init)),
      sleep: async () => {},
    });
    const got = await t.run(body as never);
    expect(got).toEqual(section);
  });

  it("signed out, the server's 401 reaches the user as an auth error", async () => {
    const t = proxyTransport({
      endpoint: `${ORIGIN}/api/review`,
      getToken: async () => "stale-token",
      fetch: (input, init) => startHandler(new Request(String(input), init)),
      sleep: async () => {},
    });
    await expect(t.run(body as never)).rejects.toMatchObject({ code: "auth" });
  });
});
