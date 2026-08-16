import { useEffect, useState } from "react";
import { DEFAULT_PROFILE, MODEL } from "./engine";
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
import Portal from "./components/Portal";
import Review from "./components/Review";
import { LogoMark, Wordmark } from "./components/Logo";

// URL routing (hash-based, static-host friendly):
//   #/            landing        #/check      intake
//   #/results     chances table  #/pricing    pricing
//   #/login       auth           #/portal     signed-in dashboard
//   #/schools/<id>  per-college page

type View =
  | { kind: "landing" }
  | { kind: "intake" }
  | { kind: "results" }
  | { kind: "pricing" }
  | { kind: "auth" }
  | { kind: "portal" }
  | { kind: "review" }
  | { kind: "school"; name: string };

const STORE = "tcm.profile.v1";

function viewFromHash(): View {
  const h = window.location.hash.replace(/^#\/?/, "").replace(/\/+$/, "");
  if (h === "check") return { kind: "intake" };
  if (h === "results") return { kind: "results" };
  if (h === "pricing") return { kind: "pricing" };
  if (h === "login") return { kind: "auth" };
  if (h === "portal") return { kind: "portal" };
  if (h === "review") return { kind: "review" };
  if (h.startsWith("schools/")) {
    const id = h.slice("schools/".length);
    const s = MODEL.schools.find((x) => x.id === id);
    if (s) return { kind: "school", name: s.name };
  }
  return { kind: "landing" };
}

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
  const [view, setView] = useState<View>(viewFromHash);
  const [profile, setProfile] = useState<Profile>(loadProfile);
  const [session, setSessionState] = useState<Session | null>(() => {
    const s = getSession();
    return s?.email ? s : null;
  });

  useEffect(() => {
    localStorage.setItem(STORE, JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    const onHash = () => {
      setView(viewFromHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  /** Navigate to a route ("" for landing, "portal", "schools/<id>", …). */
  const nav = (route: string) => {
    const target = `#/${route}`;
    if (window.location.hash === target) return;
    window.location.hash = target;
  };

  const openSchool = (name: string) => {
    const s = MODEL.schools.find((x) => x.name === name);
    if (s) nav(`schools/${s.id}`);
  };

  function handleAuth(s: Session) {
    setSession(s);
    setSessionState(s);
    nav("portal");
  }

  function logout() {
    setSession(null);
    setSessionState(null);
    nav("");
  }

  return (
    <>
      <div className="topbar" aria-hidden="true" />
      <div className="shell">
        <header className="masthead">
          <a className="wordmark" href="#/" aria-label="Transfer Chance Me home">
            <LogoMark />
            <Wordmark />
          </a>
          <nav className="mastnav">
            <a className="btn-quiet" href="#/review">Deep review</a>
            <a className="btn-quiet" href="#/pricing">Pricing</a>
            {session ? (
              <>
                <a className="btn-quiet" href="#/portal">Portal</a>
                <button type="button" className="btn-quiet" onClick={logout}>Log out</button>
              </>
            ) : (
              <a className="btn-quiet" href="#/login">Log in</a>
            )}
            <a className="btn btn-sm" href="#/check">Check my chances</a>
          </nav>
        </header>
      </div>

      {view.kind === "landing" && <Landing onStart={() => nav("check")} onOpenSchool={openSchool} />}
      {view.kind === "intake" && (
        <main><Intake profile={profile} onChange={setProfile} onDone={() => nav("results")} /></main>
      )}
      {view.kind === "results" && (
        <main><Results profile={profile} onRevise={() => nav("check")} onOpenSchool={openSchool} /></main>
      )}
      {view.kind === "pricing" && <main><Pricing onStart={() => nav("check")} /></main>}
      {view.kind === "auth" && <main><Auth onDone={handleAuth} /></main>}
      {view.kind === "portal" && (
        <main><Portal session={session} profile={profile} go={nav} /></main>
      )}
      {view.kind === "review" && (
        <main><Review profile={profile} onChange={setProfile} /></main>
      )}
      {view.kind === "school" && (
        <main>
          <SchoolPage
            name={view.name}
            onBack={() => nav("")}
            onStart={() => nav("check")}
            onOpenSchool={openSchool}
          />
        </main>
      )}
    </>
  );
}
