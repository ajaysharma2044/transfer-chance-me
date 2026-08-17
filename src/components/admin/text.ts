// Text handling for the admin console.
//
// Everything this console renders was typed by somebody else: applicant names,
// emails, essays, activity lists, the notes staff leave each other, and the
// "reason" strings that end up in audit rows. Treat all of it as hostile.
//
// React already escapes any string it renders as a text node, so markup
// injection is handled as long as two rules hold, and they do hold everywhere
// in src/components/admin/:
//
//   1. dangerouslySetInnerHTML is never used — not once, anywhere;
//   2. an applicant-supplied string is never interpolated into an href, a
//      src, a style, or a className, only into text content.
//
// What React does NOT do is anything about characters that are invisible or
// that reorder what a human sees. Those matter here because a person is
// skimming a list and deciding who to trust:
//
//   · bidi overrides (U+202A–U+202E, U+2066–U+2069) can make an email render
//     right-to-left, so "evil@attacker.test" appears as something else —
//     the Trojan-source trick, applied to a name column;
//   · zero-width characters can hide a second address inside one that looks
//     ordinary, or make two different accounts look identical;
//   · C0/C1 controls break table layout and can smuggle terminal escapes into
//     anything copied out of the page.
//
// So every user string goes through clean() or block() before it is rendered.
// They also bound the length, because nothing stops someone pasting a 2MB
// essay into the "name" field of their profile.

/** Zero-width, word-joiner and bidi-override characters. Never rendered. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
/** C0 and C1 controls, keeping \t and \n so block() can preserve layout.
 *  The lint rule below fires on any control character in a pattern; matching
 *  them is the entire point here, and they are already written as escapes. */
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * One line of untrusted text: controls and invisibles stripped, whitespace
 * collapsed, length bounded. Use for names, emails, labels, table cells.
 */
export function clean(value: unknown, max = 200): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "string" ? value : String(value);
  const flat = raw.replace(INVISIBLE, "").replace(CONTROLS, "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * A block of untrusted text — an essay, an activities list, a note. Newlines
 * and tabs survive; everything else in clean() still applies. Render inside an
 * element with `white-space: pre-wrap`, never as HTML.
 */
export function block(value: unknown, max = 20000): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "string" ? value : String(value);
  const text = raw
    .replace(INVISIBLE, "")
    .replace(CONTROLS, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[truncated for display — ${text.length - max} more characters]`;
}

/** A display string, or a visible dash. Never invents a value. */
export function orDash(value: unknown, max = 200): string {
  const c = clean(value, max);
  return c === "" ? "—" : c;
}

/**
 * True only for an absolute https URL. Signed document URLs come from our own
 * server, but they are the one place this console puts a remote string into an
 * href, so the value is checked rather than trusted.
 */
export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4000) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Only the host of a URL, for showing where a signed link points. */
export function hostOf(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Supabase user ids are UUIDs; catching a typo here saves an audited 404. */
export function isUuid(value: string): boolean {
  return UUID.test(value.trim());
}

/** Shorten an id for display without pretending it is the whole id. */
export function shortId(value: unknown): string {
  const c = clean(value, 64);
  return c.length > 8 ? `${c.slice(0, 8)}…` : c;
}

/** Absolute local time. Admin work needs the exact moment, not "2h ago". */
export function fmtTime(iso: unknown): string {
  if (typeof iso !== "string" || !iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

/** Date only, for list columns where the time of day is noise. */
export function fmtDate(iso: unknown): string {
  if (typeof iso !== "string" || !iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

/** Bytes as a short human string; "" when the size is unknown. */
export function fmtBytes(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
