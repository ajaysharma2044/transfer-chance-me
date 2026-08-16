import { useState } from "react";
import type { Profile } from "../engine";

// Coursework on file: whatever the transcript upload found, plus anything
// added by hand. Courses feed the deep review and per-school prereq advice.

const SEQUENCE_HINTS: [RegExp, string][] = [
  [/^(MATH|MAT|CALC)/i, "calculus sequence"],
  [/^(CS|CIS|COMP|CSE)/i, "CS sequence"],
  [/^(CHEM|CHM)/i, "chemistry"],
  [/^(PHYS|PHY)/i, "physics"],
  [/^(ECON|EC)/i, "economics"],
  [/^(ENGL|ENG|WR)/i, "writing"],
  [/^(BIO|BIOL)/i, "biology"],
  [/^(STAT|STA)/i, "statistics"],
];

export default function CoursesEditor({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const [draft, setDraft] = useState("");

  function add() {
    const items = draft
      .split(/[,;\n]/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length >= 2 && s.length <= 40);
    if (items.length === 0) return;
    onChange({ ...profile, courses: [...new Set([...profile.courses, ...items])] });
    setDraft("");
  }

  const remove = (c: string) =>
    onChange({ ...profile, courses: profile.courses.filter((x) => x !== c) });

  const sequences = [...new Set(
    profile.courses.flatMap((c) => {
      const hit = SEQUENCE_HINTS.find(([re]) => re.test(c));
      return hit ? [hit[1]] : [];
    }),
  )];

  return (
    <div className="field">
      <span className="flabel">Classes you've taken</span>
      {profile.courses.length > 0 ? (
        <>
          <div className="chipset ce-chips">
            {profile.courses.map((c) => (
              <span key={c} className="chip ce-chip">
                {c}
                <button type="button" aria-label={`Remove ${c}`} onClick={() => remove(c)}>×</button>
              </span>
            ))}
          </div>
          {sequences.length > 0 && (
            <p className="hint ce-seq">Major-prep detected: {sequences.join(" · ")}</p>
          )}
        </>
      ) : (
        <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
          Upload a transcript above and we'll read them automatically — or add them here.
        </p>
      )}
      <div className="ce-addrow">
        <input
          type="text"
          placeholder="MATH 1B, CS 61A, ENGL 1A…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          aria-label="Add courses, comma-separated"
        />
        <button type="button" className="choice" onClick={add} disabled={!draft.trim()}>Add</button>
      </div>
      <p className="hint">
        Completed major prerequisites are one of the few levers that actually move transfer decisions.
      </p>
    </div>
  );
}
