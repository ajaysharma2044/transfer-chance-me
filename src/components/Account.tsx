// The account page — who you are, how you sign in, and what the account
// stores. Honesty rules the copy here: every action says exactly what it
// does, and the two deletions are different sizes ("your data" leaves the
// login standing; "your account" removes everything) so both say so.
//
// Account deletion goes through POST /api/account/delete with the session's
// bearer token — the server verifies the token and deletes only the account
// it proves. `npm run dev` serves no /api routes, so a non-JSON answer is
// detected the same way src/components/admin/api.ts does, and reported as
// "this runs on the deployed site" rather than as a fake failure.

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { authProvider, cloudEnabled, logOut, setPassword, setSession } from "../lib/auth";
import type { Session } from "../lib/auth";
import { deleteAllData, listDocs, pullProfile } from "../lib/sync";
import { supabase } from "../lib/supabase";
import "./account.css";

const NO_API_MSG =
  "Account deletion runs on the deployed site — this dev server (npm run dev) " +
  "serves the front end without the /api routes. Your data can still be removed " +
  "right now with “Delete my data” above.";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong. Try again.";
}

export default function Account({
  session,
  onLogout,
}: {
  session: Session;
  onLogout: () => void;
}) {
  /* How this session signed in. undefined = still asking. */
  const [provider, setProvider] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    authProvider()
      .then((p) => {
        if (alive) setProvider(p);
      })
      .catch(() => {
        if (alive) setProvider(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const isGoogle = provider === "google";
  const providerLabel = !cloudEnabled
    ? "Local device account"
    : provider === undefined
      ? "—"
      : isGoogle
        ? "Google"
        : provider === "email"
          ? "Email and password"
          : provider
            ? provider.charAt(0).toUpperCase() + provider.slice(1)
            : "—";

  /* ── Password ── */
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);

  async function handlePassword(e: FormEvent) {
    e.preventDefault();
    if (pwBusy) return;
    setPwErr(null);
    setPwDone(false);
    if (pw1.length < 8) {
      setPwErr("Password needs at least 8 characters.");
      return;
    }
    if (pw1 !== pw2) {
      setPwErr("Those passwords don't match.");
      return;
    }
    setPwBusy(true);
    try {
      await setPassword(pw1);
      setPwDone(true);
      setPw1("");
      setPw2("");
    } catch (err) {
      setPwErr(errMsg(err));
    } finally {
      setPwBusy(false);
    }
  }

  /* ── Download my data ── */
  const [dlBusy, setDlBusy] = useState(false);
  const [dlErr, setDlErr] = useState<string | null>(null);
  const [dlDone, setDlDone] = useState(false);

  async function handleDownload() {
    if (dlBusy) return;
    setDlErr(null);
    setDlDone(false);
    setDlBusy(true);
    try {
      const [{ profile, schools }, documents] = await Promise.all([pullProfile(), listDocs()]);
      const payload = {
        account: { email: session.email, name: session.name },
        exported_at: new Date().toISOString(),
        profile,
        schools,
        documents,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "transfer-chance-me-data.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDlDone(true);
    } catch (err) {
      setDlErr(errMsg(err));
    } finally {
      setDlBusy(false);
    }
  }

  /* ── Delete my data (login stays) ── */
  const [dataOpen, setDataOpen] = useState(false);
  const [dataText, setDataText] = useState("");
  const [dataBusy, setDataBusy] = useState(false);
  const [dataErr, setDataErr] = useState<string | null>(null);
  const [dataDone, setDataDone] = useState(false);

  async function handleDeleteData() {
    if (dataBusy || dataText !== "DELETE") return;
    setDataErr(null);
    setDataBusy(true);
    try {
      await deleteAllData();
      setDataDone(true);
      setDataOpen(false);
      setDataText("");
    } catch (err) {
      setDataErr(errMsg(err));
    } finally {
      setDataBusy(false);
    }
  }

  /* ── Delete my account (everything goes) ── */
  const [acctOpen, setAcctOpen] = useState(false);
  const [acctText, setAcctText] = useState("");
  const [acctBusy, setAcctBusy] = useState(false);
  const [acctErr, setAcctErr] = useState<string | null>(null);

  async function handleDeleteAccount() {
    if (acctBusy || acctText !== "DELETE") return;
    setAcctErr(null);
    setAcctBusy(true);
    try {
      if (!supabase) throw new Error(NO_API_MSG);
      const { data, error } = await supabase.auth.getSession();
      if (error) throw new Error(error.message);
      const token = data.session?.access_token;
      if (!token) {
        throw new Error("Your session has expired. Sign in again, then retry.");
      }

      let res: Response;
      try {
        res = await fetch("/api/account/delete", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          credentials: "omit",
          cache: "no-store",
          referrerPolicy: "same-origin",
        });
      } catch {
        throw new Error(NO_API_MSG);
      }

      // A dev server or static host answers /api/* with HTML or the route's
      // own source — same detection as src/components/admin/api.ts.
      const ctype = res.headers.get("content-type") ?? "";
      if (!ctype.includes("json")) throw new Error(NO_API_MSG);

      let body: Record<string, unknown>;
      try {
        body = (await res.json()) as Record<string, unknown>;
      } catch {
        throw new Error(NO_API_MSG);
      }
      if (!res.ok) {
        const m =
          typeof body.error === "string" && body.error.trim()
            ? body.error.trim()
            : `The server answered HTTP ${res.status}.`;
        throw new Error(m);
      }

      // The account is gone; the server-side sign-out may 4xx because the
      // user no longer exists. Local clearing is what matters now.
      try {
        await logOut();
      } catch {
        setSession(null);
      }
      onLogout();
    } catch (err) {
      setAcctErr(errMsg(err));
      setAcctBusy(false);
    }
  }

  /* ── Sign out ── */
  const [outBusy, setOutBusy] = useState(false);

  async function handleSignOut() {
    if (outBusy) return;
    setOutBusy(true);
    try {
      await logOut();
    } catch {
      // Clearing locally is enough to log out here.
      setSession(null);
    }
    onLogout();
  }

  return (
    <div className="ac-wrap">
      <header className="ac-head">
        <h1>Account</h1>
        <p className="ac-sub">Your details, your password, and your data.</p>
      </header>

      {/* ── 1 · Account ── */}
      <section className="ac-card" aria-labelledby="ac-h-account">
        <h2 id="ac-h-account">Account</h2>
        <dl className="ac-kv">
          <div>
            <dt>Name</dt>
            <dd>{session.name}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{session.email}</dd>
          </div>
          <div>
            <dt>How you sign in</dt>
            <dd>{providerLabel}</dd>
          </div>
        </dl>
      </section>

      {cloudEnabled ? (
        <>
          {/* ── 2 · Password ── */}
          <section className="ac-card" aria-labelledby="ac-h-password">
            <h2 id="ac-h-password">{isGoogle ? "Set a password" : "Password"}</h2>
            <p className="ac-dek">
              {isGoogle ? (
                <>
                  You sign in with Google. Setting a password adds an email-and-password
                  way in alongside it — Google sign-in keeps working. Passwords need at
                  least 8 characters.
                </>
              ) : (
                <>Pick a new password for signing in. At least 8 characters.</>
              )}
            </p>
            <form onSubmit={handlePassword} noValidate>
              <div className="ac-field">
                <label htmlFor="ac-pw1">New password</label>
                <input
                  id="ac-pw1"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={pw1}
                  onChange={(e) => setPw1(e.target.value)}
                />
              </div>
              <div className="ac-field">
                <label htmlFor="ac-pw2">Confirm new password</label>
                <input
                  id="ac-pw2"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Same password again"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                />
              </div>
              {pwErr && (
                <p className="ac-error" role="alert">
                  {pwErr}
                </p>
              )}
              {pwDone && (
                <p className="ac-ok" role="status">
                  {isGoogle
                    ? "Password set. You can now sign in with your email and this password, as well as with Google."
                    : "Password updated."}
                </p>
              )}
              <button type="submit" className="btn btn-sm ac-submit" disabled={pwBusy}>
                {pwBusy ? "Saving…" : isGoogle ? "Set password" : "Update password"}
              </button>
            </form>
          </section>

          {/* ── 3 · Your data ── */}
          <section className="ac-card" aria-labelledby="ac-h-data">
            <h2 id="ac-h-data">Your data</h2>

            <div className="ac-action">
              <h3>Download my data</h3>
              <p>
                Everything your account stores — your profile, school list, and the
                material you've written or uploaded — as one JSON file.
              </p>
              <button type="button" className="ac-btn" disabled={dlBusy} onClick={handleDownload}>
                {dlBusy ? "Preparing…" : "Download my data"}
              </button>
              {dlErr && (
                <p className="ac-error" role="alert">
                  {dlErr}
                </p>
              )}
              {dlDone && (
                <p className="ac-ok" role="status">
                  Saved as <b>transfer-chance-me-data.json</b>.
                </p>
              )}
            </div>

            <div className="ac-action">
              <h3>Delete my data</h3>
              <p>
                Removes your documents, profile and school list from your account. The
                login itself stays — you can keep using the app from a blank slate.
              </p>
              {!dataOpen ? (
                <button
                  type="button"
                  className="ac-btn danger"
                  onClick={() => {
                    setDataOpen(true);
                    setDataErr(null);
                    setDataDone(false);
                  }}
                >
                  Delete my data
                </button>
              ) : (
                <div className="ac-confirm">
                  <label className="ac-confirm-label" htmlFor="ac-del-data">
                    Type <b>DELETE</b> to confirm
                  </label>
                  <div className="ac-confirm-row">
                    <input
                      id="ac-del-data"
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="DELETE"
                      value={dataText}
                      onChange={(e) => setDataText(e.target.value)}
                    />
                    <button
                      type="button"
                      className="ac-btn danger"
                      disabled={dataText !== "DELETE" || dataBusy}
                      onClick={handleDeleteData}
                    >
                      {dataBusy ? "Deleting…" : "Delete my data"}
                    </button>
                    <button
                      type="button"
                      className="ac-btn"
                      disabled={dataBusy}
                      onClick={() => {
                        setDataOpen(false);
                        setDataText("");
                        setDataErr(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {dataErr && (
                <p className="ac-error" role="alert">
                  {dataErr}
                </p>
              )}
              {dataDone && (
                <p className="ac-ok" role="status">
                  Your documents, profile and school list have been removed from your
                  account. Your login still works.
                </p>
              )}
            </div>

            <div className="ac-action">
              <h3>Delete my account</h3>
              <p>
                Deletes your login and everything stored with it. This can't be undone.
              </p>
              {!acctOpen ? (
                <button
                  type="button"
                  className="ac-btn danger"
                  onClick={() => {
                    setAcctOpen(true);
                    setAcctErr(null);
                  }}
                >
                  Delete my account
                </button>
              ) : (
                <div className="ac-confirm">
                  <label className="ac-confirm-label" htmlFor="ac-del-acct">
                    Type <b>DELETE</b> to confirm
                  </label>
                  <div className="ac-confirm-row">
                    <input
                      id="ac-del-acct"
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="DELETE"
                      value={acctText}
                      onChange={(e) => setAcctText(e.target.value)}
                    />
                    <button
                      type="button"
                      className="ac-btn danger"
                      disabled={acctText !== "DELETE" || acctBusy}
                      onClick={handleDeleteAccount}
                    >
                      {acctBusy ? "Deleting…" : "Delete my account"}
                    </button>
                    <button
                      type="button"
                      className="ac-btn"
                      disabled={acctBusy}
                      onClick={() => {
                        setAcctOpen(false);
                        setAcctText("");
                        setAcctErr(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {acctErr && (
                <p className="ac-error" role="alert">
                  {acctErr}
                </p>
              )}
            </div>
          </section>
        </>
      ) : (
        /* ── Local account: no server to change a password on, nothing stored
              off this device. Say so, plainly. ── */
        <section className="ac-card" aria-labelledby="ac-h-local">
          <h2 id="ac-h-local">Your data</h2>
          <p className="ac-dek">
            This account lives only in this browser, on this device. Your profile and
            everything you write stay here — nothing is sent to a server, and your
            password is stored as a one-way hash. Clearing this site's data in your
            browser removes all of it, including the account itself.
          </p>
        </section>
      )}

      {/* ── 4 · Session ── */}
      <section className="ac-card" aria-labelledby="ac-h-session">
        <h2 id="ac-h-session">Session</h2>
        <p className="ac-dek">Sign out on this device. Your saved work stays put.</p>
        <button type="button" className="ac-btn" disabled={outBusy} onClick={handleSignOut}>
          {outBusy ? "Signing out…" : "Sign out"}
        </button>
      </section>
    </div>
  );
}
