// Role management — owner only.
//
// This is the screen that decides who can read other people's transcripts, so
// it is deliberately slow to use: every change states in words what it is
// about to do, and refuses to submit without a reason, which is written into
// the audit row next to the change.
//
// What this UI does NOT do is enforce any of it. api/admin/role.ts is the
// authority and it is stricter than this form:
//
//   · owner role required, read from the database, not from the token;
//   · the session must have authenticated recently (sensitive: true), so an
//     unattended laptop cannot be used to escalate — expect "Confirm your
//     password again to continue." and treat it as normal, not as a bug;
//   · nobody may change their own role in either direction;
//   · the last remaining owner cannot be revoked;
//   · a revoke also signs the account out everywhere, so it takes effect on
//     the next request rather than the next token refresh.
//
// Each of those returns a plain-English message, and this page prints it as
// written rather than replacing it with something vaguer.

import { useCallback, useEffect, useState } from "react";
import {
  asApiError,
  changeRole,
  isMissingRoute,
  listStaff,
  STAFF_ROLES,
  type AdminApiError,
  type StaffRole,
  type StaffRow,
} from "./api";
import { clean, fmtTime, isUuid, orDash, shortId } from "./text";
import { EmptyState, ErrorNote, Loading, Panel } from "./ui";

/** Long enough that "asdf" does not pass, short enough not to be theatre. */
const MIN_REASON = 8;

interface Pending {
  kind: "grant" | "revoke";
  userId: string;
  email: string | null;
  role?: StaffRole;
  /** The role they hold now, when we know it. */
  current?: StaffRole | null;
}

