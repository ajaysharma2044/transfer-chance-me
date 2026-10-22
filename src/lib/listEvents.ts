/* Cross-component notification that the school-list has changed.
 *
 * Portal writes `tcm.list.v1` in localStorage on every edit; Audit needs to
 * unlock its section 3 the moment a school is added. The `storage` event only
 * fires in OTHER tabs, so we dispatch a custom event on the same window too.
 * Keep this tiny — one string, one dispatcher, one subscriber helper. */

export const LIST_EVENT = "tcm-list-changed";

export function dispatchListChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LIST_EVENT));
}

/** Subscribe to list changes from this tab AND from other tabs. Returns the
 *  disposer. */
export function subscribeListChanged(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onCustom = (): void => fn();
  const onStorage = (e: StorageEvent): void => {
    if (e.key === "tcm.list.v1") fn();
  };
  window.addEventListener(LIST_EVENT, onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(LIST_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}

/* The per-user keys were just wiped (logout, a sign-in that found another
 * account's data, or "Delete my data"). Clearing storage alone is not enough:
 * components keep their own copies in React state and would write the previous
 * user's list or drafts straight back — into the next account. Every component
 * that caches user material in state reloads from storage on this event. */

export const USER_DATA_CLEARED_EVENT = "tcm-user-data-cleared";

export function dispatchUserDataCleared(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(USER_DATA_CLEARED_EVENT));
}

export function subscribeUserDataCleared(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const on = (): void => fn();
  window.addEventListener(USER_DATA_CLEARED_EVENT, on);
  return () => window.removeEventListener(USER_DATA_CLEARED_EVENT, on);
}
