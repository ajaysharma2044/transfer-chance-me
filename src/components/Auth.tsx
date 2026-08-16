import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { logIn, signUp } from "../lib/auth";
import type { Session } from "../lib/auth";
import { googleEnabled, mountGoogleButton } from "../lib/googleAuth";
import { cloudEnabled, signInWithGoogle } from "../lib/auth";
import "./auth.css";

type Mode = "login" | "signup";

export default function Auth({ onDone }: { onDone: (s: Session) => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const googleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // With Supabase configured, Google runs through it (a redirect flow whose
    // token the server verifies) rather than the browser-only GIS button.
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
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const session =
        mode === "signup"
          ? await signUp(name, email, password)
          : await logIn(email, password);
      onDone(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="au-wrap">
      <div className="au-card">
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

        <h1 className="au-title">
          {mode === "login" ? "Welcome back" : "Save your chances"}
        </h1>
        <p className="au-dek">
          {mode === "login"
            ? "Pick up where you left off."
            : "Save your profile and report to your account."}
        </p>

        {cloudEnabled ? (
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
        ) : googleEnabled ? (
          <>
            <div className="au-google" ref={googleRef} />
            <div className="au-divider" aria-hidden="true"><span>or</span></div>
          </>
        ) : null}

        <form
          id="au-panel"
          role="tabpanel"
          aria-labelledby={mode === "login" ? "au-tab-login" : "au-tab-signup"}
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

          <div className="au-field">
            <label htmlFor="au-password">Password</label>
            <input
              id="au-password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <p className="au-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn au-submit" disabled={busy}>
            {busy ? "One moment…" : mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>

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
      </div>
    </div>
  );
}
