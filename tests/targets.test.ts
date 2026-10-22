// Stage A (docs/spec.md §4): ONE shared target list. The tracker (tcm.list.v1)
// is the single source for the tracker, the preview, the audit request and the
// purchase scope. Review/audit select up to six INCLUDED targets from it,
// explicitly — never a hardcoded Cornell/UCLA/Michigan default, and never
// silently more than the purchase scope.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  includedTargets,
  loadTargets,
  MAX_INCLUDED,
  saveTargets,
  schoolIdFor,
  setIncluded,
  TARGETS_KEY,
  type TargetEntry,
} from "../src/lib/targets";

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}
beforeEach(() => { (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage(); });
afterEach(() => { delete (globalThis as unknown as { localStorage?: MemStorage }).localStorage; });

const entry = (school: string, over: Partial<TargetEntry> = {}): TargetEntry =>
  ({ school, status: "considering", note: "", ...over });

describe("loadTargets / saveTargets — the tracker is the one list", () => {
  it("returns [] when nothing is stored or the stored value is not a list", () => {
    expect(loadTargets()).toEqual([]);
    localStorage.setItem(TARGETS_KEY, JSON.stringify({ not: "a list" }));
    expect(loadTargets()).toEqual([]);
  });

  it("round-trips entries, including the included flag, in the legacy storage key", () => {
    saveTargets([entry("Cornell"), entry("UCLA", { included: true })]);
    const back = loadTargets();
    expect(back.map((e) => e.school)).toEqual(["Cornell", "UCLA"]);
    expect(back[1].included).toBe(true);
    expect(localStorage.getItem(TARGETS_KEY)).not.toBeNull();
  });
});

describe("includedTargets — the explicit review / purchase scope", () => {
  it("is empty when the list is empty — no default schools are ever invented", () => {
    expect(includedTargets([])).toEqual([]);
  });

  it("uses the explicitly included entries when any are flagged", () => {
    const list = [entry("A"), entry("B", { included: true }), entry("C", { included: true })];
    expect(includedTargets(list).map((e) => e.school)).toEqual(["B", "C"]);
  });

  it("falls back to the first MAX_INCLUDED when none are flagged, never more", () => {
    const list = ["A", "B", "C", "D", "E", "F", "G", "H"].map((s) => entry(s));
    expect(MAX_INCLUDED).toBe(6);
    expect(includedTargets(list).map((e) => e.school)).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("setIncluded toggles and enforces the maximum", () => {
    let list = [
      ...["A", "B", "C", "D", "E", "F"].map((s) => entry(s, { included: true })),
      entry("G"),
    ];
    list = setIncluded(list, "G", true);   // no room — stays out
    expect(includedTargets(list).map((e) => e.school)).not.toContain("G");
    list = setIncluded(list, "A", false);  // make room
    list = setIncluded(list, "G", true);
    expect(includedTargets(list).map((e) => e.school)).toEqual(["B", "C", "D", "E", "F", "G"]);
  });

  it("the first explicit toggle starts from the implicit set, so one click can't collapse it", () => {
    const list = ["A", "B", "C"].map((s) => entry(s));          // nothing flagged → A,B,C implicit
    const after = setIncluded(list, "B", false);
    expect(includedTargets(after).map((e) => e.school)).toEqual(["A", "C"]);
  });
});

describe("schoolIdFor — stable ids from the model, never from display names", () => {
  it("resolves a modeled school and rejects an unknown name", () => {
    expect(schoolIdFor("UC Davis")).toBe("uc-davis");
    expect(schoolIdFor("Nonexistent University")).toBeNull();
  });
});
