// Case list — every applicant record this actor is allowed to see.
//
// The scope line under the title is the honest part: api/admin/cases.ts
// decides, from the role it reads out of the database, whether the reply holds
// only this reviewer's current assignments or every case. The page reports
// which of the two it got instead of implying it is showing everything.
//
// Searching is a submit, not a keystroke. Every call to /api/admin/cases
// writes a `list_cases` row to admin_audit, and a debounce-per-keystroke
// search would bury the real accesses under a hundred rows of noise.

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  asApiError,
  CASES_PER_PAGE,
  listCases,
  type AdminApiError,
  type CaseListResult,
} from "./api";
import { clean, fmtDate, orDash } from "./text";
import { EmptyState, ErrorNote, Loading, Pager, Panel } from "./ui";

/** The filters api/admin/cases.ts actually implements. Nothing else is
 *  offered: a control that silently does nothing is worse than no control. */
const FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All cases" },
  { value: "no_profile", label: "No profile saved yet" },
];

export default function CaseList({ go }: { go: (route: string) => void }) {
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);

  const [data, setData] = useState<CaseListResult | null>(null);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [busy, setBusy] = useState(true);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    // One request in flight per set of parameters; the cleanup aborts the
    // previous one, so a slow page 1 can never overwrite a fast page 2.
    const ctl = new AbortController();
    setBusy(true);
    setError(null);

    listCases({ q: query, status, page }, ctl.signal)
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
  }, [query, status, page, reloads]);

  const retry = useCallback(() => setReloads((n) => n + 1), []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setPage(0);
    setQuery(term.trim());
  };

  const scope = data?.scope;
  const scopeNote =
    scope === "assigned" ? (
      <>
        Scope: <b>the cases assigned to you</b>. Reviewers see current assignments only — the server
        decides that from your role, not this page.
      </>
    ) : scope === "all" ? (
      <>
        Scope: <b>every case</b> (administrator access). Sorted by most recently updated.
      </>
    ) : (
      "Loading the scope the server allows you."
    );

  return (
    <Panel
      title="Cases"
      note={
        <>
          {scopeNote} Each search writes a <code>list_cases</code> row to the audit log under your
          name.
        </>
      }
    >
      <form className="ad-toolbar" onSubmit={submit} role="search">
        <label className="ad-lbl" htmlFor="ad-case-q">
          Search name or email
        </label>
        <input
          id="ad-case-q"
          className="ad-input"
          type="search"
          value={term}
          placeholder="e.g. mira@ or Chen"
          maxLength={120}
          onChange={(e) => setTerm(e.target.value)}
        />

        <label className="ad-lbl" htmlFor="ad-case-status">
          Filter
        </label>
        <select
          id="ad-case-status"
          className="ad-select"
          value={status}
          onChange={(e) => {
            setPage(0);
            setStatus(e.target.value);
          }}
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        <button type="submit" className="ad-btn ad-btn-go" disabled={busy}>
          Search
        </button>
        {query && (
          <button
            type="button"
            className="ad-btn"
            onClick={() => {
              setTerm("");
              setQuery("");
              setPage(0);
            }}
          >
            Clear
          </button>
        )}
      </form>

      {busy && <Loading label="Loading cases…" />}
      {error && !busy && <ErrorNote error={error} what="loading the case list" onRetry={retry} />}

      {!busy && !error && data && data.cases.length === 0 && (
        <EmptyState
          title={
            query
              ? `No case matches “${clean(query, 60)}”.`
              : status === "no_profile"
                ? "No cases without a saved profile."
                : scope === "assigned"
                  ? "No cases are assigned to you."
                  : "No applicant records yet."
          }
        >
          {query
            ? "The search matches on email and name only."
            : scope === "assigned"
              ? "An administrator assigns cases in case_assignments; until one is assigned, there is nothing here for you to open."
              : "Records appear once a signed-in applicant saves a profile."}
        </EmptyState>
      )}

      {!busy && !error && data && data.cases.length > 0 && (
        <>
          <div className="ad-tablewrap">
            <table className="ad-table">
              <thead>
                <tr>
                  <th scope="col">Applicant</th>
                  <th scope="col">GPA</th>
                  <th scope="col">Major</th>
                  <th scope="col">Current school</th>
                  <th scope="col">Targets</th>
                  <th scope="col">Updated</th>
                  <th scope="col">
                    <span className="ad-sr">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.cases.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <span className="ad-strong">{orDash(c.name, 60)}</span>
                      <span className="ad-sub">{orDash(c.email, 80)}</span>
                    </td>
                    <td className="num">
                      {typeof c.gpa === "number" ? c.gpa.toFixed(2) : orDash(c.gpa, 10)}
                    </td>
                    <td>{orDash(c.major, 30)}</td>
                    <td>
                      {orDash(c.schoolName, 50)}
                      {c.institution && <span className="ad-sub">{clean(c.institution, 20)}</span>}
                    </td>
                    <td className="num">{Number.isFinite(c.targets) ? c.targets : 0}</td>
                    <td className="num">{fmtDate(c.updatedAt)}</td>
                    <td>
                      <button
                        type="button"
                        className="ad-btn"
                        onClick={() => go(`admin/cases/${encodeURIComponent(c.id)}`)}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pager
            page={page}
            total={data.total}
            perPage={CASES_PER_PAGE}
            busy={busy}
            onPage={setPage}
          />
        </>
      )}
    </Panel>
  );
}
