// How the browser gets one section of the audit run (docs/spec.md §5).
//
// Two transports, one contract:
//   · proxyTransport — the deployment holds the model key. POST the structured
//     request with the user's Supabase session, get 202 + a job id, poll until
//     the worker has written the section. Nothing here builds a prompt.
//   · directTransport — bring-your-own-key. The browser builds the same prompt
//     the worker would and calls Anthropic itself, as it always did.
// Both validate the section before it reaches the UI, so a model that answers
// with prose or drops a list is an error message, not a blank report.

import { buildSectionPrompt, SECTION_MAX_TOKENS } from "./prompts";
import {
  LIMITS, parseModelJson, pickSection, validateSection,
  type AuditRequest, type Section,
} from "./schema";

export type AuditErrorCode = "auth" | "config" | "rate" | "server" | "invalid" | "expired" | "aborted" | "input";

export class AuditError extends Error {
  readonly code: AuditErrorCode;
  constructor(message: string, code: AuditErrorCode) {
    super(message);
    this.name = "AuditError";
    this.code = code;
  }
}

export interface Transport {
  /** Run one section and return it validated. Throws AuditError. */
  run(req: AuditRequest, signal?: AbortSignal): Promise<Section>;
}

/* ── Shared helpers ─────────────────────────────────────────────────────── */

const SIGN_IN = "Sign in to run the deep audit — it runs on your account so you can come back to it.";

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const v = (await res.json().catch(() => null)) as unknown;
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function errorText(body: Record<string, unknown>, fallback: string): string {
  return typeof body.error === "string" && body.error.length > 0 ? body.error : fallback;
}

const FIELD_LABEL: Record<string, string> = {
  whyTransfer: "why-transfer essay", statement: "personal statement", activities: "activities list",
  awardsText: "awards list", transferReason: "transfer reason", majorDetail: "program detail", schoolName: "school name",
};

/** The server's 413 names the field and the cap; the student needs to know
 *  which box to shorten. */
function tooLong(serverMessage: string): string {
  const m = /input\.(?:profile\.)?(\w+) is longer than (\d+)/.exec(serverMessage);
  if (!m) return serverMessage;
  return `Your ${FIELD_LABEL[m[1]] ?? m[1]} is over ${Number(m[2]).toLocaleString()} characters — shorten it and run the review again.`;
}

function isAbort(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === "AbortError";
}

