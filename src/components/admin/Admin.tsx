// The admin console shell: who is here, what they may see, and which view.
//
// Read the gate below as presentation, not protection. It reads the signed-in
// user's own row in staff_roles (the one row policy lets them read) so the
// console can show a reviewer three tabs instead of five and can say "you do
// not have access" instead of rendering an empty page. An attacker types the
// URL anyway, so nothing here is load-bearing: every view fetches through
// /api/admin/*, and api/_admin.ts re-decides the question on the server for
// each request — verifying the token, reading the role from the table with the
// service key, demanding MFA and a short session, and writing an audit row for
// allows and refusals alike.
//
// Routes, all under the single #/admin hash entry in App.tsx:
//   #/admin                     case list
//   #/admin/cases/<userId>      one case
//   #/admin/audit               audit log            (administrator+)
//   #/admin/audit/<userId>      audit log for a case (administrator+)
//   #/admin/roles               role management      (owner)

import type { ReactNode } from "react";
import { atLeast, useStaffRole } from "./useStaffRole";
import { clean } from "./text";
import CaseList from "./CaseList";
import CaseDetail from "./CaseDetail";
import AuditLog from "./AuditLog";
import RoleManager from "./RoleManager";
import "../admin.css";

/** Shown instead of a blank page whenever the console will not open. */
function Denied({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="shell ad ad-denied">
      <h1>{title}</h1>
      <div className="ad-denied-body">{children}</div>
      <p className="ad-denied-foot">
        Access is decided on the server for every request, and both the grant and the refusal are
        written to the audit log.
      </p>
    </div>
  );
}

export default function Admin({ sub, go }: { sub: string; go: (route: string) => void }) {
  const staff = useStaffRole();

  if (staff.status === "loading") {
    return (
      <div className="shell ad">
        <p className="ad-loading" role="status">
          <span className="ad-dot" aria-hidden="true" />
          Checking your access…
        </p>
      </div>
    );
  }

  if (staff.status === "no-backend") {
    return (
      <Denied title="The admin console is not available in this build">
        <p>
          No Supabase backend is configured here (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are
          unset), so there are no accounts, no staff roles and no admin API to talk to.
        </p>
      </Denied>
    );
  }

  if (staff.status === "signed-out") {
    return (
      <Denied title="Sign in to continue">
        <p>The admin console needs a signed-in staff account.</p>
        <p>
          <a className="ad-btn ad-btn-go" href="#/login">
            Go to sign-in
          </a>
        </p>
      </Denied>
    );
  }

  if (staff.status === "error") {
    return (
      <Denied title="Could not check your access">
        <p>The lookup against staff_roles failed, so this page will not guess:</p>
        <p className="ad-error-msg">{clean(staff.message, 300)}</p>
      </Denied>
    );
  }

  if (staff.status === "none") {
    return (
      <Denied title="You do not have access">
        <p>
          The account <b>{clean(staff.email, 120)}</b> has no active staff role, so there is nothing
          for it to open here.
        </p>
        <p>
          If that is wrong, an owner grants roles on this console; roles are never self-assigned and
          never come from your profile or your sign-in token.
        </p>
      </Denied>
    );
  }

  const role = staff.role;
  const parts = sub.split("/").filter((p) => p !== "");
  const section = parts[0] ?? "cases";
  const canAudit = atLeast(role, "administrator");
  const canRoles = atLeast(role, "owner");

  const tab = (key: string, label: string, route: string) => (
    <button
      type="button"
      className={`ad-tab${section === key ? " on" : ""}`}
      aria-current={section === key ? "page" : undefined}
      onClick={() => go(route)}
    >
      {label}
    </button>
  );

  let body: ReactNode;
  if (section === "cases" && parts[1]) {
    body = <CaseDetail id={parts[1]} go={go} />;
  } else if (section === "cases" || parts.length === 0) {
    body = <CaseList go={go} />;
  } else if (section === "audit") {
    body = canAudit ? (
      <AuditLog subject={parts[1]} go={go} />
    ) : (
      <NotForYou
        title="The audit log is for administrators and owners"
        role={role}
        detail="A reviewer cannot read the log at all, including their own entries — otherwise it doubles as a way to enumerate which accounts exist."
      />
    );
  } else if (section === "roles") {
    body = canRoles ? (
      <RoleManager selfUserId={staff.userId} />
    ) : (
      <NotForYou
        title="Role management is for owners"
        role={role}
        detail="Administrators manage cases and applicants; deciding who may read every student file is kept to owners."
      />
    );
  } else {
    body = (
      <div className="ad-panel">
        <h2>No such admin page</h2>
        <p className="ad-body">
          <code className="ad-mono">#/admin/{clean(sub, 80)}</code> is not a view in this console.
        </p>
        <p>
          <button type="button" className="ad-btn" onClick={() => go("admin")}>
            Back to cases
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="shell ad">
      <header className="ad-head">
        <div>
          <h1>Admin console</h1>
          <p className="ad-headsub">
            Signed in as <b>{clean(staff.email, 120)}</b>
            <span className="ad-tag">{role}</span>
          </p>
        </div>
      </header>

      <p className="ad-banner">
        Internal tool. These are real student records, some belonging to minors. Every list you load
        and every document you open is written to the audit log with your account, your IP and the
        time — including the requests that are refused.
      </p>

      <nav className="ad-tabs" aria-label="Admin sections">
        {tab("cases", "Cases", "admin")}
        {canAudit && tab("audit", "Audit log", "admin/audit")}
        {canRoles && tab("roles", "Roles", "admin/roles")}
      </nav>

      {body}
    </div>
  );
}

function NotForYou({ title, role, detail }: { title: string; role: string; detail: string }) {
  return (
    <div className="ad-panel">
      <h2>{title}</h2>
      <p className="ad-body">
        Your role is <b>{clean(role, 20)}</b>. {detail}
      </p>
      <p className="ad-body ad-sub">
        Hiding this view is only tidiness: api/_admin.ts refuses the request as well, and records
        the refusal.
      </p>
    </div>
  );
}
