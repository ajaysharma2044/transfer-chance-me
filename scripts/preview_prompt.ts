// Build the EXACT production review prompt for a realistic profile and write
// it to a file, so the enriched prompt can be inspected and sent to the live
// backend without going through the browser.
//
//   npx vite-node scripts/preview_prompt.ts [outfile]
//
// This imports the same buildPrompt the app calls — not a copy — so what this
// writes is what a student's review request contains, field notes included.

import { writeFileSync } from "node:fs";
import { buildPrompt } from "../src/lib/review";
import { DEFAULT_PROFILE } from "../src/engine";
import type { Profile } from "../src/engine";

const profile: Profile = {
  ...DEFAULT_PROFILE,
  gpa: 3.72,
  schoolName: "De Anza College",
  institution: "cc",
  caResident: true,
  igetc: true,
  standing: "junior",
  major: "cs",
  majorDetail: "EECS",
  ptk: true,
  honors: true,
  gpaTrend: "upward",
  workHours: 12,
  firstGen: true,
  courses: ["CIS 22A", "CIS 22B", "CIS 22C", "MATH 1A", "MATH 1B", "MATH 1C", "PHYS 4A"],
  transferReason: "Depth in systems research",
  activitiesText:
    "CS tutoring center lead (2 yrs, 6 tutors). Hackathon organizer, 300 attendees. Part-time IT support 12h/wk.",
  awardsText: "Phi Theta Kappa. Dean's List x4.",
};

const prompt = buildPrompt({
  profile,
  targets: ["UC Berkeley", "UCLA", "Cornell", "USC"],
  whyTransfer:
    "I want to transfer to Berkeley because the EECS department's work on distributed systems is where I want to spend my life. At De Anza I rebuilt the CS tutoring center's scheduling system after watching 40 students a week get turned away.",
  statement: "",
  activities: profile.activitiesText,
});

const out = process.argv[2] ?? "/tmp/review_prompt.txt";
writeFileSync(out, prompt);
console.log(JSON.stringify({
  out,
  chars: prompt.length,
  fieldNoteBlocks: (prompt.match(/Field notes \(from our T25 study briefs\)/g) ?? []).length,
}));
