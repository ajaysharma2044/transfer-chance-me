// The ledger counts audits, not calls (docs/spec.md §5 + spec_v3 PART 8).
//
// One panel run is five model calls. Before groups, each call flagged `audit`
// counted as a real audit, so the 3-audit stop would have tripped on the
// third specialist of the FIRST run, and the $1 per-audit cap was checked per
// call rather than per run.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BudgetExceededError, Ledger, type Budgets } from "../netlify/functions/_ledger";

const budgets: Budgets = {
  total_usd: 25,
  per_audit_usd: 1,
  max_real_audits: 3,
  default_pricing: { input_per_mtok: 10, output_per_mtok: 30 },
  pricing: {},
};

// 1,000 in + 4,000 out at the default price = $0.01 + $0.12 = $0.13 reserved.
const call = (group?: string) => ({
  kind: "audit:specialist:essay", provider: "test", model: "m", inputTokens: 1_000, maxTokens: 4_000, audit: true, group,
});

let dir: string;
let ledger: Ledger;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tcm-ledger-"));
  ledger = new Ledger(join(dir, "ledger.json"), budgets);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ledger groups", () => {
  it("five calls in one group are ONE real audit", () => {
    for (let i = 0; i < 5; i++) ledger.reserve(call("run-1"));
    expect(ledger.realAudits()).toBe(1);
  });

  it("the real-audit stop counts groups: a fourth group is refused, a known group may continue", () => {
    for (const g of ["a", "b", "c"]) ledger.reserve(call(g));
    expect(ledger.realAudits()).toBe(3);
    expect(() => ledger.reserve(call("d"))).toThrow(BudgetExceededError);
    expect(() => ledger.reserve(call("c"))).not.toThrow(); // the lead call of audit c
    expect(ledger.realAudits()).toBe(3);
  });

  it("the per-audit cap covers the whole group, and settling cheaply frees room", () => {
    const tight = new Ledger(join(dir, "tight.json"), { ...budgets, per_audit_usd: 0.3 });
    const a = tight.reserve(call("g"));
    const b = tight.reserve(call("g")); // 0.26 committed
    expect(() => tight.reserve(call("g"))).toThrow(/per-audit/); // 0.39 > 0.30
    tight.settle(a, { inputTokens: 900, outputTokens: 800, actualUsd: 0.002 });
    tight.settle(b, { inputTokens: 900, outputTokens: 800, actualUsd: 0.002 });
    expect(() => tight.reserve(call("g"))).not.toThrow(); // 0.004 + 0.13
  });

  it("entries without a group — the pre-group ledger — each count as their own audit", () => {
    ledger.reserve(call());
    ledger.reserve(call());
    expect(ledger.realAudits()).toBe(2);
  });

  it("a failed call releases its share of the group", () => {
    const tight = new Ledger(join(dir, "tight2.json"), { ...budgets, per_audit_usd: 0.3 });
    const a = tight.reserve(call("g"));
    tight.reserve(call("g"));
    tight.fail(a);
    expect(tight.groupCommitted("g")).toBeCloseTo(0.13, 6);
    expect(() => tight.reserve(call("g"))).not.toThrow();
  });
});
