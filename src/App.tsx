import { useEffect, useState } from "react";
import { DEFAULT_PROFILE, MODEL } from "./engine";
import type { Profile } from "./engine";
import Intake from "./components/Intake";
import Results from "./components/Results";

type Phase = "landing" | "intake" | "results";

const STORE = "chancery.profile.v1";

function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch { /* fresh start */ }
  return DEFAULT_PROFILE;
}

export default function App() {
  const [phase, setPhase] = useState<Phase>("landing");
  const [profile, setProfile] = useState<Profile>(loadProfile);

  useEffect(() => {
    localStorage.setItem(STORE, JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [phase]);

  const rows = Number(MODEL.meta.rows).toLocaleString();

  return (
    <>
      <div className="shell">
        <header className="masthead">
          <button type="button" className="wordmark" onClick={() => setPhase("landing")} aria-label="Chancery home">
            Chancery
          </button>
          <span className="cite">Transfer chances, from real outcomes</span>
        </header>
      </div>

      {phase === "landing" && (
        <main className="shell hero">
          <span className="badge">{rows} real transfer outcomes · 2011–2026</span>
          <h1>Your real chances of transferring into the T25</h1>
          <p className="dek">
            Chancery weighs your GPA, school, and story against official admit rates and the
            admitted-student data behind every top-25 university — not forum guesses.
          </p>
          <div className="cta-row">
            <button type="button" className="btn" onClick={() => setPhase("intake")}>
              Check my chances
            </button>
            <p className="aside">Free · takes 2 minutes · nothing leaves your browser</p>
          </div>
          <div className="factline">
            <span><b>{rows}</b> recorded outcomes</span>
            <span><b>{Number(MODEL.meta.admits).toLocaleString()}</b> observed admits</span>
            <span><b>{String(MODEL.meta.schools)}</b> top-25 universities</span>
            <span><b>15</b> application cycles</span>
          </div>
        </main>
      )}

      {phase === "intake" && (
        <main>
          <Intake profile={profile} onChange={setProfile} onDone={() => setPhase("results")} />
        </main>
      )}

      {phase === "results" && (
        <main>
          <Results profile={profile} onRevise={() => setPhase("intake")} />
        </main>
      )}
    </>
  );
}
