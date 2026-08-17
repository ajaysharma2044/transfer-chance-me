// Internal notes on a case.
//
// "Internal" here means one specific thing: no view in the applicant-facing
// app reads these, and nothing in src/components/ outside this folder imports
// them. It does NOT mean invisible or deniable, and the panel says so —
// a note written about a named person is personal data about that person, so
// it comes back to them under a subject-access or deletion request, and it is
// discoverable. Staff should write notes they would be content to read out.
//
// Note bodies are typed by staff rather than by applicants, but they are still
// rendered through block() and as plain text: an "internal" field is exactly
// where someone eventually pastes an applicant's own words.

import { useCallback, useEffect, useState } from "react";
import {
  addNote,
  asApiError,
  isMissingRoute,
  listNotes,
  type AdminApiError,
  type NoteRow,
} from "./api";
import { block, clean, fmtTime } from "./text";
import { EmptyState, ErrorNote, Loading } from "./ui";

const MAX = 4000;

export default function InternalNotes({ subjectId }: { subjectId: string }) {
  const [notes, setNotes] = useState<NoteRow[] | null>(null);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [busy, setBusy] = useState(true);
  const [reloads, setReloads] = useState(0);

  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<AdminApiError | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    setBusy(true);
    setError(null);
    listNotes(subjectId, ctl.signal)
      .then((res) => {
        if (ctl.signal.aborted) return;
        setNotes(res.notes ?? []);
        setBusy(false);
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        setError(asApiError(e));
        setNotes(null);
        setBusy(false);
      });
    return () => ctl.abort();
  }, [subjectId, reloads]);

  const retry = useCallback(() => setReloads((n) => n + 1), []);

  /** The route is absent rather than broken: say so, and do not offer a
   *  composer whose Save button cannot work. */
  const unavailable = !busy && !!error && isMissingRoute(error);

  const save = () => {
    const body = draft.trim();
    if (!body || saving) return;
    setSaving(true);
    setSaveError(null);
    addNote(subjectId, body)
      .then((res) => {
        setDraft("");
        setNotes((prev) => (res.note ? [res.note, ...(prev ?? [])] : prev));
        setSaving(false);
      })
      .catch((e: unknown) => {
        setSaveError(asApiError(e));
        setSaving(false);
      });
  };

  return (
    <section className="ad-panel ad-panel-internal">
      <div className="ad-panel-head">
        <div>
          <h2>
            Internal notes <span className="ad-tag ad-tag-internal">staff only</span>
          </h2>
          <p className="ad-panel-note">
            Never rendered anywhere in the applicant's own app. Still personal data about them:
            returnable under a subject-access request and discoverable. Write accordingly.
          </p>
        </div>
      </div>

      {/* Nothing serves /api/admin/notes and supabase/ has no table behind it,
          so the composer is disabled rather than inviting someone to type four
          paragraphs into a box that will throw them away. The list request is
          still made, so this whole panel comes alive on its own once the route
          and table exist. */}
      {!unavailable && (
        <div className="ad-notewrite">
          <label className="ad-lbl" htmlFor="ad-note-body">
            Add a note
          </label>
          <textarea
            id="ad-note-body"
            className="ad-textarea"
            rows={3}
            maxLength={MAX}
            value={draft}
            placeholder="What you checked, what you decided, what the next reviewer needs to know."
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="ad-notewrite-foot">
            <span className="ad-sub num">
              {draft.length}/{MAX}
            </span>
            <button
              type="button"
              className="ad-btn ad-btn-go"
              disabled={saving || draft.trim().length === 0}
              onClick={save}
            >
              {saving ? "Saving…" : "Save note"}
            </button>
          </div>
          {saveError && <ErrorNote error={saveError} what="saving the note" />}
        </div>
      )}

      {busy && <Loading label="Loading notes…" />}

      {unavailable && (
        <EmptyState title="Internal notes are not built yet.">
          Nothing serves /api/admin/notes, and there is no notes table in supabase/schema.sql or
          supabase/admin.sql — so this is a schema change as well as a route, and no note written
          here would be stored. Case context lives in the audit log's reason field until then.
        </EmptyState>
      )}

      {error && !busy && !unavailable && (
        <ErrorNote error={error} what="loading internal notes" onRetry={retry} />
      )}

      {!busy && !error && notes && notes.length === 0 && (
        <EmptyState title="No notes on this case yet.">
          Nobody on staff has written one. The first note is the one that saves the next reviewer
          re-reading the whole file.
        </EmptyState>
      )}

      {!busy && !error && notes && notes.length > 0 && (
        <ul className="ad-notes">
          {notes.map((n) => (
            <li key={n.id} className="ad-note">
              <p className="ad-note-meta">
                <b>{clean(n.authorEmail ?? n.authorId, 80) || "unknown author"}</b>
                <span className="num">{fmtTime(n.createdAt)}</span>
              </p>
              <p className="ad-note-body">{block(n.body, 4000)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
