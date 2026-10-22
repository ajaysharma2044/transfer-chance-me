// Build the EXACT prompt the worker would send for one section of the panel,
// for a realistic profile, and write it to a file — so the brief can be
// inspected without going through the browser or spending a model call.
//
//   npx tsx scripts/preview_prompt.ts [coursework|activities|essay|fit|lead] [outfile]
//
// This imports the same buildSectionPrompt the worker and the browser call —
// not a copy — so what this writes is what a student's request becomes, field
// notes included. The fence is shown as plain markers here; the worker wraps
// the same block with a per-run nonce (api/_guard.ts).

import { writeFileSync } from "node:fs";
import { DEFAULT_PROFILE } from "../src/engine";
import type { Profile } from "../src/engine";
import { buildSectionPrompt } from "../src/lib/audit/prompts";
import { parseAuditRequest } from "../src/lib/audit/schema";
import { toAuditProfile } from "../src/lib/panel";

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

const input = {
  profile: toAuditProfile(profile),
  targets: ["UC Berkeley", "UCLA", "Cornell", "USC"],
  whyTransfer:
    "I want to transfer to Berkeley because the EECS department's work on distributed systems is where I want to spend my life. At De Anza I rebuilt the CS tutoring center's scheduling system after watching 40 students a week get turned away.",
  statement: "",
  activities: profile.activitiesText,
};

const which = process.argv[2] ?? "essay";
const body = which === "lead"
  ? {
      schemaVersion: 1, kind: "lead", input,
      reports: ["coursework", "activities", "essay", "fit"].map((id) => ({
        id, grade: "B", headline: `(${id} headline)`, notes: [], actions: [`(${id} action)`], missing: [],
      })),
    }
  : { schemaVersion: 1, kind: "specialist", specialist: which, input };

const parsed = parseAuditRequest(body);
if (!parsed.ok) {
  console.error(parsed.error);
  process.exit(1);
}

const prompt = buildSectionPrompt(parsed.value, (t) => `<applicant-material>\n${t}\n</applicant-material>`);
const out = process.argv[3] ?? "/tmp/review_prompt.txt";
writeFileSync(out, prompt);
console.log(JSON.stringify({
  out,
  kind: which,
  chars: prompt.length,
  fieldNoteBlocks: (prompt.match(/Field notes \(from our T25 study briefs\)/g) ?? []).length,
}));
