import { useEffect, useState } from "react";
import { MODEL } from "../engine";
import { markOf } from "../lib/schools";
import { KIND_LABEL, SIZE_LABEL, loadDirectory } from "../lib/directory";
import type { DirSchool } from "../lib/directory";
import CampusPhoto from "./CampusPhoto";
import "./college.css";

// Generic profile page for any of the 4,000+ US institutions in the
// directory. Schools with measured transfer data redirect to their deep page.

interface Props {
  idx: number;
  go: (route: string) => void;
}

function Favicon({ domain, size = 44 }: { domain: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="tile tile-sync" style={{ width: size, height: size }} aria-hidden="true">
      {domain && !failed ? (
        <img
          style={{ width: Math.round(size * 0.72), height: Math.round(size * 0.72) }}
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
          alt=""
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="tile-mono" style={{ color: "var(--accent)", fontSize: 15 }}>🎓</span>
      )}
    </span>
  );
}

/** Featured schools whose deep pages should take precedence. */
function featuredIdFor(name: string): string | null {
  const exact = MODEL.schools.find((s) => s.name === name);
  if (exact) return exact.id;
  const alias: Record<string, string> = {
    "Cornell University": "cornell",
    "Harvard University": "harvard",
    "Yale University": "yale",
    "Princeton University": "princeton",
    "Stanford University": "stanford",
    "Brown University": "brown",
    "Columbia University in the City of New York": "columbia",
    "Dartmouth College": "dartmouth",
    "Duke University": "duke",
    "Emory University": "emory",
    "Georgetown University": "georgetown",
    "Johns Hopkins University": "johns-hopkins",
    "Massachusetts Institute of Technology": "mit",
    "Northwestern University": "northwestern",
    "Rice University": "rice",
    "Carnegie Mellon University": "carnegie-mellon",
    "University of Chicago": "chicago",
    "University of Pennsylvania": "upenn",
    "Vanderbilt University": "vanderbilt",
    "University of Notre Dame": "notre-dame",
    "University of Michigan-Ann Arbor": "michigan",
    "University of North Carolina at Chapel Hill": "unc",
    "University of California-Berkeley": "uc-berkeley",
    "University of California-Los Angeles": "ucla",
    "University of California-Davis": "uc-davis",
    "University of California-Irvine": "uc-irvine",
    "University of California-San Diego": "uc-san-diego",
    "University of California-Santa Barbara": "uc-santa-barbara",
    "University of California-Santa Cruz": "uc-santa-cruz",
    "University of California-Riverside": "uc-riverside",
    "University of California-Merced": "uc-merced",
  };
  return alias[name] ?? null;
}

export default function CollegePage({ idx, go }: Props) {
  const [school, setSchool] = useState<DirSchool | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    loadDirectory().then((all) => { if (live) setSchool(all[idx] ?? null); });
    return () => { live = false; };
  }, [idx]);

  useEffect(() => {
    if (school) {
      const fid = featuredIdFor(school.name);
      if (fid) go(`schools/${fid}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [school]);

  if (school === undefined) return <div className="shell cp"><p className="cp-loading">Loading…</p></div>;
  if (school === null) {
    return (
      <div className="shell cp">
        <p>School not found.</p>
        <a className="btn-quiet" href="#/browse">← All schools</a>
      </div>
    );
  }

  const caCC = school.kind === "cc" && school.state === "CA";
  const mark = markOf(school.name);

  return (
    <div className="cp">
      <CampusPhoto name={school.name} color={mark.color} height={260} />
      <div className="shell">
        <div className="cp-head reveal in">
          <Favicon domain={school.domain} />
          <div>
            <h1>{school.name}</h1>
            <p className="cp-sub">
              {school.city ? `${school.city}, ` : ""}{school.state} · {KIND_LABEL[school.kind]}
              {school.sizeCat > 0 ? ` · ${SIZE_LABEL[school.sizeCat]}` : ""}
            </p>
          </div>
        </div>

        <div className="cp-stats">
          {school.admitRate != null && (
            <div className="cp-stat">
              <b className="num">{school.admitRate.toFixed(1)}%</b>
              <span>freshman admit rate (IPEDS 2023) — transfer rates aren't federally tracked</span>
            </div>
          )}
          {caCC && (
            <div className="cp-stat cp-tag">
              <b>TAG</b>
              <span>California CC students here can use the UC Transfer Admission Guarantee — six UC campuses guarantee admission at qualifying GPAs</span>
            </div>
          )}
          {school.domain && (
            <div className="cp-stat">
              <b>Site</b>
              <span><a href={`https://${school.domain}`} target="_blank" rel="noreferrer">{school.domain}</a></span>
            </div>
          )}
        </div>

        <div className="cp-cta">
          {school.kind === "cc" ? (
            <>
              <p>
                Transferring <em>from</em> {school.name}? See your real chances at all 31 measured
                universities{caCC ? " — including the six UCs that guarantee admission" : ""}.
              </p>
              <a className="btn" href="#/check">Check my chances</a>
            </>
          ) : (
            <>
              <p>
                We measure transfer chances for 31 top universities so far — {school.name}'s
                transfer profile isn't built yet. Applying from here to a top school works too.
              </p>
              <a className="btn" href="#/check">Check my chances at the measured schools</a>
            </>
          )}
          <a className="btn-quiet" href="#/browse">← Browse all schools</a>
        </div>
      </div>
    </div>
  );
}
