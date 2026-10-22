import { useEffect, useState } from "react";
import { MODEL } from "../engine";
import type { Profile } from "../engine";
import { AuditError } from "../lib/audit/client";
import { analyzeEssay } from "../lib/essay";
import { subscribeUserDataCleared } from "../lib/listEvents";
import { getApiKey, proxyMode, setApiKey } from "../lib/review";
import { loadPanel, runPanel, SPECIALISTS } from "../lib/panel";
import type { PanelResult } from "../lib/panel";
import { includedTargets, MAX_INCLUDED, saveTargets, setIncluded, useTargets } from "../lib/targets";
import "./review.css";
import { pushDoc } from "../lib/sync";

// Deep application review: paste everything, pick targets, get a graded
// report with quote-level feedback from a panel of specialists. In proxy mode
// the deployment's server builds the prompts and runs the model on the user's
// account (src/lib/audit/*); otherwise it runs on the user's own Claude API
// key, straight from the browser to Anthropic.

const DOCS_KEY = "tcm.appdocs.v1";

interface Docs { statement: string; activities?: string }

function loadDocs(): Docs {
  try {
    const raw = localStorage.getItem(DOCS_KEY);
    if (raw) return { statement: "", ...JSON.parse(raw) };
  } catch { /* fresh */ }
  return { statement: "" };
}

interface Props {
  profile: Profile;
  onChange: (p: Profile) => void;
  /** Whether a session exists: signed in, the pasted materials are also saved
   *  to the account (pushDoc below), and the privacy line must say so. */
  signedIn: boolean;
}

