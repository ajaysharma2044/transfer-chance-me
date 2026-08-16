import { useEffect, useState } from "react";
import { DEFAULT_PROFILE } from "./engine";
import type { Profile } from "./engine";
import { analyzeEssay } from "./lib/essay";
import Intake from "./components/Intake";
import Results from "./components/Results";
import Landing from "./components/Landing";
import { LogoMark, Wordmark } from "./components/Logo";

type Phase = "landing" | "intake" | "results";

const STORE = "tcm.profile.v1";

function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const p: Profile = { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
      // Re-derive essay analysis so stored profiles pick up analyzer improvements
      if (p.essayText) {
        const a = analyzeEssay(p.essayText);
        p.essayNamed = a.namedSchools;
        p.essayVerdict = a.verdict;
      }
      return p;
    }
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

  return (
    <>
      <div className="topbar" aria-hidden="true" />
      <div className="shell">
        <header className="masthead">
          <button type="button" className="wordmark" onClick={() => setPhase("landing")} aria-label="Transfer Chance Me home">
            <LogoMark />
            <Wordmark />
          </button>
          {phase === "landing" && (
            <button type="button" className="btn btn-sm" onClick={() => setPhase("intake")}>
              Check my chances
            </button>
          )}
        </header>
      </div>

      {phase === "landing" && <Landing onStart={() => setPhase("intake")} />}

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
