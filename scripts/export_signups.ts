// Export every signup and their file to CSV, for the tracking spreadsheet.
//
//   SUPABASE_SERVICE_ROLE_KEY=... npx vite-node scripts/export_signups.ts [out.csv]
//
// WHAT THIS DELIBERATELY DOES NOT EXPORT, and why:
//
//   Passwords. Supabase stores a bcrypt hash and never the password itself,
//   so there is nothing to export even with the service-role key. Any tracker
//   column called "password" would be a lie or a liability; there isn't one.
//
//   Raw essay and transcript TEXT. The documents table holds what students
//   wrote, some of them minors. Those rows are protected by row-level
//   security in Postgres; a spreadsheet has link-sharing, no row-level
//   access control, and travels by email. So this exports the SHAPE of each
//   upload — kind, filename, word count, when — which answers "who uploaded
//   what, and is it substantial enough to review" without copying the
//   contents of a 17-year-old's personal statement into a shareable doc.
//   Read the material itself in the admin portal, where every access is
//   authorised and written to admin_audit.
//
// This needs the SERVICE-ROLE key, which bypasses row-level security. Run it
// locally, never ship it, and never put that key in a VITE_ var.

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing config.\n" +
      "  VITE_SUPABASE_URL         (in .env.local already)\n" +
      "  SUPABASE_SERVICE_ROLE_KEY (Supabase dashboard → Settings → API → service_role)\n\n" +
      "Run:  SUPABASE_SERVICE_ROLE_KEY=xxx npx vite-node scripts/export_signups.ts",
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

interface ProfileRow {
  id: string;
  email: string | null;
  name: string | null;
  profile: Record<string, unknown> | null;
  schools: Record<string, { status: string; notes: string }> | null;
  created_at: string;
  updated_at: string;
}

interface DocRow {
  user_id: string;
  kind: string;
  name: string | null;
  content: string | null;
  created_at: string;
}

function words(s: string | null | undefined): number {
  return s ? s.trim().split(/\s+/).filter(Boolean).length : 0;
}

/** RFC 4180: quote everything, double any embedded quote. Student-written
 *  fields contain commas, quotes and newlines, and an unquoted export would
 *  silently shift every column after the first essay title with a comma. */
