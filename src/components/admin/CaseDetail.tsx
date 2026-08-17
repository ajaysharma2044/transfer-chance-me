// One applicant's case.
//
// Three things about this page are load-bearing:
//
//   · Opening a document goes through POST /api/admin/document and nowhere
//     else. That handler authorizes, writes the audit row, and only then mints
//     a signed URL that dies in two minutes. This page therefore treats the
//     button press itself as the access — the row is written whether or not
//     the operator goes on to click the link — and it never receives or
//     renders the permanent storage path, only the expiring URL.
//   · The essay, activities and awards text is NOT here, and this page does
//     not pretend otherwise. api/admin/case.ts strips those three fields out
//     of the profile blob and returns character counts instead, because they
//     are the same material as an upload: the case view says how much is
//     there, the document route hands over the words, one audited request at
//     a time. The panel below shows the counts and says where the text lives.
//   · The profile blob is arbitrary JSON that an applicant typed. It is
//     rendered field by field, as text, through clean()/block(); unrecognised
//     keys are listed rather than dropped, so a new field cannot go unseen,
//     and none of it is ever passed to dangerouslySetInnerHTML.

import { useCallback, useEffect, useState } from "react";
import {
  asApiError,
  getCase,
  openDocument,
  rememberedCase,
  type AdminApiError,
  type CaseDocument,
  type CaseResponse,
  type OpenedDocument,
} from "./api";
import { block, clean, fmtBytes, fmtTime, hostOf, isHttpsUrl, orDash, shortId } from "./text";
import { EmptyState, ErrorNote, Loading, Panel, Row } from "./ui";
import InternalNotes from "./InternalNotes";

/* ── How the engine's Profile is displayed ─────────────────────────────────
 * Keys come from src/engine.ts. Anything not listed here still appears, under
 * "Other fields", so the viewer never quietly hides part of someone's file. */

const SCALARS: { key: string; label: string }[] = [
  { key: "gpa", label: "GPA" },
  { key: "schoolName", label: "Current school" },
  { key: "institution", label: "Institution type" },
  { key: "standing", label: "Entering as" },
  { key: "major", label: "Intended major" },
  { key: "sat", label: "SAT" },
  { key: "gpaTrend", label: "GPA trend" },
  { key: "caResident", label: "California resident" },
  { key: "igetc", label: "IGETC complete" },
  { key: "ptk", label: "Phi Theta Kappa" },
  { key: "honors", label: "Honors programme" },
  { key: "firstGen", label: "First generation" },
  { key: "workHours", label: "Work hours / week" },
  { key: "hook", label: "Background" },
  { key: "ecLevel", label: "Activity level" },
  { key: "essay", label: "Essay stage" },
  { key: "essayVerdict", label: "Essay verdict (auto)" },
];

const LISTS: { key: string; label: string }[] = [
  { key: "courses", label: "Courses read" },
  { key: "docs", label: "Uploaded files" },
  { key: "essayNamed", label: "Schools named in the essay" },
];

/** Short free text the server does leave in the profile blob. */
const SHORT_TEXT: { key: string; label: string }[] = [
  { key: "transferReason", label: "Why transfer" },
  { key: "majorDetail", label: "Major detail" },
];

/** Withheld by api/admin/case.ts; only their lengths come back. */
const WITHHELD: { key: string; label: string }[] = [
  { key: "essayText", label: "Essay" },
  { key: "activitiesText", label: "Activities" },
  { key: "awardsText", label: "Awards" },
];

const KNOWN = new Set([...SCALARS, ...LISTS, ...SHORT_TEXT].map((f) => f.key));

/** One profile value as display text. Objects are stringified and then
 *  cleaned, so even an unexpected shape renders as inert text. */
function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "—";
  if (Array.isArray(v)) {
    return v.length === 0 ? "—" : v.map((x) => clean(x, 60)).join(", ");
  }
  if (typeof v === "object") return clean(JSON.stringify(v), 300);
  return orDash(v, 300);
}

