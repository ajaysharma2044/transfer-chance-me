// The service-role key must never reach a browser.
//
// It bypasses every row-level policy in the database, so a copy in the client
// bundle would hand any visitor every user's transcripts and essays. Vite
// only inlines VITE_-prefixed vars, which is the safeguard — this test proves
// the safeguard is actually holding, in the built output, rather than trusting
// that nobody ever renames a variable.
//
// Run `npm run build` first; the test skips with a clear message if dist/ is
// missing, so it can never pass by silently checking nothing.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST = join(process.cwd(), "dist");

function allFiles(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    out = statSync(p).isDirectory() ? out.concat(allFiles(p)) : out.concat(p);
  }
  return out;
}

function distExists(): boolean {
  try { return statSync(DIST).isDirectory(); } catch { return false; }
}

describe("built client bundle", () => {
  it("has been built (run `npm run build` before this suite)", () => {
    expect(distExists(), "dist/ is missing — run `npm run build` first").toBe(true);
  });

  it("contains no service-role key and no server-only variable names", () => {
    if (!distExists()) return;
    const text = allFiles(DIST)
      .filter((f) => /\.(js|mjs|cjs|html|css|map)$/.test(f))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");

    // The exact names of the server-only vars.
    expect(text).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(text).not.toContain("ANTHROPIC_API_KEY");

    // A Supabase service key is a JWT whose payload carries
    // "role":"service_role". Catch the value even if the variable was renamed.
    for (const jwt of text.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) ?? []) {
      let payload = "";
      try {
        payload = Buffer.from(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      } catch { continue; }
      expect(payload, `a service_role JWT is present in the bundle: ${jwt.slice(0, 24)}…`)
        .not.toMatch(/"role"\s*:\s*"service_role"/);
    }
  });

  it("does not bundle the admin API routes into the client", () => {
    if (!distExists()) return;
    const text = allFiles(DIST)
      .filter((f) => /\.(js|mjs|cjs)$/.test(f))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    // A marker string unique to the server guard. If this appears, an import
    // path has leaked server code into the browser graph.
    expect(text).not.toContain("Multi-factor authentication is required for staff accounts");
  });
});
