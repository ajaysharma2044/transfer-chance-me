// D11 (spec_v3 Step 1): .env.example must document every environment variable
// the code actually reads, so a deploy can't silently miss one (ALLOWED_ORIGIN,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and the Upstash vars were missing).
//
// This fails if any import.meta.env.VITE_* (client) or process.env.* (server)
// referenced in the shipped code lacks a NAME= line in .env.example.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
// Directories that hold code which reads configuration.
const CODE_DIRS = ["src", "api", "netlify", "functions", "scripts"];

// Vite build-ins and runtime vars that are not user-supplied .env entries.
const IGNORE = new Set(["NODE_ENV", "MODE", "DEV", "PROD", "SSR", "BASE_URL", "DATA_DIR"]);

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: ReturnType<typeof readdirSync>;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === "node_modules" || name === "dist") continue;
    const p = join(dir, name);
    out = statSync(p).isDirectory() ? out.concat(walk(p)) : out.concat(p);
  }
  return out;
}

function referencedVars(): Set<string> {
  const vars = new Set<string>();
  for (const d of CODE_DIRS) {
    for (const f of walk(join(ROOT, d))) {
      if (!/\.(ts|tsx)$/.test(f) || /\.d\.ts$/.test(f)) continue;
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/import\.meta\.env\.([A-Z][A-Z0-9_]*)/g)) vars.add(m[1]);
      for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) vars.add(m[1]);
    }
  }
  for (const v of IGNORE) vars.delete(v);
  return vars;
}

function documentedKeys(): Set<string> {
  const text = readFileSync(join(ROOT, ".env.example"), "utf8");
  const keys = new Set<string>();
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (m) keys.add(m[1]);
  }
  return keys;
}

describe(".env.example documents every env var the code reads", () => {
  it("has a NAME= line for each referenced variable", () => {
    const referenced = [...referencedVars()].sort();
    const documented = documentedKeys();
    const missing = referenced.filter((v) => !documented.has(v));
    expect(missing, `undocumented env vars: ${missing.join(", ")}`).toEqual([]);
  });

  it("references the variables we expect (guards the scanner itself)", () => {
    const referenced = referencedVars();
    // A few that must always be present, so a broken scanner can't vacuously pass.
    for (const v of ["VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ALLOWED_ORIGIN", "OPENROUTER_API_KEY"]) {
      expect(referenced.has(v), `${v} should be detected in code`).toBe(true);
    }
  });
});
