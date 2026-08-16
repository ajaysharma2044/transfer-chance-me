import { useEffect, useState } from "react";
import { DEFAULT_PROFILE } from "./engine";
import type { Profile } from "./engine";
import { analyzeEssay } from "./lib/essay";
import { getSession, setSession } from "./lib/auth";
import type { Session } from "./lib/auth";
import Intake from "./components/Intake";
import Results from "./components/Results";
import Landing from "./components/Landing";
import SchoolPage from "./components/SchoolPage";
import Pricing from "./components/Pricing";
import Auth from "./components/Auth";
import { LogoMark, Wordmark } from "./components/Logo";

type View =
  | { kind: "landing" }
  | { kind: "intake" }
  | { kind: "results" }
  | { kind: "pricing" }
  | { kind: "auth" }
  | { kind: "school"; name: string };

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
  const [view, setView] = useState<View>({ kind: "landing" });
  const [profile, setProfile] = useState<Profile>(loadProfile);
  const [session, setSessionState] = useState<Session | null>(() => {
    const s = getSession();
    return s?.email ? s : null;
  });

  useEffect(() => {
    localStorage.setItem(STORE, JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  const go = (kind: "landing" | "intake" | "results" | "pricing" | "auth") => setView({ kind });
  const openSchool = (name: string) => setView({ kind: "school", name });

  function handleAuth(s: Session) {
    setSession(s);
    setSessionState(s);
    setView({ kind: "landing" });
  }

  function logout() {
    setSession(null);
    setSessionState(null);
  }

  return (
    <>
      <div className="topbar" aria-hidden="true" />
      <div className="shell">
        <header className="masthead">
          <button type="button" className="wordmark" onClick={() => go("landing")} aria-label="Transfer Chance Me home">
            <LogoMark />
            <Wordmark />
          </button>
          <nav className="mastnav">
            <button type="button" className="btn-quiet" onClick={() => go("pricing")}>Pricing</button>
            {session ? (
              <>
                <span className="who">{session.name || session.email}</span>
                <button type="button" className="btn-quiet" onClick={logout}>Log out</button>
              </>
            ) : (
              <button type="button" className="btn-quiet" onClick={() => go("auth")}>Log in</button>
            )}
            <button type="button" className="btn btn-sm" onClick={() => go("intake")}>Check my chances</button>
          </nav>
        </header>
      </div>

      {view.kind === "landing" && <Landing onStart={() => go("intake")} onOpenSchool={openSchool} />}
      {view.kind === "intake" && (
        <main><Intake profile={profile} onChange={setProfile} onDone={() => go("results")} /></main>
      )}
      {view.kind === "results" && (
        <main><Results profile={profile} onRevise={() => go("intake")} onOpenSchool={openSchool} /></main>
      )}
      {view.kind === "pricing" && <main><Pricing onStart={() => go("intake")} /></main>}
      {view.kind === "auth" && <main><Auth onDone={handleAuth} /></main>}
      {view.kind === "school" && (
        <main>
          <SchoolPage
            name={view.name}
            onBack={() => go("landing")}
            onStart={() => go("intake")}
            onOpenSchool={openSchool}
          />
        </main>
      )}
    </>
  );
}
