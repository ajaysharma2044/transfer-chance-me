// Cross-device sync: the signed-in user's profile, school list and written
// material, stored against their account so their work follows them.
//
// What goes up: the numeric profile, the My Schools tracker, and the material
// they write or upload — "why transfer" essay, personal statement, activities,
// awards, and text extracted from a transcript. This is real student data,
// some of it from minors, so it is written only under an authenticated
// session and read back only by that same account (row-level security in
// supabase/schema.sql enforces that server-side, not just here).
//
// Everything degrades quietly: with no Supabase configured, or nobody signed
// in, these are no-ops and the app keeps working entirely on localStorage.

import type { Profile } from "../engine";
import { cloudEnabled, supabase } from "./supabase";

export type DocKind = "transcript" | "essay" | "statement" | "activities" | "awards";

export interface CloudState {
  profile: Profile | null;
  schools: Record<string, { status: string; notes: string }> | null;
}

/** The signed-in user's id, or null. Every write below is scoped to it. */
async function uid(): Promise<string | null> {
  if (!cloudEnabled || !supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/** True when there is a backend AND somebody signed in to write against. */
export async function syncReady(): Promise<boolean> {
  return (await uid()) !== null;
}

/* ── Profile and school list ─────────────────────────────────────────────── */

export async function pushProfile(
  profile: Profile,
  schools?: Record<string, { status: string; notes: string }>,
): Promise<void> {
  const id = await uid();
  if (!id || !supabase) return;
  const row: Record<string, unknown> = { id, profile, updated_at: new Date().toISOString() };
  if (schools) row.schools = schools;
  const { error } = await supabase.from("profiles").upsert(row);
  if (error) throw new Error(`Couldn't save your profile: ${error.message}`);
}

/** What the account holds. Returns nulls when there is nothing stored yet,
 *  so a caller can tell "no cloud copy" from "an empty one". */
export async function pullProfile(): Promise<CloudState> {
  const id = await uid();
  if (!id || !supabase) return { profile: null, schools: null };
  const { data, error } = await supabase
    .from("profiles")
    .select("profile, schools")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Couldn't load your profile: ${error.message}`);
  return {
    profile: (data?.profile as Profile) ?? null,
    schools: (data?.schools as CloudState["schools"]) ?? null,
  };
}

/* ── Written and uploaded material ───────────────────────────────────────── */

/** Store one document. Empty content is dropped rather than written as a
 *  blank row — an empty essay is not a saved essay. */
export async function pushDoc(kind: DocKind, content: string, name?: string): Promise<void> {
  const id = await uid();
  if (!id || !supabase || !content.trim()) return;
  const { error } = await supabase
    .from("documents")
    .insert({ user_id: id, kind, name: name ?? null, content });
  if (error) throw new Error(`Couldn't save your ${kind}: ${error.message}`);
}

export interface StoredDoc {
  id: string;
  kind: DocKind;
  name: string | null;
  content: string;
  created_at: string;
}

export async function listDocs(kind?: DocKind): Promise<StoredDoc[]> {
  const id = await uid();
  if (!id || !supabase) return [];
  let q = supabase.from("documents").select("*").eq("user_id", id);
  if (kind) q = q.eq("kind", kind);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw new Error(`Couldn't load your documents: ${error.message}`);
  return (data ?? []) as StoredDoc[];
}

/** Delete one document. Users are entitled to take their material back. */
export async function deleteDoc(docId: string): Promise<void> {
  const id = await uid();
  if (!id || !supabase) return;
  const { error } = await supabase.from("documents").delete().eq("id", docId).eq("user_id", id);
  if (error) throw new Error(`Couldn't delete that: ${error.message}`);
}

/** Delete everything this account has stored. Wire this to a visible control
 *  before launch — under GDPR/CCPA an erasure request is not optional, and
 *  the account itself is removed from the Supabase dashboard or via an admin
 *  function (the anon key deliberately cannot delete auth users). */
export async function deleteAllData(): Promise<void> {
  const id = await uid();
  if (!id || !supabase) return;
  const docs = await supabase.from("documents").delete().eq("user_id", id);
  if (docs.error) throw new Error(`Couldn't delete your documents: ${docs.error.message}`);
  const prof = await supabase.from("profiles").update({ profile: null, schools: null }).eq("id", id);
  if (prof.error) throw new Error(`Couldn't clear your profile: ${prof.error.message}`);
}
