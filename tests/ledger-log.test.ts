// The ledger's persistence is an append-only event log, because the first
// live panel run proved a rewritten JSON snapshot loses entries when four
// worker processes reserve at once (and then settle() throws "no entry").
// These pin the fold: two writers on one file, a torn trailing line, and the
// legacy snapshot seeding the new log.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger, type Budgets } from "../netlify/functions/_ledger";

const budgets: Budgets = {
  total_usd: 25, per_audit_usd: 1, max_real_audits: 3,
  default_pricing: { input_per_mtok: 10, output_per_mtok: 30 }, pricing: {},
};
const call = (kind = "k") => ({ kind, provider: "test", model: "m", inputTokens: 1_000, maxTokens: 4_000, audit: true, group: "g" });

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "tcm-ledger-log-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ledger event log", () => {
  it("two writers on the same file never lose each other's entries", () => {
    const path = join(dir, "ledger.jsonl");
    const a = new Ledger(path, budgets); // two instances = two processes, each reads fresh
    const b = new Ledger(path, budgets);
    const ia = a.reserve(call("a"));
    const ib = b.reserve(call("b"));
    a.settle(ia, { inputTokens: 10, outputTokens: 10, actualUsd: 0.001 });
    b.settle(ib, { inputTokens: 10, outputTokens: 10, actualUsd: 0.002 });
    const fresh = new Ledger(path, budgets);
    expect(fresh.totalSpent()).toBeCloseTo(0.003, 9);
    expect(fresh.totalReserved()).toBe(0);
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(4); // 2 reserves + 2 settles
  });

  it("a torn trailing line is skipped, not fatal", () => {
    const path = join(dir, "ledger.jsonl");
    const l = new Ledger(path, budgets);
    const id = l.reserve(call());
    appendFileSync(path, '{"t":"settle","id":"' + id + '","actualUsd":0.0'); // a crash mid-write
    expect(() => l.totalSpent()).not.toThrow();
    expect(l.totalReserved()).toBeGreaterThan(0); // still reserved: the settle never landed
    l.settle(id, { inputTokens: 1, outputTokens: 1, actualUsd: 0.01 });
    expect(l.totalSpent()).toBeCloseTo(0.01, 9);
  });

  it("the pre-log ledger.json snapshot seeds the state and is never rewritten", () => {
    const snapshot = join(dir, "ledger.json");
    const legacy = {
      entries: [{
        id: "old-1", ts: "2026-10-01T00:00:00Z", kind: "smoke", provider: "openrouter", model: "m",
        state: "settled", audit: false, reservedUsd: 0.01, actualUsd: 0.000015, inputTokens: 5, outputTokens: 3,
      }, {
        id: "old-2", ts: "2026-10-01T00:00:01Z", kind: "audit:x", provider: "openrouter", model: "m",
        state: "reserved", audit: true, group: "run-0", reservedUsd: 0.14, actualUsd: null, inputTokens: null, outputTokens: null,
      }],
    };
    writeFileSync(snapshot, JSON.stringify(legacy));
    const before = readFileSync(snapshot, "utf8");
    const l = new Ledger(join(dir, "ledger.jsonl"), budgets);
    expect(l.totalSpent()).toBeCloseTo(0.000015, 9);
    expect(l.totalReserved()).toBeCloseTo(0.14, 9);
    l.fail("old-2"); // releasing a legacy reservation is an appended event
    expect(l.totalReserved()).toBe(0);
    expect(l.realAudits()).toBe(0);
    expect(readFileSync(snapshot, "utf8")).toBe(before);
  });

  it("fail() for an unknown id writes nothing", () => {
    const path = join(dir, "ledger.jsonl");
    new Ledger(path, budgets).fail("nope");
    expect(() => readFileSync(path, "utf8")).toThrow();
  });
});
