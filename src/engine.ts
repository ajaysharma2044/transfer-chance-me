// Transfer Chance Me — chance engine.
// Anchored on each school's official transfer admit rate (Common Data Set / UC
// admit data), then adjusted by where the applicant sits in that school's
// *observed admitted-GPA distribution* and by the levers the dataset shows
// actually differentiate admits (feeder fit, standing, major lane, hooks,
// essay specificity). Every adjustment is surfaced as a named driver.

import model from "./data/model.json";
import ucData from "./data/uc_data.json";

export interface Counsel {
  typical: string;
  floor: number | null;
  levers: string[];
  watchouts: string[];
  feeders: string;
  programs: string[];
}

export interface School {
  id: string;
  name: string;
  rate: number;
  applicants: number | null;
  admitted: number | null;
  cycle: string;
  n: number;
  nAdmits: number;
  nGpa: number;
  gpa: { p10: number | null; p25: number | null; p50: number | null; p75: number | null; p90: number | null };
  hist: number[];
  majors: string[];
  feeder: string;
  coadmit: string[];
  trend: [string, number][];
  counsel: Counsel | null;
}

export const MODEL = model as unknown as { meta: Record<string, unknown>; schools: School[] };

// ── The rest of the UC system, from official UC admit data (Fall 2026) ──
// UC no longer publishes admitted-GPA ranges, so gpa percentiles are null
// and the engine estimates position from campus selectivity instead.
interface UcCampus {
  rate: number; applicants: number; admitted: number;
  gpaP25: number | null; gpaP75: number | null; cycle: string; ccNote: string;
}
const UC_JSON = ucData as unknown as {
  campuses: Record<string, UcCampus>;
  tag: { campuses: string[]; minGpa: Record<string, number> };
};

export const TAG_CAMPUSES: Record<string, number> = Object.fromEntries(
  UC_JSON.tag.campuses.map((c) => [c, UC_JSON.tag.minGpa[c] ?? 3.4]),
);

for (const [name, c] of Object.entries(UC_JSON.campuses)) {
  if (MODEL.schools.some((s) => s.name === name)) continue;
  const tagMin = TAG_CAMPUSES[name];
  MODEL.schools.push({
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    rate: c.rate,
    applicants: c.applicants,
    admitted: c.admitted,
    cycle: `${c.cycle} (UC admit data)`,
    n: 0, nAdmits: 0, nGpa: 0,
    gpa: { p10: null, p25: null, p50: null, p75: null, p90: null },
    hist: [],
    majors: [],
    feeder: "California community colleges",
    coadmit: [],
    trend: [],
    counsel: {
      typical: `${c.ccNote} The standard admit is a California CC junior with IGETC progress and major prep done${tagMin ? `; TAG guarantees admission at a ${tagMin.toFixed(1)}+ GPA with on-time filing` : ""}.`,
      floor: tagMin ?? null,
      levers: [
        ...(tagMin ? [`File TAG in September — guaranteed admission at ${tagMin.toFixed(1)}+ GPA (major criteria apply)`] : []),
        "Finish IGETC and your major's articulated prerequisites (check ASSIST.org)",
        "Apply in the Aug 1–Nov 30 UC filing window — there is no late round",
      ],
      watchouts: [
        ...(tagMin ? [] : ["No TAG at this campus — admission is competitive, not guaranteed"]),
        "Impacted majors (CS, engineering, some biology) run far more selective than the campus rate",
      ],
      feeders: c.ccNote,
      programs: tagMin ? ["TAG", "IGETC"] : ["IGETC"],
    },
  });
}
MODEL.meta.schools = MODEL.schools.length;

export type Institution = "cc" | "public4" | "private4";
export type Standing = "sophomore" | "junior";
export type Major = "cs" | "engineering" | "business" | "econ" | "stem" | "social" | "humanities" | "undecided";
export type Hook = "none" | "veteran" | "nontraditional";
export type Essay = "named" | "general" | "draft";
export type EcLevel = "minimal" | "campus" | "national";

