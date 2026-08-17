// POST /api/admin/assign — put a reviewer on a case, or take them off it.
//
// Assignment is what confines a reviewer: /api/admin/cases, /api/admin/case
// and /api/admin/document all resolve "may this person see this file?" to a
// live row in case_assignments. That makes this route the place where a
// reviewer's reach is widened, so it is administrator-and-above only and both
// directions are logged with who did it and why.
//
//   · the target must already hold an active staff role — you cannot hand a
//     case to a member of the public by putting their id in the body
//   · release is a timestamp, never a delete, so "who could see this file in
//     March" stays answerable
//   · both directions are capped, so a scripted loop cannot quietly hand one
//     account every case in the product
//
// Revoking a staff role does not need to walk this table: canViewCase() only
// trusts an assignment held by someone who still passes requireStaff.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, AuthzError, fail, requireStaff, serviceClient } from "../_admin.js";
import { noStore, requireMethod, text, uuid } from "./_util.js";

/** A reviewer holding more open cases than this is a sign of a mistake (or a
 *  scripted grab), not a workload. */
const MAX_OPEN_PER_REVIEWER = 200;
/** More reviewers than this on one applicant means something has gone wrong. */
const MAX_REVIEWERS_PER_CASE = 10;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    requireMethod(req, "POST");
    const actor = await requireStaff(req, { min: "administrator" });

    const body = (req.body ?? {}) as {
      subjectId?: string; reviewerId?: string; release?: boolean; reason?: string;
    };
    const subjectId = uuid(body.subjectId, "case");
    const reviewerId = uuid(body.reviewerId, "reviewer");
    const release = body.release === true;
    const reason = text(body.reason, 300);

    const sb = serviceClient();

    // The case has to exist. Without this check the table happily accepts an
    // assignment to a subject id that is not a user of this product.
    const { data: subject, error: subjectErr } = await sb
      .from("profiles")
      .select("id")
      .eq("id", subjectId)
      .maybeSingle();
    if (subjectErr) throw new Error(subjectErr.message);
    if (!subject) throw new AuthzError(404, "No such case.");

    if (release) {
      const { data: released, error: relErr } = await sb
        .from("case_assignments")
        .update({ released_at: new Date().toISOString() })
        .eq("subject_id", subjectId)
        .eq("reviewer_id", reviewerId)
        .is("released_at", null)
        .select("id");
      if (relErr) throw new Error(relErr.message);

      if (!released || released.length === 0) {
        await audit(actor, {
          action: "release_case", subjectId, success: false,
          meta: { reviewerId, reason: "not_assigned" },
        });
        throw new AuthzError(404, "That reviewer isn't assigned to this case.");
      }

      await audit(actor, {
        action: "release_case", subjectId, reason: reason || null, meta: { reviewerId },
      });
      noStore(res);
      res.status(200).json({ ok: true, released: true, subjectId, reviewerId });
      return;
    }

    // Staff only, and only a role that is still live. This is read from the
    // table for the same reason requireStaff does: it is the only statement
    // of who is staff that the browser cannot influence.
    const { data: staffRow, error: staffErr } = await sb
      .from("staff_roles")
      .select("role")
      .eq("user_id", reviewerId)
      .is("revoked_at", null)
      .maybeSingle();
    if (staffErr) throw new Error(staffErr.message);
    if (!staffRow) {
      await audit(actor, {
        action: "assign_case", subjectId, success: false,
        meta: { reviewerId, reason: "target_not_staff" },
      });
      throw new AuthzError(409, "That account isn't staff.");
    }

    const { count: openForReviewer } = await sb
      .from("case_assignments")
      .select("id", { count: "exact", head: true })
      .eq("reviewer_id", reviewerId)
      .is("released_at", null);
    if ((openForReviewer ?? 0) >= MAX_OPEN_PER_REVIEWER) {
      await audit(actor, {
        action: "assign_case", subjectId, success: false,
        meta: { reviewerId, reason: "reviewer_at_capacity", open: openForReviewer },
      });
      throw new AuthzError(409, "That reviewer already has the maximum number of open cases.");
    }

    const { count: onThisCase } = await sb
      .from("case_assignments")
      .select("id", { count: "exact", head: true })
      .eq("subject_id", subjectId)
      .is("released_at", null);
    if ((onThisCase ?? 0) >= MAX_REVIEWERS_PER_CASE) {
      await audit(actor, {
        action: "assign_case", subjectId, success: false,
        meta: { reviewerId, reason: "case_at_capacity", reviewers: onThisCase },
      });
      throw new AuthzError(409, "This case already has the maximum number of reviewers.");
    }

    // Re-assigning after a release reopens the same row rather than stacking
    // duplicates: (subject_id, reviewer_id) is unique in the schema.
    const { error: upsertErr } = await sb.from("case_assignments").upsert(
      {
        subject_id: subjectId,
        reviewer_id: reviewerId,
        assigned_by: actor.id,
        assigned_at: new Date().toISOString(),
        released_at: null,
      },
      { onConflict: "subject_id,reviewer_id" },
    );
    if (upsertErr) throw new Error(upsertErr.message);

    await audit(actor, {
      action: "assign_case", subjectId, reason: reason || null,
      meta: { reviewerId, reviewerRole: staffRow.role },
    });

    noStore(res);
    res.status(200).json({ ok: true, assigned: true, subjectId, reviewerId });
  } catch (e) {
    fail(res, e);
  }
}