export default function CaseDetail({ id, go }: { id: string; go: (route: string) => void }) {
  const [data, setData] = useState<CaseResponse | null>(null);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [busy, setBusy] = useState(true);
  const [reloads, setReloads] = useState(0);
  /** Recorded in the audit row for every document opened from this page. */
  const [reason, setReason] = useState("");

  useEffect(() => {
    const ctl = new AbortController();
    setBusy(true);
    setError(null);
    getCase(id, ctl.signal)
      .then((res) => {
        if (ctl.signal.aborted) return;
        setData(res);
        setBusy(false);
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        setError(asApiError(e));
        setData(null);
        setBusy(false);
      });
    return () => ctl.abort();
  }, [id, reloads]);

  const retry = useCallback(() => setReloads((n) => n + 1), []);

  // What the case list already told us about this applicant. It arrived
  // through the same audited route, so showing it is not a back door — it is
  // simply the last honest thing we know when the detail request fails.
  const summary = rememberedCase(id);

  const record = data?.case ?? null;
  const name = clean(record?.name ?? summary?.name, 80);
  const email = clean(record?.email ?? summary?.email, 120);
  const profile = record?.profile ?? null;

  return (
    <div className="ad-case">
      <div className="ad-crumbs">
        <button type="button" className="ad-link" onClick={() => go("admin")}>
          ← All cases
        </button>
        <button
          type="button"
          className="ad-link"
          onClick={() => go(`admin/audit/${encodeURIComponent(id)}`)}
        >
          Audit trail for this case →
        </button>
      </div>

      <header className="ad-casehead">
        <div>
          <h1>{name || "Applicant"}</h1>
          <p className="ad-casesub">
            {email || "no email on the record"} · case <code className="ad-mono">{shortId(id)}</code>
            {record?.updatedAt ? ` · updated ${fmtTime(record.updatedAt)}` : ""}
          </p>
        </div>
        {data?.viewerRole && (
          <span className="ad-tag">
            {data.viewerRole === "reviewer" ? "assigned to you" : `${data.viewerRole} access`}
          </span>
        )}
      </header>

      {busy && <Loading label="Loading this case…" />}

      {error && !busy && (
        <>
          <ErrorNote error={error} what="loading the case record" onRetry={retry} />
          {summary ? (
            <Panel
              title="What the case list returned"
              note="The detail request failed, so this is the summary row from /api/admin/cases — no documents, consents or assignments were fetched."
            >
              <dl className="ad-kv">
                <Row label="Name" value={orDash(summary.name, 80)} />
                <Row label="Email" value={orDash(summary.email, 120)} />
                <Row
                  label="GPA"
                  value={typeof summary.gpa === "number" ? summary.gpa.toFixed(2) : orDash(summary.gpa, 10)}
                />
                <Row label="Major" value={orDash(summary.major, 40)} />
                <Row label="Current school" value={orDash(summary.schoolName, 60)} />
                <Row label="Institution" value={orDash(summary.institution, 30)} />
                <Row label="Target schools" value={String(summary.targets ?? 0)} />
                <Row label="Updated" value={fmtTime(summary.updatedAt)} />
              </dl>
            </Panel>
          ) : (
            <EmptyState title="Nothing to show for this case.">
              The detail request failed and this case was not in the last list you loaded, so there
              is no earlier copy to fall back to.
            </EmptyState>
          )}
        </>
      )}

      {!busy && !error && data && record && (
        <>
          <Panel
            title="Applicant profile"
            note="Exactly what the applicant saved. Nothing here is inferred or filled in."
          >
            {!profile || Object.keys(profile).length === 0 ? (
              <EmptyState title="This account has no saved profile.">
                They created an account but have not completed the intake, so there are no figures
                to show.
              </EmptyState>
            ) : (
              <>
                <dl className="ad-kv">
                  {SCALARS.map((f) => (
                    <Row
                      key={f.key}
                      label={f.label}
                      value={
                        f.key === "gpa" && typeof profile.gpa === "number"
                          ? profile.gpa.toFixed(2)
                          : show(profile[f.key])
                      }
                    />
                  ))}
                </dl>

                <div className="ad-sublists">
                  {LISTS.map((f) => (
                    <div key={f.key}>
                      <p className="ad-lbl">{f.label}</p>
                      <p className="ad-body">{show(profile[f.key])}</p>
                    </div>
                  ))}
                </div>

                {SHORT_TEXT.filter((f) => typeof profile[f.key] === "string" && profile[f.key] !== "").map(
                  (f) => (
                    <article key={f.key} className="ad-textblock">
                      <p className="ad-lbl">{f.label}</p>
                      <p className="ad-prose">{block(profile[f.key], 4000)}</p>
                    </article>
                  ),
                )}

                {Object.keys(profile).filter((k) => !KNOWN.has(k)).length > 0 && (
                  <details className="ad-details">
                    <summary>Other fields on this record</summary>
                    <dl className="ad-kv">
                      {Object.keys(profile)
                        .filter((k) => !KNOWN.has(k))
                        .map((k) => (
                          <Row key={k} label={clean(k, 40)} value={show(profile[k])} />
                        ))}
                    </dl>
                  </details>
                )}
              </>
            )}
          </Panel>

          <Panel
            title="Essays and activities"
            note="The server withholds this text from the case view on purpose: it is the same material as an upload, so it comes through the document route one audited request at a time."
          >
            {WITHHELD.every((f) => (record.written?.[f.key] ?? 0) === 0) ? (
              <EmptyState title="No essay, activities or awards text on this profile.">
                All three fields are empty, so there is nothing withheld and nothing to open. Any
                uploaded file still appears in the document list below.
              </EmptyState>
            ) : (
              <ul className="ad-written">
                {WITHHELD.map((f) => {
                  const n = record.written?.[f.key] ?? 0;
                  return (
                    <li key={f.key}>
                      <b>{f.label}</b>
                      <span className="num">
                        {n === 0 ? "empty" : `${n.toLocaleString()} characters`}
                      </span>
                      <span className="ad-sub">
                        {n === 0 ? "nothing written" : "text not included here — open it as a document"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel
            title="Documents"
            note="Opening any of these writes an audit row before the file is unlocked, and the link it returns expires in about two minutes."
          >
            <div className="ad-reason">
              <label className="ad-lbl" htmlFor="ad-doc-reason">
                Reason for opening (recorded in the audit log)
              </label>
              <input
                id="ad-doc-reason"
                className="ad-input"
                type="text"
                value={reason}
                maxLength={300}
                placeholder="e.g. verifying GPA against the transcript for case review"
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

            {data.documents.length === 0 ? (
              <EmptyState title="No documents on this case.">
                This applicant has uploaded no file and pasted nothing that was stored as a
                document.
              </EmptyState>
            ) : (
              <ul className="ad-docs">
                {data.documents.map((d) => (
                  <DocumentItem key={d.id} doc={d} reason={reason} />
                ))}
              </ul>
            )}
          </Panel>

          {Object.keys(record.schools ?? {}).length > 0 && (
            <Panel title="Target schools" note="The applicant's own tracker: their statuses, their notes.">
              <div className="ad-tablewrap">
                <table className="ad-table">
                  <thead>
                    <tr>
                      <th scope="col">School</th>
                      <th scope="col">Status</th>
                      <th scope="col">Their note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(record.schools).map(([school, v]) => (
                      <tr key={school}>
                        <td>{clean(school, 80)}</td>
                        <td>{orDash(v?.status, 30)}</td>
                        <td>{orDash(v?.notes, 300)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          <Panel
            title="Consent"
            note="What this person has agreed to, per purpose. Holding a file to deliver the service they asked for is not permission to train on it or to market to them."
          >
            <ul className="ad-consents">
              {data.consents.map((c) => (
                <li key={c.purpose}>
                  <span className={c.granted ? "ad-yes" : c.answered ? "ad-no" : "ad-unknown"}>
                    {c.granted ? "granted" : c.answered ? "refused" : "never asked"}
                  </span>
                  <b>{clean(c.purpose, 40)}</b>
                  <span className="ad-sub num">
                    {c.answered ? fmtTime(c.recordedAt) : "no record — treat as not granted"}
                  </span>
                </li>
              ))}
            </ul>
            <p className="ad-hint">
              Staff cannot write a consent record: the only insert policy is the person's own. An
              administrator who wants a different answer has to go and ask for it.
            </p>
          </Panel>

          <Panel
            title="Who can see this case"
            note="Live rows in case_assignments. A release is a timestamp rather than a delete, so past access stays answerable."
          >
            {data.reviewers.length === 0 ? (
              <EmptyState title="No reviewer is assigned.">
                Only administrators and owners can open this case at the moment. Assignment is an
                administrator action (POST /api/admin/assign) and is not offered from this screen.
              </EmptyState>
            ) : (
              <ul className="ad-consents">
                {data.reviewers.map((r) => (
                  <li key={r.reviewerId}>
                    <b>{orDash(r.email ?? r.name ?? r.reviewerId, 80)}</b>
                    <span className="ad-sub num">
                      assigned {fmtTime(r.assignedAt)}
                      {r.assignedByEmail ? ` by ${clean(r.assignedByEmail, 60)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {data.viewerRole !== "reviewer" && (
            <Panel
              title="Recent access to this case"
              note="The last few audit rows naming this applicant. Reviewers are not shown this — a readable log doubles as a way to enumerate accounts."
              actions={
                <button
                  type="button"
                  className="ad-btn"
                  onClick={() => go(`admin/audit/${encodeURIComponent(id)}`)}
                >
                  Full trail
                </button>
              }
            >
              {data.history.length === 0 ? (
                <EmptyState title="Nobody has touched this case yet.">
                  Loading this page has just written the first row; it will appear on the next
                  load.
                </EmptyState>
              ) : (
                <ul className="ad-consents">
                  {data.history.map((h, i) => (
                    <li key={`${h.at}-${i}`}>
                      <code className="ad-mono">{clean(h.action, 40)}</code>
                      <b>{orDash(h.actorEmail ?? h.actorId, 70)}</b>
                      {!h.success && <span className="ad-fail">refused</span>}
                      <span className="ad-sub num">{fmtTime(h.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </>
      )}

      <InternalNotes subjectId={id} />
    </div>
  );
}

/* ── One document, and its two-minute window ──────────────────────────────── */

function DocumentItem({ doc, reason }: { doc: CaseDocument; reason: string }) {
  const [opened, setOpened] = useState<OpenedDocument | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminApiError | null>(null);

  // The countdown is not decoration: when it reaches zero the URL is dropped
  // from state, so the page cannot keep offering a link the storage layer has
  // already stopped honouring. Re-opening means another audit row, which is
  // the correct cost.
  useEffect(() => {
    if (expiresAt === null) return;
    const tick = () => {
      const secs = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setLeft(secs);
      if (secs === 0) {
        setExpiresAt(null);
        setOpened((o) => (o ? { ...o, url: null } : o));
      }
    };
    tick();
    const t = window.setInterval(tick, 500);
    return () => window.clearInterval(t);
  }, [expiresAt]);

  const open = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    openDocument(doc.id, reason.trim())
      .then((res) => {
        setOpened(res);
        setExpiresAt(res.url && res.expiresIn ? Date.now() + res.expiresIn * 1000 : null);
        setBusy(false);
      })
      .catch((e: unknown) => {
        setError(asApiError(e));
        setOpened(null);
        setExpiresAt(null);
        setBusy(false);
      });
  };

  const size = fmtBytes(doc.bytes);
  const url = opened?.url;

  return (
    <li className="ad-doc">
      <div className="ad-doc-head">
        <span className="ad-tag">{clean(doc.kind, 20) || "document"}</span>
        <span className="ad-strong">{orDash(doc.name, 90)}</span>
        <span className="ad-sub num">
          {fmtTime(doc.createdAt)}
          {size ? ` · ${size}` : ""}
          {doc.mime ? ` · ${clean(doc.mime, 40)}` : ""}
          {doc.stored ? " · stored file" : " · text record"}
        </span>
        <button type="button" className="ad-btn ad-btn-go" onClick={open} disabled={busy}>
          {busy ? "Authorizing…" : opened ? "Open again" : "Open document"}
        </button>
      </div>

      {error && <ErrorNote error={error} what={`opening ${orDash(doc.name, 60)}`} />}

      {opened && (
        <div className="ad-doc-body">
          {/* A stored file. The href is the expiring signed URL and is checked
              to be https before it is put in an anchor; the permanent storage
              path is never sent to this page at all. It opens in a new tab
              rather than inline because the page's CSP allows connections to
              our own origin only — and because a transcript should not be
              rendered into the DOM by accident. */}
          {isHttpsUrl(url) && left > 0 && (
            <p className="ad-doc-link">
              <a className="ad-btn ad-btn-go" href={url} target="_blank" rel="noopener noreferrer">
                Open file in a new tab ↗
              </a>
              <span className="ad-countdown num" aria-live="polite">
                link expires in {left}s
              </span>
              <span className="ad-sub">via {hostOf(url)}</span>
            </p>
          )}

          {doc.stored && !url && (
            <p className="ad-body ad-expired">
              The signed link has expired. Opening it again mints a new one and writes a new audit
              row.
            </p>
          )}

          {typeof opened.content === "string" && opened.content !== "" && (
            <>
              <p className="ad-lbl">Stored text</p>
              <p className="ad-prose">{block(opened.content, 20000)}</p>
            </>
          )}

          {!doc.stored && !opened.content && (
            <p className="ad-body">This record holds neither a file nor any extracted text.</p>
          )}
        </div>
      )}
    </li>
  );
}
