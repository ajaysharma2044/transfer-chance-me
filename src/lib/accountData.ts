// "Delete my data" orchestration (D14).
//
// The bug: App debounces a cloud push of the profile (~1.2s after any change).
// "Delete my data" deleted the cloud rows but left the in-memory profile alone,
// so the pending push re-uploaded it and the data came back. The fix stops the
// push and clears in-memory + local state BEFORE the cloud delete. The concrete
// effects are injected so the ordering stays unit-testable.

export interface DeleteMyDataDeps {
  /** Turn the debounced cloud push off (true) or back on (false). */
  suppress: (on: boolean) => void;
  /** Cancel any already-scheduled push so it can't fire mid-delete. */
  cancelPendingPush: () => void;
  /** Remove the user's material from localStorage (login stays). */
  clearLocalMaterial: () => void;
  /** Reset the in-memory profile to its default. */
  resetProfile: () => void;
  /** Delete the user's rows in the cloud. */
  deleteCloud: () => Promise<void>;
}

export async function deleteMyData(deps: DeleteMyDataDeps): Promise<void> {
  // Everything that could cause a re-upload happens first.
  deps.suppress(true);
  deps.cancelPendingPush();
  deps.clearLocalMaterial();
  deps.resetProfile();
  try {
    await deps.deleteCloud();
  } finally {
    // Always re-enable, even on failure, so a failed delete doesn't leave the
    // app permanently unable to sync.
    deps.suppress(false);
  }
}
