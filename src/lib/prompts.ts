// Per-school transfer application intelligence: which application they use,
// their own supplemental essay prompts, and the official sources.
//
// Researched from each university's own admissions pages. Coverage is partial
// by design — a school we haven't verified shows nothing rather than a guess.

import promptsData from "../data/prompts.json";

export interface SchoolPrompt {
  text: string;
  words: string;
  required: boolean;
}

export interface SchoolPrompts {
  name: string;
  usesCommonApp: boolean;
  cycle: string;
  prompts: SchoolPrompt[];
  cdsUrl: string | null;
  transferUrl: string | null;
  notes: string;
}

const DATA = promptsData as unknown as SchoolPrompts[];
const BY_NAME = new Map(DATA.map((s) => [s.name, s]));

export function promptsFor(school: string): SchoolPrompts | null {
  return BY_NAME.get(school) ?? null;
}

export function hasPrompts(school: string): boolean {
  return BY_NAME.has(school);
}

/** How many of the measured schools we have verified prompt data for. */
export const PROMPT_COVERAGE = DATA.length;

/** The application a school actually uses, in words a student reads. */
export function appLabel(s: SchoolPrompts): string {
  if (s.usesCommonApp) return "Common App for transfer";
  if (s.name.startsWith("UC ") || s.name === "UCLA") return "UC application (not Common App)";
  return "Its own application (not Common App)";
}
