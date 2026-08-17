// What role the browser *believes* the signed-in user holds.
//
// Read this comment before using anything in this file to decide anything.
//
// The value returned here is COSMETIC. It exists so the masthead can decide
// whether to offer an "Admin" link, and so the console can show the Roles tab
// to owners and not to reviewers. It is not access control and must never be
// treated as such:
//
//   · it comes from the browser, and anyone can edit what the browser thinks;
//   · it is read with the anon key under the "read own staff row" policy in
//     supabase/admin.sql, which lets a user see their own row — so it is at
//     least an honest reading of the database rather than a JWT claim the user
//     could set themselves — but it is still a client-side read;
//   · hiding a link hides nothing. Every route in this console is a plain URL
//     and every fetch is a request an attacker can make by hand.
//
// The real decision is made in api/_admin.ts, on the server, on every single
// request: it verifies the bearer token, reads staff_roles with the service
// key, requires MFA and a fresh-enough session, and writes an audit row for
// allows and denials alike. Revoking a role takes effect on the next request
// no matter what this hook still has in state.

import { useEffect, useState } from "react";
import { cloudEnabled, supabase } from "../../lib/supabase";
import type { StaffRole } from "./api";

export type StaffState =
  | { status: "loading" }
  /** No Supabase in this build: accounts and the admin API are both absent. */
  | { status: "no-backend" }
  | { status: "signed-out" }
  /** Signed in, but no active row in staff_roles. */
  | { status: "none"; email: string }
  | { status: "staff"; role: StaffRole; email: string; userId: string }
  | { status: "error"; message: string };

const RANK: Record<StaffRole, number> = { reviewer: 1, administrator: 2, owner: 3 };

/** Role comparison, mirroring api/_admin.ts. For showing and hiding UI only. */
export function atLeast(role: StaffRole | null | undefined, min: StaffRole): boolean {
  return role ? RANK[role] >= RANK[min] : false;
}

async function readOwnRole(): Promise<StaffState> {
  if (!cloudEnabled || !supabase) return { status: "no-backend" };

  const { data: sess, error: sessErr } = await supabase.auth.getSession();
  if (sessErr) return { status: "error", message: sessErr.message };
  const user = sess.session?.user;
  if (!user) return { status: "signed-out" };

  // Policy-limited to this user's own row; the .eq() states that intent in
  // the query as well, so a policy change can never silently widen it.
  const { data, error } = await supabase
    .from("staff_roles")
    .select("role")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) return { status: "error", message: error.message };
  if (!data) return { status: "none", email: user.email ?? "" };

  return {
    status: "staff",
    role: data.role as StaffRole,
    email: user.email ?? "",
    userId: user.id,
  };
}

/** Track the signed-in user's own staff row. Re-reads on any auth change. */
export function useStaffRole(): StaffState {
  const [state, setState] = useState<StaffState>({ status: "loading" });

  useEffect(() => {
    let live = true;
    // Only the newest read may write state, so a slow first request cannot
    // overwrite the result of a sign-out that happened after it.
    let generation = 0;

    const run = () => {
      const mine = ++generation;
      readOwnRole()
        .then((s) => {
          if (live && mine === generation) setState(s);
        })
        .catch((e: unknown) => {
          if (live && mine === generation) {
            setState({ status: "error", message: e instanceof Error ? e.message : "Could not read your staff role." });
          }
        });
    };

    run();

    if (!cloudEnabled || !supabase) return () => { live = false; };
    const { data } = supabase.auth.onAuthStateChange(() => run());
    return () => {
      live = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return state;
}
