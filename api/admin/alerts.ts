// GET /api/admin/alerts — staff behaviour that looks wrong.
//
// The admin_alerts view in supabase/admin.sql computes three things from the
// log itself: one account touching 25+ distinct subjects in an hour, 5+ failed
// actions in fifteen minutes, and 20+ export/download actions in an hour.
// Computed from the audit table rather than reported by the client, so an
// admin cannot avoid appearing here by not sending an event.
//
// Administrator and above, because the alerts name staff and the thresholds
// tell you what a scrape has to stay under. Reading them is logged like
// anything else — including, notably, when the person reading is the person
// the alert is about.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, fail, requireStaff, serviceClient } from "../_admin.js";
import { boundedInt, directory, noStore, queryParam, requireMethod } from "./_util.js";

const MAX_ROWS = 200;
const DEFAULT_ROWS = 100;

/** What each kind means, so the dashboard does not have to guess and so the
 *  wording lives next to the SQL that produces it. */
const EXPLAIN: Record<string, string> = {
  many_subjects: "Opened an unusual number of different students' files in the last hour.",
  failed_actions: "Several refused actions in the last fifteen minutes.",
  bulk_export: "A high volume of exports or document downloads in the last hour.",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    requireMethod(req, "GET");
    const actor = await requireStaff(req, { min: "administrator" });

    const limit = boundedInt(queryParam(req, "limit"), 1, MAX_ROWS, DEFAULT_ROWS);

    // Logged before the read, same rule as every other route here.
    await audit(actor, { action: "read_alerts", meta: { limit } });

    const sb = serviceClient();
    const { data, error } = await sb
      .from("admin_alerts")
      .select("actor_id, kind, value, last_seen")
      .order("last_seen", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const people = await directory(sb, rows.map((r) => r.actor_id as string));

    noStore(res);
    res.status(200).json({
      alerts: rows.map((r) => ({
        actorId: r.actor_id,
        actorEmail: people.get(r.actor_id as string)?.email ?? null,
        actorName: people.get(r.actor_id as string)?.name ?? null,
        kind: r.kind,
        // The raw count behind the threshold — a real number from the view,
        // not a severity score invented here.
        value: r.value,
        lastSeen: r.last_seen,
        explanation: EXPLAIN[String(r.kind)] ?? "Unusual staff activity.",
        // True when the person reading this list is the subject of the alert.
        aboutViewer: r.actor_id === actor.id,
      })),
      count: rows.length,
      truncated: rows.length >= limit,
    });
  } catch (e) {
    fail(res, e);
  }
}