export default function RoleManager({ selfUserId }: { selfUserId: string }) {
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [listError, setListError] = useState<AdminApiError | null>(null);
  const [busy, setBusy] = useState(true);
  const [reloads, setReloads] = useState(0);

  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<StaffRole>("reviewer");

  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<AdminApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    setBusy(true);
    setListError(null);
    listStaff(ctl.signal)
      .then((res) => {
        if (ctl.signal.aborted) return;
        setStaff(res.staff ?? []);
        setBusy(false);
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        setListError(asApiError(e));
        setStaff(null);
        setBusy(false);
      });
    return () => ctl.abort();
  }, [reloads]);

  const refresh = useCallback(() => setReloads((n) => n + 1), []);

  const start = (p: Pending) => {
    setPending(p);
    setReason("");
    setSaveError(null);
    setDone(null);
  };

  const confirm = () => {
    if (!pending || saving) return;
    const why = reason.trim();
    if (why.length < MIN_REASON) return;

    setSaving(true);
    setSaveError(null);
    changeRole({
      userId: pending.userId,
      role: pending.kind === "grant" ? pending.role : undefined,
      revoke: pending.kind === "revoke",
      reason: why,
    })
      .then(() => {
        setDone(
          pending.kind === "grant"
            ? `Granted ${pending.role} to ${clean(pending.email ?? pending.userId, 80)}.`
            : `Revoked staff access for ${clean(pending.email ?? pending.userId, 80)}. Their sessions were signed out.`,
        );
        setPending(null);
        setReason("");
        setUserId("");
        setSaving(false);
        refresh();
      })
      .catch((e: unknown) => {
        setSaveError(asApiError(e));
        setSaving(false);
      });
  };

  const idOk = isUuid(userId);
  const active = (staff ?? []).filter((s) => !s.revokedAt);
  const revoked = (staff ?? []).filter((s) => s.revokedAt);

  return (
    <>
      <Panel
        title="Grant a staff role"
        note="Owner only. The server checks that again, demands a recently authenticated session, and refuses to let you change your own role."
      >
        <div className="ad-grant">
          <div className="ad-grant-field">
            <label className="ad-lbl" htmlFor="ad-role-user">
              Account id (UUID)
            </label>
            <input
              id="ad-role-user"
              className="ad-input ad-mono"
              type="text"
              value={userId}
              maxLength={64}
              placeholder="00000000-0000-0000-0000-000000000000"
              onChange={(e) => setUserId(e.target.value)}
            />
            <p className="ad-hint">
              There is no user-search route, so this takes the account's Supabase user id — the same
              id that appears in a case URL or in the audit log.
            </p>
          </div>

          <div className="ad-grant-field">
            <label className="ad-lbl" htmlFor="ad-role-role">
              Role
            </label>
            <select
              id="ad-role-role"
              className="ad-select"
              value={role}
              onChange={(e) => setRole(e.target.value as StaffRole)}
            >
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <p className="ad-hint">
              reviewer: assigned cases only · administrator: every case and the audit log · owner:
              also grants and revokes roles.
            </p>
          </div>

          <button
            type="button"
            className="ad-btn ad-btn-go"
            disabled={!idOk}
            onClick={() =>
              start({
                kind: "grant",
                userId: userId.trim(),
                email: null,
                role,
                current: active.find((s) => s.userId === userId.trim())?.role ?? null,
              })
            }
          >
            Review this change
          </button>
        </div>

        {userId.trim() !== "" && !idOk && (
          <p className="ad-hint ad-hint-warn">
            That is not a UUID. Copy the account id rather than the email address.
          </p>
        )}
        {idOk && userId.trim() === selfUserId && (
          <p className="ad-hint ad-hint-warn">
            That is your own account. The server refuses self-modification in either direction —
            ask another owner.
          </p>
        )}

        {done && <p className="ad-done">{done}</p>}
      </Panel>

      {pending && (
        <section className="ad-panel ad-confirm" role="alertdialog" aria-label="Confirm role change">
          <h2>Confirm this change</h2>
          <p className="ad-confirm-what">
            {pending.kind === "grant" ? (
              <>
                Give <code className="ad-mono">{shortId(pending.userId)}</code>
                {pending.email ? ` (${clean(pending.email, 80)})` : ""} the role{" "}
                <b>{pending.role}</b>
                {pending.current ? ` — they currently hold ${pending.current}.` : "."}
              </>
            ) : (
              <>
                Revoke staff access for <code className="ad-mono">{shortId(pending.userId)}</code>
                {pending.email ? ` (${clean(pending.email, 80)})` : ""}
                {pending.current ? `, currently ${pending.current}` : ""}. Their sessions are signed
                out immediately and their next request is refused.
              </>
            )}
          </p>

          <label className="ad-lbl" htmlFor="ad-role-reason">
            Reason (required — written into the audit log)
          </label>
          <textarea
            id="ad-role-reason"
            className="ad-textarea"
            rows={2}
            maxLength={300}
            value={reason}
            placeholder="e.g. joining the review team for the spring cycle, approved by K.R."
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="ad-hint">
            {reason.trim().length < MIN_REASON
              ? `At least ${MIN_REASON} characters. This is the record of why someone gained or lost access to student files.`
              : "This text is stored on the audit row for this change."}
          </p>

          {saveError && <ErrorNote error={saveError} what="applying the role change" />}

          <div className="ad-confirm-acts">
            <button
              type="button"
              className="ad-btn"
              onClick={() => {
                setPending(null);
                setSaveError(null);
              }}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className={pending.kind === "revoke" ? "ad-btn ad-btn-danger" : "ad-btn ad-btn-go"}
              disabled={saving || reason.trim().length < MIN_REASON}
              onClick={confirm}
            >
              {saving
                ? "Applying…"
                : pending.kind === "grant"
                  ? `Grant ${pending.role}`
                  : "Revoke access"}
            </button>
          </div>
        </section>
      )}

      <Panel
        title="Staff"
        note="Read from staff_roles. A revoked row is kept rather than deleted, so the grant stays in the record."
        actions={
          <button type="button" className="ad-btn" onClick={refresh} disabled={busy}>
            Refresh
          </button>
        }
      >
        {busy && <Loading label="Loading staff…" />}

        {/* There is no GET /api/admin/staff handler in api/admin/. That is a
            missing feature rather than a failure, so it is stated as one; a red
            error box here would read as "something broke". The request is still
            made, so the roster appears by itself the day the route lands. */}
        {listError && !busy && isMissingRoute(listError) && (
          <EmptyState title="There is no staff-roster endpoint yet.">
            Nothing serves GET /api/admin/staff, so this console cannot list who holds which role.
            Reviewing that is a SQL-editor task today — the query is in docs/ADMIN.md §6. Granting
            and revoking above are unaffected: they post to /api/admin/role, which is implemented.
          </EmptyState>
        )}
        {listError && !busy && !isMissingRoute(listError) && (
          <ErrorNote error={listError} what="loading the staff list" onRetry={refresh} />
        )}

        {!busy && !listError && active.length === 0 && (
          <EmptyState title="No active staff rows.">
            Nobody currently holds a role in staff_roles. The first owner is granted with the
            service key, from the server — not from this page.
          </EmptyState>
        )}

        {!busy && !listError && active.length > 0 && (
          <div className="ad-tablewrap">
            <table className="ad-table">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Role</th>
                  <th scope="col">Granted</th>
                  <th scope="col">Note</th>
                  <th scope="col">
                    <span className="ad-sr">Revoke</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {active.map((s) => (
                  <tr key={s.userId}>
                    <td>
                      <span className="ad-strong">{orDash(s.email, 80)}</span>
                      <span className="ad-sub ad-mono">{shortId(s.userId)}</span>
                    </td>
                    <td>
                      <span className="ad-tag">{clean(s.role, 20)}</span>
                    </td>
                    <td className="num">
                      {fmtTime(s.grantedAt)}
                      {s.grantedByEmail && <span className="ad-sub">by {clean(s.grantedByEmail, 60)}</span>}
                    </td>
                    <td>{orDash(s.note, 120)}</td>
                    <td>
                      {s.userId === selfUserId ? (
                        <span className="ad-sub">that is you</span>
                      ) : (
                        <button
                          type="button"
                          className="ad-btn ad-btn-danger"
                          onClick={() =>
                            start({
                              kind: "revoke",
                              userId: s.userId,
                              email: s.email,
                              current: s.role,
                            })
                          }
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!busy && !listError && revoked.length > 0 && (
          <details className="ad-details">
            <summary>Revoked ({revoked.length})</summary>
            <ul className="ad-revoked">
              {revoked.map((s) => (
                <li key={`${s.userId}-revoked`}>
                  <b>{orDash(s.email, 80)}</b>
                  <span className="ad-sub">
                    was {clean(s.role, 20)} · revoked {fmtTime(s.revokedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Panel>
    </>
  );
}