function csv(rows: (string | number)[][]): string {
  return rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

async function main() {
  // auth.users is only reachable through the admin API, and it is the only
  // place the signup timestamp and the provider (google vs email) live.
  const users: { id: string; email?: string; created_at: string; last_sign_in_at?: string | null;
    app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }

  const { data: profiles, error: pErr } = await admin
    .from("profiles").select("id, email, name, profile, schools, created_at, updated_at");
  if (pErr) throw new Error(`profiles: ${pErr.message}`);

  const { data: docs, error: dErr } = await admin
    .from("documents").select("user_id, kind, name, content, created_at");
  if (dErr) throw new Error(`documents: ${dErr.message}`);

  const byId = new Map((profiles as ProfileRow[]).map((p) => [p.id, p]));
  const docsById = new Map<string, DocRow[]>();
  for (const d of (docs as DocRow[]) ?? []) {
    const list = docsById.get(d.user_id) ?? [];
    list.push(d);
    docsById.set(d.user_id, list);
  }

  const header = [
    "Signed up", "Last sign-in", "Email", "Name", "Provider",
    "GPA", "Trend", "Current school", "High school", "HS grad year",
    "Institution", "Standing", "Major", "Major detail", "CA resident",
    "IGETC", "PTK", "Honors", "First-gen", "SAT", "Work hrs/wk",
    "Courses on file", "Schools tracked", "School list", "Statuses",
    "Transcript", "Essay words", "Statement words", "Activities words", "Awards words",
    "Docs total", "Profile updated", "User id",
  ];

  const rows: (string | number)[][] = [header];

  for (const u of users) {
    const p = byId.get(u.id);
    const pr = (p?.profile ?? {}) as Record<string, unknown>;
    const ds = docsById.get(u.id) ?? [];
    const latest = (kind: string) =>
      ds.filter((d) => d.kind === kind).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

    const schools = p?.schools ?? {};
    const names = Object.keys(schools);
    const transcript = latest("transcript");
    const courses = Array.isArray(pr.courses) ? (pr.courses as unknown[]).length : 0;

    rows.push([
      u.created_at?.slice(0, 10) ?? "",
      u.last_sign_in_at?.slice(0, 10) ?? "",
      u.email ?? p?.email ?? "",
      (u.user_metadata?.full_name as string) ?? p?.name ?? "",
      (u.app_metadata?.provider as string) ?? "email",
      (pr.gpa as number) ?? "",
      (pr.gpaTrend as string) ?? "",
      (pr.schoolName as string) ?? "",
      (pr.highSchool as string) ?? "",
      (pr.hsGradYear as number) ?? "",
      (pr.institution as string) ?? "",
      (pr.standing as string) ?? "",
      (pr.major as string) ?? "",
      (pr.majorDetail as string) ?? "",
      pr.caResident ? "yes" : "",
      pr.igetc ? "yes" : "",
      pr.ptk ? "yes" : "",
      pr.honors ? "yes" : "",
      pr.firstGen ? "yes" : "",
      (pr.sat as number) ?? "",
      (pr.workHours as number) ?? "",
      courses,
      names.length,
      names.join(" · "),
      names.map((n) => `${n}:${schools[n]?.status ?? "?"}`).join(" · "),
      transcript ? (transcript.name ?? "uploaded") : "",
      words(latest("essay")?.content),
      words(latest("statement")?.content),
      words(latest("activities")?.content),
      words(latest("awards")?.content),
      ds.length,
      p?.updated_at?.slice(0, 10) ?? "",
      u.id,
    ]);
  }

  const out = process.argv[2] ?? "signups.csv";
  writeFileSync(out, csv(rows));

  // Second sheet: ONE ROW PER UPLOADED FILE, not one per person. The summary
  // above collapses a student with four documents into four word-counts; this
  // is the list of the actual artefacts, so a file can be found and opened in
  // the admin portal by name and date.
  const fileHeader = [
    "Uploaded", "Email", "Name", "Kind", "Filename", "Words", "Characters", "Preview", "User id",
  ];
  const fileRows: (string | number)[][] = [fileHeader];
  const allDocs = ((docs as DocRow[]) ?? [])
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  for (const d of allDocs) {
    const u = users.find((x) => x.id === d.user_id);
    const p = byId.get(d.user_id);
    fileRows.push([
      d.created_at?.slice(0, 16).replace("T", " ") ?? "",
      u?.email ?? p?.email ?? "",
      (u?.user_metadata?.full_name as string) ?? p?.name ?? "",
      d.kind,
      d.name ?? (d.kind === "transcript" ? "(pasted)" : "(typed in app)"),
      words(d.content),
      d.content?.length ?? 0,
      // First line only, hard-capped. Enough to recognise which draft this is
      // in a list of five; not enough to be a copy of the document. The full
      // text stays in Postgres behind row-level security and the audit log.
      (d.content ?? "").trim().split("\n")[0].slice(0, 80),
      d.user_id,
    ]);
  }

  const filesOut = out.replace(/\.csv$/, "") + "_files.csv";
  writeFileSync(filesOut, csv(fileRows));

  console.log(JSON.stringify({
    out,
    filesOut,
    users: users.length,
    withProfile: users.filter((u) => byId.has(u.id)).length,
    withDocs: users.filter((u) => (docsById.get(u.id)?.length ?? 0) > 0).length,
    uploadedFiles: allDocs.length,
    byKind: allDocs.reduce<Record<string, number>>((m, d) => {
      m[d.kind] = (m[d.kind] ?? 0) + 1;
      return m;
    }, {}),
  }, null, 1));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
