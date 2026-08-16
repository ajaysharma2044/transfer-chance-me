import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { logIn, signUp } from "../lib/auth";
import type { Session } from "../lib/auth";
import { googleEnabled, mountGoogleButton } from "../lib/googleAuth";
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
            : "Keep your profile and report on this device."}
        </p>

        {googleEnabled && (
          <>
            <div className="au-google" ref={googleRef} />
            <div className="au-divider" aria-hidden="true"><span>or</span></div>
          </>
        )}

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
          Beta note: accounts live only in this browser, on this device. Nothing is sent
          to a server, and your password is stored as a one-way hash — but clearing this
          browser's data will remove your account.
        </p>
      </div>
    </div>
  );
}
