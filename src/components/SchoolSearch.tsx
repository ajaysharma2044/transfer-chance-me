import { useEffect, useRef, useState } from "react";
import type { Profile } from "../engine";

// Typeahead over the IPEDS directory (public/schools.json, lazy-loaded).
// Picking a school auto-sets institution type and the California-CC pathway.

type Row = [string, string, "cc" | "public4" | "private4"];

let cache: Row[] | null = null;
async function loadSchools(): Promise<Row[]> {
  if (!cache) {
    const res = await fetch("/schools.json");
    cache = (await res.json()) as Row[];
  }
  return cache;
}

const KIND_LABEL = { cc: "Community college", public4: "4-year public", private4: "4-year private" };

export default function SchoolSearch({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<Row[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || q.trim().length < 2) { setHits([]); return; }
    let live = true;
    loadSchools().then((rows) => {
      if (!live) return;
      const needle = q.trim().toLowerCase();
      const starts = rows.filter((r) => r[0].toLowerCase().startsWith(needle));
      const contains = rows.filter((r) => !r[0].toLowerCase().startsWith(needle) && r[0].toLowerCase().includes(needle));
      setHits([...starts, ...contains].slice(0, 8));
    });
    return () => { live = false; };
  }, [q, open]);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function pick([name, state, kind]: Row) {
    onChange({
      ...profile,
      schoolName: name,
      institution: kind,
      caResident: kind === "cc" && state === "CA",
      igetc: kind === "cc" && state === "CA" ? profile.igetc : false,
    });
    setQ("");
    setOpen(false);
  }

  if (profile.schoolName) {
    return (
      <div className="school-picked">
        <span className="chip chip-school">
          {profile.schoolName}
          <button
            type="button"
            aria-label="Clear school"
            onClick={() => onChange({ ...profile, schoolName: null })}
          >×</button>
        </span>
        <span className="picked-kind">{KIND_LABEL[profile.institution]}{profile.caResident ? " · California" : ""}</span>
      </div>
    );
  }

  return (
    <div className="school-search" ref={boxRef}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-label="Search for your current school"
        placeholder="Start typing your school — De Anza, Ohio State, NYU…"
        value={q}
        onFocus={() => { setOpen(true); loadSchools(); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
      />
      {open && hits.length > 0 && (
        <ul className="school-hits" role="listbox">
          {hits.map((r) => (
            <li key={`${r[0]}|${r[1]}`}>
              <button type="button" onClick={() => pick(r)}>
                <span>{r[0]}</span>
                <span className="hit-meta">{r[1]} · {KIND_LABEL[r[2]]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