export default function Review({ profile, onChange, signedIn }: Props) {
  const [key, setKeyState] = useState(getApiKey());
  const [keyInput, setKeyInput] = useState("");
  const [docs, setDocs] = useState<Docs>(loadDocs);
  // ONE shared list: the tracker in step 2 is the source of truth and the
  // review covers the explicitly included (≤ MAX_INCLUDED) entries from it.
  // No invented defaults — an empty tracker means no targets, and the gate
  // says so — and the request below carries exactly what is shown here.
  const list = useTargets();
  const targets = includedTargets(list).map((e) => e.school);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [panel, setPanel] = useState<PanelResult | null>(loadPanel);
  const [stage, setStage] = useState<Record<string, "running" | "done" | "failed">>({});

  useEffect(() => {
    localStorage.setItem(DOCS_KEY, JSON.stringify(docs));
  }, [docs]);

  // Logout / a sign-in that found another account's data / "Delete my data"
  // wiped storage; drop the in-memory copies too, or the next run would send
  // and save the previous user's statement under the new account.
  useEffect(() => subscribeUserDataCleared(() => {
    setDocs(loadDocs());
    setPanel(loadPanel());
    setError(null);
  }), []);

  // One-time migration: activities used to live here; they're part of the
  // shared profile now (also editable in the intake).
  useEffect(() => {
    if (!profile.activitiesText && docs.activities) {
      onChange({ ...profile, activitiesText: docs.activities });
      setDocs((d) => ({ statement: d.statement }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setEssay(text: string) {
    if (!text.trim()) {
      onChange({ ...profile, essayText: "", essayNamed: [], essayVerdict: null });
      return;
    }
    const a = analyzeEssay(text);
    onChange({ ...profile, essayText: text, essayNamed: a.namedSchools, essayVerdict: a.verdict });
  }

  async function go() {
    setError(null);
    setNeedsSignIn(false);
    if (!profile.essayText.trim() && !docs.statement.trim() && !profile.activitiesText.trim()) {
      setError("Paste at least one thing to review — an essay, statement, or activities list.");
      return;
    }
    if (targets.length === 0) {
      setError("Add at least one target school in step 2 — the review covers the schools on your list.");
      return;
    }
    setBusy(true);
    setStage({});
    setPanel(null);
    // Save what they wrote to their account, so the work survives this
    // session and this device. Best-effort: a sync failure must never stop
    // the review they actually asked for.
    void Promise.all([
      pushDoc("essay", profile.essayText),
      pushDoc("statement", docs.statement),
      pushDoc("activities", profile.activitiesText),
      pushDoc("awards", profile.awardsText),
    ]).catch(() => { /* offline or signed out — keep going */ });
    try {
      const r = await runPanel(
        {
          profile,
          targets,
          whyTransfer: profile.essayText,
          statement: docs.statement,
          activities: profile.activitiesText,
        },
        (id, state) => setStage((s) => ({ ...s, [id]: state })),
      );
      setPanel(r);
    } catch (e) {
      if (e instanceof AuditError && e.code === "auth" && proxyMode) setNeedsSignIn(true);
      setError(e instanceof Error ? e.message : "Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell rv">
      <header className="rv-head">
        <h1>Deep application review</h1>
        <p className="rv-dek">
          Paste your actual materials. A reviewer grounded in {Number(MODEL.meta.rows).toLocaleString()} real
          transfer outcomes reads everything and returns quote-level feedback, per-school verdicts, and a
          prioritized fix list.{" "}
          {/* This sentence has to track what the deployment ACTUALLY does, on
              the one page where students paste their most personal writing.
              Proxy mode: materials pass through our server to reach the model.
              Browser-key mode: they go straight to Anthropic — but signed in,
              go() below ALSO saves them to the account (pushDoc), so "never to
              us" is only true signed out. CLAUDE.md: signed-in and signed-out
              wording must differ. */}
          {proxyMode
            ? "Runs on your account: your materials pass through our server to reach the reviewer, and are stored on your account so you can come back to them."
            : signedIn
              ? "Your materials go from your browser straight to Anthropic — our review server never sees them — and are saved to your account so you can come back to them."
              : "Your materials go directly from your browser to the AI, and signed out nothing is stored anywhere but this browser."}
        </p>
      </header>

      {!key && !proxyMode && (
        <section className="rv-keycard">
          <h2>One-time setup: your AI key</h2>
          <ol>
            <li>Go to <b>console.anthropic.com</b> and sign up (or log in).</li>
            <li>Add billing under <b>Settings → Billing</b> — $5 of credit covers ~50 full reviews.</li>
            <li>Open <b>API Keys</b>, click <b>Create key</b>, copy it (starts with <code>sk-ant-</code>).</li>
            <li>Paste it here. It's stored only in this browser and sent only to Anthropic.</li>
          </ol>
          <div className="rv-keyrow">
            <input
              type="password"
              placeholder="sk-ant-…"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              aria-label="Anthropic API key"
            />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => { setApiKey(keyInput); setKeyState(keyInput.trim()); setKeyInput(""); }}
              disabled={!keyInput.trim().startsWith("sk-ant-")}
            >
              Save key
            </button>
          </div>
        </section>
      )}

      <div className="rv-grid">
        <section className="rv-inputs">
          <div className="rv-field">
            <label htmlFor="rv-essay">Your "why transfer" essay</label>
            <textarea
              id="rv-essay" rows={9}
              placeholder="Paste your main transfer essay…"
              value={profile.essayText}
              onChange={(e) => setEssay(e.target.value)}
            />
          </div>
          <div className="rv-field">
            <label htmlFor="rv-statement">Personal statement <span>(optional)</span></label>
            <textarea
              id="rv-statement" rows={7}
              placeholder="Paste your personal statement if your targets require one…"
              value={docs.statement}
              onChange={(e) => setDocs((d) => ({ ...d, statement: e.target.value }))}
            />
          </div>
          <div className="rv-field">
            <label htmlFor="rv-acts">Activities list, in your own words <span>(optional)</span></label>
            <textarea
              id="rv-acts" rows={7}
              placeholder={"One per line, exactly as written in your application:\nFounder, tutoring business — taught 41 students…"}
              value={profile.activitiesText}
              onChange={(e) => onChange({ ...profile, activitiesText: e.target.value })}
            />
          </div>

          <div className="rv-field">
            <span className="rv-label">Target schools for this review</span>
            {list.length === 0 ? (
              <p className="rv-hint">
                Your list is empty. Add schools in step 2 — the review covers the schools you track,
                never ones we pick for you.
              </p>
            ) : (
              <>
                <div className="rv-targets">
                  {list.map((e) => (
                    <button
                      key={e.school}
                      type="button"
                      className="chip rv-target"
                      aria-pressed={targets.includes(e.school)}
                      onClick={() => saveTargets(setIncluded(list, e.school, !targets.includes(e.school)))}
                    >
                      {e.school}
                    </button>
                  ))}
                </div>
                <p className="rv-hint">
                  {targets.length} of {list.length} on your list included — up to {MAX_INCLUDED} per review,
                  so fewer is deeper. Verdicts are school-specific.
                </p>
              </>
            )}
          </div>

          {error && (
            <p className="rv-error" role="alert">
              {error}{needsSignIn && <> <a href="#/login">Sign in</a></>}
            </p>
          )}

          <button type="button" className="btn rv-run" onClick={go} disabled={busy || (!key && !proxyMode)}>
            {busy ? "Reviewing — this takes about a minute…" : "Run deep review"}
          </button>
          {key && !proxyMode && (
            <button type="button" className="btn-quiet rv-keyclear" onClick={() => { setApiKey(""); setKeyState(""); }}>
              Remove saved API key
            </button>
          )}
        </section>

        <section className="rv-output" aria-live="polite">
          {!panel && !busy && (
            <div className="rv-empty">
              <p>Your report appears here — grades, quote-level notes, per-school verdicts, and your fix list.</p>
            </div>
          )}
          {busy && (
            <div className="rv-panelrun">
              <p className="rv-panelrun-h">Four reviewers are reading your file at once</p>
              {SPECIALISTS.map((sp) => {
                const st = stage[sp.id] ?? "waiting";
                return (
                  <div className={`rv-agent ${st}`} key={sp.id} style={{ ["--ac" as string]: sp.color }}>
                    <span className="rv-agent-dot" aria-hidden="true">
                      {st === "done" ? "✓" : st === "failed" ? "!" : st === "running" ? <span className="rv-spinner sm" /> : "·"}
                    </span>
                    <span className="rv-agent-text">
                      <b>{sp.name}</b>
                      <i>{sp.role}</i>
                    </span>
                    <span className="rv-agent-state">
                      {st === "done" ? "done" : st === "running" ? "reading" : st === "failed" ? "failed" : "queued"}
                    </span>
                  </div>
                );
              })}
              <div className={`rv-agent ${stage.lead ?? "waiting"}`} style={{ ["--ac" as string]: "var(--ink)" }}>
                <span className="rv-agent-dot" aria-hidden="true">
                  {stage.lead === "done" ? "✓" : stage.lead === "running" ? <span className="rv-spinner sm" /> : "·"}
                </span>
                <span className="rv-agent-text">
                  <b>Lead reviewer</b>
                  <i>Weighs the four reports into one verdict</i>
                </span>
                <span className="rv-agent-state">
                  {stage.lead === "done" ? "done" : stage.lead === "running" ? "synthesising" : "waiting on the panel"}
                </span>
              </div>
            </div>
          )}

          {panel && !busy && (panel.failed.length > 0 || panel.leadError) && (
            <p className="rv-error" role="alert">
              {panel.leadError
                ? `The lead reviewer did not finish (${panel.leadError}) — the specialist reports below stand; run again for the verdict.`
                : null}
              {panel.failed.length > 0 && (
                <>
                  {" "}This report is partial: {panel.failed.map((f) => `${SPECIALISTS.find((s) => s.id === f.id)?.name ?? f.id} (${f.message})`).join("; ")}.
                  {" "}Run again to fill the gaps.
                </>
              )}
            </p>
          )}
          {panel && !busy && (
            <article className="rv-report">
              <header className="rv-r-head">
                <span className="rv-grade">{panel.grade}</span>
                <div>
                  <h2>The honest read</h2>
                  <p>{panel.summary}</p>
                  <p className="rv-bylines">
                    Reviewed by {panel.reports.length} specialists ·{" "}
                    {panel.reports.map((r) => {
                      const sp = SPECIALISTS.find((x) => x.id === r.id);
                      return `${sp?.name ?? r.id} ${r.grade}`;
                    }).join(" · ")}
                  </p>
                </div>
              </header>

              <div className="rv-cols">
                <div>
                  <h3>Working for you</h3>
                  <ul>{panel.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
                </div>
                <div>
                  <h3 className="rv-risk">Working against you</h3>
                  <ul>{panel.risks.map((s) => <li key={s}>{s}</li>)}</ul>
                </div>
              </div>

              {panel.reports.map((r) => {
                const sp = SPECIALISTS.find((x) => x.id === r.id);
                return (
                  <section className="rv-spec" key={r.id} style={{ ["--ac" as string]: sp?.color ?? "var(--accent)" }}>
                    <div className="rv-spec-head">
                      <span className="rv-spec-grade">{r.grade}</span>
                      <div>
                        <h3>{sp?.name ?? r.id}</h3>
                        <p>{r.headline}</p>
                      </div>
                    </div>
                    {r.notes.map((n, i) => (
                      <div className="rv-note" key={i}>
                        <blockquote>{n.quote}</blockquote>
                        <p className="rv-issue">{n.issue}</p>
                        <p className="rv-fix">{n.fix}</p>
                      </div>
                    ))}
                    {r.actions.length > 0 && (
                      <div className="rv-spec-actions">
                        <h4>Do this</h4>
                        <ul>{r.actions.map((a) => <li key={a}>{a}</li>)}</ul>
                      </div>
                    )}
                    {r.missing.length > 0 && (
                      <p className="rv-missing">Couldn't judge: {r.missing.join("; ")}</p>
                    )}
                  </section>
                );
              })}

              <section className="rv-actions">
                <h3>Before you submit</h3>
                <ol>{panel.priorities.map((a) => <li key={a}>{a}</li>)}</ol>
              </section>
            </article>
          )}
        </section>
      </div>
    </div>
  );
}
