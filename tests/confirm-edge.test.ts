// Edges of explicit confirmation found in review (docs/spec.md §4): clearing
// a parsed school name must not vouch for the parsed institution type, and a
// document import that changes a confirmed field must un-confirm it.

import { describe, expect, it } from "vitest";
import { confirmFor } from "../src/lib/profile";

describe("confirmFor", () => {
  it("a real school pick confirms the institution", () => {
    expect(confirmFor({ schoolName: "De Anza College", institution: "cc" })).toEqual({ institution: true });
  });

  it("clearing the school name confirms nothing", () => {
    expect(confirmFor({ schoolName: null })).toEqual({});
  });

  it("editing GPA confirms only GPA", () => {
    expect(confirmFor({ gpa: 3.7 })).toEqual({ gpa: true });
  });
});
