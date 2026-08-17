// GET /api/admin/case?id=<subject> — one applicant's file, as staff see it.
//
// What this route deliberately does NOT return:
//
//   · document contents. Documents come back as metadata only — kind, name,
//     size, when it arrived. Reading an essay or a transcript is a separate
//     request to /api/admin/document, which writes its own audit row naming
//     that document. If the case view carried the text, one fetch would open
//     every file a student ever uploaded and the log would show a single
//     "viewed the case" line for it.
//   · the long free-text fields inside the profile blob (essay, activities,
//     awards). They are the same material as the documents, so they follow
//     the same rule: the case view reports how much is there, the document
//     route hands over the words.
//   · storage paths. The client has no use for a permanent pointer.
//
// Reviewers may fetch only cases currently assigned to them; administrators
// and owners may fetch any, and both are logged before anything is returned.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, AuthzError, canViewCase, fail, requireStaff, serviceClient } from "../_admin.js";
import {
  boundedInt, directory, noStore, queryParam, requireMethod, splitProfile, uuid,
} from "./_util.js";

/** The consent purposes in supabase/admin.sql, in the order the UI shows
 *  them. A purpose with no record has never been granted. */
const PURPOSES = [
  "service_delivery",
  "human_review",
  "support",
  "security",
  "product_improvement",
  "marketing",
] as const;

const MAX_DOCUMENTS = 200;
const MAX_CONSENT_ROWS = 300;
const MAX_REVIEWERS = 50;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    requireMethod(req, "GET");
    const actor = await requireStaff(req);

    const subjectId = uuid(queryParam(req, "id"), "case");
    // How much of the subject's own audit trail to show inline. Bounded so a
    // crafted query cannot pull the whole log through this route.
    const trail = boundedInt(queryParam(req, "trail"), 0, 50, 10);

    if (!(await canViewCase(actor, subjectId))) {
      await audit(actor, {
        action: "view_case", subjectId, success: false, meta: { reason: "not_assigned" },
      });
      throw new AuthzError(403, "That case isn't assigned to you.");
    }

    // Logged before a single field is read, so a failure to log is a failure
    // to look. The same ordering as /api/admin/document, for the same reason.
    await audit(actor, { action: "view_case", subjectId, meta: { scope: actor.role } });

    const sb = serviceClient();

    const { data: profileRow, error: profileErr } = await sb
      .from("profiles")
      .select("id, email, name, profile, schools, created_at, updated_at")
      .eq("id", subjectId)
      .maybeSingle();
    if (profileErr) throw new Error(profileErr.message);
    if (!profileRow) throw new AuthzError(404, "No such case.");

    // Note the absence of `content` in this select list. It is not filtered
    // out afterwards — it is never read, so it cannot be leaked by a later
    // mistake in the mapping below.
    const { data: docRows, error: docErr } = await sb
      .from("documents")
      .select("id, kind, name, mime, bytes, storage_path, created_at")
      .eq("user_id", subjectId)
      .order("created_at", { ascending: false })
      .limit(MAX_DOCUMENTS);
    if (docErr) throw new Error(docErr.message);

    const { data: consentRows, error: consentErr } = await sb
      .from("consents")
      .select("purpose, granted, source, created_at")
      .eq("user_id", subjectId)
      .order("created_at", { ascending: false })
      .limit(MAX_CONSENT_ROWS);
    if (consentErr) throw new Error(consentErr.message);

    const { data: assignRows, error: assignErr } = await sb
      .from("case_assignments")
      .select("reviewer_id, assigned_by, assigned_at")
      .eq("subject_id", subjectId)
      .is("released_at", null)
      .order("assigned_at", { ascending: false })
      .limit(MAX_REVIEWERS);
    if (assignErr) throw new Error(assignErr.message);

    // The most recent record for a purpose is the current answer; anything
    // never recorded counts as not granted.
    const seen = new Map<string, { granted: boolean; at: string | null; source: string | null }>();
    for (const row of consentRows ?? []) {
      const purpose = String(row.purpose ?? "");
      if (!purpose || seen.has(purpose)) continue;
      seen.set(purpose, {
        granted: row.granted === true,
        at: (row.created_at as string | null) ?? null,
        source: (row.source as string | null) ?? null,
      });
    }
    const consents = PURPOSES.map((purpose) => {
      const c = seen.get(purpose);
      return {
        purpose,
        granted: c?.granted ?? false,
        recordedAt: c?.at ?? null,
        source: c?.source ?? null,
        // Never recorded is not the same as declined, and the UI has to be
        // able to tell the difference before anyone acts on it.
        answered: !!c,
      };
    });

    const { profile, written } = splitProfile(profileRow.profile);

    const people = await directory(sb, (assignRows ?? []).flatMap((r) => [
      r.reviewer_id as string,
      r.assigned_by as string | null,
    ]));

    const reviewers = (assignRows ?? []).map((r) => {
      const who = people.get(r.reviewer_id as string);
      return {
        reviewerId: r.reviewer_id,
        email: who?.email ?? null,
        name: who?.name ?? null,
        assignedAt: r.assigned_at,
        assignedBy: r.assigned_by ?? null,
        assignedByEmail: people.get((r.assigned_by as string) ?? "")?.email ?? null,
      };
    });

    // Who has touched this file — administrators and owners only. The policy
    // in supabase/admin.sql keeps reviewers out of admin_audit entirely, and
    // this route holds the service key, so it has to enforce that itself
    // rather than assume the database will. A reviewer sees the case; they do
    // not see who else has been reading it.
    let history: unknown[] = [];
    if (trail > 0 && actor.role !== "reviewer") {
      const { data: auditRows } = await sb
        .from("admin_audit")
        .select("action, actor_id, actor_role, success, created_at")
        .eq("subject_id", subjectId)
        .order("created_at", { ascending: false })
        .limit(trail);
      const actors = await directory(sb, (auditRows ?? []).map((r) => r.actor_id as string));
      history = (auditRows ?? []).map((r) => ({
        action: r.action,
        actorId: r.actor_id,
        actorEmail: actors.get(r.actor_id as string)?.email ?? null,
        actorRole: r.actor_role,
        success: r.success,
        at: r.created_at,
      }));
    }

    noStore(res);
    res.status(200).json({
      case: {
        id: profileRow.id,
        email: profileRow.email,
        name: profileRow.name,
        createdAt: profileRow.created_at,
        updatedAt: profileRow.updated_at,
        profile,
        // Character counts, not the text: enough for a reviewer to know
        // whether there is an essay to read, not enough to read it.
        written,
        schools: profileRow.schools ?? {},
      },
      documents: (docRows ?? []).map((d) => ({
        id: d.id,
        kind: d.kind,
        name: d.name,
        mime: d.mime ?? null,
        bytes: d.bytes ?? null,
        // A file in private storage versus text pasted into the app. Either
        // way it opens through /api/admin/document, never from here.
        stored: !!d.storage_path,
        createdAt: d.created_at,
      })),
      consents,
      reviewers,
      history,
      viewerRole: actor.role,
    });
  } catch (e) {
    fail(res, e);
  }
}
