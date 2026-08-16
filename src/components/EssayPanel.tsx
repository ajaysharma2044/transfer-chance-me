import type { Profile } from "../engine";
import { analyzeEssay } from "../lib/essay";

interface Props {
  profile: Profile;
  onChange: (p: Profile) => void;
}

export default function EssayPanel({ profile, onChange }: Props) {
  const a = profile.essayText ? analyzeEssay(profile.essayText) : null;

  function setText(text: string) {
    if (!text.trim()) {
      onChange({ ...profile, essayText: "", essayNamed: [], essayVerdict: null });
      return;
    }
    const r = analyzeEssay(text);
    onChange({ ...profile, essayText: text, essayNamed: r.namedSchools, essayVerdict: r.verdict });
  }

  return (
    <div className="field">
      <label htmlFor="essay">Paste your "why transfer" essay (optional)</label>
      <textarea
        id="essay"
        rows={7}
        placeholder="Paste a draft and we'll check it for the things admits' essays actually do — analyzed on your device, never uploaded."
        value={profile.essayText}
        onChange={(e) => setText(e.target.value)}
      />
      {a && (
        <div className="essay-report">
          <p className="essay-line">
            <b className="num">{a.words}</b> words
            {" · "}
            {a.namedSchools.length > 0
              ? <>school-specific for <b>{a.namedSchools.join(", ")}</b></>
              : <>no school named specifically yet</>}
            {a.professorMentions > 0 && <> · {a.professorMentions} professor{a.professorMentions > 1 ? "s" : ""} named</>}
          </p>
          {a.verdict === "complaint" && (
            <p className="essay-note warn">
              Reads complaint-shaped ({a.complaintScore} complaint signals vs {a.fitScore} fit signals).
              Admits frame the move around what the target offers, not what your school lacks.
            </p>
          )}
          {a.notes.filter((n) => !n.startsWith("Reads complaint")).map((n) => (
            <p key={n} className="essay-note">{n}</p>
          ))}
          {a.namedSchools.length > 0 && a.verdict !== "complaint" && (
            <p className="essay-note ok">
              Schools you name get the specificity credit in your chances; the rest see this essay as general.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
