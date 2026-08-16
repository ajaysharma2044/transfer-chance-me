import { useEffect, useState } from "react";
import { MODEL } from "../engine";
import type { Profile } from "../engine";
import { analyzeEssay } from "../lib/essay";
import { getApiKey, loadLastReview, proxyMode, setApiKey } from "../lib/review";
import { loadPanel, runPanel, SPECIALISTS } from "../lib/panel";
import type { PanelResult } from "../lib/panel";
import type { ReviewResult } from "../lib/review";
import Tile from "./Tile";
import "./review.css";

// Deep application review: paste everything, pick targets, get a graded
// report with quote-level feedback. Runs on the user's own Claude API key,
// straight from the browser to Anthropic — no middleman server.

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
}

export default function Review({ profile, onChange }: Props) {
  const [key, setKeyState] = useState(getApiKey());
  const [keyInput, setKeyInput] = useState("");
  const [docs, setDocs] = useState<Docs>(loadDocs);
  const [targets, setTargets] = useState<string[]>(() =>
    profile.essayNamed.length > 0 ? profile.essayNamed.slice(0, 4) : ["Cornell", "UCLA", "Michigan"],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReviewResult | null>(loadLastReview);
  const [panel, setPanel] = useState<PanelResult | null>(loadPanel);
  const [stage, setStage] = useState<Record<string, "running" | "done" | "failed">>({});

  useEffect(() => {
    localStorage.setItem(DOCS_KEY, JSON.stringify(docs));
  }, [docs]);

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
    if (!profile.essayText.trim() && !docs.statement.trim() && !profile.activitiesText.trim()) {
      setError("Paste at least one thing to review — an essay, statement, or activities list.");
      return;
    }
    if (targets.length === 0) {
      setError("Pick at least one target school.");
      return;
    }
    setBusy(true);
    setStage({});
    setPanel(null);
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
      setResult(null);
    } catch (e) {
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
          prioritized fix list. Your materials go directly from your browser to the AI — never to us.
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
            <div className="rv-targets">
              {MODEL.schools.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="chip rv-target"
                  aria-pressed={targets.includes(s.name)}
                  onClick={() =>
                    setTargets((t) =>
                      t.includes(s.name) ? t.filter((x) => x !== s.name) : t.length < 6 ? [...t, s.name] : t,
                    )
                  }
                >
                  {s.name}
                </button>
              ))}
            </div>
            <p className="rv-hint">Up to 6 per review — verdicts are school-specific, so fewer is deeper.</p>
          </div>

          {error && <p className="rv-error" role="alert">{error}</p>}

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
          {!result && !panel && !busy && (
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
          {result && !panel && !busy && (
            <article className="rv-report">
              <header className="rv-r-head">
                <span className="rv-grade">{result.grade}</span>
                <div>
                  <h2>The honest read</h2>
                  <p>{result.summary}</p>
                </div>
              </header>

              <div className="rv-cols">
                <div>
                  <h3>Working for you</h3>
                  <ul>{result.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
                </div>
                <div>
                  <h3 className="rv-risk">Working against you</h3>
                  <ul>{result.risks.map((s) => <li key={s}>{s}</li>)}</ul>
                </div>
              </div>

              {result.essay && (
                <section>
                  <h3>"Why transfer" essay · {result.essay.grade}</h3>
                  <p className="rv-direction">{result.essay.direction}</p>
                  {result.essay.notes.map((n, i) => (
                    <div className="rv-note" key={i}>
                      <blockquote>"{n.quote}"</blockquote>
                      <p className="rv-issue">{n.issue}</p>
                      <p className="rv-fix">{n.fix}</p>
                    </div>
                  ))}
                </section>
              )}

              {result.statement && (
                <section>
                  <h3>Personal statement · {result.statement.grade}</h3>
                  {result.statement.notes.map((n, i) => (
                    <div className="rv-note" key={i}>
                      <blockquote>"{n.quote}"</blockquote>
                      <p className="rv-issue">{n.issue}</p>
                      <p className="rv-fix">{n.fix}</p>
                    </div>
                  ))}
                </section>
              )}

              {result.activities && (
                <section>
                  <h3>Activities · {result.activities.grade}</h3>
                  {result.activities.notes.map((n, i) => (
                    <div className="rv-note" key={i}>
                      <blockquote>"{n.quote}"</blockquote>
                      <p className="rv-issue">{n.issue}</p>
                      <p className="rv-fix">{n.fix}</p>
                    </div>
                  ))}
                  {result.activities.reframes.length > 0 && (
                    <>
                      <h4>Rewritten descriptions you can use</h4>
                      <ul className="rv-reframes">
                        {result.activities.reframes.map((r) => <li key={r}>{r}</li>)}
                      </ul>
                    </>
                  )}
                </section>
              )}

              <section>
                <h3>School by school</h3>
                {result.perSchool.map((v) => (
                  <div className="rv-school" key={v.school}>
                    <div className="rv-school-h"><Tile name={v.school} size={24} /> <b>{v.school}</b></div>
                    <p>{v.verdict}</p>
                    <ul>{v.moves.map((m) => <li key={m}>{m}</li>)}</ul>
                  </div>
                ))}
              </section>

              <section className="rv-actions">
                <h3>Do these before you submit</h3>
                <ol>{result.actions.map((a) => <li key={a}>{a}</li>)}</ol>
              </section>

              <footer className="rv-r-foot">
                <button type="button" className="btn btn-sm" onClick={() => window.print()}>Download this report</button>
                <span>Generated {new Date(result.generatedAt).toLocaleString()} · AI feedback grounded in the dataset — a tool, not an admissions decision.</span>
              </footer>
            </article>
          )}
        </section>
      </div>
    </div>
  );
}
