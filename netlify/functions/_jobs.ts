// The job store shared by review.ts (which writes the request and reads the
// result) and review-background.ts (which claims the job, reads the request
// and writes the result).
//
// This is Netlify Blobs, NOT Upstash Redis.
//
// The split-invocation design needs somewhere for the two halves to meet, and
// the obvious answer looked like Redis. It was the wrong answer: Netlify ships
// a key-value store built into the platform, available to every function with
// no signup, no second bill, and no third party holding student review text.
// Adding Upstash would have meant a new vendor storing essays and transcripts
// to solve a problem the host already solves.
//
// Consequences of Blobs rather than Redis, all handled below:
//
//   1. There is no TTL. Expiry is a timestamp written into the record and
//      checked on read.
//   2. Read-modify-write is not atomic. Fine for a per-IP request counter
//      (`bump`), NOT fine for anything that must be exact.
//   3. There IS a conditional write (`onlyIfNew`), which is what makes the
//      worker's claim one-shot: two invocations for the same job cannot both
//      run — and pay for — it.
//
// With the typed contract (docs/spec.md §5) the store holds the parsed
// AuditRequest, never a browser-authored prompt, and every record carries the
// uid that started it — poll() refuses anyone else.

import { getStore } from "@netlify/blobs";
import type { AuditRequest, Section, SectionKind } from "../../src/lib/audit/schema";

/** How long a finished section stays readable. Long enough to survive a reload
 *  and a slow reader; short enough that student material is not kept around. */
export const JOB_TTL_SEC = 60 * 60; // 1 hour

/** Budget for the worker's WHOLE run, retry included — well inside Netlify's
 *  15-minute background ceiling, so a hung upstream still leaves time to
 *  record a readable failure. */
export const RUN_BUDGET_MS = 600_000;

/** Poll cadence, sent in the 202 so the client does not hard-code a copy. */
export const POLL_AFTER_MS = 3_000;

/** Past this a still-pending job is dead: the worker's budget plus a margin
 *  for the trigger and the store. Sent in the 202 as expiresInMs, so a client
 *  that misses a worker failure stops polling. */
export const PENDING_DEADLINE_MS = RUN_BUDGET_MS + 60_000;

/** How long the request — the applicant's writing — may sit unclaimed. The
 *  worker deletes it on claim, so this only matters when the worker never
 *  arrives. */
const REQUEST_TTL_SEC = Math.ceil(PENDING_DEADLINE_MS / 1000);

const STORE_NAME = "tcm-reviews";

function jobs() {
  return getStore(STORE_NAME);
}

export interface QueuedRequest {
  req: AuditRequest;
  /** Supabase user id of the caller who started the job. */
  uid: string;
}

export interface JobResult { kind: SectionKind; section: Section }

export type JobState =
  | { status: "pending"; started: number; uid: string }
  | { status: "done"; result: JobResult; finished: number; uid: string }
  | { status: "error"; error: string; finished: number; uid: string };

type Distribute<T> = T extends unknown ? Omit<T, "uid"> : never;
export type JobView = Distribute<JobState>;

/** What a poll returns: the state minus the owner id, which the caller is. */
export function clientView(state: JobState): JobView {
  const { uid: _uid, ...visible } = state;
  void _uid;
  return visible as JobView;
}

interface Envelope<T> {
  /** Unix ms after which this record is treated as absent. */
  expires: number;
  value: T;
}

async function read<T>(key: string): Promise<T | null> {
  const raw = await jobs().get(key, { type: "json" }) as Envelope<T> | null;
  if (!raw) return null;
  // Blobs has no TTL, so expiry is enforced on read. A record past its time is
  // reported as missing and deleted opportunistically — there is no sweeper.
  if (Date.now() > raw.expires) {
    await jobs().delete(key).catch(() => {});
    return null;
  }
  return raw.value;
}

async function write<T>(key: string, value: T, ttlSec: number): Promise<void> {
  const env: Envelope<T> = { expires: Date.now() + ttlSec * 1000, value };
  await jobs().setJSON(key, env);
}

/* ── Jobs ──────────────────────────────────────────────────────────────── */

const jobKey = (id: string) => `job/${id}`;
const reqKey = (id: string) => `req/${id}`;
const claimKey = (id: string) => `claim/${id}`;

export async function putRequest(id: string, queued: QueuedRequest): Promise<void> {
  await write(reqKey(id), queued, REQUEST_TTL_SEC);
}

/**
 * Claim a job before running it. A conditional write: exactly one caller is
 * told `true`, so a replayed or duplicated worker invocation stops here
 * instead of buying a second model call. If the store ever answers without a
 * `modified` flag (an emulator that predates conditional writes), the claim
 * degrades to takeRequest's read-and-delete, which is one-shot in practice.
 */
export async function claimJob(id: string): Promise<boolean> {
  const r = (await jobs().set(claimKey(id), String(Date.now()), { onlyIfNew: true })) as { modified?: boolean } | undefined;
  return r?.modified !== false;
}

export async function takeRequest(id: string): Promise<QueuedRequest | null> {
  const q = await read<QueuedRequest>(reqKey(id));
  // The worker reads the request exactly once. Deleting it here means student
  // material is not left sitting in the store just because the result is.
  if (q !== null) await jobs().delete(reqKey(id)).catch(() => {});
  return q;
}

export async function putJob(id: string, state: JobState): Promise<void> {
  await write(jobKey(id), state, JOB_TTL_SEC);
}

export async function getJob(id: string): Promise<JobState | null> {
  return read<JobState>(jobKey(id));
}

export async function dropJob(id: string): Promise<void> {
  await Promise.all([
    jobs().delete(jobKey(id)).catch(() => {}),
    jobs().delete(reqKey(id)).catch(() => {}),
    jobs().delete(claimKey(id)).catch(() => {}),
  ]);
}

/* ── Rate limiting ─────────────────────────────────────────────────────── */

/**
 * Increment a windowed counter and report whether the caller is still under
 * `max`.
 *
 * NOT atomic: two requests that read the same value before either writes will
 * both store the same count, so a burst of exactly-simultaneous requests can
 * slip one or two past the limit. That is acceptable for what this guards — it
 * makes hammering the paid endpoint expensive rather than free — and it must
 * NOT be reused for anything where an exact count matters, such as a paid
 * quota or a free-audit allowance. Those need a real atomic counter, and
 * Postgres (already in this stack) is where they should live.
 */
export async function bump(key: string, max: number, windowSec: number): Promise<boolean> {
  const k = `rate/${key}`;
  const now = Date.now();
  const cur = await read<{ count: number; resets: number }>(k);
  if (!cur || now >= cur.resets) {
    await write(k, { count: 1, resets: now + windowSec * 1000 }, windowSec * 2);
    return true;
  }
  const next = { count: cur.count + 1, resets: cur.resets };
  await write(k, next, windowSec * 2);
  return next.count <= max;
}
