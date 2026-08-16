// POST /api/admin/role — grant or revoke a staff role.
//
// The most dangerous route in the product, so it carries the most conditions:
//
//   · owner only — administrators manage cases and users, not the people who
//     can read every file
//   · recent authentication required (sensitive: true), so an unattended
//     session cannot be used to escalate
//   · nobody may change their own role, in either direction: that closes both
//     self-promotion and the "lock out every other owner" move
//   · the last remaining owner cannot be revoked, or the system becomes
//     unadministrable
//   · granted and revoked are both audited, including failures
//
// Revocation takes effect on the very next request: requireStaff reads the
// table every time and caches nothing.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, AuthzError, fail, requireStaff, serviceClient, type Role } from "../_admin.js";

const ROLES: Role[] = ["reviewer", "administrator", "owner"];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed." });
      return;
    }
    const actor = await requireStaff(req, { min: "owner", sensitive: true });

    const body = (req.body ?? {}) as { userId?: string; role?: string; revoke?: boolean; reason?: string };
    const userId = String(body.userId ?? "");
    const reason = String(body.reason ?? "").slice(0, 300);
    const revoke = body.revoke === true;
    if (!userId) throw new AuthzError(400, "Which user?");

    if (userId === actor.id) {
      await audit(actor, {
        action: "change_role", subjectId: userId, success: false,
        meta: { reason: "self_modification_blocked" },
      });
      throw new AuthzError(403, "You can't change your own role. Ask another owner.");
    }

    const sb = serviceClient();

    if (revoke) {
      // Never strip the last owner.
      const { count } = await sb
        .from("staff_roles")
        .select("user_id", { count: "exact", head: true })
        .eq("role", "owner")
        .is("revoked_at", null);
      const { data: target } = await sb
        .from("staff_roles")
        .select("role")
        .eq("user_id", userId)
        .is("revoked_at", null)
        .maybeSingle();
      if (target?.role === "owner" && (count ?? 0) <= 1) {
        await audit(actor, {
          action: "change_role", subjectId: userId, success: false,
          meta: { reason: "last_owner_protected" },
        });
        throw new AuthzError(409, "That's the last owner — promote someone else first.");
      }

      const { error } = await sb
        .from("staff_roles")
        .update({ revoked_at: new Date().toISOString() })
        .eq("user_id", userId)
        .is("revoked_at", null);
      if (error) throw new Error(error.message);

      // Kill their live sessions too, so revocation is immediate rather than
      // "immediate on their next token refresh".
      await sb.auth.admin.signOut(userId, "global").catch(() => {});

      await audit(actor, {
        action: "change_role", subjectId: userId, reason: reason || null,
        meta: { revoked: true, previous: target?.role ?? null },
      });
      res.status(200).json({ ok: true, revoked: true });
      return;
    }

    const role = String(body.role ?? "") as Role;
    if (!ROLES.includes(role)) throw new AuthzError(400, "Unknown role.");

    // The account must exist and have a confirmed email before it can hold
    // any privilege.
    const { data: userRes, error: userErr } = await sb.auth.admin.getUserById(userId);
    if (userErr || !userRes?.user) throw new AuthzError(404, "No such user.");
    if (!userRes.user.email_confirmed_at) {
      throw new AuthzError(409, "That account hasn't confirmed its email address yet.");
    }

    const { error } = await sb.from("staff_roles").upsert({
      user_id: userId,
      role,
      granted_by: actor.id,
      granted_at: new Date().toISOString(),
      revoked_at: null,
      note: reason || null,
    });
    if (error) throw new Error(error.message);

    await audit(actor, {
      action: "change_role", subjectId: userId, reason: reason || null,
      meta: { granted: role, email: userRes.user.email },
    });

    res.status(200).json({ ok: true, role });
  } catch (e) {
    fail(res, e);
  }
}
