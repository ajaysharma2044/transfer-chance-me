import { useEffect, useState } from "react";
import { estimateAll, fmtPct, MODEL } from "../engine";
import type { Profile } from "../engine";
import type { Session } from "../lib/auth";
import { analyzeEssay } from "../lib/essay";
import Tile from "./Tile";
import Report from "./Report";
import { countdown } from "../lib/deadlines";
import "./portal.css";

// The signed-in home: your file, your chances, and a working school list
// with statuses and notes. Everything persists in this browser.

type Status = "planning" | "applied" | "waitlisted" | "accepted" | "rejected";

interface ListEntry {
  school: string;
  status: Status;
  note: string;
}

const LIST_KEY = "tcm.list.v1";

const MAJOR_LABEL: Record<string, string> = {
  cs: "Computer science", engineering: "Engineering", business: "Business",
  econ: "Economics", stem: "STEM", social: "Social science",
  humanities: "Humanities", undecided: "Undecided",
};

const STATUS_LABEL: Record<Status, string> = {
  planning: "Planning",
  applied: "Applied",
  waitlisted: "Waitlisted",
  accepted: "Accepted",
  rejected: "Rejected",
};

function loadList(): ListEntry[] {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as ListEntry[]) : [];
  } catch {
    return [];
  }
}

interface Props {
  session: Session | null;
  profile: Profile;
  go: (route: string) => void;
}

