// Field notes from the T25 Transfer Admissions Study — distilled from the
// study's per-school intelligence briefs. Injected into a prompt per TARGET
// only, so the prompt grows with the applicant's list, not with the corpus.
// Every line traces back to a brief; nothing here is model-generated at
// request time.
//
// Its own module (no import.meta, no browser APIs) because the Netlify worker
// builds prompts from it too — see src/lib/audit/prompts.ts.

import INTEL_RAW from "../data/intel.json";

interface IntelEntry {
  timing?: string;
  paths?: string[];
  pitfalls?: string[];
  aid?: string;
  notes?: string[];
}

const INTEL = INTEL_RAW as unknown as Record<string, IntelEntry | unknown>;

export function intelLines(name: string): string {
  const e = INTEL[name] as IntelEntry | undefined;
  if (!e || typeof e !== "object") return "";
  const lines = [
    e.timing ? `Timing: ${e.timing}` : "",
    e.paths?.length ? `Doors in: ${e.paths.join("; ")}` : "",
    e.pitfalls?.length ? `Pitfalls seen in real files: ${e.pitfalls.join("; ")}` : "",
    e.aid ? `Aid: ${e.aid}` : "",
    ...(e.notes ?? []).map((n) => `- ${n}`),
  ].filter(Boolean);
  return lines.length ? `Field notes (from our T25 study briefs):\n${lines.join("\n")}` : "";
}
