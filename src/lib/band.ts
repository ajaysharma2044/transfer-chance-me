// The admitted band for a school — ONE derivation, three named states.
//
// Two different corpora make two different claims about "what admitted files
// look like here", and this product's whole position is that it never lets
// them blur into each other:
//
//   study    — model.json percentiles, from the Reddit + College Confidential
//              study (24 schools, nGpa 4 → 287). A researched distribution.
//   observed — the outcome corpus (similar.json) where the study has no
//              percentiles: 17 schools (7 UC campuses, 9 CSUs, USC) with at
//              least MIN_SIGNATURE_N recorded admits. A tally, not a study.
//   none     — 167 of 208 schools. No band exists. Draw NO bar: p25/p50/p75
//              are null so there is nothing to render, and the caption says
//              why in words.
//
// Verified against the shipped data (2026-08): 24 + 17 = 41 banded, 167 not.
// Of the 167, 119 have literally zero recorded admits and 48 have between 1
// and 6 — too few to characterize, but not "none", so their caption counts
// them rather than asserting a zero that is not true.

import type { School } from "../engine";
import { admitSignature, observedAdmits } from "./similar";

export type BandKind = "study" | "observed" | "none";

export interface AdmitBand {
  kind: BandKind;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  /** Files behind the band. 0 for kind "none" — there is no band. */
  n: number;
  /** Recorded admits in the outcome corpus, whatever the band's source.
   *  For a study band this is a DIFFERENT number from `n` (UCLA: n=271 study
   *  files, 124 observed admits) and the two must never be swapped. */
  observed: number;
  /** Printed on the face. Never a tooltip. */
  caption: string;
}

/** One fixed axis for every band on the page, never autoscaled — a bar that
 *  rescales per row cannot be compared across rows.
 *  Four of the 41 bands (UC Merced, Cal State LA, SF State, Sacramento State)
 *  have a p25 between 3.10 and 3.19, just under the floor. Use bandPos() so
 *  they clip to the axis edge instead of rendering at a negative offset. */
export const BAND_MIN = 3.20;
export const BAND_MAX = 4.00;

/** A GPA's position on the shared axis, 0–100, clamped to the track. */
export function bandPos(gpa: number): number {
  const raw = ((gpa - BAND_MIN) / (BAND_MAX - BAND_MIN)) * 100;
  return Math.max(0, Math.min(100, raw));
}

export function admitBand(s: School): AdmitBand {
  const observed = observedAdmits(s.name);

  if (s.gpa.p50 != null) {
    return {
      kind: "study",
      p25: s.gpa.p25,
      p50: s.gpa.p50,
      p75: s.gpa.p75,
      n: s.nGpa,
      observed,
      caption: `n=${s.nGpa} study admits`,
    };
  }

  const sig = admitSignature(s.name);
  if (sig) {
    return {
      kind: "observed",
      p25: sig.gpaP25,
      p50: sig.gpaMedian,
      p75: sig.gpaP75,
      n: sig.n,
      observed,
      caption: `n=${sig.n} observed admits`,
    };
  }

  return {
    kind: "none",
    p25: null,
    p50: null,
    p75: null,
    n: 0,
    observed,
    caption: observed === 0
      ? "no observed admits · official rate only"
      : `${observed} observed admit${observed === 1 ? "" : "s"} · too few to band`,
  };
}

/** The noun for this band's files. A study band and an outcome-corpus band
 *  are different claims and never share a word. */
export function bandNoun(kind: BandKind): string {
  return kind === "study" ? "study admits" : "observed admits";
}
