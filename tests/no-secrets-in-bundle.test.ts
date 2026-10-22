// The service-role key must never reach a browser.
//
// It bypasses every row-level policy in the database, so a copy in the client
// bundle would hand any visitor every user's transcripts and essays. Vite
// only inlines VITE_-prefixed vars, which is the safeguard — this test proves
// the safeguard is actually holding, in the built output, rather than trusting
// that nobody ever renames a variable.
//
// Determinism: this scan needs the built bundle, which `vitest run` does not
// itself produce. Rather than pass or fail depending on whether someone ran
// `npm run build` first (the old behaviour — green after a build, red on a
// cold checkout or CI), beforeAll builds the bundle on demand when dist/ is
// absent. It only builds when missing, so the warm inner loop stays fast, and
// a build failure throws loudly here rather than letting the scan check
// nothing.

import { beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
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

// Build the client bundle once if it is not already present, so the scan runs
// against real output on a cold checkout too. Generous timeout: a cold build
// runs tsc -b + vite build.
beforeAll(() => {
  if (!distExists()) {
    execSync("npm run build", { cwd: process.cwd(), stdio: "ignore" });
  }
}, 180_000);

describe("built client bundle", () => {
  it("is present for the scan (built on demand when missing)", () => {
    expect(distExists(), "dist/ was not produced by the on-demand build").toBe(true);
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
    expect(text).not.toContain("OPENROUTER_API_KEY");

    // The literal key shapes, in case a var is ever renamed around them.
    expect(text).not.toMatch(/sk-or-v1-[A-Za-z0-9]{16,}/);  // OpenRouter
    expect(text).not.toMatch(/sk-ant-[A-Za-z0-9_-]{16,}/);  // Anthropic

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
