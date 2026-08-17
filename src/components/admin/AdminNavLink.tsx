// The "Admin" item in the masthead.
//
// Renders only for an account with an active row in staff_roles, and that
// check is cosmetic — it keeps the link out of a student's way, nothing more.
// #/admin is a plain URL that anyone can type, and typing it gets you the
// console's own "you do not have access" page; asking it for data gets you a
// refusal from api/_admin.ts and a row in the audit log.
//
// Self-contained on purpose: it reads its own auth state so adding staff
// navigation costs App.tsx one line rather than a new piece of session logic.

import { useStaffRole } from "./useStaffRole";

export default function AdminNavLink() {
  const staff = useStaffRole();
  if (staff.status !== "staff") return null;
  return (
    <a className="btn-quiet ad-navlink" href="#/admin" title={`Staff console · ${staff.role}`}>
      Admin
    </a>
  );
}