export interface Profile {
  gpa: number;
  /** The applicant's current school, picked from the IPEDS directory */
  schoolName: string | null;
  institution: Institution;
  caResident: boolean;
  igetc: boolean;
  standing: Standing;
  major: Major;
  ptk: boolean;
  honors: boolean;
  hook: Hook;
  essay: Essay;
  ecLevel: EcLevel;
  sat: number | null;
  /** Pasted "why transfer" essay; analyzed locally when present */
  essayText: string;
  /** Schools the essay names specifically (derived from essayText) */
  essayNamed: string[];
  essayVerdict: "specific" | "general" | "complaint" | null;
  /** Course codes read off uploaded transcripts or added by hand */
  courses: string[];
  /** Names of documents analyzed */
  docs: string[];
  /** Specific program/major in their own words, e.g. "Applied Economics (Dyson)" */
  majorDetail: string;
  /** Why they're transferring, in their own words */
  transferReason: string;
  /** Direction of the college GPA over time */
  gpaTrend: "upward" | "flat" | "downward";
  /** Hours/week working while enrolled (context for review) */
  workHours: number | null;
  firstGen: boolean;
  /** Activities & extracurriculars in their own words */
  activitiesText: string;
  /** Awards & honors in their own words */
  awardsText: string;
}

export const DEFAULT_PROFILE: Profile = {
  gpa: 3.8,
  schoolName: null,
  institution: "cc",
  caResident: false,
  igetc: false,
  standing: "junior",
  major: "cs",
  ptk: false,
  honors: false,
  hook: "none",
  essay: "general",
  ecLevel: "campus",
  sat: null,
  essayText: "",
  essayNamed: [],
  essayVerdict: null,
  courses: [],
  docs: [],
  majorDetail: "",
  transferReason: "",
  gpaTrend: "flat",
  workHours: null,
  firstGen: false,
  activitiesText: "",
  awardsText: "",
};

export interface Driver {
  dir: "up" | "down" | "flat";
  text: string;
}

export interface Estimate {
  school: School;
  p: number;           // point estimate, 0..1
  lo: number;          // band, 0..1
  hi: number;
  tier: Tier;
  drivers: Driver[];
  thin: boolean;       // small observed sample
}

export type Tier = "TAG guarantee" | "Likely" | "Strong target" | "Target" | "Reach" | "High reach" | "Long shot";

const UC = new Set([
  "UCLA", "UC Berkeley", "UC Davis", "UC Irvine", "UC San Diego",
  "UC Santa Barbara", "UC Santa Cruz", "UC Riverside", "UC Merced",
]);
const PUBLICS = new Set(["UCLA", "UC Berkeley", "Michigan", "UNC"]);
// Schools whose dominant transfer lane runs through business programs
const BUSINESS_GAUNTLET = new Set(["UPenn", "Cornell", "Michigan", "UC Berkeley"]);
// Test scores still surface in admits' files here
const TEST_VALUED = new Set(["MIT", "Georgetown", "Cornell"]);

function tierOf(p: number): Tier {
  if (p >= 0.45) return "Likely";
  if (p >= 0.25) return "Strong target";
  if (p >= 0.12) return "Target";
  if (p >= 0.05) return "Reach";
  if (p >= 0.015) return "High reach";
  return "Long shot";
}

