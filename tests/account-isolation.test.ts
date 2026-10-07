// D1 (spec_v3 Step 2): logout and account-switch isolation.
//
// The shipped bug: logout left one user's material (tcm.profile.v1 carries
// essays/activities/awards, tcm.list.v1, tcm.review.v1, tcm.appdocs.v1) in
// localStorage, and the login-sync effect pushed the in-memory profile into a
// freshly signed-in account whose cloud row was empty — writing user A's
// materials (some from minors) into user B's account.
//
// Two defenses, both pure and testable here without a DOM harness:
//   · clearUserLocalState() wipes every per-user key on logout/deletion, but
//     keeps the local-account registry (tcm.users.v1) so people can log back
//     in, and the marketing waitlist (tcm.waitlist.v1), which is not per-user.
//   · loginSyncAction() decides adopt-cloud / push-local / reset-local from
//     cloud presence + the owner stamp, so A's data can never be pushed into B.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearUserLocalState,
  getProfileOwner,
  loginSyncAction,
  setProfileOwner,
} from "../src/lib/session";

// Minimal in-memory Storage so this runs under vitest's node environment.
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  has(k: string) { return this.m.has(k); }
}

const PER_USER = [
  "tcm.profile.v1", "tcm.list.v1", "tcm.review.v1", "tcm.appdocs.v1",
  "tcm.apikey.v1", "tcm.panel.v1", "tcm.schooldomain.v1", "tcm.session.v1", "tcm.owner.v1",
];

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
  (globalThis as unknown as { sessionStorage: MemStorage }).sessionStorage = new MemStorage();
});
afterEach(() => {
  delete (globalThis as unknown as { localStorage?: MemStorage }).localStorage;
  delete (globalThis as unknown as { sessionStorage?: MemStorage }).sessionStorage;
});

describe("clearUserLocalState — logout leaves no per-user material (D1)", () => {
  it("removes every per-user key but keeps the local-account registry and waitlist", () => {
    for (const k of PER_USER) localStorage.setItem(k, "A-material");
    localStorage.setItem("tcm.users.v1", '[{"email":"a@x.com"}]');
    localStorage.setItem("tcm.waitlist.v1", '["e@x.com"]');
    sessionStorage.setItem("tcm.next.v1", "results");

    clearUserLocalState();

    for (const k of PER_USER) {
      expect((localStorage as unknown as MemStorage).has(k), `${k} must be cleared`).toBe(false);
    }
    // Clearing the registry would lock every local account out — must survive.
    expect((localStorage as unknown as MemStorage).has("tcm.users.v1")).toBe(true);
    // Not per-user material.
    expect((localStorage as unknown as MemStorage).has("tcm.waitlist.v1")).toBe(true);
    // The post-login redirect lives in sessionStorage and is cleared too.
    expect((sessionStorage as unknown as MemStorage).has("tcm.next.v1")).toBe(false);
  });
});

describe("profile owner stamp", () => {
  it("round-trips an owner and clears back to anonymous", () => {
    expect(getProfileOwner()).toBeNull();
    setProfileOwner("a@example.com");
    expect(getProfileOwner()).toBe("a@example.com");
    setProfileOwner(null);
    expect(getProfileOwner()).toBeNull();
  });
});

describe("loginSyncAction — A's local data never lands in B's account (D1)", () => {
  it("adopts the cloud profile when the account already has one", () => {
    expect(loginSyncAction({ hasCloudProfile: true, localOwner: "a@x.com", userEmail: "b@x.com" }))
      .toBe("adopt-cloud");
  });
  it("adopts an anonymous guest draft into the new account", () => {
    expect(loginSyncAction({ hasCloudProfile: false, localOwner: null, userEmail: "b@x.com" }))
      .toBe("push-local");
  });
  it("keeps a user's own returning local data", () => {
    expect(loginSyncAction({ hasCloudProfile: false, localOwner: "b@x.com", userEmail: "b@x.com" }))
      .toBe("push-local");
  });
  it("resets — never pushes — local data owned by a different account", () => {
    expect(loginSyncAction({ hasCloudProfile: false, localOwner: "a@x.com", userEmail: "b@x.com" }))
      .toBe("reset-local");
  });
});
