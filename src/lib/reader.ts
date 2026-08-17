// The reader view: how an admissions officer actually reads this file.
//
// Transfer admission is not a GPA ranking. A reader clears the academic gate
// and then reads the rest — where you're coming from, what you've done on
// that campus, whether your case for THIS school is specific, and what your
// circumstances explain. This models those dimensions the way a reading sheet
// does, and deliberately refuses to let one number stand in for the file.

import type { Estimate, Profile, School } from "../engine";

export type Signal = "strong" | "solid" | "thin" | "gap";

export interface Dimension {
  id: string;
  label: string;
  /** What the reader is actually assessing here. */
  lens: string;
  /** 0–1, how this dimension reads. Never a probability — a reading. */
  score: number;
  signal: Signal;
  /** The reader's margin note on this file, specifically. */
  note: string;
  /** What would change the note. */
  lift: string | null;
  color: string;
  /**
   * This dimension's score and note read the PROFILE only — pick a different
   * school and nothing here moves. Verified against the source below:
   *   · engagement(p)   — takes no School at all.
   *   · circumstance(p) — takes no School at all.
   *   · preparation(p, s) — score reads p.courses / p.igetc / p.standing and
   *     note reads p.courses / p.igetc; the only use of `s` in the whole
   *     function is the `.lift` string, which may name that school's
   *     pathways. The reading is invariant; the suggestion attached to it
   *     is not.
   * academic, context and narrative all genuinely re-read per school.
   * Six meters under a school picker otherwise claim six per-school readings
   * when three of them are static.
   */
  schoolInvariant: boolean;
}

export interface ReaderSheet {
  school: string;
  dimensions: Dimension[];
  /** Which dimension the reader would linger on. */
  pivot: Dimension;
  /** The one-line read a reader would write at the top of the sheet. */
  headline: string;
  gateCleared: boolean;
  gateNote: string;
  /** The band this gate was read against is derived from selectivity, not
   *  published. True for every school with no `gpa.p50` — which is all seven
   *  appended UC campuses and every extra school. Already computed inside
   *  band(); it used to survive only as a parenthetical inside gateNote. */
  bandEstimated: boolean;
}

const sig = (s: number): Signal => (s >= 0.75 ? "strong" : s >= 0.5 ? "solid" : s >= 0.28 ? "thin" : "gap");

const INSTITUTION_LABEL: Record<Profile["institution"], string> = {
  cc: "a community college",
  public4: "a four-year public",
  private4: "a four-year private",
};

/** Real, sourced pipeline facts — never invented. */
const PIPELINE: Record<string, { share: string; from: string }> = {
  UCLA: { share: "92%", from: "California community colleges" },
  "UC Berkeley": { share: "most", from: "California community colleges" },
  "UC Davis": { share: "93%", from: "California community colleges" },
  "UC Irvine": { share: "most", from: "California community colleges" },
  "UC San Diego": { share: "most", from: "California community colleges" },
  "UC Santa Barbara": { share: "most", from: "California community colleges" },
  "UC Santa Cruz": { share: "most", from: "California community colleges" },
  "UC Riverside": { share: "most", from: "California community colleges" },
  "UC Merced": { share: "most", from: "California community colleges" },
  USC: { share: "63%", from: "two-year colleges" },
  Washington: { share: "72%", from: "Washington community and technical colleges" },
};

/** The admitted band for a school, from published percentiles where they
 *  exist and from selectivity where they don't. One derivation, so the gate
 *  and the academic box can never disagree with each other. */
function band(s: School): { med: number; p25: number; estimated: boolean } {
  const published = s.gpa.p50 != null;
  const med = s.gpa.p50 ?? Math.min(3.7, Math.max(3.25, 3.9 - (s.rate / 100) * 0.8));
  const p25 = s.gpa.p25 ?? med - 0.25;
  return { med, p25, estimated: !published };
}

