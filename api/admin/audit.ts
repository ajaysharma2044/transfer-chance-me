// GET /api/admin/audit — search the access log.
//
// The log is the answer to "who read this student's file, and when". Two
// consequences shape this route:
//
//   · reviewers cannot read it at all. Not even their own rows: the log names
//     every subject an administrator has opened, so a reviewer with read
//     access could enumerate accounts they were never assigned.
//   · reading it is itself an audited action, written BEFORE the query runs.
//     Someone checking whether their own trail is visible leaves a trail of
//     having checked, and a search that cannot be logged does not happen.
//
// The log is append-only in the database (no UPDATE or DELETE policy, plus a
// trigger), so there is no write path here at all — this route only reads.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, fail, requireStaff, serviceClient } from "../_admin.js";
import {
  boundedInt, directory, noStore, optionalAction, optionalDate, optionalUuid,
  queryParam, requireMethod,
} from "./_util.js";

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;
/** Deep paging into a growing log is a scrape, not a search. */
const MAX_PAGE = 200;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    requireMethod(req, "GET");
    const actor = await requireStaff(req, { min: "administrator" });

    const actorFilter = optionalUuid(queryParam(req, "actor"), "actor");
    const subjectFilter = optionalUuid(queryParam(req, "subject"), "subject");
    const action = optionalAction(queryParam(req, "action"));
    const from = optionalDate(queryParam(req, "from"), "from");
    const to = optionalDate(queryParam(req, "to"), "to");
    const successParam = queryParam(req, "success");
    const onlyFailures = successParam === "false";
    const limit = boundedInt(queryParam(req, "limit"), 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
    const page = boundedInt(queryParam(req, "page"), 0, MAX_PAGE, 0);

    // Written first: if the log cannot record this search, the search does
    // not run. audit() throws on a failed write and fail() turns that into a
    // 500 — deliberately, an unlogged read of the log is the worst case here.
    await audit(actor, {
      action: "read_audit_log",
      subjectId: subjectFilter,
      meta: {
        filters: {
          actor: actorFilter, subject: subjectFilter, action,
          from, to, onlyFailures: onlyFailures || undefined,
        },
        page, limit,
      },
    });

    const sb = serviceClient();
    let query = sb
      .from("admin_audit")
      .select(
        "id, actor_id, actor_role, action, subject_id, document_id, reason, success, ip, user_agent, meta, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(page * limit, page * limit + limit - 1);

    if (actorFilter) query = query.eq("actor_id", actorFilter);
    if (subjectFilter) query = query.eq("subject_id", subjectFilter);
    if (action) query = query.eq("action", action);
    if (from) query = query.gte("created_at", from);
    if (to) query = query.lte("created_at", to);
    if (onlyFailures) query = query.eq("success", false);

    const { data, count, error } = await query;
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const people = await directory(
      sb,
      rows.flatMap((r) => [r.actor_id as string, r.subject_id as string | null]),
    );

    noStore(res);
    res.status(200).json({
      // Values pass through as stored, including reason and user_agent, which
      // are strings typed by people. They are data, not markup: the admin UI
      // renders them as text and never with dangerouslySetInnerHTML.
      entries: rows.map((r) => ({
        id: r.id,
        at: r.created_at,
        action: r.action,
        actorId: r.actor_id,
        actorEmail: people.get(r.actor_id as string)?.email ?? null,
        actorRole: r.actor_role,
        subjectId: r.subject_id ?? null,
        subjectEmail: r.subject_id ? people.get(r.subject_id as string)?.email ?? null : null,
        documentId: r.document_id ?? null,
        reason: r.reason ?? null,
        success: r.success,
        ip: r.ip ?? null,
        userAgent: r.user_agent ?? null,
        meta: r.meta ?? null,
      })),
      total: count ?? rows.length,
      page,
      limit,
    });
  } catch (e) {
    fail(res, e);
  }
}
