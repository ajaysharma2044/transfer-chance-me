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

/* ------------------------------------------------------------------ *
 * Shared name grammar
 *
 * A "name word" is capitalised and may be ALL CAPS, because the header of a
 * PDF transcript usually is. Joiner words stay lower-case only, so the two
 * classes can never match the same token — that keeps the alternation
 * unambiguous and the match linear instead of exponential.
 * ------------------------------------------------------------------ */
const NW = "[A-Z][A-Za-z\\u00C0-\\u024F'’.&-]*";
const JOIN = "(?:of|the|at|and|de|la|los|las|for)";
const NAME_RUN = `${NW}(?:\\s+(?:${JOIN}|${NW})){0,4}`;

const SMALL_WORDS = new Set(["of", "the", "at", "and", "for", "in", "de", "la", "los", "las"]);

// A capitalised sentence opener gets swept into a name run ("Recipient of the
// Chancellor's Medal", "Now Attending Valencia College"). Shave it back off.
const LEAD_JUNK =
  /^(?:the|a|an|and|of|for|in|at|to|now|currently|attending|enrolled|recipient|awarded|received|winner|earned|named|selected|honou?red|from|transfer|my|this|also|our)$/i;

/** Drop leading filler while at least `keep` words remain. */
function trimLead(words: string[], keep: number): string[] {
  const out = [...words];
  while (out.length > keep && LEAD_JUNK.test(out[0])) out.shift();
  return out;
}

/** Keep a school's own casing when it has any; title-case a shouting header
 *  so "DE ANZA COLLEGE" reads back as the student would write it. */
function tidyName(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (/[a-z]/.test(t) && /[A-Z]/.test(t)) return t;
  return t
    .split(" ")
    .map((w, i) => {
      const low = w.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(low)) return low;
      return low.charAt(0).toUpperCase() + low.slice(1);
    })
    .join(" ");
}

/** Collect every capture of a global pattern that survives `refine`, which
 *  also sees the ~24 characters following the match and may return a cleaned
 *  up string, or null to drop the candidate. */
