// Typical fall-transfer application deadlines by school (month is 1-based).
// These are the well-known recurring dates; schools do shift them, so the UI
// always labels these "typical" and links the applicant to verify.

export interface Deadline { month: number; day: number; note?: string }

export const DEADLINES: Record<string, Deadline> = {
  "UC Berkeley": { month: 11, day: 30, note: "UC filing period Aug 1–Nov 30" },
  "UCLA":        { month: 11, day: 30, note: "UC filing period Aug 1–Nov 30" },
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
