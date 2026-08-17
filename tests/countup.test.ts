// Guard on the count-up animation's convergence.
//
// The bug this exists to prevent SHIPPED: the portal's headline figure sat at
// "23–25%" while the true value was "90–99%", and the unanimated sticky bar
// two centimetres above it showed the right number. The cause was `target` in
// the effect's dependency array — the profile is replaced on load (local copy,
// then the account's), so the tween was torn down and restarted mid-flight and
// never converged. It froze at whatever partial value it had reached and
// presented it as fact.
//
// There is no DOM harness in this repo, so this checks the two properties that
// actually caused the defect, at the source level. Crude, but it fails loudly
// if someone "tidies up" the dependency array — which is exactly how this
// would come back.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/lib/reveal.ts"), "utf8");

describe("useCountUp convergence", () => {
  it("does not key the animation effect on `target`", () => {
    // The animation effect's dependency list must not contain `target`.
    // Anything of the form [..., target, ...] restarts the tween on every
    // profile change and reintroduces the freeze.
    const depLists = src.match(/\}, \[[^\]]*\]\);/g) ?? [];
    const animationDeps = depLists.filter((d) => d.includes("shown"));
    expect(animationDeps.length, "expected an effect keyed on `shown`").toBeGreaterThan(0);
    for (const d of animationDeps) {
      expect(d, `animation effect must not depend on target: ${d}`).not.toMatch(/\btarget\b/);
    }
  });

  it("reads the live target through a ref so a change retargets in flight", () => {
    expect(src).toMatch(/targetRef\s*=\s*useRef\(target\)/);
    expect(src).toMatch(/targetRef\.current\s*=\s*target/);
    // The tween must read the ref, not the captured prop.
    expect(src).toMatch(/const to = targetRef\.current/);
  });

  it("snaps to the true value when interrupted rather than leaving a partial one", () => {
    // The cleanup path is what stops a half-finished number from being left
    // on screen as though it were the real figure.
    expect(src).toMatch(/setValue\(targetRef\.current\)/);
  });

  it("shows the exact target immediately when motion is reduced", () => {
    expect(src).toMatch(/if \(motionOff\(\)\) \{ setValue\(target\); return; \}/);
  });
});
