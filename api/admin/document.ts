// POST /api/admin/document — open one document as staff.
//
// The order here is the whole point, and it is deliberate:
//
//   1. verify the session server-side          (requireStaff)
//   2. verify this actor may see THIS case     (canViewCase)
//   3. write the audit row                     (audit)  ← before access
//   4. only then mint a short-lived signed URL
//
// The audit write comes before the URL is minted so that a failure to log is
// a failure to access, rather than an access nobody can see. The permanent
// storage path is never returned to the client, and the bucket is private, so
// the signed URL is the only way in and it dies in SIGNED_URL_TTL seconds.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, AuthzError, canViewCase, fail, requireStaff, serviceClient } from "../_admin.js";

/** Short enough that a leaked link is near-worthless, long enough to read. */
const SIGNED_URL_TTL = 120;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed." });
      return;
    }
    const actor = await requireStaff(req);

    const body = (req.body ?? {}) as { documentId?: string; reason?: string };
    const documentId = String(body.documentId ?? "");
    const reason = String(body.reason ?? "").slice(0, 300);
    if (!documentId) throw new AuthzError(400, "Which document?");

    const sb = serviceClient();
    const { data: doc, error } = await sb
      .from("documents")
      .select("id, user_id, kind, name, content, storage_path, mime, created_at")
      .eq("id", documentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc) throw new AuthzError(404, "No such document.");

    if (!(await canViewCase(actor, doc.user_id as string))) {
      await audit(actor, {
        action: "view_document", documentId, subjectId: doc.user_id as string,
        success: false, meta: { reason: "not_assigned" },
      });
      throw new AuthzError(403, "That case isn't assigned to you.");
    }

    // Logged before the content or URL is handed over. If this throws, the
    // request fails and no access happens.
    await audit(actor, {
      action: doc.storage_path ? "download_document" : "view_document",
      documentId,
      subjectId: doc.user_id as string,
      reason: reason || null,
      meta: { kind: doc.kind, name: doc.name },
    });

    // A stored file: hand back a URL that expires. Text-only records (essays,
    // activities) have no file and return their content directly.
    let url: string | null = null;
    if (doc.storage_path) {
      const signed = await sb.storage
        .from("documents")
        .createSignedUrl(doc.storage_path as string, SIGNED_URL_TTL);
      if (signed.error) throw new Error(signed.error.message);
      url = signed.data.signedUrl;
    }

    res.status(200).json({
      id: doc.id,
      kind: doc.kind,
      name: doc.name,
      mime: doc.mime,
      createdAt: doc.created_at,
      // Never the storage path — the client has no use for a permanent
      // pointer and it would outlive the signed URL.
      url,
      expiresIn: url ? SIGNED_URL_TTL : null,
      content: url ? null : doc.content,
    });
  } catch (e) {
    fail(res, e);
  }
}
