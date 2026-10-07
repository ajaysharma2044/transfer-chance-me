// Cost ledger (spec_v3 Step 20, minimal). No paid model call happens until this
// exists and refuses correctly: it reserves worst-case cost BEFORE dispatch,
// reconciles to actual usage after, persists across restarts, and refuses any
// call that would push total spend past the budget or a single audit past its
// cap. These tests use a temp ledger file and a mock budget — no network.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BudgetExceededError, Ledger, type Budgets } from "../netlify/functions/_ledger";

// $/Mtok chosen so small token counts give clean dollars: 100 in = $0.10,
// 100 out = $0.30.
const BUDGETS: Budgets = {
  total_usd: 1.0,
  per_audit_usd: 0.1,
  max_real_audits: 2,
  default_pricing: { input_per_mtok: 1000, output_per_mtok: 3000 },
  pricing: {},
};

let dir: string;
let ledger: Ledger;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tcm-ledger-"));
  ledger = new Ledger(join(dir, "ledger.json"), BUDGETS);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const call = (over: Partial<Parameters<Ledger["reserve"]>[0]> = {}) => ({
  kind: "review", provider: "openrouter", model: "x", inputTokens: 100, maxTokens: 100, ...over,
});

describe("Ledger — reserve worst-case before dispatch, reconcile after", () => {
  it("reserves the worst case, then settles to the (smaller) actual", () => {
    const id = ledger.reserve(call());             // 0.10 + 0.30 = 0.40 reserved
    expect(ledger.committed()).toBeCloseTo(0.4, 6);
    const actual = ledger.settle(id, { inputTokens: 100, outputTokens: 10 }); // 0.10 + 0.03
    expect(actual).toBeCloseTo(0.13, 6);
    expect(ledger.committed()).toBeCloseTo(0.13, 6);
    expect(ledger.totalSpent()).toBeCloseTo(0.13, 6);
  });

  it("settles to the provider's reported cost when given one", () => {
    const id = ledger.reserve(call());
    const actual = ledger.settle(id, { inputTokens: 100, outputTokens: 10, actualUsd: 0.07 });
    expect(actual).toBeCloseTo(0.07, 6);
    expect(ledger.totalSpent()).toBeCloseTo(0.07, 6);
  });
});

describe("Ledger — refuses before spending, not after", () => {
  it("refuses a reservation that would exceed the total budget", () => {
    ledger.reserve(call({ inputTokens: 100, maxTokens: 200 }));   // 0.10 + 0.60 = 0.70
    expect(() => ledger.reserve(call({ inputTokens: 100, maxTokens: 100 }))) // +0.40 -> 1.10
      .toThrow(BudgetExceededError);
  });

  it("refuses a single audit over the per-audit cap", () => {
    expect(() => ledger.reserve(call({ audit: true })))  // 0.40 > 0.10 cap
      .toThrow(BudgetExceededError);
  });

  it("refuses more than max_real_audits audits", () => {
    ledger.reserve(call({ audit: true, inputTokens: 10, maxTokens: 10 }));   // 0.04
    ledger.reserve(call({ audit: true, inputTokens: 10, maxTokens: 10 }));   // 0.04
    expect(ledger.realAudits()).toBe(2);
    expect(() => ledger.reserve(call({ audit: true, inputTokens: 10, maxTokens: 10 })))
      .toThrow(BudgetExceededError);
  });
});

describe("Ledger — failed calls release their reservation", () => {
  it("a failed call frees the reserved budget", () => {
    const id = ledger.reserve(call({ inputTokens: 100, maxTokens: 100 })); // 0.40
    expect(ledger.committed()).toBeCloseTo(0.4, 6);
    ledger.fail(id);
    expect(ledger.committed()).toBeCloseTo(0, 6);
    // The room is back: a big reservation that would have collided now fits.
    expect(() => ledger.reserve(call({ inputTokens: 100, maxTokens: 300 }))).not.toThrow(); // 0.10+0.90
  });
});

describe("Ledger — persists across instances (restart-safe)", () => {
  it("a second Ledger on the same file sees prior spend", () => {
    const path = join(dir, "persist.json");
    const a = new Ledger(path, BUDGETS);
    const id = a.reserve(call());
    a.settle(id, { inputTokens: 100, outputTokens: 10 });
    const b = new Ledger(path, BUDGETS);
    expect(b.totalSpent()).toBeCloseTo(0.13, 6);
  });
});
