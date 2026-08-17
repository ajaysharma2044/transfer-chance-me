// The audit log, and the alerts computed from it.
//
// admin_audit is append-only by construction — supabase/admin.sql gives it an
// insert policy and a select policy, no update or delete policy at all, plus
// triggers that raise on both. So this is a viewer. There is no edit control
// here and there cannot be one.
//
// Reading it is administrator-and-above (the "admins read audit" policy, and
// again in api/admin/audit.ts). A reviewer is refused even for their own
// entries, because a readable log doubles as a way to enumerate accounts.
//
// Reading it is itself audited, before the query runs: every search writes a
// read_audit_log row, and loading the alerts writes read_alerts. That is why
// the filters submit on a button rather than on every keystroke — a
// debounce-per-character search would bury the real accesses in noise.
//
// Denials matter as much as accesses: requireStaff() writes a row when it
// turns someone away, so a run of refusals from one actor is the signal this
// table exists to surface. Refused rows are marked, never hidden.

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ADMIN_ACTIONS,
  asApiError,
  listAlerts,
  listAudit,
  type AdminApiError,
  type AlertsResult,
  type AuditQuery,
  type AuditResult,
} from "./api";
import { clean, fmtTime, isUuid, orDash, shortId } from "./text";
import { EmptyState, ErrorNote, Loading, Pager, Panel } from "./ui";

const PER_PAGE = 50;

