// Stage B (docs/spec.md §5): the browser side of the typed contract.
//
// Before this, src/lib/panel.ts POSTed { prompt } and read data.content[0].text
// from the response — but the Netlify endpoint answers 202 { jobId } and the
// result arrives by polling, so every proxy-mode panel run parsed "" and
// failed. These tests drive the proxy transport against a fake fetch and the
// sequencer against a fake transport; no network, no model.

import { describe, expect, it, vi } from "vitest";
import { AuditError, proxyTransport } from "../src/lib/audit/client";
import type { Transport } from "../src/lib/audit/client";
import type { AuditRequest } from "../src/lib/audit/schema";
import { DEFAULT_PROFILE } from "../src/engine";
import { runPanel, SPECIALISTS, toAuditProfile } from "../src/lib/panel";

const section = {
  grade: "B+", headline: "Solid.", notes: [{ quote: "q", issue: "i", fix: "f" }], actions: ["a"], missing: [],
};
const leadSection = { grade: "B", summary: "Fine.", strengths: ["s"], risks: ["r"], priorities: ["p"] };

const specialistReq: AuditRequest = {
  schemaVersion: 1, kind: "specialist", specialist: "essay",
  input: { profile: toAuditProfile(DEFAULT_PROFILE), targets: ["Cornell"], whyTransfer: "x", statement: "", activities: "" },
};

type Call = { url: string; init: RequestInit | undefined };

/** A fake /api/review: records calls, answers 202 then the given poll states. */
function fakeApi(polls: unknown[], opts: { startStatus?: number; startBody?: unknown } = {}) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (init?.method === "POST") {
      const body = opts.startBody ?? { status: "pending", jobId: "11111111-2222-4333-8444-555555555555", pollAfterMs: 1, expiresInMs: 5_000 };
      return new Response(JSON.stringify(body), { status: opts.startStatus ?? 202 });
    }
    const next = polls.shift() ?? { status: "pending" };
    const status = typeof next === "object" && next !== null && "httpStatus" in next ? (next as { httpStatus: number }).httpStatus : 200;
    return new Response(JSON.stringify(next), { status });
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

const noSleep = async () => {};

describe("proxyTransport", () => {
  it("POSTs the structured request with the session token, polls, and returns the validated section", async () => {
    const api = fakeApi([{ status: "pending" }, { status: "done", result: { kind: "specialist", section } }]);
    const t = proxyTransport({ endpoint: "/api/review", getToken: async () => "tok", fetch: api.fetch, sleep: noSleep });
    const got = await t.run(specialistReq);
    expect(got).toEqual(section);

    const start = api.calls[0];
    expect(start.init?.method).toBe("POST");
    const headers = start.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok");
    const sent = JSON.parse(String(start.init?.body)) as Record<string, unknown>;
    expect(sent.schemaVersion).toBe(1);
    expect(sent.kind).toBe("specialist");
    expect("prompt" in sent).toBe(false);

    expect(api.calls.slice(1).every((c) => c.url.startsWith("/api/review?job="))).toBe(true);
    expect(api.calls).toHaveLength(3);
  });

  it("signed out: an auth error before any request is made", async () => {
    const api = fakeApi([]);
    const t = proxyTransport({ endpoint: "/api/review", getToken: async () => null, fetch: api.fetch, sleep: noSleep });
    await expect(t.run(specialistReq)).rejects.toMatchObject({ code: "auth" });
    expect(api.calls).toHaveLength(0);
  });

  it("a 401 from the server is an auth error with the server's wording", async () => {
    const api = fakeApi([], { startStatus: 401, startBody: { error: "Your session has expired — sign in again." } });
    const t = proxyTransport({ endpoint: "/api/review", getToken: async () => "stale", fetch: api.fetch, sleep: noSleep });
    const err = await t.run(specialistReq).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuditError);
    expect((err as AuditError).code).toBe("auth");
    expect((err as AuditError).message).toMatch(/sign in/i);
  });

  it("a worker error surfaces as the worker's safe message", async () => {
    const api = fakeApi([{ status: "error", error: "The review service is busy — try again in a moment." }]);
    const t = proxyTransport({ endpoint: "/api/review", getToken: async () => "tok", fetch: api.fetch, sleep: noSleep });
    await expect(t.run(specialistReq)).rejects.toMatchObject({ code: "server", message: /busy/ });
  });

  it("a done result that fails validation is rejected, never rendered", async () => {
    const api = fakeApi([{ status: "done", result: { kind: "specialist", section: { grade: "A" } } }]);
    const t = proxyTransport({ endpoint: "/api/review", getToken: async () => "tok", fetch: api.fetch, sleep: noSleep });
    await expect(t.run(specialistReq)).rejects.toMatchObject({ code: "invalid" });
  });

  it("gives up when the job outlives expiresInMs", async () => {
    const api = fakeApi([], { startBody: { status: "pending", jobId: "11111111-2222-4333-8444-555555555555", pollAfterMs: 1, expiresInMs: -1 } });
    const t = proxyTransport({ endpoint: "/api/review", getToken: async () => "tok", fetch: api.fetch, sleep: noSleep, maxWaitMs: 1 });
    await expect(t.run(specialistReq)).rejects.toMatchObject({ code: "expired" });
  });
});

