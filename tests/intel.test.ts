// The T25 field notes are keyed by school name and looked up with
// MODEL.schools.find(name) at prompt-build time. A key that doesn't match an
// engine school name fails SILENTLY — the school still gets a prompt block,
// just without its field notes — so nothing at runtime would ever tell us.
// This suite is the only thing that would.

import { describe, expect, it } from "vitest";
import { MODEL } from "../src/engine";
import { intelLines } from "../src/lib/review";
import INTEL from "../src/data/intel.json";

const names = new Set(MODEL.schools.map((s) => s.name));
const intelKeys = Object.keys(INTEL).filter((k) => k !== "_meta");

describe("T25 intel data", () => {
  it("has real content, not the pre-distillation placeholder", () => {
    expect(intelKeys.length).toBeGreaterThanOrEqual(15);
  });

  it("every intel key matches an engine school name exactly", () => {
    const orphans = intelKeys.filter((k) => !names.has(k));
    expect(orphans, `intel keys with no matching school: ${orphans.join(", ")}`).toEqual([]);
  });

  it("intelLines produces field notes for a school with intel", () => {
    const line = intelLines("UCLA");
    expect(line).toContain("Field notes");
    // Spot-check a hard fact from the UCLA brief so a regeneration that
    // silently emptied the entries would fail here.
    expect(line.toLowerCase()).toContain("tap");
  });

  it("intelLines is empty, not throwing, for a school without intel", () => {
    expect(intelLines("Harvard")).toBe("");
    expect(intelLines("not a school")).toBe("");
  });

  it("keeps every string tight enough for a prompt (no essays)", () => {
    for (const k of intelKeys) {
      const e = (INTEL as Record<string, unknown>)[k] as {
        timing: string; aid: string; paths: string[]; pitfalls: string[]; notes: string[];
      };
      for (const s of [e.timing, e.aid, ...e.paths, ...e.pitfalls, ...e.notes]) {
        expect(s.length, `${k}: over-long line: ${s.slice(0, 60)}…`).toBeLessThanOrEqual(220);
      }
    }
  });
});