export default function AuditLog({
  subject,
  go,
}: {
  /** Optional applicant id, when the page was reached from a case. */
  subject?: string;
  go: (route: string) => void;
}) {
  // Draft filter values, and the ones actually submitted. Only the second set
  // reaches the server, so an unfinished date cannot fire a logged query.
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [onlyFailures, setOnlyFailures] = useState(false);
  const [applied, setApplied] = useState<AuditQuery>({});
  const [page, setPage] = useState(0);

  const [data, setData] = useState<AuditResult | null>(null);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [busy, setBusy] = useState(true);
  const [reloads, setReloads] = useState(0);

  // A different subject is a different question, so go back to page one.
  // Adjusted during render rather than in an effect on purpose: an effect
  // would let the fetch below fire once with the old page number first, and
  // every audit query writes a read_audit_log row. React re-renders on this
  // without committing, so the discarded request never happens.
  const [lastSubject, setLastSubject] = useState(subject);
  if (lastSubject !== subject) {
    setLastSubject(subject);
    setPage(0);
  }

  useEffect(() => {
    const ctl = new AbortController();
    setBusy(true);
    setError(null);
    listAudit({ ...applied, subject, page, limit: PER_PAGE }, ctl.signal)
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
  }, [applied, subject, page, reloads]);

  const retry = useCallback(() => setReloads((n) => n + 1), []);

  const actorOk = actor.trim() === "" || isUuid(actor);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!actorOk) return;
    setPage(0);
    setApplied({
      action: action || undefined,
      actor: actor.trim() || undefined,
      from: from || undefined,
      // A date-only "to" parses as midnight, which would silently drop
      // everything that happened on the day the operator asked for.
      to: to ? `${to}T23:59:59.999` : undefined,
      onlyFailures: onlyFailures || undefined,
    });
  };

  const clearAll = () => {
    setAction("");
    setActor("");
    setFrom("");
    setTo("");
    setOnlyFailures(false);
    setApplied({});
    setPage(0);
  };

  const filtered =
    !!applied.action || !!applied.actor || !!applied.from || !!applied.to || !!applied.onlyFailures;

  return (
    <>
      <Alerts />

      <Panel
        title="Audit log"
        note={
          subject ? (
            <>
              Filtered to one applicant (<code className="ad-mono">{shortId(subject)}</code>).
              Append-only: entries cannot be edited or deleted from this application, and this
              search has just written a row of its own.
            </>
          ) : (
            <>
              Every staff decision, allowed and refused alike. Append-only: entries cannot be edited
              or deleted from this application, and this search has just written a row of its own.
            </>
          )
        }
        actions={
          subject ? (
            <button type="button" className="ad-btn" onClick={() => go("admin/audit")}>
              Clear applicant filter
            </button>
          ) : undefined
        }
      >
        <form className="ad-toolbar" onSubmit={submit}>
          <label className="ad-lbl" htmlFor="ad-audit-action">
            Action
          </label>
          <select
            id="ad-audit-action"
            className="ad-select"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          >
            <option value="">Any action</option>
            {ADMIN_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>

          <label className="ad-lbl" htmlFor="ad-audit-actor">
            Actor id
          </label>
          <input
            id="ad-audit-actor"
            className="ad-input ad-mono"
            type="text"
            value={actor}
            maxLength={64}
            placeholder="staff account UUID"
            onChange={(e) => setActor(e.target.value)}
          />

          <label className="ad-lbl" htmlFor="ad-audit-from">
            From
          </label>
          <input
            id="ad-audit-from"
            className="ad-select"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />

          <label className="ad-lbl" htmlFor="ad-audit-to">
            To
          </label>
          <input
            id="ad-audit-to"
            className="ad-select"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />

          <label className="ad-check">
            <input
              type="checkbox"
              checked={onlyFailures}
              onChange={(e) => setOnlyFailures(e.target.checked)}
            />
            Refusals only
          </label>

          <button type="submit" className="ad-btn ad-btn-go" disabled={busy || !actorOk}>
            Search
          </button>
          {filtered && (
            <button type="button" className="ad-btn" onClick={clearAll}>
              Clear
            </button>
          )}
        </form>

        {!actorOk && (
          <p className="ad-hint ad-hint-warn">
            The actor filter takes an account UUID, not an email address — the route matches on id
            and refuses anything else with a 400.
          </p>
        )}

        {busy && <Loading label="Loading audit entries…" />}
        {error && !busy && <ErrorNote error={error} what="loading the audit log" onRetry={retry} />}

        {!busy && !error && data && data.entries.length === 0 && (
          <EmptyState
            title={
              filtered
                ? "No audit entry matches these filters."
                : subject
                  ? "No staff member has touched this case."
                  : "The audit log is empty."
            }
          >
            {filtered
              ? "Filters combine with AND, and the action name has to match exactly."
              : subject
                ? "Nobody has opened this applicant's record or documents, so nothing is recorded against it."
                : "No admin request has been served yet. Rows appear the first time somebody lists cases or opens a document."}
          </EmptyState>
        )}

        {!busy && !error && data && data.entries.length > 0 && (
          <>
            <div className="ad-tablewrap">
              <table className="ad-table ad-table-audit">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Action</th>
                    <th scope="col">Subject</th>
                    <th scope="col">Reason</th>
                    <th scope="col">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((row) => (
                    <tr key={String(row.id)} className={row.success ? undefined : "ad-tr-fail"}>
                      <td className="num">{fmtTime(row.at)}</td>
                      <td>
                        <span className="ad-strong">{orDash(row.actorEmail ?? row.actorId, 60)}</span>
                        {row.actorRole && <span className="ad-sub">{clean(row.actorRole, 20)}</span>}
                      </td>
                      <td>
                        <code className="ad-mono">{clean(row.action, 40)}</code>
                        {!row.success && <span className="ad-fail">refused</span>}
                        {row.meta && typeof row.meta.reason === "string" && (
                          <span className="ad-sub">{clean(row.meta.reason, 40)}</span>
                        )}
                      </td>
                      <td>
                        {row.subjectId ? (
                          <button
                            type="button"
                            className="ad-link"
                            onClick={() =>
                              go(`admin/cases/${encodeURIComponent(row.subjectId as string)}`)
                            }
                          >
                            {orDash(row.subjectEmail ?? shortId(row.subjectId), 60)}
                          </button>
                        ) : (
                          "—"
                        )}
                        {row.documentId && <span className="ad-sub">doc {shortId(row.documentId)}</span>}
                      </td>
                      <td>{orDash(row.reason, 160)}</td>
                      <td className="num">{orDash(row.ip, 45)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pager
              page={data.page ?? page}
              total={data.total}
              perPage={data.limit ?? PER_PAGE}
              busy={busy}
              onPage={setPage}
            />
          </>
        )}
      </Panel>
    </>
  );
}

/* ── Alerts ────────────────────────────────────────────────────────────────
 * Computed by the admin_alerts view from the log itself, so an administrator
 * cannot stay out of it by not sending an event. Loaded once with the page;
 * the request writes a read_alerts row, which is why there is no auto-refresh
 * on a timer here. */

function Alerts() {
  const [data, setData] = useState<AlertsResult | null>(null);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    const ctl = new AbortController();
    listAlerts(ctl.signal)
      .then((res) => {
        if (ctl.signal.aborted) return;
        setData(res);
        setBusy(false);
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        setError(asApiError(e));
        setBusy(false);
      });
    return () => ctl.abort();
  }, []);

  if (busy) return null;

  // Secondary information: a failure here is stated in one line rather than
  // in a red box that competes with the log itself.
  if (error) {
    return (
      <p className="ad-hint ad-hint-warn">
        Alerts unavailable — {error.message}
      </p>
    );
  }

  if (!data || data.alerts.length === 0) {
    return (
      <p className="ad-hint">
        No alerts. The admin_alerts view fires on 25+ distinct students in an hour, 5+ refusals in
        fifteen minutes, or 20+ downloads or exports in an hour — computed at read time, so this is
        a snapshot rather than a monitor.
      </p>
    );
  }

  return (
    <section className="ad-panel ad-panel-alert">
      <div className="ad-panel-head">
        <div>
          <h2>
            Alerts <span className="ad-tag ad-tag-internal">{data.alerts.length}</span>
          </h2>
          <p className="ad-panel-note">
            Computed from the log by the admin_alerts view, not reported by any client. Nothing
            schedules or emails these; they are only true as of this page load.
          </p>
        </div>
      </div>
      <ul className="ad-alerts">
        {data.alerts.map((a, i) => (
          <li key={`${a.actorId}-${a.kind}-${i}`}>
            <span className="ad-tag ad-tag-internal">{clean(a.kind, 30)}</span>
            <b>{orDash(a.actorEmail ?? a.actorName ?? a.actorId, 70)}</b>
            {a.aboutViewer && <span className="ad-fail">that is you</span>}
            <span className="ad-alert-why">{clean(a.explanation, 160)}</span>
            <span className="ad-sub num">
              {a.value} · last seen {fmtTime(a.lastSeen)}
            </span>
          </li>
        ))}
      </ul>
      {data.truncated && (
        <p className="ad-hint">More alerts exist than were returned; this list is capped.</p>
      )}
    </section>
  );
}
