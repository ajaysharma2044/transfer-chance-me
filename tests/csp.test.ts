// The Content-Security-Policy is declared in three files, one per host, and
// they drift.
//
// This caught a real bug: vercel.json and netlify.toml both omitted
// *.supabase.co from connect-src while public/_headers included it. Either
// deploy would have blocked every auth and sync call — accounts broken in
// production, working perfectly in dev, with the only symptom a CSP violation
// in a console nobody was watching.
//
// A CSP that is wrong in a way you only discover in production is worth a test
// that runs in a second.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function csp(file: string): string {
  const text = readFileSync(join(root, file), "utf8");
  // Stop at a double quote (the JSON/TOML string terminator) or a newline
  // (the _headers line terminator). Deliberately NOT excluding ' or ; —
  // both appear inside every real policy, in "'self'" and between directives.
  const m = text.match(/default-src[^"\n]*/);
  expect(m, `no CSP found in ${file}`).not.toBeNull();
  return m![0];
}

/** Everything the running app actually talks to. */
const REQUIRED_CONNECT = [
  "'self'", // the review proxy and all same-origin fetches
  "https://*.supabase.co", // accounts, profile + document sync
  "wss://*.supabase.co", // Supabase realtime/auth websocket
  "https://api.anthropic.com", // browser-key fallback mode
  "https://en.wikipedia.org", // campus photos
  "https://accounts.google.com", // Google sign-in
];

const FILES = ["vercel.json", "netlify.toml", "public/_headers"];

describe("Content-Security-Policy", () => {
  for (const file of FILES) {
    describe(file, () => {
      const policy = csp(file);
      const connect = policy.match(/connect-src[^;]*/)?.[0] ?? "";

      it("has a connect-src directive", () => {
        expect(connect, `${file} has no connect-src`).not.toBe("");
      });

      for (const origin of REQUIRED_CONNECT) {
        it(`allows ${origin}`, () => {
          expect(connect, `${file} connect-src is missing ${origin}: ${connect}`).toContain(origin);
        });
      }

      it("keeps the hardening directives", () => {
        expect(policy).toContain("object-src 'none'");
        expect(policy).toContain("frame-ancestors 'none'");
        expect(policy).toContain("base-uri 'self'");
      });

      it("does not allow unsafe-eval anywhere", () => {
        expect(policy).not.toContain("unsafe-eval");
      });
    });
  }

  it("every host file allows the same connect-src origins", () => {
    // Not string equality — the directives are in a different order per file,
    // and ordering is not meaningful in a CSP. What must match is the SET.
    const sets = FILES.map((f) => {
      const c = csp(f).match(/connect-src[^;]*/)?.[0] ?? "";
      return new Set(c.replace("connect-src", "").trim().split(/\s+/).filter(Boolean));
    });
    const [first, ...rest] = sets;
    for (let i = 0; i < rest.length; i++) {
      const missing = [...first].filter((o) => !rest[i].has(o));
      const extra = [...rest[i]].filter((o) => !first.has(o));
      expect(
        [...missing, ...extra],
        `${FILES[0]} and ${FILES[i + 1]} disagree — missing: ${missing}, extra: ${extra}`,
      ).toEqual([]);
    }
  });
});
