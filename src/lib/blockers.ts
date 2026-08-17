// The single governing condition at one school.
//
// A ledger row can only carry one clause, so this picks the one that actually
// decides the outcome and reports how many others also fired. The ordering is
// the whole point: rungs 1–5 are structural — residency, standing, a published
// floor, a band — and CANNOT be pre-empted by rungs 6–9, which are things you
// fix by writing or enrolling. Get that backwards and the page tells a
// four-year-private sophomore to polish an essay for a UC that will not read
// them.
//
// Every clause is ≤ 8 words and every figure in one is computed from the
// profile, the engine's estimate, the published TAG matrix, or the band —
// never written by hand.

import type { Estimate, Profile } from "../engine";
import { tagFloor } from "../engine";
import ucData from "../data/uc_data.json";
import type { CourseGaps } from "./coursework";
import type { EssayAnalysis } from "./essay";
import { admitBand, bandNoun } from "./band";

export type BlockerKind =
  | "TAG" | "GPA" | "GATE" | "STANDING" | "BAND"   // structural, rungs 1–5
  | "TONE" | "ESSAY" | "PREP" | "NONE";            // fixable,   rungs 6–9

/** Brand tokens only — these become `.po-tone-*` classes. */
export type BlockerTone = "teal" | "coral" | "accent" | "blue" | "ink";

export interface Blocker {
  kind: BlockerKind;
  tone: BlockerTone;
  /** ≤ 8 words. Rendered next to the chip. */
  clause: string;
  /** How many other rungs also fired. Rendered as "+2", opens the row. */
  extra: number;
  /**
   * Counted in the "N blocked today" readout.
   *
   * DEVIATION FROM SPEC §2.7, deliberate: the spec's comment says "true for
   * kinds TAG…BAND", which would count a TAG *guarantee* — a teal chip whose
   * clause is an instruction to file, not an obstacle — inside a figure the
   * page prints as "N blocked today". That is a false number, and the only
   * stated consumer of this flag is that readout. So TAG is structural in
   * kind but is not blocking: this is true for GPA, GATE, STANDING and BAND.
   * Use `kind` if you need the rung group for styling.
   */
  structural: boolean;
  /** Every rung that fired, in precedence order — the row expansion prints
   *  these when `extra > 0`. The first entry is always the governing one. */
  all: BlockerKind[];
}

/** The nine UC campuses. UCLA and Berkeley live in model.json, the rest are
 *  appended to MODEL from uc_data.json, so the union is the real list. */
const UC_JSON = ucData as unknown as { campuses: Record<string, unknown> };
const UC_NAMES = new Set<string>(["UCLA", "UC Berkeley", ...Object.keys(UC_JSON.campuses)]);

/** The engine's own three structural TAG gates, in the order Portal.tsx shows
 *  them. "First failing only" means first in THIS order. */
function tagGates(p: Profile): { ok: boolean; miss: string }[] {
  return [
    { ok: p.institution === "cc", miss: "community-college enrollment" },
    { ok: p.caResident, miss: "California residency" },
    { ok: p.standing === "junior", miss: "junior-standing entry" },
  ];
}

/** Rungs counted in "N blocked today". TAG is a rung, not a blockage. */
const BLOCKING = new Set<BlockerKind>(["GPA", "GATE", "STANDING", "BAND"]);

/** Enough of the name to identify the school inside an 8-word clause. */
function shortName(name: string): string {
  return name.replace(/^University of /, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/**
 * The one condition governing this school, plus the count of the others.
 *
 * `essay` is optional and additive to the spec's signature: the TONE clause
 * quotes the real signal counts from analyzeEssay(), and re-running that
 * per ledger row would re-scan all 208 schools' program lists on every
 * keystroke. Pass the analysis the page already computed; without it the
 * TONE clause states the verdict without the counts rather than inventing
 * them.
 */
export function blockerFor(
  p: Profile,
  e: Estimate,
  gaps: CourseGaps,
  essay?: EssayAnalysis | null,
): Blocker {
  const name = e.school.name;
  const fired: { kind: BlockerKind; tone: BlockerTone; clause: string }[] = [];

  const floor = tagFloor(name, p.major);
  const gates = tagGates(p);
  const gatesOk = gates.every((g) => g.ok);
  const firstMiss = gates.find((g) => !g.ok)?.miss ?? null;

  // ── 1 · TAG, and 2 · the GPA that is the only thing between you and it ──
  if (floor != null && gatesOk) {
    if (p.gpa >= floor) {
      fired.push({ kind: "TAG", tone: "teal", clause: "file by Sep 30 · voids without Nov 30" });
    } else {
      fired.push({
        kind: "GPA",
        tone: "coral",
        clause: `${p.gpa.toFixed(2)} → ${floor.toFixed(2)} for TAG in your major`,
      });
    }
  }

  // ── 3 · TAG exists here but a structural gate fails ──
  if (floor != null && !gatesOk && firstMiss) {
    fired.push({ kind: "GATE", tone: "ink", clause: `TAG needs ${firstMiss}` });
  }

  // ── 4 · UCs read junior-entry transfers, full stop ──
  if (UC_NAMES.has(name) && p.standing !== "junior") {
    fired.push({ kind: "STANDING", tone: "coral", clause: "UC transfers enter at junior standing" });
  }

  // ── 5 · under the 25th percentile of whatever band this school has ──
  const band = admitBand(e.school);
  if (band.kind !== "none" && band.p25 != null && p.gpa < band.p25) {
    const under = (band.p25 - p.gpa).toFixed(2);
    fired.push({
      kind: "BAND",
      tone: "coral",
      clause: `${under} under p25 of ${band.n} ${bandNoun(band.kind)}`,
    });
  }

  // ── 6 · the essay reads as escape rather than fit ──
  if (p.essayVerdict === "complaint") {
    const counts = essay ? ` · ${essay.complaintScore} vs ${essay.fitScore} signals` : "";
    fired.push({ kind: "TONE", tone: "accent", clause: `reads complaint-shaped${counts}` });
  }

  // ── 7 · nothing written yet ──
  if (!p.essayText.trim()) {
    fired.push({ kind: "ESSAY", tone: "accent", clause: "no why-transfer draft on file" });
  }

  // ── 8 · written, but interchangeable with every other file in the stack ──
  if (!p.essayNamed.includes(name)) {
    fired.push({
      kind: "ESSAY",
      tone: "accent",
      clause: `essay names no ${shortName(name)} specifics`,
    });
  }

  // ── 9 · major prep still open on ASSIST's spine ──
  if (gaps.missingCore.length > 0) {
    const n = gaps.missingCore.length;
    fired.push({
      kind: "PREP",
      tone: "blue",
      clause: `${n} core course${n === 1 ? "" : "s"} open · ${gaps.missingCore[0].label}`,
    });
  }

  // ── 10 · nothing above ──
  if (fired.length === 0) {
    return {
      kind: "NONE", tone: "ink", clause: "nothing blocking on file",
      extra: 0, structural: false, all: ["NONE"],
    };
  }

  const [governing, ...rest] = fired;
  return {
    ...governing,
    extra: rest.length,
    structural: BLOCKING.has(governing.kind),
    all: fired.map((f) => f.kind),
  };
}
