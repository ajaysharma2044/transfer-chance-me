// Heuristic "why transfer" essay analysis, grounded in what the outcome data
// shows differentiates admits: school-specificity (named programs, professors,
// courses) and fit-and-resources framing over complaint-shaped writing.
// Runs entirely in the browser.
import { MODEL } from "../engine";

export interface EssayAnalysis {
  words: number;
  /** Schools whose name or named programs appear in the essay */
  namedSchools: string[];
  /** School → the specific tokens matched (for feedback copy) */
  matches: Record<string, string[]>;
  professorMentions: number;
  fitScore: number;        // count of fit-and-resources signals
  complaintScore: number;  // count of complaint-shaped signals
  verdict: "specific" | "general" | "complaint";
  notes: string[];
}

const GENERIC_PROGRAMS = new Set(["ptk", "igetc", "honors", "phi theta kappa", "tag"]);

const ALIASES: Record<string, string[]> = {
  "UC Berkeley": ["uc berkeley", "berkeley", "cal "],
  UCLA: ["ucla"],
  UPenn: ["upenn", "penn ", "university of pennsylvania", "wharton"],
  Michigan: ["university of michigan", "umich", "ann arbor"],
  UNC: ["unc", "chapel hill", "north carolina"],
  "Johns Hopkins": ["johns hopkins", "jhu", "hopkins"],
  "Carnegie Mellon": ["carnegie mellon", "cmu"],
  Chicago: ["uchicago", "university of chicago"],
  "Notre Dame": ["notre dame"],
  MIT: ["mit ", "massachusetts institute"],
};

const FIT_WORDS = [
  "program", "professor", "course", "curriculum", "research", "lab", "faculty",
  "seminar", "department", "concentration", "institute", "resources", "major",
  "school of", "study abroad", "thesis",
];

const COMPLAINT_WORDS = [
  "hate", "boring", "party school", "miserable", "unhappy", "stuck", "regret",
  "mistake", "nothing to do", "worst", "toxic", "waste", "dead end", "lacks",
  "disappoint", "settle",
];

function hasToken(text: string, token: string): boolean {
  const esc = token.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${esc}\\b`).test(text);
}

export function analyzeEssay(raw: string): EssayAnalysis {
  const text = ` ${raw.toLowerCase().replace(/\s+/g, " ")} `;
  const words = raw.trim() ? raw.trim().split(/\s+/).length : 0;

  const matches: Record<string, string[]> = {};
  for (const s of MODEL.schools) {
    const tokens: string[] = [];
    const aliases = ALIASES[s.name] ?? [s.name.toLowerCase()];
    if (aliases.some((a) => hasToken(text, a))) tokens.push(s.name);
    for (const p of s.counsel?.programs ?? []) {
      const pl = p.toLowerCase();
      if (GENERIC_PROGRAMS.has(pl)) continue;
      // program entries can be compound ("Transfer Option/GT") — any part counts
      if (pl.split(/[/,]| or /).some((part) => part.trim().length >= 3 && hasToken(text, part))) {
        tokens.push(p);
      }
    }
    if (tokens.length) matches[s.name] = [...new Set(tokens)];
  }

  const professorMentions = (raw.match(/\b[Pp]rofessors?\s+[A-Z][a-z]+/g) ?? []).length
    + (raw.match(/\bdr\.\s+[A-Z][a-z]+/gi) ?? []).length;

  const fitScore = FIT_WORDS.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
  const complaintScore = COMPLAINT_WORDS.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);

  // A school counts as "named" only when a program-level token matched, or the
  // school itself plus real fit language.
  const namedSchools = Object.entries(matches)
    .filter(([school, toks]) => toks.some((t) => t !== school) || fitScore >= 3)
    .map(([school]) => school);

  const notes: string[] = [];
  if (words > 0 && words < 250) notes.push("Very short — transfer essays typically run 400–650 words.");
  if (words > 800) notes.push("Long — most successful essays land under ~650 words.");
  if (complaintScore >= 2 && complaintScore >= fitScore) {
    notes.push("Reads complaint-shaped. Admits frame the move as fit-and-resources, not escape — rewrite around what the target offers.");
  }
  if (professorMentions === 0 && words > 0) {
    notes.push("No professors named. Admits repeatedly credit naming specific faculty or courses.");
  }

  let verdict: EssayAnalysis["verdict"] = "general";
  if (complaintScore >= 2 && complaintScore > fitScore) verdict = "complaint";
  else if (namedSchools.length > 0) verdict = "specific";

  return { words, namedSchools, matches, professorMentions, fitScore, complaintScore, verdict, notes };
}
