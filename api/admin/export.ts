// POST /api/admin/export — everything held about one person, in one file.
//
// This exists because people are entitled to a copy of their own record, and
// because a support case sometimes needs the whole picture at once. It is
// also, by construction, the single request that moves the most private data
// in this product — transcripts, essays, a minor's file — so it carries every
// brake the guard offers:
//
//   · administrator and above, never a reviewer
//   · sensitive: true — a session authenticated within the last 15 minutes.
//     An unattended laptop cannot be used to bulk-export.
//   · a written reason is REQUIRED. Not a checkbox: a sentence, stored on the
//     audit row, readable later by the person asking why this happened.
//   · rate-limited per actor, so "export everyone" is a slow, loud loop
//   · hard caps on rows and characters, so one call cannot become a dump
//   · audited twice: once before anything is read, and again with the exact
//     manifest of what left — document ids, counts, characters, truncations.
//     The action name is "export_user", which is what the admin_alerts view
//     in supabase/admin.sql watches for bulk-export behaviour.
//
// Files in private storage are NOT included and no signed URLs are minted
// here. Their metadata is listed and each one must be opened through
// /api/admin/document, which logs that specific document against that
// specific person. A bulk route that also handed out file URLs would turn
// dozens of individually-logged accesses into one line in the log.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, AuthzError, fail, rateLimit, requireStaff, serviceClient } from "../_admin.js";
import { FREE_TEXT, noStore, requireMethod, splitProfile, text, uuid } from "./_util.js";

const MIN_REASON = 10;
const MAX_REASON = 300;

/** Per-actor ceiling. In-memory and per-instance like the guard's own limiter
 *  — a speed bump plus an audit trail, not a hard guarantee. */
const EXPORTS_PER_HOUR = 5;

