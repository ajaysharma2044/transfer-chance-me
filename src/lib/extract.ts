// Heuristic extraction of profile fields from transcript / application text.
// Pattern-based only — runs entirely in the browser.
import type { Profile } from "../engine";

export interface Extraction {
  fields: Partial<Profile>;
  found: string[];   // human-readable summary of what was detected
  courses: string[]; // course codes seen on a transcript
}

const CA_CC_HINTS = [
  "de anza", "foothill", "santa monica college", "diablo valley", "pasadena city",
  "irvine valley", "orange coast", "el camino college", "mt. san antonio", "mt san antonio",
  "santa barbara city", "berkeley city college", "city college of san francisco",
  "glendale community", "saddleback", "moorpark", "chabot", "las positas", "ohlone",
  "sierra college", "american river", "sacramento city", "san diego mesa", "grossmont",
  "cerritos", "fullerton college", "long beach city", "riverside city", "santiago canyon",
  "west valley college", "mission college", "cañada college", "canada college", "skyline college",
  "college of san mateo", "los angeles pierce", "santa rosa junior",
];

const MAJOR_MAP: [RegExp, Profile["major"]][] = [
  [/computer science|\bcs\b(?! ?[0-9])|software engineering/i, "cs"],
  [/\b(electrical|mechanical|civil|aerospace|chemical|bio)?\s?engineering\b/i, "engineering"],
  [/business|finance|accounting|marketing|management\b/i, "business"],
  [/economics|\becon\b/i, "econ"],
  [/biology|chemistry|physics|math|statistics|neuroscience|biochem/i, "stem"],
  [/political science|psychology|sociology|international relations|communication/i, "social"],
  [/english|history|philosophy|literature|art history|classics/i, "humanities"],
];

export function extractProfile(raw: string): Extraction {
  const text = raw.replace(/\s+/g, " ");
  const lower = text.toLowerCase();
  const fields: Partial<Profile> = {};
  const found: string[] = [];

  // GPA — prefer values labeled cumulative, else any labeled GPA
  const gpaPatterns = [
    /cumulative\s*(?:college\s*)?gpa[^0-9]{0,12}([0-4]\.\d{1,3})/i,
    /overall\s*gpa[^0-9]{0,12}([0-4]\.\d{1,3})/i,
    /gpa[^0-9]{0,12}([0-4]\.\d{1,3})/i,
  ];
  for (const p of gpaPatterns) {
    const m = text.match(p);
    if (m) {
      const g = parseFloat(m[1]);
      if (g >= 2 && g <= 4.0) {
        fields.gpa = g;
        found.push(`GPA ${g.toFixed(2)}`);
        break;
      }
    }
  }

  // SAT
  const sat = text.match(/\bSAT\b[^0-9]{0,20}\b(1[0-6]\d{2}|[89]\d{2})\b/i);
  if (sat) {
    fields.sat = parseInt(sat[1], 10);
    found.push(`SAT ${sat[1]}`);
  }

  // Credits → standing
  const credits = text.match(/(\d{1,3}(?:\.\d)?)\s*(?:semester\s*)?(?:credits?|units)\s*(?:earned|completed|attempted)?/i)
    ?? text.match(/(?:credits?|units)\s*(?:earned|completed)[^0-9]{0,10}(\d{1,3}(?:\.\d)?)/i);
  if (credits) {
    const n = parseFloat(credits[1]);
    if (n >= 6 && n <= 200) {
      fields.standing = n >= 45 ? "junior" : "sophomore";
      found.push(`${n} credits → ${fields.standing} standing`);
    }
  }

  // Institution type — known CA community colleges first (many lack "community" in the name)
  if (CA_CC_HINTS.some((h) => lower.includes(h)) || /california community college/i.test(text)) {
    fields.institution = "cc";
    fields.caResident = true;
    found.push("California community college");
  } else if (/community college|junior college|\bcity college\b/i.test(text)) {
    fields.institution = "cc";
    found.push("Community college");
  } else if (/\buniversity\b|\bcollege\b/.test(lower)) {
    if (/state university|\buniversity of\b|a&m|polytechnic/i.test(text)) {
      fields.institution = "public4";
      found.push("4-year public");
    }
  }

  // Credentials & hooks
  if (/phi theta kappa|\bptk\b/i.test(text)) { fields.ptk = true; found.push("Phi Theta Kappa"); }
  if (/honors (program|college|society)/i.test(text)) { fields.honors = true; found.push("Honors program"); }
  if (/igetc/i.test(text)) { fields.igetc = true; found.push("IGETC"); }
  if (/\bveteran\b|military service|\barmy\b|\bnavy\b|\bmarine corps\b|air force/i.test(text)) {
    fields.hook = "veteran";
    found.push("Veteran / military service");
  }

  // Intended major
  const majorLine = text.match(/(?:intended|declared|current)?\s*major[^a-z0-9]{0,4}([A-Za-z &/-]{3,40})/i);
  const majorSource = majorLine ? majorLine[1] : text;
  for (const [re, val] of MAJOR_MAP) {
    if (re.test(majorSource)) {
      fields.major = val;
      found.push(`Major: ${val === "cs" ? "computer science" : val}`);
      break;
    }
  }

  // Course codes (e.g. MATH 1B, CS 61A, ENGL-101)
  const courses = [...new Set(
    (raw.match(/\b[A-Z]{2,5}[- ]?\d{1,3}[A-Z]{0,2}\b/g) ?? [])
      .filter((c) => !/^(SAT|ACT|GPA|PDF)/.test(c)),
  )].slice(0, 60);
  if (courses.length >= 4) found.push(`${courses.length} courses on transcript`);

  return { fields, found, courses };
}
