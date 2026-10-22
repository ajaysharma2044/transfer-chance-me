// The single model-call module must GATE on the ledger: it reserves before
// dispatch, settles the actual cost after, releases the reservation on failure,
// and — the safety-critical part — refuses to call the provider at all when the
// budget is spent. Uses an injected ledger + a mock provider; no network.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger, type Budgets } from "../netlify/functions/_ledger";
import { callModel, type Provider } from "../netlify/functions/_llm";

const BUDGETS: Budgets = {
  total_usd: 0.5,
  per_audit_usd: 0.1,
  max_real_audits: 2,
  default_pricing: { input_per_mtok: 1000, output_per_mtok: 3000 },
  pricing: {},
};

let dir: string;
let ledger: Ledger;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tcm-llm-"));
  ledger = new Ledger(join(dir, "l.json"), BUDGETS);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const base = {
  kind: "t", model: "m", maxTokens: 5,
  messages: [{ role: "user" as const, content: "hi" }],
};

describe("callModel — ledgered dispatch", () => {
  it("routes through the ledger and settles the provider's reported cost", async () => {
    const provider: Provider = async () => ({ text: "ok", inputTokens: 10, outputTokens: 5, costUsd: 0.02 });
    const r = await callModel({ ...base, ledger, provider });
    expect(r.text).toBe("ok");
    expect(r.costUsd).toBeCloseTo(0.02, 6);
    expect(ledger.totalSpent()).toBeCloseTo(0.02, 6);
  });

  it("refuses WITHOUT calling the provider when the reservation exceeds budget", async () => {
    ledger.reserve({ kind: "x", provider: "openrouter", model: "m", inputTokens: 100, maxTokens: 100 }); // 0.40 of 0.50
    let called = false;
    const provider: Provider = async () => { called = true; return { text: "x", inputTokens: 1, outputTokens: 1 }; };
    await expect(callModel({ ...base, maxTokens: 100, ledger, provider })).rejects.toThrow(/budget/i);
    expect(called).toBe(false);
  });

  it("releases the reservation when the provider throws", async () => {
    const provider: Provider = async () => { throw new Error("provider down"); };
    await expect(callModel({ ...base, ledger, provider })).rejects.toThrow("provider down");
    expect(ledger.committed()).toBeCloseTo(0, 6);
  });
});
