import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  cloudEnabled,
  logIn,
  requestPasswordReset,
  resendConfirmation,
  setPassword as savePassword,
  signInWithGoogle,
  signUp,
} from "../lib/auth";
import { getSession } from "../lib/auth";
import type { Session } from "../lib/auth";
import { googleEnabled, mountGoogleButton } from "../lib/googleAuth";
import "./auth.css";

// The whole sign-in surface, as states rather than pages:
//   login        email + password, Google, forgot-password link
//   signup       name + email + password, Google
//   sent         account created, confirmation email on its way (resend, cooldown)
//   forgot       ask for the email to reset
//   forgot-sent  reset email on its way — same wording whether or not an
//                account exists, so this screen can't be used to probe who
//                has an account here
//   reset        arrived from the email link: choose the new password
type Mode = "login" | "signup" | "sent" | "forgot" | "forgot-sent" | "reset";

const RESEND_COOLDOWN_S = 60;

export default function Auth({
  onDone,
  recovery = false,
  notice = null,
}: {
  onDone: (s: Session) => void;
  /** True when this visit came from a password-reset email link. */
  recovery?: boolean;
  /** A message carried in from outside — e.g. a failed OAuth return. */
  notice?: string | null;
}) {
  const [mode, setMode] = useState<Mode>(recovery ? "reset" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(notice);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const googleRef = useRef<HTMLDivElement>(null);

  // A recovery link can land while the page is already open.
  useEffect(() => {
    if (recovery) setMode("reset");
  }, [recovery]);

  // Resend cooldown ticks down once per second.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    // Without Supabase, Google falls back to the browser-only GIS button.
    if (cloudEnabled) return;
    if (googleEnabled && googleRef.current) {
      mountGoogleButton(googleRef.current, onDone).catch(() => {
        /* button stays hidden if GIS fails to load */
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setInfo(null);
  }

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (mode === "login") {
      void run(async () => {
        onDone(await logIn(email, password));
      });
    } else if (mode === "signup") {
      void run(async () => {
        const r = await signUp(name, email, password);
        if (r.needsConfirmation) {
          setCooldown(RESEND_COOLDOWN_S);
          setMode("sent");
        } else if (r.session) {
          onDone(r.session);
        }
      });
    } else if (mode === "forgot") {
      void run(async () => {
        await requestPasswordReset(email);
        setCooldown(RESEND_COOLDOWN_S);
        setMode("forgot-sent");
      });
    } else if (mode === "reset") {
      void run(async () => {
        if (password !== password2) throw new Error("Those passwords don't match.");
        await savePassword(password);
        const s = getSession();
        if (s) onDone(s);
        else setError("Password saved — log in with it now.");
      });
    }
  }

  function resend() {
    void run(async () => {
      if (mode === "sent") await resendConfirmation(email);
      else await requestPasswordReset(email);
      setCooldown(RESEND_COOLDOWN_S);
      setInfo("Sent again — give it a minute to arrive, and check spam.");
    });
  }

  const showTabs = mode === "login" || mode === "signup";
  const showGoogle = showTabs;

  const title =
    mode === "login" ? "Welcome back"
    : mode === "signup" ? "Save your chances"
    : mode === "sent" ? "Check your inbox"
    : mode === "forgot" ? "Reset your password"
    : mode === "forgot-sent" ? "Check your inbox"
    : "Choose a new password";

  const dek =
    mode === "login" ? "Pick up where you left off."
    : mode === "signup" ? "Save your profile and report to your account."
    : mode === "sent" ? `We sent a confirmation link to ${email}. Click it and you're in.`
    : mode === "forgot" ? "Enter your email and we'll send a reset link."
    : mode === "forgot-sent" ? `If there's an account for ${email}, a reset link is on its way.`
    : "You followed a reset link — set the new password for your account here.";

  return (
    <div className="au-wrap">
      <div className="au-card">
        {showTabs && (
          <div className="au-tabs" role="tablist" aria-label="Log in or create account">
            <button
              type="button"
              role="tab"
              id="au-tab-login"
              aria-selected={mode === "login"}
              aria-controls="au-panel"
              className={`au-tab${mode === "login" ? " on" : ""}`}
              onClick={() => switchMode("login")}
            >
              Log in
            </button>
            <button
              type="button"
              role="tab"
              id="au-tab-signup"
              aria-selected={mode === "signup"}
              aria-controls="au-panel"
              className={`au-tab${mode === "signup" ? " on" : ""}`}
              onClick={() => switchMode("signup")}
            >
              Create account
            </button>
          </div>
        )}

        <h1 className="au-title">{title}</h1>
        <p className="au-dek">{dek}</p>

        {showGoogle && cloudEnabled ? (
          <>
            <button
              type="button"
              className="au-gbtn"
              onClick={() => {
                setError(null);
                signInWithGoogle().catch((e: Error) => setError(e.message));
              }}
            >
              <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#4285F4" d="M45 24.5c0-1.6-.1-2.7-.4-4H24v7.3h12c-.2 2-1.5 5-4.4 7l6.7 5.2c4-3.7 6.7-9.1 6.7-15.5Z" />
                <path fill="#34A853" d="M24 46c5.8 0 10.7-1.9 14.3-5.2l-6.7-5.2c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7 5.4C8.1 41.1 15.4 46 24 46Z" />
                <path fill="#FBBC05" d="M11.5 28.7c-.5-1.4-.7-2.9-.7-4.7s.3-3.3.7-4.7l-7-5.4C3.3 17 2.5 20.4 2.5 24s.8 7 2.5 10.1l6.5-5.4Z" />
                <path fill="#EA4335" d="M24 10.2c4.1 0 6.9 1.8 8.5 3.3l6-5.8C34.7 4.3 29.8 2 24 2 15.4 2 8.1 6.9 5 14l7 5.4c1.8-5.3 6.7-9.2 12-9.2Z" />
              </svg>
              Continue with Google
            </button>
            <div className="au-divider" aria-hidden="true"><span>or</span></div>
          </>
        ) : showGoogle && googleEnabled ? (
          <>
            <div className="au-google" ref={googleRef} />
            <div className="au-divider" aria-hidden="true"><span>or</span></div>
          </>
        ) : null}

        {mode === "sent" || mode === "forgot-sent" ? (
          <div className="au-sent" role="status">
            <span className="au-sent-mark" aria-hidden="true">✉</span>
            <p>
              {mode === "sent"
                ? "The link signs you in and brings you straight back here."
                : "The link opens a screen to choose a new password. It works for an hour."}
            </p>
            {info && <p className="au-ok">{info}</p>}
            {error && <p className="au-error" role="alert">{error}</p>}
            <button type="button" className="btn au-submit" onClick={resend} disabled={busy || cooldown > 0}>
              {cooldown > 0 ? `Send again (${cooldown}s)` : busy ? "One moment…" : "Send it again"}
            </button>
            <p className="au-switch">
              Wrong email?{" "}
              <button type="button" className="au-link" onClick={() => switchMode(mode === "sent" ? "signup" : "forgot")}>
                Go back
              </button>
              {" · "}
              <button type="button" className="au-link" onClick={() => switchMode("login")}>
                Log in
              </button>
            </p>
          </div>
        ) : (
          <form
            id="au-panel"
            role="tabpanel"
            aria-labelledby={mode === "signup" ? "au-tab-signup" : "au-tab-login"}
            className="au-form"
            onSubmit={handleSubmit}
            noValidate
          >
            {mode === "signup" && (
              <div className="au-field">
                <label htmlFor="au-name">Name</label>
                <input
                  id="au-name"
                  type="text"
                  autoComplete="name"
                  placeholder="Jordan Rivera"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            )}

            {mode !== "reset" && (
              <div className="au-field">
                <label htmlFor="au-email">Email</label>
                <input
                  id="au-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            )}

            {mode !== "forgot" && (
              <div className="au-field">
                <div className="au-labelrow">
                  <label htmlFor="au-password">{mode === "reset" ? "New password" : "Password"}</label>
                  <button
                    type="button"
                    className="au-link au-pwtoggle"
                    onClick={() => setShowPw((v) => !v)}
                    aria-pressed={showPw}
                  >
                    {showPw ? "Hide" : "Show"}
                  </button>
                </div>
                <input
                  id="au-password"
                  type={showPw ? "text" : "password"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  placeholder={mode === "login" ? "Your password" : "At least 8 characters"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {mode !== "login" && (
                  <p className="au-hint">At least 8 characters. A short sentence works well.</p>
                )}
              </div>
            )}

            {mode === "reset" && (
              <div className="au-field">
                <label htmlFor="au-password2">Type it again</label>
                <input
                  id="au-password2"
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Same password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                />
              </div>
            )}

            {error && (
              <p className="au-error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="btn au-submit" disabled={busy}>
              {busy
                ? "One moment…"
                : mode === "login" ? "Log in"
                : mode === "signup" ? "Create account"
                : mode === "forgot" ? "Send reset link"
                : "Save new password"}
            </button>

            {mode === "login" && cloudEnabled && (
              <p className="au-forgot">
                <button type="button" className="au-link" onClick={() => switchMode("forgot")}>
                  Forgot your password?
                </button>
              </p>
            )}
          </form>
        )}

        {showTabs && (
          <p className="au-switch">
            {mode === "login" ? (
              <>
                New here?{" "}
                <button type="button" className="au-link" onClick={() => switchMode("signup")}>
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button type="button" className="au-link" onClick={() => switchMode("login")}>
                  Log in
                </button>
              </>
            )}
          </p>
        )}

        {mode === "forgot" && (
          <p className="au-switch">
            Remembered it?{" "}
            <button type="button" className="au-link" onClick={() => switchMode("login")}>
              Log in
            </button>
          </p>
        )}

        {/* Reset mode hides the tabs, so without this there is no way out of
            the screen except setting a password or editing the URL. */}
        {mode === "reset" && (
          <p className="au-switch">
            Don't need to change it?{" "}
            <button type="button" className="au-link" onClick={() => switchMode("login")}>
              Back to log in
            </button>
          </p>
        )}

        {showTabs && (
          <p className="au-note">
            {cloudEnabled ? (
              <>
                Your account saves your profile, school list and the material you write or upload,
                so your work follows you to another device. Only you can read it, and you can delete
                it whenever you like.
              </>
            ) : (
              <>
                Beta note: accounts live only in this browser, on this device. Nothing is sent
                to a server, and your password is stored as a one-way hash — but clearing this
                browser's data will remove your account.
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
