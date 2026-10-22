// Resolved paths for local tooling (pipeline, build scripts, the cost ledger).
//
// DATA_DIR is the research dataset root, OUTSIDE this repo — and outside the
// git worktree, so a relative ../data does not resolve. Override with the
// DATA_DIR env var; the default is the owner's local dataset. Resolved through
// functions (not constants) so a late-loaded .env.local is still honored.

import { join } from "node:path";

const DEFAULT_DATA_DIR = "/Users/ajaysharma/claude chance me/data";

export function dataDir(): string {
  return process.env.DATA_DIR || DEFAULT_DATA_DIR;
}

export function derivedDir(): string {
  return join(dataDir(), "derived");
}

/** Where model spend is recorded until the Supabase spend_ledger table exists:
 *  an append-only event log. The older `ledger.json` snapshot beside it, if
 *  present, seeds the state (see netlify/functions/_ledger.ts). */
export function ledgerPath(): string {
  return join(derivedDir(), "ledger.jsonl");
}