/** Sleep that ends early when the caller cancels. */
function sleepUntil(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done(): void { clearTimeout(t); signal?.removeEventListener("abort", done); resolve(); }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/* ── Proxy: 202 + poll ──────────────────────────────────────────────────── */

export interface ProxyOptions {
  endpoint: string;
  /** The user's current Supabase access token, or null when signed out. Called
   *  before EVERY request: the SDK refreshes the token, and a section can
   *  outlive the one it started with. */
  getToken: () => Promise<string | null>;
  fetch?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Give-up point when the 202 carries no expiresInMs. */
  maxWaitMs?: number;
}

export function proxyTransport(opts: ProxyOptions): Transport {
  const f = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const sleep = opts.sleep ?? sleepUntil;

  async function authHeader(): Promise<Record<string, string>> {
    const token = await opts.getToken();
    if (!token) throw new AuditError(SIGN_IN, "auth");
    return { authorization: `Bearer ${token}` };
  }

  return {
    async run(req, signal) {
      const startHeaders = { "content-type": "application/json", ...(await authHeader()) }; // signed out → auth error, no request
      let start: Response;
      try {
        start = await f(opts.endpoint, { method: "POST", headers: startHeaders, body: JSON.stringify(req), signal });
      } catch (e) {
        if (e instanceof AuditError) throw e;
        if (isAbort(e)) throw new AuditError("Cancelled.", "aborted");
        throw new AuditError("Could not reach the review service — check your connection and try again.", "server");
      }
      const started = await readJson(start);
      if (start.status === 401) throw new AuditError(errorText(started, SIGN_IN), "auth");
      if (start.status === 413) throw new AuditError(tooLong(errorText(started, "Your materials are too long for one review.")), "input");
      if (start.status === 429) throw new AuditError("Too many reviews at once — wait a minute and run it again.", "rate");
      if (start.status === 503) throw new AuditError(errorText(started, "The review service is not available right now."), "config");
      if (start.status !== 202 || typeof started.jobId !== "string") {
        throw new AuditError(errorText(started, `Review failed (${start.status}).`), "server");
      }
      const jobId = started.jobId;
      const every = Math.max(1_000, Number(started.pollAfterMs) || 3_000);
      const deadline = Date.now() + (Number(started.expiresInMs) || opts.maxWaitMs || 660_000);

      let wait = every;
      for (;;) {
        if (signal?.aborted) throw new AuditError("Cancelled.", "aborted");
        if (Date.now() > deadline) throw new AuditError("The review took too long — run it again.", "expired");
        await sleep(wait, signal);
        if (signal?.aborted) throw new AuditError("Cancelled.", "aborted");
        wait = every;

        const pollHeaders = await authHeader(); // a refreshed token, or the sign-out error itself
        let poll: Response;
        try {
          poll = await f(`${opts.endpoint}?job=${encodeURIComponent(jobId)}`, { headers: pollHeaders, signal });
        } catch (e) {
          if (isAbort(e)) throw new AuditError("Cancelled.", "aborted");
          continue; // one dropped poll is not a failed review; the deadline bounds this
        }
        const state = await readJson(poll);
        if (poll.status === 401) throw new AuditError(errorText(state, SIGN_IN), "auth");
        if (poll.status === 404) throw new AuditError("That review expired before it finished — run it again.", "expired");
        if (poll.status === 429 || poll.status >= 500) {
          // Rate-limited or a hiccup in the store / the sign-in check: the
          // worker is still running and the result is still coming.
          const retryAfter = Number(poll.headers.get("retry-after")) * 1_000;
          wait = Math.max(every, Number.isFinite(retryAfter) ? retryAfter : 0);
          continue;
        }
        if (!poll.ok) throw new AuditError(errorText(state, `Review failed (${poll.status}).`), "server");

        if (state.status === "pending") continue;
        if (state.status === "error") throw new AuditError(errorText(state, "The review failed — run it again."), "server");
        if (state.status === "done") {
          const result = typeof state.result === "object" && state.result !== null ? (state.result as Record<string, unknown>) : {};
          const check = validateSection(req.kind, result.section);
          if (!check.ok) throw new AuditError("The reviewer returned an unreadable response — run it again.", "invalid");
          return pickSection(req.kind, result.section as Record<string, unknown>);
        }
        throw new AuditError("The review service answered in a shape this app does not understand.", "server");
      }
    },
  };
}

/* ── Direct: the user's own Anthropic key, straight from the browser ─────── */

const ANTHROPIC_MODEL = "claude-sonnet-5";
/** A stalled connection must not pin the Run button forever. */
const DIRECT_TIMEOUT_MS = 180_000;

export function directTransport(getKey: () => string, f: typeof fetch = (i, init) => fetch(i, init)): Transport {
  return {
    async run(req, signal) {
      const key = getKey();
      if (!key) throw new AuditError("No API key set.", "auth");
      for (const k of ["whyTransfer", "statement", "activities"] as const) {
        if (req.input[k].length > LIMITS.longText) throw new AuditError(tooLong(`input.${k} is longer than ${LIMITS.longText}`), "input");
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), DIRECT_TIMEOUT_MS);
      const onOuter = (): void => ctrl.abort();
      signal?.addEventListener("abort", onOuter, { once: true });
      let res: Response;
      try {
        res = await f("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: ANTHROPIC_MODEL,
            max_tokens: SECTION_MAX_TOKENS[req.kind],
            messages: [{ role: "user", content: buildSectionPrompt(req) }],
          }),
          signal: ctrl.signal,
        });
      } catch (e) {
        if (isAbort(e)) {
          throw signal?.aborted
            ? new AuditError("Cancelled.", "aborted")
            : new AuditError("The review took too long — run it again.", "expired");
        }
        throw new AuditError("Could not reach Anthropic — check your connection and try again.", "server");
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onOuter);
      }
      if (!res.ok) {
        if (res.status === 401) throw new AuditError("That API key was rejected — check it in key settings.", "auth");
        if (res.status === 429) throw new AuditError("Rate limited — wait a moment and run it again.", "rate");
        const body = await res.text().catch(() => "");
        throw new AuditError(`Review failed (${res.status}). ${body.slice(0, 160)}`, "server");
      }
      const data = await readJson(res);
      const blocks = Array.isArray(data.content) ? (data.content as { type?: unknown; text?: unknown }[]) : [];
      const textBlock = blocks.find((b) => b.type === "text") ?? blocks.find((b) => typeof b.text === "string");
      const text = typeof textBlock?.text === "string" ? textBlock.text : "";
      const parsed = parseModelJson(text);
      const check = parsed.ok ? validateSection(req.kind, parsed.value) : { ok: false as const, errors: [parsed.error] };
      if (!parsed.ok || !check.ok) {
        throw new AuditError("The reviewer returned an unreadable response — run it again.", "invalid");
      }
      return pickSection(req.kind, parsed.value as Record<string, unknown>);
    },
  };
}
