// D1, the in-memory half. clearUserLocalState()/clearUserMaterial() wipe the
// per-user keys, but Portal keeps the school list and Review keeps the pasted
// statement in React state — and both persist that state back to storage on
// change. Seen live: sign in as account B on a device where A was signed in,
// storage is clean, yet the page still shows A's school; one edit would have
// written A's list (and pushed it) under B. The fix is a broadcast the
// components subscribe to; this pins that the clears actually broadcast.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LIST_EVENT, USER_DATA_CLEARED_EVENT } from "../src/lib/listEvents";
import { clearUserLocalState, clearUserMaterial } from "../src/lib/session";

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}

type G = { localStorage?: MemStorage; sessionStorage?: MemStorage; window?: EventTarget };
const g = globalThis as unknown as G;

beforeEach(() => {
  g.localStorage = new MemStorage();
  g.sessionStorage = new MemStorage();
  g.window = new EventTarget(); // Node's EventTarget + CustomEvent are enough
});
afterEach(() => {
  delete g.localStorage;
  delete g.sessionStorage;
  delete g.window;
});

function listen(): Record<string, number> {
  const counts: Record<string, number> = { [LIST_EVENT]: 0, [USER_DATA_CLEARED_EVENT]: 0 };
  for (const name of Object.keys(counts)) g.window!.addEventListener(name, () => { counts[name] += 1; });
  return counts;
}

describe("clearing per-user storage tells the components holding copies", () => {
  it("logout / reset-local broadcasts both the list change and the user-data-cleared event", () => {
    const counts = listen();
    g.localStorage!.setItem("tcm.list.v1", JSON.stringify([{ school: "Cornell", status: "planning", note: "" }]));
    clearUserLocalState();
    expect(g.localStorage!.getItem("tcm.list.v1")).toBeNull();
    expect(counts[LIST_EVENT]).toBe(1);
    expect(counts[USER_DATA_CLEARED_EVENT]).toBe(1);
  });

  it("'Delete my data' broadcasts too, and takes the cached panel report with it", () => {
    const counts = listen();
    // The report's notes quote the essay verbatim — it is material, not UI state.
    g.localStorage!.setItem("tcm.panel.v1", JSON.stringify({ grade: "B", reports: [{ notes: [{ quote: "my essay line" }] }] }));
    g.localStorage!.setItem("tcm.apikey.v1", "sk-ant-keep-me");
    clearUserMaterial();
    expect(g.localStorage!.getItem("tcm.panel.v1")).toBeNull();
    expect(g.localStorage!.getItem("tcm.apikey.v1")).toBe("sk-ant-keep-me"); // the login-side keys stay
    expect(counts[LIST_EVENT]).toBe(1);
    expect(counts[USER_DATA_CLEARED_EVENT]).toBe(1);
  });

  it("still works where there is no window at all (tests, scripts)", () => {
    delete g.window;
    expect(() => clearUserLocalState()).not.toThrow();
  });
});
