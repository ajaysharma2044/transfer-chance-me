import { useRef, useState } from "react";
import type { Profile } from "../engine";
import { fileToText } from "../lib/pdf";
import { extractProfile } from "../lib/extract";

interface Props {
  profile: Profile;
  onChange: (p: Profile) => void;
}

export default function ImportPanel({ profile, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "busy" | "done" | "empty" | "error">("idle");
  const [found, setFound] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setFileName(file.name);
    setState("busy");
    try {
      const text = await fileToText(file);
      const { fields, found } = extractProfile(text);
      if (found.length === 0) {
        setState("empty");
        return;
      }
      onChange({ ...profile, ...fields });
      setFound(found);
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="import" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.txt,text/plain,application/pdf"
        style={{ display: "none" }}
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className="import-row">
        <div>
          <p className="import-title">Have your transcript or application?</p>
          <p className="import-sub">
            Drop a PDF or text file — transcript, Common App preview — and we'll fill in what we find.
            Parsed on your device; never uploaded.
          </p>
        </div>
        <button type="button" className="choice" onClick={() => inputRef.current?.click()}>
          {state === "busy" ? "Reading…" : "Choose file"}
        </button>
      </div>
      {state === "done" && (
        <p className="import-result ok">
          Found in {fileName}: {found.join(" · ")}. Check the fields below and adjust anything we got wrong.
        </p>
      )}
      {state === "empty" && (
        <p className="import-result">
          Couldn't recognize fields in {fileName}. Fill in the form below — it takes a minute.
        </p>
      )}
      {state === "error" && (
        <p className="import-result">
          Couldn't read {fileName}. Try a text-based PDF (not a scan), or fill in the form below.
        </p>
      )}
    </div>
  );
}