const MAX_DOCUMENTS = 100;
const MAX_CHARS_PER_DOCUMENT = 100_000;
const MAX_CHARS_TOTAL = 400_000;
const MAX_CONSENT_ROWS = 500;
const MAX_ASSIGNMENTS = 100;
const MAX_TRAIL_ROWS = 200;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    requireMethod(req, "POST");
    // sensitive: the guard refuses a session older than its re-auth window
    // before this handler runs at all.
    const actor = await requireStaff(req, { min: "administrator", sensitive: true });

    const body = (req.body ?? {}) as { userId?: string; reason?: string; includeContent?: boolean };
    const subjectId = uuid(body.userId, "user");
    const reason = text(body.reason, MAX_REASON);
    const includeContent = body.includeContent === true;

    if (reason.length < MIN_REASON) {
      await audit(actor, {
        action: "export_user", subjectId, success: false, meta: { reason: "no_reason_given" },
      });
      throw new AuthzError(400, "An export needs a written reason.");
    }

    if (!rateLimit(`export:${actor.id}`, EXPORTS_PER_HOUR, 60 * 60_000)) {
      await audit(actor, {
        action: "export_user", subjectId, success: false, meta: { reason: "rate_limited" },
      });
      throw new AuthzError(429, "Too many exports. Wait before running another.");
    }

    // Before a single row is read. If the log is down, the export does not
    // happen — the whole point of this route is that it is never invisible.
    await audit(actor, {
      action: "export_user",
      subjectId,
      reason,
      meta: { includeContent, caps: { documents: MAX_DOCUMENTS, chars: MAX_CHARS_TOTAL } },
    });

    const sb = serviceClient();

    const { data: profileRow, error: profileErr } = await sb
      .from("profiles")
      .select("id, email, name, profile, schools, created_at, updated_at")
      .eq("id", subjectId)
      .maybeSingle();
    if (profileErr) throw new Error(profileErr.message);
    if (!profileRow) throw new AuthzError(404, "No such user.");

    // Two literal column lists rather than one built by hand: `content` is
    // read from the database only when the caller actually asked for it, so
    // an export without content never loads a transcript into memory at all.
    const docQuery = includeContent
      ? sb.from("documents").select("id, kind, name, mime, bytes, storage_path, created_at, content")
      : sb.from("documents").select("id, kind, name, mime, bytes, storage_path, created_at");
    const { data: docRows, error: docErr } = await docQuery
      .eq("user_id", subjectId)
      .order("created_at", { ascending: false })
      .limit(MAX_DOCUMENTS);
    if (docErr) throw new Error(docErr.message);

    // Counted separately so "52 documents were left out" is a real number
    // rather than an inference from a page that happened to come back full.
    const { count: heldDocuments } = await sb
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("user_id", subjectId);

    const kept = (docRows ?? []) as unknown as Record<string, unknown>[];
    const total = heldDocuments ?? kept.length;
    const omittedDocuments = Math.max(0, total - kept.length);

    let charsUsed = 0;
    let truncatedCount = 0;
    const documents = kept.map((d) => {
      const stored = !!d.storage_path;
      const stashed = typeof d.content === "string" ? d.content : null;
      let content: string | null = null;
      let truncated = false;
      if (includeContent && !stored && stashed !== null) {
        const room = Math.max(0, Math.min(MAX_CHARS_PER_DOCUMENT, MAX_CHARS_TOTAL - charsUsed));
        content = stashed.slice(0, room);
        truncated = content.length < stashed.length;
        charsUsed += content.length;
        if (truncated) truncatedCount += 1;
      }
      return {
        id: d.id,
        kind: d.kind,
        name: d.name,
        mime: d.mime ?? null,
        bytes: d.bytes ?? null,
        createdAt: d.created_at,
        // A stored file is listed, never handed over here.
        stored,
        content,
        truncated,
      };
    });

    const { data: consentRows, error: consentErr } = await sb
      .from("consents")
      .select("purpose, granted, source, created_at")
      .eq("user_id", subjectId)
      .order("created_at", { ascending: false })
      .limit(MAX_CONSENT_ROWS);
    if (consentErr) throw new Error(consentErr.message);

    const { data: assignRows, error: assignErr } = await sb
      .from("case_assignments")
      .select("reviewer_id, assigned_by, assigned_at, released_at")
      .eq("subject_id", subjectId)
      .order("assigned_at", { ascending: false })
      .limit(MAX_ASSIGNMENTS);
    if (assignErr) throw new Error(assignErr.message);

    // Who looked at this person's file. Part of their record, not an extra.
    const { data: trailRows, error: trailErr } = await sb
      .from("admin_audit")
      .select("action, actor_id, actor_role, success, reason, created_at")
      .eq("subject_id", subjectId)
      .order("created_at", { ascending: false })
      .limit(MAX_TRAIL_ROWS);
    if (trailErr) throw new Error(trailErr.message);

    // The intake form's long answers live in the profile blob, but they are
    // the same writing as the essay document — so they follow the document
    // rule, not the profile rule. Without this, "content was not requested"
    // would be false the moment a student pasted their essay into the form.
    const { profile: trimmedProfile, written } = splitProfile(profileRow.profile);
    const fullProfile = (profileRow.profile ?? {}) as Record<string, unknown>;
    const profileChars = FREE_TEXT.reduce(
      (n, k) => n + (typeof fullProfile[k] === "string" ? (fullProfile[k] as string).length : 0),
      0,
    );

    const manifest = {
      documents: documents.length,
      documentsHeld: total,
      documentsOmitted: omittedDocuments,
      documentIds: documents.map((d) => d.id),
      storedFiles: documents.filter((d) => d.stored).length,
      contentIncluded: includeContent,
      chars: charsUsed,
      profileChars: includeContent ? profileChars : 0,
      profileTextWithheld: includeContent ? 0 : profileChars,
      truncatedDocuments: truncatedCount,
      consents: (consentRows ?? []).length,
      assignments: (assignRows ?? []).length,
      trail: (trailRows ?? []).length,
    };

    // Second row: exactly what left the building, written before the payload
    // is serialised to the client.
    await audit(actor, {
      action: "export_user_manifest", subjectId, reason, meta: manifest,
    });

    noStore(res);
    res.status(200).json({
      exportedAt: new Date().toISOString(),
      exportedBy: { id: actor.id, email: actor.email, role: actor.role },
      reason,
      subject: {
        id: profileRow.id,
        email: profileRow.email,
        name: profileRow.name,
        createdAt: profileRow.created_at,
        updatedAt: profileRow.updated_at,
        profile: includeContent ? fullProfile : trimmedProfile,
        // How much writing is in the profile, whether or not it was included.
        written,
        schools: profileRow.schools ?? {},
      },
      documents,
      consents: (consentRows ?? []).map((c) => ({
        purpose: c.purpose,
        granted: c.granted,
        source: c.source ?? null,
        recordedAt: c.created_at,
      })),
      assignments: (assignRows ?? []).map((a) => ({
        reviewerId: a.reviewer_id,
        assignedBy: a.assigned_by ?? null,
        assignedAt: a.assigned_at,
        releasedAt: a.released_at ?? null,
      })),
      accessTrail: (trailRows ?? []).map((t) => ({
        action: t.action,
        actorId: t.actor_id,
        actorRole: t.actor_role,
        success: t.success,
        reason: t.reason ?? null,
        at: t.created_at,
      })),
      manifest,
      // Stated in the payload so whoever receives the file knows what is and
      // is not in it, rather than assuming "complete" means every byte.
      notes: [
        omittedDocuments > 0
          ? `Only the ${MAX_DOCUMENTS} most recent documents are included; ${omittedDocuments} of ${total} were left out.`
          : "All documents on this account are listed.",
        includeContent
          ? "Text records and the profile's written answers are included; stored files are not — open those individually through /api/admin/document so each access is logged."
          : "No written material was requested: documents are listed as metadata, and the profile's essay, activities and awards text was left out.",
        truncatedCount > 0
          ? `${truncatedCount} document(s) were truncated at the export size limit.`
          : "No document was truncated.",
      ],
    });
  } catch (e) {
    fail(res, e);
  }
}