export function estimate(profile: Profile, s: School): Estimate {
  const base = s.rate / 100;
  const drivers: Driver[] = [];
  let mult = 1;

  // ── TAG: six UCs guarantee admission to qualifying CA CC juniors ──
  const tagMin = TAG_CAMPUSES[s.name];
  if (
    tagMin != null &&
    profile.institution === "cc" &&
    profile.caResident &&
    profile.standing === "junior" &&
    profile.gpa >= tagMin
  ) {
    return {
      school: s,
      p: 0.95, lo: 0.9, hi: 0.99,
      tier: "TAG guarantee",
      drivers: [
        { dir: "up", text: `You meet ${s.name}'s TAG criteria (${tagMin.toFixed(1)}+ GPA, CA community college, junior standing) — filing TAG by September 30 guarantees admission` },
        { dir: "flat", text: "The guarantee holds if you complete major prerequisites and maintain your GPA; some impacted majors are excluded — verify yours on ASSIST" },
      ],
      thin: false,
    };
  }

  // ── GPA vs the school's observed admitted distribution ──
  // UC campuses without published GPA ranges get a selectivity-based estimate.
  const noGpaData = s.gpa.p50 == null && UC.has(s.name);
  const med = s.gpa.p50 ?? (noGpaData ? Math.min(3.7, Math.max(3.25, 3.9 - (s.rate / 100) * 0.8)) : 3.95);
  const q25 = s.gpa.p25 ?? (noGpaData ? med - 0.25 : med - 0.12);
  const mid = (med + q25) / 2;
  const spread = Math.max(0.045, (med - q25) / 1.35);
  const gpaFactor = 0.22 + 2.2 / (1 + Math.exp(-(profile.gpa - mid) / spread));
  mult *= gpaFactor;
  const est = noGpaData ? " (estimated — UC no longer publishes admitted-GPA ranges)" : "";
  if (profile.gpa >= med) {
    drivers.push({ dir: "up", text: `Your ${profile.gpa.toFixed(2)} sits at or above the ${noGpaData ? "estimated" : "observed"} admit median (${med.toFixed(2)})${est}` });
  } else if (profile.gpa >= q25) {
    drivers.push({ dir: "flat", text: `Your ${profile.gpa.toFixed(2)} is inside the admit range (25th percentile ${q25.toFixed(2)}, median ${med.toFixed(2)})${est}` });
  } else {
    drivers.push({ dir: "down", text: `Your ${profile.gpa.toFixed(2)} is below the 25th percentile of ${noGpaData ? "estimated" : "observed"} admits (${q25.toFixed(2)})${est}` });
  }
  const floor = s.counsel?.floor;
  if (floor != null && profile.gpa < floor) {
    drivers.push({ dir: "down", text: `Below the ~${floor.toFixed(1)} practical floor that shows up in this school's admits` });
  }
  if (profile.gpaTrend === "upward") {
    mult *= 1.08;
    drivers.push({ dir: "up", text: "An upward GPA trajectory — admits' files repeatedly credit the climb, not just the number" });
  } else if (profile.gpaTrend === "downward") {
    mult *= 0.9;
    drivers.push({ dir: "down", text: "A downward GPA trend invites scrutiny — recent-term grades carry the most weight" });
  }

  // ── Feeder fit & standing ──
  if (UC.has(s.name)) {
    if (profile.institution === "cc") {
      if (profile.caResident) {
        mult *= 1.5;
        drivers.push({ dir: "up", text: "California community college is this campus's dominant admit lane (≈90%+ of UC transfer admits)" });
        if (profile.igetc) {
          mult *= 1.15;
          drivers.push({ dir: "up", text: "IGETC completion matches the standard admitted pathway" });
        }
      } else {
        mult *= 0.5;
        drivers.push({ dir: "down", text: "UCs overwhelmingly admit from California community colleges; out-of-state CC is a much thinner lane" });
      }
    } else {
      mult *= 0.45;
      drivers.push({ dir: "down", text: "UCs give transfer priority to community college applicants over 4-year transfers" });
    }
    if (profile.standing !== "junior") {
      mult *= 0.25;
      drivers.push({ dir: "down", text: "UCs admit transfers at junior standing; sophomore-entry applications are largely ineligible" });
    }
  } else {
    const ccFeeder = s.feeder.toLowerCase().includes("community college");
    if (profile.institution === "cc") {
      if (ccFeeder || profile.gpa >= 3.9) {
        mult *= 1.1;
        drivers.push({ dir: "up", text: "Community college is a recurring feeder lane in this school's admits" });
      } else {
        mult *= 0.9;
        drivers.push({ dir: "flat", text: `Observed admits here skew from 4-year feeders (${s.feeder || "state flagships and privates"})` });
      }
      if (profile.ptk) {
        mult *= 1.12;
        drivers.push({ dir: "up", text: "Phi Theta Kappa is the single most-cited credential among CC-origin admits" });
      }
    } else {
      if (!ccFeeder) {
        mult *= 1.1;
        drivers.push({ dir: "up", text: `4-year-to-4-year matches this school's dominant feeder pattern (${s.feeder})` });
      }
    }
  }
  if (profile.honors) {
    mult *= 1.08;
    drivers.push({ dir: "up", text: "Honors-program membership recurs in the 'institutional stack' of admits" });
  }

  // ── Major lane ──
  if (profile.major === "cs" || profile.major === "engineering") {
    if (UC.has(s.name)) {
      mult *= 0.35;
      drivers.push({ dir: "down", text: "CS/engineering at the UCs runs several times more selective than the campus-wide transfer rate" });
    } else {
      mult *= 0.8;
      drivers.push({ dir: "down", text: "CS/engineering is the most impacted transfer lane nearly everywhere" });
    }
  } else if (profile.major === "business" && BUSINESS_GAUNTLET.has(s.name)) {
    mult *= UC.has(s.name) ? 0.4 : 0.75;
    drivers.push({ dir: "down", text: "Direct-to-business (Wharton/Dyson/Ross/Haas-type) is this school's hardest transfer door" });
  } else if ((profile.major === "humanities" || profile.major === "social") && PUBLICS.has(s.name)) {
    mult *= 1.1;
    drivers.push({ dir: "up", text: "Humanities/social-science lanes are less impacted at the big publics" });
  }

  // ── Hooks ──
  if (profile.hook === "veteran") {
    const m = s.name === "Princeton" ? 3.0 : s.name === "Yale" ? 2.6 : s.name === "Columbia" ? 2.0 : 1.25;
    mult *= m;
    if (m > 1.3) drivers.push({ dir: "up", text: "This school runs a deliberate veteran/nontraditional transfer pipeline — your strongest card" });
    else drivers.push({ dir: "up", text: "Veteran status is a meaningful differentiator in transfer review" });
  } else if (profile.hook === "nontraditional") {
    const m = s.name === "Princeton" ? 2.2 : s.name === "Yale" ? 2.0 : s.name === "Columbia" ? 1.8 : 1.1;
    mult *= m;
    if (m > 1.2) drivers.push({ dir: "up", text: "Nontraditional path fits this school's comeback-story admit lane (GS/Eli Whitney-type programs)" });
  }

  // ── Essay ──
  if (profile.essayText) {
    // Analyzed from the actual pasted essay
    if (profile.essayVerdict === "complaint") {
      mult *= 0.85;
      drivers.push({ dir: "down", text: "Your essay reads complaint-shaped — admits frame the move as fit-and-resources, not escape" });
    }
    if (profile.essayNamed.includes(s.name)) {
      mult *= 1.3;
      drivers.push({ dir: "up", text: "Your essay names this school's programs — the school-specific case admits credit most" });
    } else {
      const progs = (s.counsel?.programs ?? []).filter((p) => !["PTK", "IGETC", "TAG", "Honors"].includes(p)).slice(0, 3);
      drivers.push({
        dir: "flat",
        text: progs.length
          ? `Your essay doesn't name ${s.name} specifics — admits here name ${progs.join(", ")}`
          : `Your essay doesn't name ${s.name} specifics — a version naming its programs would score higher`,
      });
    }
  } else if (profile.essay === "named") {
    mult *= 1.3;
    drivers.push({ dir: "up", text: "A program-specific 'why transfer' essay is the #1 differentiator admits credit" });
  } else if (profile.essay === "draft") {
    mult *= 0.85;
    drivers.push({ dir: "down", text: "No essay yet — the single biggest lever still on the table" });
  }

  // ── Test score ──
  if (profile.sat != null && profile.sat >= 1450) {
    mult *= TEST_VALUED.has(s.name) ? 1.18 : 1.06;
    if (TEST_VALUED.has(s.name)) drivers.push({ dir: "up", text: "A strong score still carries weight here (not fully test-optional in practice)" });
  }

  // ── Activities: pattern over prestige — campus-anchored involvement
  // recurs in admit files; trophy ECs alone don't rescue a GPA ──
  if (profile.ecLevel === "campus") {
    mult *= 1.05;
    drivers.push({ dir: "up", text: "Campus involvement — leadership, tutoring, faculty research — is the activity pattern that recurs in admit files" });
  } else if (profile.ecLevel === "national") {
    mult *= 1.08;
    drivers.push({ dir: "up", text: "Strong activities help your file — pair them with campus-anchored work; prestige alone doesn't rescue a GPA in the record" });
  }

  const cap = Math.min(0.85, base * 8);
  const p = Math.min(cap, Math.max(base * 0.08, base * mult));
  const lo = Math.max(0.001, p * 0.72);
  const hi = Math.min(0.9, p * 1.38);

  drivers.sort((a, b) => (a.dir === "down" ? 0 : 1) - (b.dir === "down" ? 0 : 1));

  return { school: s, p, lo, hi, tier: tierOf(p), drivers, thin: s.nGpa < 15 };
}

export function estimateAll(profile: Profile): Estimate[] {
  return MODEL.schools
    .map((s) => estimate(profile, s))
    .sort((a, b) => b.p - a.p);
}

export function fmtPct(x: number): string {
  const v = x * 100;
  if (v < 1) return v.toFixed(1);
  if (v < 10) return v.toFixed(1).replace(/\.0$/, "");
  return Math.round(v).toString();
}
