// The job store shared by review.ts (which writes the prompt and reads the
// result) and review-background.ts (which reads the prompt and writes the
// result).
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
// Two consequences of Blobs rather than Redis, both handled below:
//
//   1. There is no INCR and no EX. Expiry is a timestamp written into the
//      record and checked on read; counters are read-modify-write.
//   2. Read-modify-write is not atomic. That is fine for what it is used for
//      here (a per-IP request counter) and NOT fine for anything that must be
//      exact — see the note on `bump`.

import { getStore } from "@netlify/blobs";

/** How long a finished review stays readable. Long enough to survive a reload
 *  and a slow reader; short enough that student material is not kept around. */
export const JOB_TTL_SEC = 60 * 60; // 1 hour

const STORE_NAME = "tcm-reviews";

function jobs() {
  return getStore(STORE_NAME);
}

export type JobState =
  | { status: "pending"; started: number }
  | { status: "done"; result: unknown; finished: number }
  | { status: "error"; error: string; finished: number };

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
const promptKey = (id: string) => `prompt/${id}`;

export async function putPrompt(id: string, prompt: string): Promise<void> {
  await write(promptKey(id), prompt, JOB_TTL_SEC);
}

export async function takePrompt(id: string): Promise<string | null> {
  const p = await read<string>(promptKey(id));
  // The worker reads the prompt exactly once. Deleting it here means student
  // material is not left sitting in the store for the full hour just because
  // the result is.
  if (p !== null) await jobs().delete(promptKey(id)).catch(() => {});
  return p;
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
    jobs().delete(promptKey(id)).catch(() => {}),
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
