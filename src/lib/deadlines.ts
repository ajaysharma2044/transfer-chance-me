// Typical fall-transfer application deadlines by school (month is 1-based).
// These are the well-known recurring dates; schools do shift them, so the UI
// always labels these "typical" and links the applicant to verify.

export interface Deadline { month: number; day: number; note?: string }

export const DEADLINES: Record<string, Deadline> = {
  "UC Berkeley": { month: 11, day: 30, note: "UC filing period Aug 1–Nov 30" },
  "UCLA":        { month: 11, day: 30, note: "UC filing period Aug 1–Nov 30" },
  "UC Davis":    { month: 11, day: 30, note: "UC filing period Aug 1–Nov 30; TAG by Sep 30" },
  "UC Irvine":   { month: 11, day: 30, note: "UC filing period Aug 1–Nov 30; TAG by Sep 30" },
  "UC San Diego": { month: 11, day: 30, note: "UC filing period Aug 1–Nov 30" },
  "UC Santa Barbara": { month: 11, day: 30, note: "UC filing period Aug 1–Nov 30; TAG by Sep 30" },
  "UC Santa Cruz": { month: 11, day: 30, note: "UC filing period Aug 1–Nov 30; TAG by Sep 30" },
  "UC Riverside": { month: 11, day: 30, note: "UC filing period Aug 1–Nov 30; TAG by Sep 30" },
  "UC Merced":   { month: 11, day: 30, note: "UC filing period Aug 1–Nov 30; TAG by Sep 30" },
  "Michigan":    { month: 2, day: 1 },
  "UNC":         { month: 2, day: 15 },
  "Carnegie Mellon": { month: 2, day: 15 },
  "Harvard":     { month: 3, day: 1 },
  "Yale":        { month: 3, day: 1 },
  "Princeton":   { month: 3, day: 1 },
  "Columbia":    { month: 3, day: 1 },
  "Brown":       { month: 3, day: 1 },
  "Dartmouth":   { month: 3, day: 1 },
  "Georgetown":  { month: 3, day: 1 },
  "Johns Hopkins": { month: 3, day: 1 },
  "Rice":        { month: 3, day: 1 },
  "Chicago":     { month: 3, day: 1 },
  "Duke":        { month: 3, day: 15 },
  "Cornell":     { month: 3, day: 15 },
  "UPenn":       { month: 3, day: 15 },
  "Stanford":    { month: 3, day: 15 },
  "Northwestern": { month: 3, day: 15 },
  "Emory":       { month: 3, day: 15 },
  "Notre Dame":  { month: 3, day: 15 },
  "Vanderbilt":  { month: 3, day: 15 },
  "MIT":         { month: 3, day: 15 },
  "USC":         { month: 2, day: 15, note: "Dec 1 for portfolio/audition majors; spring entry offered" },
  "NYU":         { month: 3, day: 1, note: "Spring entry closes Oct 1; requirements vary by NYU school" },
  "WashU":       { month: 3, day: 1, note: "Spring entry closes Oct 15" },
  "UVA":         { month: 3, day: 1, note: "VCCS GAA students: intent + course list per agreement" },
  "Georgia Tech": { month: 3, day: 2, note: "Spring transfer closes Oct 31 (priority Sep 15)" },
  "UT Austin":   { month: 3, day: 1, note: "Major prerequisites must be done before applying" },
  "Tufts":       { month: 3, day: 15, note: "Fall entry only — no spring transfer round" },
  "Boston College": { month: 3, day: 15, note: "Spring entry closes Nov 1" },
  "Boston University": { month: 3, day: 15, note: "Spring entry closes Nov 1" },
  "Caltech":     { month: 2, day: 15, note: "Entrance exams are part of the process" },
  "Washington":  { month: 2, day: 15, note: "Autumn quarter; UW admits transfers all four quarters" },
  "Wisconsin":   { month: 3, day: 1, note: "Feb 1 priority gets a decision by end of March" },
};

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface Countdown {
  label: string;     // "Mar 15"
  days: number;      // days from today until the next occurrence
  date: Date;
  note?: string;
}

export function countdown(school: string, from = new Date()): Countdown | null {
  const d = DEADLINES[school];
  if (!d) return null;
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let next = new Date(today.getFullYear(), d.month - 1, d.day);
  if (next < today) next = new Date(today.getFullYear() + 1, d.month - 1, d.day);
  const days = Math.round((next.getTime() - today.getTime()) / 86_400_000);
  return { label: `${MONTHS[d.month]} ${d.day}`, days, date: next, note: d.note };
}
