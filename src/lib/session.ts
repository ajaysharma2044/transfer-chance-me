// Account-owned local state: what belongs to one signed-in (or guest) user,
// and the rules that keep it from bleeding into the next account.
//
// D1 (spec_v3 Step 2): logout used to clear only the session key, leaving the
// profile (essays/activities/awards), school list, last review and uploaded
// document text in localStorage; and the login-sync effect pushed that
// in-memory profile into a freshly signed-in account with an empty cloud row,
// writing one student's materials — some from minors — into another's account.

import { dispatchListChanged, dispatchUserDataCleared } from "./listEvents";

/**
 * Per-user keys cleared on logout and account deletion.
 *
 * Deliberately NOT here:
 *  · `tcm.users.v1` — the local-account registry (salted password hashes).
 *    Clearing it on logout would delete every local account on the device and
 *    lock the user out, since `logIn` reads it. Shared-device exposure of the
 *    registry is a separate, lower-severity design issue (see manual_todo).
 *  · `tcm.waitlist.v1` — a marketing list, not one user's material.
 */
export const PER_USER_KEYS = [
  "tcm.profile.v1",      // the Profile: GPA, essays, activities, awards, …
  "tcm.list.v1",         // My Schools tracker
  "tcm.review.v1",       // last deep-review result
  "tcm.appdocs.v1",      // uploaded document names + extracted text
  "tcm.apikey.v1",       // the user's own Anthropic key (browser-direct review)
  "tcm.panel.v1",        // per-user UI panel state
  "tcm.schooldomain.v1", // user-set favicon domain overrides
  "tcm.session.v1",      // the mirrored session
  "tcm.owner.v1",        // the owner stamp below
] as const;

/** The keys holding the student's own material — the subset "Delete my data"
 *  clears while the login stays (session, owner stamp and API key are kept).
 *  The cached panel report is material too: its notes quote the essay
 *  verbatim, so a deletion that left it behind was no deletion. */
export const USER_MATERIAL_KEYS = [
  "tcm.profile.v1", "tcm.list.v1", "tcm.review.v1", "tcm.appdocs.v1", "tcm.panel.v1",
] as const;

const OWNER_KEY = "tcm.owner.v1";
const NEXT_KEY = "tcm.next.v1"; // sessionStorage: post-login redirect target

/**
 * Who the locally-stored profile belongs to: an account email, or `null` when
 * it is an anonymous guest draft. The login-sync step reads this to decide
 * whether local data may be pushed into an account — A's data must never land
 * in B's row.
 */
export function getProfileOwner(): string | null {
  try { return localStorage.getItem(OWNER_KEY); } catch { return null; }
}

export function setProfileOwner(email: string | null): void {
  try {
    if (email) localStorage.setItem(OWNER_KEY, email);
    else localStorage.removeItem(OWNER_KEY);
  } catch { /* storage unavailable — nothing to stamp */ }
}

/**
 * Remove every per-user key so the next account starts clean, and drop the
 * post-login redirect. Call on logout and on account deletion. The caller is
 * responsible for resetting in-memory React state (setProfile(DEFAULT_PROFILE)),
 * because clearing storage alone leaves the previous user's profile in memory.
 */
export function clearUserLocalState(): void {
  for (const k of PER_USER_KEYS) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  }
  try { sessionStorage.removeItem(NEXT_KEY); } catch { /* ignore */ }
  announceCleared();
}

/** Clear the signed-in user's material without logging them out — used by
 *  "Delete my data" (D14). Session, owner stamp and API key are kept. */
export function clearUserMaterial(): void {
  for (const k of USER_MATERIAL_KEYS) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  }
  announceCleared();
}

/** Storage is clean; now the components holding copies in React state must
 *  drop theirs, or the first edit writes the previous account's list or drafts
 *  back under the new owner. */
function announceCleared(): void {
  dispatchListChanged();
  dispatchUserDataCleared();
}

export type LoginSyncAction = "adopt-cloud" | "push-local" | "reset-local";

/**
 * Decide what to do with local profile data when a user signs in.
 *
 *  · adopt-cloud — the account already has a saved profile; take it.
 *  · push-local  — the local data is this user's own, or an anonymous guest
 *                  draft; it may be saved into the account.
 *  · reset-local — the local data belongs to a DIFFERENT account; it must be
 *                  discarded, never pushed. This is the D1 leak guard.
 */
export function loginSyncAction(args: {
  hasCloudProfile: boolean;
  localOwner: string | null;
  userEmail: string;
}): LoginSyncAction {
  if (args.hasCloudProfile) return "adopt-cloud";
  if (args.localOwner == null || args.localOwner === args.userEmail) return "push-local";
  return "reset-local";
}
