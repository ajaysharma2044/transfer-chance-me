/* Audit — the single signed-in page that used to be four.
 *
 * Dashboard / My file / Chances / Deep review were all "read the file from
 * angle X". This is the same tool as one linear flow: (1) fill in profile,
 * (2) pick schools, (3) get the AI-powered deep audit. Section 3 is locked
 * until 1 and 2 are done.
 *
 * The three inner components (FileFlow, Portal, Review) are mounted as they
 * are; App.tsx redirects the old routes here with a URL anchor so bookmarks
 * still work.
 */

import { useEffect, useState } from "react";
import type { Profile } from "../engine";
import type { Session } from "../lib/auth";
import { DEFAULT_PROFILE } from "../engine";
import { subscribeListChanged } from "../lib/listEvents";
import FileFlow from "./FileFlow";
import Portal from "./Portal";
import Review from "./Review";
import "./audit.css";

const LIST_KEY = "tcm.list.v1";

interface Props {
  session: Session | null;
  profile: Profile;
  onChange: (p: Profile) => void;
  go: (r: string) => void;
  /** Which section to scroll to on mount — parsed by App.tsx from `#/audit/<anchor>`. */
  anchor?: "profile" | "schools" | "deep";
}

/** A profile is scorable once GPA is set to something the student actually
 *  chose (not the default 3.0) AND a major is selected. Anything less and
 *  section 3's AI audit would render generic advice. */
function isProfileScorable(p: Profile): boolean {
  return (
    p.gpa !== DEFAULT_PROFILE.gpa
    && !!p.major
    && p.major !== DEFAULT_PROFILE.major
  );
}

/** Read the school list once. `useSchoolCount` below keeps it live. */
function readListLength(): number {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.length : 0;
  } catch { return 0; }
}

/** Reactive count of the tracker list. Portal writes it; this reads and
 *  re-reads on every change so section 3 unlocks the moment a school is added. */
function useSchoolCount(): number {
  const [n, setN] = useState<number>(readListLength);
  useEffect(() => subscribeListChanged(() => setN(readListLength())), []);
  return n;
}

export default function Audit({ session, profile, onChange, go, anchor }: Props) {
  const scorable = isProfileScorable(profile);
  const schools = useSchoolCount();
  const ready = scorable && schools > 0;

  /* Scroll to the requested section on first mount only. A hash change that
   * KEEPS us on this page (a user clicking a step tab) is handled by the
   * anchor's own scrollIntoView on click, not by re-running this effect —
   * running it every time the anchor changes would jerk the page around
   * mid-scroll. */
  useEffect(() => {
    if (!anchor) return;
    const id = `audit-${anchor}`;
    const el = document.getElementById(id);
    if (!el) return;
    // One frame delay so the section has rendered and its offset is real.
    requestAnimationFrame(() => el.scrollIntoView({ behavior: "auto", block: "start" }));
    // Mount-only on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const jump = (id: "profile" | "schools" | "deep") => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(`audit-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Update the hash without a full re-render.
    history.replaceState(null, "", `#/audit/${id}`);
  };

  return (
    <div className="audit">
      <nav className="audit-steps" aria-label="Audit sections">
        <a
          href="#/audit/profile"
          className={`audit-step${scorable ? " done" : ""}`}
          onClick={jump("profile")}
        >
          <b>1</b><span>Profile</span><i>{scorable ? "Ready" : "Fill in"}</i>
        </a>
        <a
          href="#/audit/schools"
          className={`audit-step${schools > 0 ? " done" : ""}`}
          onClick={jump("schools")}
        >
          <b>2</b><span>Schools</span><i>{schools > 0 ? `${schools} added` : "Pick targets"}</i>
        </a>
        <a
          href="#/audit/deep"
          className={`audit-step${ready ? " ready" : " locked"}`}
          onClick={ready ? jump("deep") : (e) => e.preventDefault()}
          aria-disabled={!ready}
        >
          <b>3</b><span>Deep audit</span><i>{ready ? "Run it" : "Locked"}</i>
        </a>
      </nav>

      <section id="audit-profile" className="audit-sec" aria-labelledby="audit-profile-h">
        <header className="audit-head">
          <p className="audit-num">01</p>
          <h2 id="audit-profile-h">Your profile</h2>
          <p className="audit-dek">Everything about you. Saves to your account as you type.</p>
        </header>
        <FileFlow profile={profile} onChange={onChange} go={go} />
      </section>

      <section id="audit-schools" className="audit-sec" aria-labelledby="audit-schools-h">
        <header className="audit-head">
          <p className="audit-num">02</p>
          <h2 id="audit-schools-h">Your schools</h2>
          <p className="audit-dek">Pick the schools you want to transfer to. Track status and notes.</p>
        </header>
        <Portal session={session} profile={profile} go={go} onChange={onChange} />
      </section>

      <section id="audit-deep" className="audit-sec" aria-labelledby="audit-deep-h">
        <header className="audit-head">
          <p className="audit-num">03</p>
          <h2 id="audit-deep-h">Your deep audit</h2>
          <p className="audit-dek">
            AI-powered review of your file — essay, activities, and per-school verdicts.
          </p>
        </header>
        {ready ? (
          <Review profile={profile} onChange={onChange} />
        ) : (
          <div className="audit-locked" role="note">
            <p className="audit-locked-h"><b>Locked</b></p>
            <p className="audit-locked-p">
              Complete <a href="#/audit/profile" onClick={jump("profile")}>step 1 — your profile</a>{" "}
              and add at least one school in{" "}
              <a href="#/audit/schools" onClick={jump("schools")}>step 2</a> to run your audit.
            </p>
            <ul className="audit-locked-check">
              <li className={scorable ? "ok" : ""}>Profile is scorable (GPA + major set)</li>
              <li className={schools > 0 ? "ok" : ""}>At least one target school added</li>
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