function academic(p: Profile, s: School): Dimension {
  // Position within the admitted band, not the raw number.
  const { med, p25 } = band(s);
  const spread = Math.max(0.12, med - p25);
  const z = (p.gpa - med) / spread;
  let score = 1 / (1 + Math.exp(-z * 1.15));
  if (p.gpaTrend === "upward") score = Math.min(1, score + 0.08);
  if (p.gpaTrend === "downward") score = Math.max(0, score - 0.1);

  const inBand = p.gpa >= p25;
  const note = inBand
    ? p.gpaTrend === "upward"
      ? `Inside the admitted band and still climbing. A reader stops checking the number here and starts reading the rest of the file.`
      : `Inside the admitted band. The number is not the argument any more — it just means the file gets read properly.`
    : `Below where admitted files here usually sit, so the rest of the file has to do more work than it can usually carry at this school.`;

  return {
    id: "academic",
    label: "Academic record",
    lens: "Does this clear the bar, and is it moving the right way?",
    score,
    signal: sig(score),
    note,
    lift: p.gpaTrend === "downward" ? "One clean upward term changes how this paragraph reads." : null,
    color: "var(--blue)",
    schoolInvariant: false,
  };
}

function context(p: Profile, s: School): Dimension {
  const pipe = PIPELINE[s.name];
  const isCC = p.institution === "cc";
  let score = 0.5;
  let note = "";

  if (pipe && isCC) {
    score = 0.9;
    note = `${pipe.share === "most" ? "Most" : pipe.share} of admitted transfers here come from ${pipe.from}. You are applying from inside the pipeline this school actually runs on — that is context working for you, not against you.`;
  } else if (pipe && !isCC) {
    score = 0.4;
    note = `This school's transfer intake runs mainly through ${pipe.from}. Coming from ${INSTITUTION_LABEL[p.institution]}, you're outside the main channel, so your case has to stand on its own terms.`;
  } else if (isCC) {
    score = 0.62;
    note = `${s.counsel?.feeders ? `Reported feeders: ${s.counsel.feeders}. ` : ""}Community college applicants are read here with the institutional credentials in view — honors, PTK, and named pathways carry real weight in this box.`;
  } else {
    score = 0.6;
    note = `${s.counsel?.feeders ? `Reported feeders: ${s.counsel.feeders}. ` : ""}A reader places you against others from similar institutions, not against the whole pool.`;
  }
  if (p.caResident && isCC && pipe) score = Math.min(1, score + 0.05);

  return {
    id: "context",
    label: "Where you're reading from",
    lens: "What kind of institution is this file coming out of, and does this school take people from there?",
    score,
    signal: sig(score),
    note,
    lift: !isCC && pipe ? "Naming the specific program you'd enter matters more from outside the pipeline." : null,
    color: "var(--teal)",
    schoolInvariant: false,
  };
}

function narrative(p: Profile, s: School): Dimension {
  const named = p.essayNamed.includes(s.name);
  const complaint = p.essayVerdict === "complaint";
  let score = 0.3;
  if (p.essay === "named" || named) score = 0.85;
  else if (p.essay === "general") score = 0.45;
  else score = 0.2;
  if (complaint) score = Math.min(score, 0.25);

  const note = complaint
    ? `The case currently reads as escape rather than fit. Readers see this shape constantly and it is the fastest way a strong file gets set down.`
    : named
      ? `Your case names ${s.name} specifically. That is the thing readers here credit most among files that already clear the bar.`
      : p.essay === "named"
        ? `A school-specific case is on file. Make sure the version this reader sees names their programs, not a generic one.`
        : `No specific case for this school yet. To a reader, an unnamed file is interchangeable with every other file in the stack.`;

  return {
    id: "narrative",
    label: "The case for this school",
    lens: "Does this applicant want us, or do they just want out?",
    score,
    signal: sig(score),
    note,
    lift: score < 0.8 ? `Name two courses and one professor at ${s.name} you could not access where you are.` : null,
    color: "var(--accent)",
    schoolInvariant: false,
  };
}

function engagement(p: Profile): Dimension {
  let score = 0.22;
  if (p.ecLevel === "campus") score = 0.7;
  if (p.ecLevel === "national") score = 0.8;
  if (p.ptk) score += 0.07;
  if (p.honors) score += 0.07;
  if (p.activitiesText.trim().length > 120) score += 0.05;
  score = Math.min(1, score);

  const note =
    p.ecLevel === "minimal"
      ? `Little campus-anchored involvement on file. In 1,217 structured profiles, half of what admits list happens on their own campus — this is the most fixable box on the sheet.`
      : p.ecLevel === "national"
        ? `National-level involvement is here, and it reads well alongside campus roles. Prestige alone doesn't carry a file, but paired with campus work it's a strong box.`
        : `Campus-anchored involvement is on file — the pattern that recurs through admit files, not the trophy-hunting one.`;

  return {
    id: "engagement",
    label: "What you did where you are",
    lens: "Has this person used the institution they're in?",
    score,
    signal: sig(score),
    note,
    lift: score < 0.7 ? "An officer seat or a tutoring job — three weeks of real commitment — changes this box." : null,
    color: "var(--coral)",
    schoolInvariant: true,
  };
}

