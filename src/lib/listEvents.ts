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
