// The ONE shared target list (docs/spec.md §4).
//
// Storage keeps the tracker's legacy key and array shape so existing lists keep
// working, and every consumer — the tracker, the audit gate, the review, the
// purchase scope, the export — reads this same list instead of inventing its
// own. (Review used to seed its own "Cornell / UCLA / Michigan" defaults, so a
// student could unlock with one list and get analysis for another.)
//
// `included` is the explicit review / purchase scope, capped at MAX_INCLUDED.
// When nothing is flagged, the first MAX_INCLUDED count — never more, and never
// a school the student did not add.

import { useEffect, useState } from "react";
import { MAX_INCLUDED_TARGETS } from "../../config/product";
import { MODEL } from "../engine";
import { dispatchListChanged, subscribeListChanged } from "./listEvents";

export const TARGETS_KEY = "tcm.list.v1";
/** How many targets one review / purchase covers. A product setting, not a
 *  research finding — config/product.ts is the one place it is set. */
export const MAX_INCLUDED = MAX_INCLUDED_TARGETS;

export interface TargetEntry {
  /** Display name; the stable id is schoolIdFor(school). */
  school: string;
  status: string;
  note: string;
  /** Explicitly in the review / purchase scope. */
  included?: boolean;
  /** Per-target scope, filled in by later stages. */
  program?: string;
  term?: string;
  cycle?: string;
}

export function loadTargets(): TargetEntry[] {
  try {
    const raw = localStorage.getItem(TARGETS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is TargetEntry => !!e && typeof e === "object" && typeof (e as TargetEntry).school === "string",
    );
  } catch {
    return [];
  }
}

export function saveTargets(list: TargetEntry[]): void {
  try { localStorage.setItem(TARGETS_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
  dispatchListChanged();
}

/** The review / purchase scope: the flagged entries, else the first `max`. */
export function includedTargets(list: TargetEntry[], max = MAX_INCLUDED): TargetEntry[] {
  const flagged = list.filter((e) => e.included);
  return (flagged.length ? flagged : list).slice(0, max);
}

/**
 * Toggle one school's inclusion, enforcing the cap. The first explicit choice
 * starts from what was implicitly included, so a single toggle can't collapse
 * six implicit targets into one.
 */
export function setIncluded(list: TargetEntry[], school: string, on: boolean, max = MAX_INCLUDED): TargetEntry[] {
  let base = list;
  if (!list.some((e) => e.included)) {
    const implicit = new Set(includedTargets(list, max).map((e) => e.school));
    base = list.map((e) => (implicit.has(e.school) ? { ...e, included: true } : e));
  }
  const already = base.find((e) => e.school === school)?.included === true;
  if (on && !already && base.filter((e) => e.included).length >= max) return base;
  return base.map((e) => (e.school === school ? { ...e, included: on } : e));
}

/** Stable id for a modeled school, or null when the name is not in the model. */
export function schoolIdFor(name: string): string | null {
  return MODEL.schools.find((s) => s.name === name)?.id ?? null;
}

/** Live view of the shared list; re-reads on any change in this or another tab. */
export function useTargets(): TargetEntry[] {
  const [list, setList] = useState<TargetEntry[]>(loadTargets);
  useEffect(() => subscribeListChanged(() => setList(loadTargets())), []);
  return list;
}