function collect(
  re: RegExp,
  hay: string,
  refine: (name: string, after: string) => string | null,
): string[] {
  const out: string[] = [];
  for (const m of hay.matchAll(re)) {
    const end = (m.index ?? 0) + m[0].length;
    const kept = refine(m[1], hay.slice(end, end + 24));
    if (kept) out.push(kept);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * School name
 *
 * A wrong school name is worse than none: it lands on the report, in the
 * prompt, and on the "Now at" line of the profile. So the curated CC list
 * wins first, and the general header pattern has to clear a denylist before
 * it is trusted.
 * ------------------------------------------------------------------ */

// "De Anza" on the hint list, "De Anza College" on the transcript.
const HINT_SUFFIX = /^\s+(?:(?:community|junior|city)\s+)?(?:college|university)\b/i;

const TRAILING_SCHOOL = new RegExp(
  `\\b(${NAME_RUN}\\s+(?:College|COLLEGE|University|UNIVERSITY))\\b`,
  "g",
);

const LEADING_UNIVERSITY = new RegExp(
  `\\b((?:University|UNIVERSITY)\\s+(?:of|OF)\\s+${NW}(?:\\s+${NW}){0,2}` +
    `(?:,\\s*${NW}(?:\\s+${NW})?)?(?:\\s+(?:at|AT)\\s+${NW}(?:\\s+${NW})?)?)`,
  "g",
);

// Words that mean the match is paperwork, a governing body or a sub-unit —
// not the institution the student attends.
const NOT_A_SCHOOL =
  /\b(transcript|official|unofficial|academic|registrar|records?|report|department|division|office|district|system|board|catalog|catalogue|credits?|courses?|semester|quarter|term|student|copy|page|printed|issued|honors?|program|scholarship|awards?|dean|library|bookstore|athletics|alumni|foundation|graduate|undergraduate)\b/i;

// A name that is only generic words ("Community College") names nothing.
const GENERIC_ONLY = /^(?:the|a|community|junior|city|state|technical|of|and|college|university)$/i;

const SCHOOL_TAIL_BAD = /^\s+(?:district|system|board|foundation|police|athletics)\b/i;
// "Berkeley College of Engineering" is a division inside a university.
const SCHOOL_TAIL_OF = /^\s+(?:of|OF)\s+[A-Z]/;

function acceptSchool(name: string, after: string): string | null {
  // "University of California, Davis Official Academic" — a name run runs on
  // into the rest of the letterhead, so cut at the first word that belongs to
  // the paperwork rather than to the school.
  let words = name.split(/\s+/);
  const junk = words.findIndex((w) => NOT_A_SCHOOL.test(w));
  if (junk >= 0) words = words.slice(0, junk);
  words = trimLead(words, 2);
  const trimmed = words.join(" ");

  if (words.length < 2 || words.length > 7 || trimmed.length > 60) return null;
  // Truncation must not have eaten the thing that made this a school.
  if (!/\b(?:college|university)\b/i.test(trimmed)) return null;
  if (SCHOOL_TAIL_BAD.test(after)) return null;
  if (/college$/i.test(trimmed) && SCHOOL_TAIL_OF.test(after)) return null;
  // Needs at least one word that is actually a name, not "Community College".
  if (!words.some((w) => !GENERIC_ONLY.test(w))) return null;
  return trimmed;
}

/** The curated California CC list, expanded to the full name as written. */
function schoolFromHint(text: string, lower: string): string | null {
  let best: { at: number; hit: string } | null = null;
  for (const h of CA_CC_HINTS) {
    const at = lower.indexOf(h);
    if (at < 0) continue;
    // Earliest wins — on a transcript the letterhead comes before any
    // "transfer credit from …" line further down.
    if (!best || at < best.at || (at === best.at && h.length > best.hit.length)) best = { at, hit: h };
  }
  if (!best) return null;
  let end = best.at + best.hit.length;
  const suffix = text.slice(end, end + 30).match(HINT_SUFFIX);
  if (suffix) end += suffix[0].length;
  return tidyName(text.slice(best.at, end));
}

/** Any college/university named in the letterhead, i.e. the top of the doc. */
function schoolFromHeader(head: string): string | null {
  const hits = [
    ...collect(TRAILING_SCHOOL, head, acceptSchool),
    ...collect(LEADING_UNIVERSITY, head, acceptSchool),
  ];
  return hits.length ? tidyName(hits[0]) : null;
}

/* ------------------------------------------------------------------ *
 * Awards & honors
 * ------------------------------------------------------------------ */

// One mention can cover several terms: "Dean's List: Fall 2023, Spring 2024".
// Only the unbroken run of term labels immediately after the phrase counts,
// so the next semester's course block can never inflate the number.
// Four-digit years first: "Fall 2023" must not be read as "Fall '20".
const TERM = "(?:fall|spring|summer|winter|autumn)\\s*(?:of\\s+)?(?:\\d{4}\\b|['’]\\d{2}\\b|\\d{2}\\b)";
const TERM_RUN = new RegExp(`^[\\s:;,()\\-–—]*(?:${TERM}(?:[\\s,;&()]|and)*)+`, "i");
const TERM_ONE = new RegExp(TERM, "gi");

/** "Dean's List" → "Dean's List", "Dean's List x2" — never a count we invented. */
function countedHonor(text: string, label: string, core: string): string | null {
  const all = [...text.matchAll(new RegExp(core, "gi"))];
  if (all.length === 0) return null;

  const explicit =
    text.match(new RegExp(`${core}\\s*[-–—:(]?\\s*[xX]\\s*(\\d{1,2})\\b`, "i")) ??
    text.match(new RegExp(`${core}\\s*[-–—:(]?\\s*(\\d{1,2})\\s*(?:times|terms|semesters|quarters)\\b`, "i")) ??
    text.match(new RegExp(`(\\d{1,2})\\s*(?:x|times|terms|semesters|quarters)\\s*(?:on\\s+the\\s+)?${core}`, "i"));
  if (explicit) {
    const v = parseInt(explicit[1], 10);
    if (v >= 1 && v <= 12) return v > 1 ? `${label} x${v}` : label;
  }

  let n = all.length;
  if (n === 1) {
    const first = all[0];
    const run = text.slice((first.index ?? 0) + first[0].length).match(TERM_RUN);
    const terms = run ? run[0].match(TERM_ONE) : null;
    if (terms && terms.length > 1) n = Math.min(terms.length, 12);
  }
  return n > 1 ? `${label} x${n}` : label;
}

const GREEK =
  "(?:Alpha|Beta|Gamma|Delta|Epsilon|Zeta|Eta|Theta|Iota|Kappa|Lambda|Mu|Nu|Xi|Omicron|Pi|Rho|Sigma|Tau|Upsilon|Phi|Chi|Psi|Omega)";
const SOCIETY_GREEK = new RegExp(`\\b(${GREEK}(?:\\s+${GREEK}){1,2})\\b`, "gi");
const SOCIETY_NAMED = new RegExp(`\\b(${NAME_RUN}\\s+(?:Honor|HONOR)\\s+(?:Society|SOCIETY))\\b`, "g");
const NAMED_AWARD = new RegExp(
  `\\b(${NAME_RUN}\\s+(?:Scholarship|SCHOLARSHIP|Scholarships|Fellowship|FELLOWSHIP|Award|AWARD|Prize|PRIZE|Medal|MEDAL))\\b`,
  "g",
);
// Money the student was given is not an honour they won.
const NOT_AN_AWARD = /\b(financial|aid|pell|loan|grant|tuition|disburse|disbursement|fee|refund|balance|federal|fafsa|year|letter|summary|total)\b/i;
const LATIN_HONORS = /\b(summa\s+cum\s+laude|magna\s+cum\s+laude|cum\s+laude)\b/i;

/** "Recipient of the Chancellor's Medal" is the medal, not the sentence. */
function named(name: string): string | null {
  const words = trimLead(name.split(/\s+/), 2);
  return words.length >= 2 ? words.join(" ") : null;
}

function extractAwards(text: string): string[] {
  const out: string[] = [];

  const dean = countedHonor(text, "Dean's List", "dean['’]?s?\\s+list");
  if (dean) out.push(dean);
  for (const [label, core] of [
    ["President's List", "president['’]?s?\\s+list"],
    ["Chancellor's List", "chancellor['’]?s?\\s+list"],
    ["Provost's List", "provost['’]?s?\\s+list"],
    ["Honor Roll", "honou?r\\s+roll"],
  ] as [string, string][]) {
    const hit = countedHonor(text, label, core);
    if (hit) out.push(hit);
  }

  const ptk = text.search(/phi\s+theta\s+kappa|\bptk\b/i);
  if (ptk >= 0) {
    const window = text.slice(Math.max(0, ptk - 40), ptk + 90);
    out.push(/induct/i.test(window) ? "Phi Theta Kappa inducted" : "Phi Theta Kappa");
  }

  // Phi Theta Kappa is already spoken for above; any other Greek-letter run is
  // an honour society the reader will recognise.
  const isSociety = (s: string) => (/phi\s+theta\s+kappa/i.test(s) ? null : s);
  for (const s of collect(SOCIETY_GREEK, text, isSociety)) out.push(tidyName(s));
  for (const s of collect(SOCIETY_NAMED, text, named)) out.push(tidyName(s));

  const isAward = (name: string, after: string) =>
    !NOT_AN_AWARD.test(name) && !/^\s+(?:year|letter|summary|disburse)/i.test(after)
      ? named(name)
      : null;
  for (const a of collect(NAMED_AWARD, text, isAward)) out.push(tidyName(a));

  const latin = text.match(LATIN_HONORS);
  if (latin) out.push(tidyName(latin[1]));
  else if (/\bgraduat\w*\s+with\s+(?:high\s+|highest\s+)?(?:distinction|honou?rs)\b/i.test(text)) {
    out.push("Graduated with honors");
  }
  if (/\bvaledictorian\b/i.test(text)) out.push("Valedictorian");
  if (/\bsalutatorian\b/i.test(text)) out.push("Salutatorian");

  // Dedupe case-insensitively, keep the reading order, keep the line short.
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const a of out) {
    const k = a.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(a);
  }
  return uniq.slice(0, 6);
}

/* ------------------------------------------------------------------ *
 * ACT
 *
 * "ACT" is also a course prefix at colleges that abbreviate accounting that
 * way, so a bare "ACT 31" is only trusted when the text right after it does
 * not read like a course row. A fabricated test score is worse than a blank.
 * ------------------------------------------------------------------ */
const ACT_LABELLED = [
  /\bACT\b[ \t]*(?:composite|comp\.?|score|scores|total|superscore|result)[^0-9]{0,8}(\d{1,2})\b/i,
  /\bACT\b[ \t]*[:=][ \t]*(\d{1,2})\b/i,
];
const ACT_BARE = /\bACT\b[ \t]*[-–—]?[ \t]*(\d{1,2})\b/i;
// "<title> <units> <grade>" in either order — the shape of a transcript row.
const COURSE_TAIL = new RegExp(
  "^\\s*[A-Za-z][A-Za-z&/'-]{2,}(?:\\s+[A-Za-z&/'.,-]+){0,6}\\s+(?:" +
    "\\d{1,2}\\.\\d{1,2}\\s+(?:[A-DF][+-]?|IP|NP|CR|RD|W|I)\\b" +
    "|(?:[A-DF][+-]?|IP|NP|CR|RD|W|I)\\s+\\d{1,2}\\.\\d{1,2}\\b" +
  ")",
);

function extractAct(text: string): number | null {
  for (const re of ACT_LABELLED) {
    const m = text.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 36) return n;
    }
  }
  const bare = text.match(ACT_BARE);
  if (bare && bare.index !== undefined) {
    const n = parseInt(bare[1], 10);
    // Unlabelled, so demand a plausible composite (11+) and no course row.
    if (n >= 11 && n <= 36) {
      const tail = text.slice(bare.index + bare[0].length, bare.index + bare[0].length + 80);
      if (!COURSE_TAIL.test(tail)) return n;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Credits
 *
 * A labelled total beats a number that merely sits next to the word "units",
 * because every course row on a transcript carries one of those. Patterns run
 * in confidence order and each is scanned to its end, so a 5.00-unit course
 * row can no longer shadow the 48.0-unit total below it.
 *
 * "Attempted" is deliberately absent: units attempted are not units earned,
 * and the field this feeds means credits completed.
 * ------------------------------------------------------------------ */
const CREDIT_PATTERNS = [
  /(?:total|cumulative|overall)\s+(?:transferable\s+|transfer\s+|degree\s+|applicable\s+)?(?:semester\s+|quarter\s+)?(?:credits?|units|hours)\s*(?:earned|completed|passed)?\s*[:=]?\s*(\d{1,3}(?:\.\d{1,2})?)/gi,
  /(?:credits?|units|(?:semester|quarter)\s+hours)\s*(?:earned|completed|passed|to\s+date)\s*[:=]?\s*(\d{1,3}(?:\.\d{1,2})?)/gi,
  /\b(\d{1,3}(?:\.\d{1,2})?)\s*(?:transferable\s+)?(?:semester\s+|quarter\s+)?(?:credits?|units)\b/gi,
];

function extractCredits(text: string): number | null {
  for (const re of CREDIT_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const n = parseFloat(m[1]);
      if (n >= 6 && n <= 200) return n;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */

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

  // ACT — kept beside the SAT, never converted into one
  const act = extractAct(text);
  if (act !== null) {
    fields.act = act;
    found.push(`ACT ${act}`);
  }

  // Current school — curated list first, letterhead second
  const school = schoolFromHint(text, lower) ?? schoolFromHeader(text.slice(0, 600));
  if (school) {
    fields.schoolName = school;
    found.push(`School: ${school}`);
  }

  // Credits → kept as a number AND collapsed into standing; several targets
  // gate on the count itself (Rice/Vanderbilt 12+, Notre Dame 24+, USC 30).
  const credits = extractCredits(text);
  if (credits !== null) {
    fields.credits = credits;
    fields.standing = credits >= 45 ? "junior" : "sophomore";
    found.push(`${credits} credits → ${fields.standing} standing`);
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

  // Awards & honors — the institutional stack an admissions reader recognises
  const awards = extractAwards(text);
  if (awards.length) {
    fields.awardsText = awards.join(", ");
    found.push(`Awards: ${fields.awardsText}`);
  }

  // Course codes (e.g. MATH 1B, CS 61A, ENGL-101)
  const courses = [...new Set(
    (raw.match(/\b[A-Z]{2,5}[- ]?\d{1,3}[A-Z]{0,2}\b/g) ?? [])
      .filter((c) => !/^(SAT|ACT|GPA|PDF)/.test(c)),
  )].slice(0, 60);
  if (courses.length >= 4) found.push(`${courses.length} courses on transcript`);

  return { fields, found, courses };
}
