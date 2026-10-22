// D14: "Delete my data" re-uploaded the just-deleted profile ~1.2s later,
// because the debounced cloud push in App kept a copy of the in-memory profile
// and fired after deleteAllData(). The fix stops the push and clears in-memory
// + local state BEFORE the cloud delete. deleteMyData() encodes that ordering
// with injected effects so it is directly testable.

import { describe, expect, it } from "vitest";
import { deleteMyData } from "../src/lib/accountData";

describe("deleteMyData — stop the push and clear state before the cloud delete (D14)", () => {
  it("suppresses, cancels the pending push, and clears before deleting; re-enables after", async () => {
    const calls: string[] = [];
    await deleteMyData({
      suppress: (on) => calls.push(`suppress:${on}`),
      cancelPendingPush: () => calls.push("cancelPendingPush"),
      clearLocalMaterial: () => calls.push("clearLocalMaterial"),
      resetProfile: () => calls.push("resetProfile"),
      deleteCloud: async () => { calls.push("deleteCloud"); },
    });

    const del = calls.indexOf("deleteCloud");
    expect(del).toBeGreaterThanOrEqual(0);
    for (const before of ["suppress:true", "cancelPendingPush", "clearLocalMaterial", "resetProfile"]) {
      expect(calls.indexOf(before), `${before} must precede the cloud delete`).toBeLessThan(del);
    }
    expect(calls.indexOf("suppress:false"), "sync re-enabled only after the delete").toBeGreaterThan(del);
  });

  it("re-enables sync even when the cloud delete fails (no permanent lock)", async () => {
    const calls: string[] = [];
    await expect(
      deleteMyData({
        suppress: (on) => calls.push(`suppress:${on}`),
        cancelPendingPush: () => {},
        clearLocalMaterial: () => {},
        resetProfile: () => {},
        deleteCloud: async () => { throw new Error("network"); },
      }),
    ).rejects.toThrow("network");
    expect(calls).toContain("suppress:false");
  });
});
