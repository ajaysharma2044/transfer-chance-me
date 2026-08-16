import { useRef, useState } from "react";
import type { Profile } from "../engine";
import { fileToText } from "../lib/pdf";
import { extractProfile } from "../lib/extract";

// The upload center: drop any mix of documents — transcript, Common App PDF,
// activities list — and everything readable is folded into the profile.
// All parsing happens on-device; files are never uploaded anywhere.

interface Props {
  profile: Profile;
  onChange: (p: Profile) => void;
}

export default function ImportPanel({ profile, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "busy" | "done" | "empty" | "error">("idle");
  const [found, setFound] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setState("busy");
    try {
      let next = { ...profile };
      const allFound: string[] = [];
      for (const file of Array.from(files).slice(0, 6)) {
        const text = await fileToText(file);
        const { fields, found, courses } = extractProfile(text);
        // document values fill the profile; courses and docs accumulate
        next = { ...next, ...definite(fields, next) };
        next.courses = [...new Set([...next.courses, ...courses])];
        if (!next.docs.includes(file.name)) next.docs = [...next.docs, file.name];
        if (found.length) allFound.push(`${file.name}: ${found.join(" · ")}`);
      }
      if (allFound.length === 0) {
        setState("empty");
        return;
      }
      onChange(next);
      setFound(allFound);
      setState("done");
    } catch {
      setState("error");
    }
  }

  // fields extracted from documents override defaults but not user-set values
  function definite(fields: Partial<Profile>, current: Profile): Partial<Profile> {
    const out: Partial<Profile> = {};
    for (const [k, v] of Object.entries(fields) as [keyof Profile, never][]) {
      if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
    }
    // keep an explicitly chosen school name
    if (current.schoolName) delete out.schoolName;
    return out;
  }

  return (
    <div
      className={`import${dragging ? " dragging" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.txt,text/plain,application/pdf"
        style={{ display: "none" }}
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className="import-row">
        <div>
          <p className="import-title">Upload your application documents</p>
          <p className="import-sub">
            Transcript, Common App preview, activities list — PDF or text, several at once. We read
            GPA, credits, courses, credentials, and more. Parsed on your device; never uploaded.
          </p>
        </div>
        <button type="button" className="choice" onClick={() => inputRef.current?.click()}>
          {state === "busy" ? "Reading…" : "Choose files"}
        </button>
      </div>
      {profile.docs.length > 0 && (
        <div className="chipset" style={{ marginTop: 12 }}>
          {profile.docs.map((d) => <span key={d} className="chip">{d}</span>)}
          {profile.courses.length > 0 && <span className="chip">{profile.courses.length} courses read</span>}
        </div>
      )}
      {state === "done" && (
        <div className="import-result ok">
          {found.map((f) => <p key={f}>{f}</p>)}
          <p>Check the fields below and adjust anything we got wrong.</p>
        </div>
      )}
      {state === "empty" && (
        <p className="import-result">
          Couldn't recognize fields in those files. Fill in the form below — it takes a minute.
        </p>
      )}
      {state === "error" && (
        <p className="import-result">
          Couldn't read one of those files. Try a text-based PDF (not a scan), or fill in the form below.
        </p>
      )}
    </div>
  );
}
