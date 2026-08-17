// GET /api/admin/cases — the case list an actor is allowed to see.
//
// Reviewers get only their current assignments; administrators and owners get
// the full list. The scoping happens here, server-side, from the role read
// out of staff_roles — a reviewer who calls this route directly with a
// crafted query string still receives only their own cases.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, AuthzError, fail, requireStaff, serviceClient } from "../_admin.js";

const PAGE = 50;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ error: "Method not allowed." });
      return;
    }
    const actor = await requireStaff(req);
    const sb = serviceClient();

    // req.query values can be arrays; String() on an array joins with commas
    // and would smuggle a comma into the filter grammar below.
    const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    const rawQ = String(first(req.query.q) ?? "").trim().slice(0, 120);
    // PostgREST's .or() takes a comma-separated filter EXPRESSION. Any comma,
    // parenthesis or dot in user text is grammar, not data — a name like
    // "O'Brien, Mary" breaks the query, and a crafted value could bolt on
    // filters the caller was never meant to run. Restrict the search to
    // characters that cannot be grammar and reject the rest outright.
    const q = /^[\w@.\- ]*$/.test(rawQ) ? rawQ.replace(/[.]/g, "") : null;
    if (rawQ && q === null) throw new AuthzError(400, "Search contains characters that aren't allowed.");
    const status = String(first(req.query.status) ?? "").trim();
    const page = Math.min(200, Math.max(0, Number(first(req.query.page) ?? 0) || 0));

    // Reviewers: restrict to assigned subjects before any other filter.
    let allowed: string[] | null = null;
    if (actor.role === "reviewer") {
      const { data } = await sb
        .from("case_assignments")
        .select("subject_id")
        .eq("reviewer_id", actor.id)
        .is("released_at", null);
      allowed = (data ?? []).map((r) => r.subject_id as string);
      if (allowed.length === 0) {
        await audit(actor, { action: "list_cases", meta: { count: 0, scope: "assigned" } });
        res.status(200).json({ cases: [], total: 0, scope: "assigned" });
        return;
      }
    }

    let query = sb
      .from("profiles")
      .select("id, email, name, profile, schools, updated_at", { count: "exact" })
      .order("updated_at", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);

    if (allowed) query = query.in("id", allowed);
    if (q) query = query.or(`email.ilike.%${q}%,name.ilike.%${q}%`);
    if (status === "no_profile") query = query.is("profile", null);

    const { data, count, error } = await query;
    if (error) throw new Error(error.message);

    // The list view deliberately carries no essay or transcript text: opening
    // a document is a separate, individually audited action.
    const cases = (data ?? []).map((r) => {
      const p = (r.profile ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        email: r.email,
        name: r.name,
        gpa: p.gpa ?? null,
        major: p.major ?? null,
        institution: p.institution ?? null,
        schoolName: p.schoolName ?? null,
        targets: Object.keys((r.schools ?? {}) as object).length,
        updatedAt: r.updated_at,
      };
    });

    await audit(actor, {
      action: "list_cases",
      meta: { count: cases.length, scope: allowed ? "assigned" : "all", q: q || undefined },
    });

    // Applicant data must never sit in a shared cache or browser history.
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.status(200).json({ cases, total: count ?? cases.length, scope: allowed ? "assigned" : "all" });
  } catch (e) {
    fail(res, e);
  }
}
