// POST /api/account/delete — a signed-in user erases their own account.
//
// This is the route behind "you can delete it whenever you like", so it has
// to actually work and actually be safe. The shape of both:
//
//   1. verify the caller's token server-side      (getUser with the service key)
//   2. refuse if they ever acted as staff         (409 — see below)
//   3. delete their storage folder                (storage does NOT cascade)
//   4. delete the auth user                       (every table row cascades)
//
// The ONLY account this route will ever delete is the one the verified token
// proves the caller holds. Nothing — no id, no email — is read from the
// request body. A body saying { userId: "someone-else" } is ignored entirely,
// which is what makes this route safe to expose without a staff guard.
//
// This is a USER route, deliberately not behind requireStaff: the person
// least likely to hold a staff role is exactly the person entitled to use it.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AuthzError, clientIp, fail, rateLimit, serviceClient } from "../_admin.js";

/** Storage list page size. Uploads live flat under `<uid>/name`, so paging
 *  the one folder is enough — there are no nested folders to walk. */
const PAGE = 100;
/** Hard cap on pages, so a broken storage response can never loop forever. */
const MAX_PAGES = 50;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Whatever happens here — success, refusal, error — concerns one person's
  // account and must never sit in a cache.
  res.setHeader("Cache-Control", "no-store, private");

  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed." });
      return;
    }

    // Deleting an account is a one-shot action; a burst of attempts from one
    // address is either a stuck client or an attack, and both can wait.
    if (!rateLimit(`accdel:${clientIp(req)}`, 5, 10 * 60_000)) {
      throw new AuthzError(429, "Too many requests.");
    }

    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) throw new AuthzError(401, "Sign in required.");

    const sb = serviceClient();

    // Server-side verification: signature and expiry checked by Supabase. A
    // forged or stale token dies here. The uid this returns is the one and
    // only id used below.
    const { data: userData, error: userErr } = await sb.auth.getUser(token);
    const user = userData?.user;
    if (userErr || !user) throw new AuthzError(401, "Sign in required.", "invalid_token");
    const uid = user.id;

    // ── The staff edge ────────────────────────────────────────────────────
    // admin_audit.actor_id references auth.users ON DELETE RESTRICT — on
    // purpose. If this user ever acted as staff, rows in the audit log carry
    // their id, and deleting the user would either fail on that FK or (with
    // a laxer constraint) take the log's history with them. Self-deletion
    // must never be a way to erase your own audit trail, so anyone with
    // audit rows is refused up front and told to go through an owner, who
    // can revoke the role and hand the deletion to a process that keeps the
    // trail intact.
    const { data: acted, error: actedErr } = await sb
      .from("admin_audit")
      .select("id")
      .eq("actor_id", uid)
      .limit(1);
    if (actedErr) throw new Error(actedErr.message);
    if (acted && acted.length > 0) {
      throw new AuthzError(
        409,
        "Staff accounts can't delete themselves — ask an owner to remove the account.",
      );
    }

    // ── Storage first ─────────────────────────────────────────────────────
    // The documents bucket does NOT cascade when the auth user goes away;
    // deleting the user first would orphan their files forever. So: list the
    // user's folder, remove what's there, and only then delete the account.
    const paths: string[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data: objects, error: listErr } = await sb.storage
        .from("documents")
        .list(uid, { limit: PAGE, offset: page * PAGE });
      if (listErr) throw new Error(listErr.message);
      const names = (objects ?? []).map((o) => o.name).filter(Boolean);
      paths.push(...names.map((n) => `${uid}/${n}`));
      if (!objects || objects.length < PAGE) break;
    }
    if (paths.length > 0) {
      const { error: rmErr } = await sb.storage.from("documents").remove(paths);
      if (rmErr) throw new Error(rmErr.message);
    }

    // ── The account itself ────────────────────────────────────────────────
    // profiles, documents, consents and staff_roles rows all cascade from
    // auth.users, so this one call erases every table row the person has.
    const { error: delErr } = await sb.auth.admin.deleteUser(uid);
    if (delErr) {
      // Belt and braces for the RESTRICT above: if an audit row landed
      // between our check and this call (or the check missed), the FK still
      // refuses the delete. Map that refusal to the same honest 409 rather
      // than a generic 500.
      if (/foreign key|violat|restrict|admin_audit/i.test(delErr.message ?? "")) {
        throw new AuthzError(
          409,
          "Staff accounts can't delete themselves — ask an owner to remove the account.",
        );
      }
      throw new Error(delErr.message);
    }

    // Deliberately NO admin_audit row for a self-deletion. Two reasons:
    // writing one would create the very actor_id row whose RESTRICT then
    // blocks this same deletion, and a person erasing their own data is not
    // a staff access event — the audit log records staff touching other
    // people's records, not people exercising their own rights.

    res.status(200).json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
}
