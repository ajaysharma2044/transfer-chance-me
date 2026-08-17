import { useEffect, useState } from "react";
import { DEFAULT_PROFILE, MODEL } from "./engine";
import type { Profile } from "./engine";
import { analyzeEssay } from "./lib/essay";
import { getSession, initAuth, logOut, setSession } from "./lib/auth";
import { pullProfile, pushProfile, syncReady } from "./lib/sync";
import type { Session } from "./lib/auth";
import Intake from "./components/Intake";
import Results, { ResultsGate } from "./components/Results";
import Landing from "./components/Landing";
import SchoolPage from "./components/SchoolPage";
import Pricing from "./components/Pricing";
import Auth from "./components/Auth";
import Portal from "./components/Portal";
import Account from "./components/Account";
import Review from "./components/Review";
import CollegePage from "./components/CollegePage";
import SchoolsIndex from "./components/SchoolsIndex";
import Admin from "./components/admin/Admin";
import AdminNavLink from "./components/admin/AdminNavLink";
import { LogoMark, Wordmark } from "./components/Logo";
import { useScrollFx } from "./hooks/useScrollFx";

// URL routing (hash-based, static-host friendly):
//   #/            landing        #/check      intake
//   #/results     chances table  #/pricing    pricing
//   #/login       auth           #/portal     signed-in dashboard
//   #/schools/<id>  per-college page
//   #/admin[/...]   internal staff console (server decides access, not this)

type View =
  | { kind: "landing" }
  | { kind: "intake" }
  | { kind: "results" }
  | { kind: "pricing" }
  | { kind: "auth" }
  | { kind: "portal" }
  | { kind: "account" }
  | { kind: "review" }
  | { kind: "browse" }
  | { kind: "college"; idx: number }
  | { kind: "school"; name: string }
  | { kind: "admin"; sub: string };

const STORE = "tcm.profile.v1";
/** Where to land after signing in, when auth interrupted something. */
const NEXT_KEY = "tcm.next.v1";

/* Auth links (OAuth returns, confirmation emails, reset emails) land on this
 * page with their tokens in the URL hash. The Supabase SDK consumes and
 * scrubs that hash almost immediately, so what KIND of visit this is has to
 * be captured at module load — by the first render it is gone. */
const BOOT_HASH = typeof window !== "undefined" ? window.location.hash : "";
/** This visit arrived from an auth email or an OAuth provider. */
const AUTH_RETURN = /access_token=|refresh_token=|error_code=|error_description=/.test(BOOT_HASH);
/** …specifically from a password-reset email. */
const RECOVERY_RETURN = /type=recovery/.test(BOOT_HASH);
/** …and it failed at the provider (user cancelled, config error). */
const AUTH_RETURN_ERROR = (() => {
  const m = BOOT_HASH.match(/error_description=([^&]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1].replace(/\+/g, " ")); } catch { return m[1]; }
})();