export default function Portal({ session, profile, go }: Props) {
  const [list, setList] = useState<ListEntry[]>(loadList);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
  }, [list]);

  if (!session) {
    return (
      <div className="shell po-gate">
        <h1>Your portal</h1>
        <p>Log in to track your school list, statuses, and progress in one place.</p>
        <button type="button" className="btn" onClick={() => go("login")}>Log in</button>
      </div>
    );
  }

  const ests = estimateAll(profile);
  const byName = new Map(ests.map((e) => [e.school.name, e]));
  const listed = new Set(list.map((l) => l.school));
  const targets = ests.filter((e) => e.p >= 0.12).length;
  const essay = profile.essayText ? analyzeEssay(profile.essayText) : null;
  const firstName = (session.name || session.email).split(" ")[0];

  const setEntry = (school: string, patch: Partial<ListEntry>) =>
    setList((ls) => ls.map((l) => (l.school === school ? { ...l, ...patch } : l)));

  return (
    <div className="shell po">
      <header className="po-head">
        <div>
          <h1>Welcome back, {firstName}</h1>
          <p className="po-sub">
            Target odds or better at <b>{targets} of {ests.length}</b> schools with your current file.
          </p>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => window.print()}>Download report</button>
      </header>

      <div className="po-grid">
        <section className="po-card">
          <div className="po-card-head">
            <h2>Your file</h2>
            <button type="button" className="btn-quiet" onClick={() => go("check")}>Edit</button>
          </div>
          <dl className="po-kv">
            <div><dt>GPA</dt><dd className="num">{profile.gpa.toFixed(2)}</dd></div>
            <div><dt>School</dt><dd>{profile.schoolName ?? { cc: "Community college", public4: "4-year public", private4: "4-year private" }[profile.institution]}</dd></div>
            <div><dt>Entering as</dt><dd>{profile.standing}</dd></div>
            <div><dt>Major</dt><dd>{MAJOR_LABEL[profile.major] ?? profile.major}</dd></div>
            {profile.sat != null && <div><dt>SAT</dt><dd className="num">{profile.sat}</dd></div>}
          </dl>
        </section>

        <section className="po-card">
          <div className="po-card-head">
            <h2>Best positions</h2>
            <button type="button" className="btn-quiet" onClick={() => go("results")}>All 24 →</button>
          </div>
          <ul className="po-best">
            {ests.slice(0, 5).map((e) => (
              <li key={e.school.id}>
                <button type="button" className="po-best-row" onClick={() => go(`schools/${e.school.id}`)}>
                  <Tile name={e.school.name} size={24} />
                  <span className="po-best-name">{e.school.name}</span>
                  <span className="po-best-band num">{fmtPct(e.lo)}–{fmtPct(e.hi)}%</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="po-card">
          <div className="po-card-head">
            <h2>Timeline</h2>
          </div>
          <ul className="po-clock">
            {(list.length > 0 ? list.map((l) => l.school) : ests.slice(0, 5).map((e) => e.school.name))
              .map((name) => ({ name, cd: countdown(name) }))
              .filter((x) => x.cd)
              .sort((a, b) => a.cd!.days - b.cd!.days)
              .slice(0, 6)
              .map(({ name, cd }) => (
                <li key={name} className={cd!.days <= 45 ? "po-clock-soon" : ""}>
                  <span className="po-clock-school"><Tile name={name} size={20} /> {name}</span>
                  <span className="po-clock-when">{cd!.label}</span>
                  <span className="po-clock-days num">{cd!.days}d</span>
                </li>
              ))}
          </ul>
          <p className="po-clock-note">Typical fall-transfer deadlines — always verify on the school's site.</p>
        </section>

        <section className="po-card">
          <div className="po-card-head">
            <h2>Essay</h2>
            <button type="button" className="btn-quiet" onClick={() => go("check")}>Open</button>
          </div>
          {essay ? (
            <p className="po-body">
              <b className="num">{essay.words}</b> words ·{" "}
              {essay.namedSchools.length > 0
                ? <>school-specific for <b>{essay.namedSchools.join(", ")}</b></>
                : "not school-specific yet"}
              {essay.verdict === "complaint" && <span className="po-warn"> · reads complaint-shaped</span>}
            </p>
          ) : (
            <p className="po-body po-empty">No essay on file yet — paste a draft and we'll check it against what admits' essays do.</p>
          )}
        </section>

        <section className="po-card">
          <div className="po-card-head">
            <h2>Documents</h2>
            <button type="button" className="btn-quiet" onClick={() => go("check")}>Upload</button>
          </div>
          {profile.docs.length > 0 ? (
            <div className="chipset">
              {profile.docs.map((d) => <span key={d} className="chip">{d}</span>)}
              {profile.courses.length > 0 && <span className="chip">{profile.courses.length} courses read</span>}
            </div>
          ) : (
            <p className="po-body po-empty">Drop in a transcript or Common App PDF — parsed on your device, never uploaded.</p>
          )}
        </section>
      </div>

      <section className="po-list">
        <div className="po-card-head">
          <h2>My schools</h2>
          <button type="button" className="btn btn-sm" onClick={() => setAdding((a) => !a)}>
            {adding ? "Done" : "+ Add schools"}
          </button>
        </div>

        {adding && (
          <div className="po-addwall">
            {MODEL.schools.map((s) => (
              <button
                key={s.id}
                type="button"
                className="chip po-add"
                aria-pressed={listed.has(s.name)}
                onClick={() =>
                  listed.has(s.name)
                    ? setList((ls) => ls.filter((l) => l.school !== s.name))
                    : setList((ls) => [...ls, { school: s.name, status: "planning", note: "" }])
                }
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        {list.length === 0 && !adding && (
          <p className="po-body po-empty">No schools on your list yet. Add the ones you're targeting to track statuses and notes.</p>
        )}

        {list.map((l) => {
          const e = byName.get(l.school);
          const id = e?.school.id;
          return (
            <div className="po-row" key={l.school}>
              <button type="button" className="po-row-school" onClick={() => id && go(`schools/${id}`)}>
                <Tile name={l.school} size={28} />
                <span>
                  <span className="po-row-name">{l.school}</span>
                  {e && <span className="po-row-band num">{fmtPct(e.lo)}–{fmtPct(e.hi)}% · {e.tier}</span>}
                </span>
              </button>
              <select
                aria-label={`Status for ${l.school}`}
                className={`po-status po-${l.status}`}
                value={l.status}
                onChange={(ev) => setEntry(l.school, { status: ev.target.value as Status })}
              >
                {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
              <input
                type="text"
                className="po-note"
                placeholder="Notes — deadline, portal login, who's writing recs…"
                value={l.note}
                onChange={(ev) => setEntry(l.school, { note: ev.target.value })}
              />
              <button
                type="button"
                className="po-remove"
                aria-label={`Remove ${l.school}`}
                onClick={() => setList((ls) => ls.filter((x) => x.school !== l.school))}
              >×</button>
            </div>
          );
        })}
      </section>

      <Report profile={profile} ests={ests} date={new Date().toLocaleDateString()} />
    </div>
  );
}
