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
  parseModelJson, pickSection, validateSection,
  type AuditRequest, type Section,
} from "./schema";

export type AuditErrorCode = "auth" | "config" | "rate" | "server" | "invalid" | "expired" | "aborted";

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

/* ── Proxy: 202 + poll ──────────────────────────────────────────────────── */

export interface ProxyOptions {
  endpoint: string;
  /** The user's Supabase access token, or null when signed out. */
  getToken: () => Promise<string | null>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Give-up point when the 202 carries no expiresInMs. */
  maxWaitMs?: number;
}

const SIGN_IN = "Sign in to run the deep audit — it runs on your account so you can come back to it.";

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const v = (await res.json().catch(() => null)) as unknown;
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function errorText(body: Record<string, unknown>, fallback: string): string {
  return typeof body.error === "string" && body.error.length > 0 ? body.error : fallback;
}

export function proxyTransport(opts: ProxyOptions): Transport {
  const f = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  return {
    async run(req, signal) {
      const token = await opts.getToken();
      if (!token) throw new AuditError(SIGN_IN, "auth");
      const auth = { authorization: `Bearer ${token}` };

      const start = await f(opts.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify(req),
        signal,
      });
      const started = await readJson(start);
      if (start.status === 401) throw new AuditError(errorText(started, SIGN_IN), "auth");
      if (start.status === 429) throw new AuditError("Too many reviews at once — wait a minute and run it again.", "rate");
      if (start.status === 503) throw new AuditError(errorText(started, "The review service is not available right now."), "config");
      if (start.status !== 202 || typeof started.jobId !== "string") {
        throw new AuditError(errorText(started, `Review failed (${start.status}).`), "server");
      }
      const jobId = started.jobId;
      const every = Math.max(1_000, Number(started.pollAfterMs) || 3_000);
      const deadline = Date.now() + (Number(started.expiresInMs) || opts.maxWaitMs || 660_000);

      for (;;) {
        if (signal?.aborted) throw new AuditError("Cancelled.", "aborted");
        await sleep(every);
        const poll = await f(`${opts.endpoint}?job=${encodeURIComponent(jobId)}`, { headers: auth, signal });
        const state = await readJson(poll);
        if (poll.status === 401) throw new AuditError(errorText(state, SIGN_IN), "auth");
        if (poll.status === 404) throw new AuditError("That review expired before it finished — run it again.", "expired");
        if (poll.status === 429) continue; // one slow poll, not a failed review
        if (!poll.ok) throw new AuditError(errorText(state, `Review failed (${poll.status}).`), "server");

        if (state.status === "pending") {
          if (Date.now() > deadline) throw new AuditError("The review took too long — run it again.", "expired");
          continue;
        }
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

export function directTransport(getKey: () => string, f: typeof fetch = (i, init) => fetch(i, init)): Transport {
  return {
    async run(req, signal) {
      const key = getKey();
      if (!key) throw new AuditError("No API key set.", "auth");
      const res = await f("https://api.anthropic.com/v1/messages", {
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
        signal,
      });
      if (!res.ok) {
        if (res.status === 401) throw new AuditError("That API key was rejected — check it in key settings.", "auth");
        if (res.status === 429) throw new AuditError("Rate limited — wait a moment and run it again.", "rate");
        const body = await res.text().catch(() => "");
        throw new AuditError(`Review failed (${res.status}). ${body.slice(0, 160)}`, "server");
      }
      const data = await readJson(res);
      const content = Array.isArray(data.content) ? (data.content[0] as { text?: unknown } | undefined) : undefined;
      const text = typeof content?.text === "string" ? content.text : "";
      const parsed = parseModelJson(text);
      const check = parsed.ok ? validateSection(req.kind, parsed.value) : { ok: false as const, errors: [parsed.error] };
      if (!parsed.ok || !check.ok) {
        throw new AuditError("The reviewer returned an unreadable response — run it again.", "invalid");
      }
      return pickSection(req.kind, parsed.value as Record<string, unknown>);
    },
  };
}