function viewFromHash(): View {
  const h = window.location.hash.replace(/^#\/?/, "").replace(/\/+$/, "");
  if (h === "check") return { kind: "intake" };
  if (h === "results") return { kind: "results" };
  if (h === "pricing") return { kind: "pricing" };
  if (h === "login") return { kind: "auth" };
  if (h === "portal") return { kind: "portal" };
  if (h === "account") return { kind: "account" };
  if (h === "review") return { kind: "review" };
  if (h === "browse") return { kind: "browse" };
  // Staff console. The sub-path is handed to Admin unparsed; nothing about
  // reaching this route grants anything — api/_admin.ts decides on the server.
  if (h === "admin") return { kind: "admin", sub: "" };
  if (h.startsWith("admin/")) return { kind: "admin", sub: h.slice("admin/".length) };
  if (h.startsWith("college/")) {
    const idx = Number(h.slice("college/".length));
    if (Number.isInteger(idx) && idx >= 0) return { kind: "college", idx };
  }
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

  // True while this visit is completing a password reset: the reset email
  // signed them in with a recovery token, and the only sensible next screen
  // is "choose a new password".
  const [recovery, setRecovery] = useState<boolean>(RECOVERY_RETURN);

  // Track the real backend session (Supabase) once at boot, and route the
  // moments that arrive from outside the app:
  //   · a reset-email visit goes to the new-password form
  //   · a fresh sign-in that came from an OAuth redirect or a confirmation
  //     email continues to wherever the user was headed (the results gate
  //     stores that in sessionStorage) or to their portal
  // In-app logins don't take this path — handleAuth below routes those — so
  // this only fires for visits that START signed-in from a redirect.
  useEffect(() => {
    // These describe how THIS PAGE-LOAD started, so each must be consumed
    // once and then stop matching. Leaving them armed made every later auth
    // event re-run the arrival logic: a token refresh (~55 min) or a
    // tab-refocus in a tab that began at a reset link would throw a
    // signed-in user back into the new-password screen, and a later
    // in-app login would eat the stored destination.
    let arrivalPending = AUTH_RETURN;
    let recoveryPending = RECOVERY_RETURN;

    return initAuth((s, event) => {
      setSessionState(s);

      if (event === "PASSWORD_RECOVERY" || (recoveryPending && s)) {
        recoveryPending = false;
        arrivalPending = false;
        setRecovery(true);
        window.location.hash = "#/login";
        return;
      }

      if (arrivalPending && s && event === "SIGNED_IN") {
        arrivalPending = false;
        let next = "portal";
        try {
          const pending = sessionStorage.getItem(NEXT_KEY);
          if (pending) { next = pending; sessionStorage.removeItem(NEXT_KEY); }
        } catch { /* ok */ }
        window.location.hash = `#/${next}`;
      }
    });
  }, []);

  // A provider or email link that came back with an error carries no session,
  // so neither branch above fires and the router sees an unroutable hash —
  // which used to strand a cancelled Google sign-in, or an expired reset
  // link, on the marketing page with no explanation. Send those to the login
  // screen, which knows how to show the message.
  useEffect(() => {
    if (AUTH_RETURN_ERROR) window.location.hash = "#/login";
  }, []);

  // On sign-in, adopt the account's saved profile so a user's work follows
  // them to a new device. A local profile that is still untouched must not
  // overwrite the stored one, so the pull wins unless the user has edited.
  useEffect(() => {
    if (!session) return;
    let live = true;
    (async () => {
      try {
        if (!(await syncReady())) return;
        const cloud = await pullProfile();
        if (!live) return;
        if (cloud.profile) setProfile(cloud.profile);
        else await pushProfile(profile);
      } catch { /* sync is best-effort; never block the app on it */ }
    })();
    return () => { live = false; };
    // Deliberately keyed on identity only: this is an adopt-on-login step,
    // not a subscription to every profile keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.email]);

  // Push edits up, debounced, so a refresh or another device sees them.
  useEffect(() => {
    if (!session) return;
    const t = window.setTimeout(() => {
      pushProfile(profile).catch(() => { /* offline is not an error here */ });
    }, 1200);
    return () => clearTimeout(t);
  }, [profile, session]);

  useEffect(() => {
    const onHash = () => {
      setView(viewFromHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Scroll choreography for the whole app, not just the landing page.
  // Re-keyed on the route because it queries the DOM once per run: after a
  // route change the previous page's [data-fx] nodes are gone and the new
  // page's have never been observed, so without this they would sit at
  // opacity 0 forever.
  useScrollFx([view.kind]);

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
    // Came from the results gate? Send them straight to what they were promised.
    let next = "portal";
    try {
      const pending = sessionStorage.getItem(NEXT_KEY);
      if (pending) { next = pending; sessionStorage.removeItem(NEXT_KEY); }
    } catch { /* ok */ }
    nav(next);
  }

  function logout() {
    logOut().catch(() => { /* clearing locally is enough to log out here */ });
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
            <a className="btn-quiet" href="#/browse">Schools</a>
            <a className="btn-quiet" href="#/review">Deep review</a>
            <a className="btn-quiet" href="#/pricing">Pricing</a>
            {session ? (
              <>
                {/* Renders only for an account holding a staff role, and that
                    is cosmetic: #/admin is a URL anyone can type. */}
                <AdminNavLink />
                <a className="btn-quiet" href="#/portal">Portal</a>
                <a className="btn-quiet" href="#/account">Account</a>
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
        <main>
          {session ? (
            <Results profile={profile} onRevise={() => nav("check")} onOpenSchool={openSchool} />
          ) : (
            <ResultsGate
              profile={profile}
              onSignup={() => {
                try { sessionStorage.setItem(NEXT_KEY, "results"); } catch { /* ok */ }
                nav("login");
              }}
            />
          )}
        </main>
      )}
      {view.kind === "pricing" && <main><Pricing onStart={() => nav("check")} /></main>}
      {view.kind === "account" && (
        session ? (
          <main><Account session={session} onLogout={logout} /></main>
        ) : (
          // Signed out on the account URL: sign in first, then return here.
          <main><Auth onDone={(s) => { try { sessionStorage.removeItem(NEXT_KEY); } catch { /* ok */ } setRecovery(false); setSession(s); setSessionState(s); nav("account"); }} recovery={recovery} notice={AUTH_RETURN_ERROR} /></main>
        )
      )}

      {view.kind === "auth" && (
        <main>
          <Auth
            onDone={(s) => { setRecovery(false); handleAuth(s); }}
            recovery={recovery}
            notice={AUTH_RETURN_ERROR}
          />
        </main>
      )}
      {view.kind === "portal" && (
        <main><Portal session={session} profile={profile} go={nav} /></main>
      )}
      {view.kind === "review" && (
        <main><Review profile={profile} onChange={setProfile} /></main>
      )}
      {view.kind === "browse" && <main><SchoolsIndex go={nav} /></main>}
      {view.kind === "college" && <main><CollegePage idx={view.idx} go={nav} /></main>}
      {view.kind === "admin" && <main><Admin sub={view.sub} go={nav} /></main>}
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