describe("runPanel", () => {
  function fakeTransport(failing: string[] = []): { transport: Transport; seen: AuditRequest[] } {
    const seen: AuditRequest[] = [];
    const transport: Transport = {
      async run(req) {
        seen.push(req);
        if (req.kind === "specialist" && failing.includes(req.specialist)) throw new AuditError("boom", "server");
        return req.kind === "specialist" ? section : leadSection;
      },
    };
    return { transport, seen };
  }

  const input = { profile: DEFAULT_PROFILE, targets: ["Cornell", "UCLA"], whyTransfer: "why", statement: "", activities: "acts" };

  it("runs four specialists, then a lead carrying their reports, all under one auditId", async () => {
    const { transport, seen } = fakeTransport();
    const stages: string[] = [];
    const r = await runPanel(input, (id, state) => stages.push(`${id}:${state}`), undefined, transport);

    expect(seen.filter((q) => q.kind === "specialist").map((q) => q.kind === "specialist" && q.specialist).sort())
      .toEqual(SPECIALISTS.map((s) => s.id).sort());
    const lead = seen.find((q) => q.kind === "lead");
    expect(lead && lead.kind === "lead" && lead.reports.map((x) => x.id).sort()).toEqual(SPECIALISTS.map((s) => s.id).sort());
    expect(new Set(seen.map((q) => q.auditId)).size).toBe(1);
    expect(seen[0].auditId).toMatch(/^[0-9a-f-]{36}$/);
    // The request carries exactly the displayed targets and the review fields.
    expect(seen[0].input.targets).toEqual(["Cornell", "UCLA"]);
    expect(Object.keys(seen[0].input.profile)).not.toContain("confirmed");
    expect(r.reports).toHaveLength(4);
    expect(r.grade).toBe("B");
    expect(stages).toContain("lead:done");
  });

  it("one failed specialist does not lose the other three", async () => {
    const { transport } = fakeTransport(["essay"]);
    const r = await runPanel(input, undefined, undefined, transport);
    expect(r.reports.map((x) => x.id)).not.toContain("essay");
    expect(r.reports).toHaveLength(3);
  });

  it("when every specialist fails the same way, that error is the one the user sees", async () => {
    const t: Transport = { async run() { throw new AuditError("Sign in to run the deep audit.", "auth"); } };
    await expect(runPanel(input, undefined, undefined, t)).rejects.toMatchObject({ code: "auth" });
  });

  it("a failed specialist is named on the result, so a partial panel is never shown as complete", async () => {
    const { transport } = fakeTransport(["fit"]);
    const r = await runPanel(input, undefined, undefined, transport);
    expect(r.failed).toEqual([{ id: "fit", message: "boom" }]);
    expect(r.leadError).toBeUndefined();
  });

  it("a lead failure keeps the four paid specialist reports and says the verdict is missing", async () => {
    const seen: AuditRequest[] = [];
    const t: Transport = {
      async run(req) {
        seen.push(req);
        if (req.kind === "lead") throw new AuditError("The review service is busy — try again in a moment.", "server");
        return section;
      },
    };
    const stages: string[] = [];
    const r = await runPanel(input, (id, state) => stages.push(`${id}:${state}`), undefined, t);
    expect(r.reports).toHaveLength(4);
    expect(r.grade).toBe("—");
    expect(r.leadError).toMatch(/busy/);
    expect(stages).toContain("lead:failed");
    expect(seen.filter((q) => q.kind === "lead")).toHaveLength(1);
  });
});

describe("proxyTransport resilience", () => {
  it("rides out a 5xx on a poll instead of abandoning the running section", async () => {
    const api = fakeApi([{ httpStatus: 502, error: "Could not reach the review store — try again." }, { status: "pending" }, { status: "done", result: { kind: "specialist", section } }]);
    const t = proxyTransport({ endpoint: "/api/review", getToken: async () => "tok", fetch: api.fetch, sleep: noSleep });
    expect(await t.run(specialistReq)).toEqual(section);
  });

  it("asks for the token before every request, so a refreshed session is what reaches the server", async () => {
    const tokens = ["t1", "t2", "t3"];
    const api = fakeApi([{ status: "pending" }, { status: "done", result: { kind: "specialist", section } }]);
    const t = proxyTransport({ endpoint: "/api/review", getToken: async () => tokens.shift() ?? "tN", fetch: api.fetch, sleep: noSleep });
    await t.run(specialistReq);
    const sent = api.calls.map((c) => ((c.init?.headers ?? {}) as Record<string, string>).authorization);
    expect(sent).toEqual(["Bearer t1", "Bearer t2", "Bearer t3"]);
  });

  it("a 413 from the server tells the student which box to shorten", async () => {
    const api = fakeApi([], { startStatus: 413, startBody: { error: "input.profile.awardsText is longer than 2000 characters." } });
    const t = proxyTransport({ endpoint: "/api/review", getToken: async () => "tok", fetch: api.fetch, sleep: noSleep });
    await expect(t.run(specialistReq)).rejects.toMatchObject({ code: "input", message: /awards list is over 2,000 characters/ });
  });
});
