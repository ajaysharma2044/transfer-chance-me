// Defect #2: privacy copy must describe what the app actually does.
//
// The repo rule (CLAUDE.md) is explicit: signed in, the profile / school list
// / written and uploaded material sync to the user's account, so copy must
// distinguish "signed in" from "signed out" and never make a blanket "nothing
// leaves your browser" claim. A third path the old copy ignored entirely: the
// deep AI review sends the application text to Anthropic whether or not you're
// signed in.
//
// These tests pin the single source of truth (src/lib/privacy.ts) and guard
// the material-handling components against reintroducing the false blanket
// claims. Source is read off disk the way csp / no-secrets tests do.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRIVACY } from "../src/lib/privacy";

const src = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");

describe("privacy copy — single source of truth is accurate to behaviour", () => {
  it("names the on-device path and that signed-out material stays local", () => {
    expect(PRIVACY.onDevice).toMatch(/your device/i);
    expect(PRIVACY.onDevice).toMatch(/signed out/i);
    expect(PRIVACY.onDevice).toMatch(/browser|device/i);
  });

  it("names the signed-in sync path, scoped to the account and deletable", () => {
    expect(PRIVACY.signedIn).toMatch(/signed in/i);
    expect(PRIVACY.signedIn).toMatch(/account/i);
    expect(PRIVACY.signedIn).toMatch(/delet/i);
  });

  it("discloses that the AI review sends material to Anthropic, signed in or not", () => {
    expect(PRIVACY.review).toMatch(/review/i);
    expect(PRIVACY.review).toMatch(/anthropic/i);
    expect(PRIVACY.review).toMatch(/whether or not you.?re signed in|signed in or not/i);
  });
});

describe("privacy copy — no component makes a blanket browser-only claim", () => {
  const FORBIDDEN = [
    /everything stays in your browser/i,
    /never uploaded/i,
    /nothing (ever )?leaves (your|this) (browser|device)/i,
  ];

  for (const file of ["components/Results.tsx", "components/EssayPanel.tsx", "components/ImportPanel.tsx"]) {
    it(`${file} states nothing that contradicts the sync/review behaviour`, () => {
      const text = src(file);
      for (const pattern of FORBIDDEN) {
        expect(text, `${file} matched ${pattern}`).not.toMatch(pattern);
      }
    });
  }
});
