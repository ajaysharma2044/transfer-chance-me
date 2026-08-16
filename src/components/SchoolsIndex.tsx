import { useEffect, useMemo, useState } from "react";
import { MODEL } from "../engine";
import Tile from "./Tile";
import { loadDirectory, searchDirectory, KIND_LABEL } from "../lib/directory";
import type { DirSchool } from "../lib/directory";
import "./college.css";

// Browse every US school: the 31 measured universities up top, then a live
// search over the full 4,000-institution directory — every result has a page.

export default function SchoolsIndex({ go }: { go: (route: string) => void }) {
  const [all, setAll] = useState<DirSchool[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    loadDirectory().then(setAll);
  }, []);

  const hits = useMemo(() => searchDirectory(all, q, 20), [all, q]);
  const featured = useMemo(
    () => [...MODEL.schools].sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  return (
    <div className="shell cx">
      <header className="cx-head">
        <h1>Every school, one place</h1>
        <p className="cx-dek">
          Deep transfer profiles for 31 top universities — plus a page for every one of the{" "}
          {all.length ? all.length.toLocaleString() : "4,000+"} degree-granting colleges and
          community colleges in the US.
        </p>
        <input
          type="text"
          className="cx-search"
          placeholder="Search any school — De Anza, Ohio State, Amherst…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search all schools"
        />
      </header>

      {q.trim().length >= 2 ? (
        <ul className="cx-results">
          {hits.map((s) => (
            <li key={s.idx}>
              <button type="button" className="cx-row" onClick={() => go(`college/${s.idx}`)}>
                <span className="cx-name">{s.name}</span>
                <span className="cx-meta">
                  {s.city ? `${s.city}, ` : ""}{s.state} · {KIND_LABEL[s.kind]}
                  {s.admitRate != null ? ` · ${s.admitRate.toFixed(0)}% admit` : ""}
                </span>
              </button>
            </li>
          ))}
          {hits.length === 0 && <li className="cx-none">No schools match "{q.trim()}".</li>}
        </ul>
      ) : (
        <>
          <h2 className="cx-sec">Measured transfer profiles</h2>
          <div className="cx-grid">
            {featured.map((s) => (
              <a key={s.id} className="cx-card" href={`#/schools/${s.id}`}>
                <Tile name={s.name} size={34} />
                <span className="cx-card-name">{s.name}</span>
                <span className="cx-card-rate num">{s.rate.toFixed(1)}%</span>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