function preparation(p: Profile, s: School): Dimension {
  const hasCourses = p.courses.length > 0;
  let score = hasCourses ? Math.min(0.9, 0.35 + p.courses.length * 0.045) : 0.25;
  if (p.igetc) score = Math.min(1, score + 0.12);
  if (p.standing === "junior") score = Math.min(1, score + 0.06);

  const note = !hasCourses
    ? `No coursework on file, so a reader cannot tell whether you're ready for their upper-division sequence. This is a blank box, not a bad one — fill it.`
    : `${p.courses.length} courses on record${p.igetc ? ", IGETC in progress or complete" : ""}. A reader is checking whether you can walk into their junior year, not counting credits.`;

  return {
    id: "preparation",
    label: "Ready for their coursework",
    lens: "Can this person step into our upper-division sequence without backfilling?",
    score,
    signal: sig(score),
    note,
    lift: !hasCourses ? "Add your courses — it's the fastest way to turn a blank box into a strong one." : (s.counsel?.programs?.length ? `Their named pathways: ${s.counsel.programs.join(", ")}.` : null),
    color: "#7a5cf0",
    schoolInvariant: true,
  };
}

function circumstance(p: Profile): Dimension {
  let score = 0.5;
  const bits: string[] = [];
  if (p.firstGen) { score += 0.14; bits.push("first-generation"); }
  if (p.workHours && p.workHours >= 15) { score += 0.14; bits.push(`${p.workHours} hrs/week of work while enrolled`); }
  if (p.hook === "veteran") { score += 0.2; bits.push("veteran"); }
  if (p.hook === "nontraditional") { score += 0.14; bits.push("non-traditional path"); }
  if (p.gpaTrend === "upward") { score += 0.08; bits.push("an upward trajectory"); }
  score = Math.min(1, score);

  const note = bits.length
    ? `Context a reader weighs the rest of the file against: ${bits.join(", ")}. This is the box that turns a number into a person, and 16% of admits in the study are redemption cases.`
    : `Nothing flagged here yet. If you work, support family, are first in your family at university, or came back from a rough start — say so. Readers weigh the record against the conditions it was earned in.`;

  return {
    id: "circumstance",
    label: "The conditions behind the record",
    lens: "What was this person managing while they earned this?",
    score,
    signal: sig(score),
    note,
    lift: bits.length === 0 ? "Work hours and first-generation status are read as substance, never as excuses." : null,
    color: "#e8a33d",
    schoolInvariant: true,
  };
}

export function readerSheet(p: Profile, e: Estimate): ReaderSheet {
  const s = e.school;
  const dims = [
    academic(p, s),
    context(p, s),
    preparation(p, s),
    engagement(p),
    narrative(p, s),
    circumstance(p),
  ];

  // The pivot is the weakest dimension that is genuinely movable.
  const movable = dims.filter((d) => d.id !== "academic" && d.id !== "context");
  const pivot = [...movable].sort((a, b) => a.score - b.score)[0] ?? dims[0];

  const { p25, estimated } = band(s);
  const gateCleared = p.gpa >= p25 - 0.05;

  const headline = gateCleared
    ? `Your number gets this file read at ${s.name}. What happens next is decided in the boxes below — and ${pivot.label.toLowerCase()} is the one a reader would stop on.`
    : `At ${s.name} the academic band is doing most of the gatekeeping, and this file sits under it. The boxes below still matter, but they're being asked to carry more than they usually can here.`;

  const gateNote =
    (gateCleared
      ? "Cleared — the rest of the sheet is the decision"
      : "Under the band — the rest of the sheet has to overperform") +
    (estimated ? " (band estimated; this school doesn't publish it)" : "");

  return { school: s.name, dimensions: dims, pivot, headline, gateCleared, gateNote, bandEstimated: estimated };
}

/** High school, honestly: the corpus says it barely predicts anything. */
export const HIGH_SCHOOL_FACT = {
  corr: 0.016,
  redemption: 16,
  line: "Your high-school record correlates with your college GPA at 0.016 — statistically nothing. Transfer readers are assessing what you did after. 16% of admits in the study are redemption cases.",
};
