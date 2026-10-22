// The one module every model call goes through (spec_v3 §3.4, Step 20 — minimal).
//
// It reserves worst-case cost on the ledger BEFORE dispatch, calls the provider
// with a timeout, settles the actual cost after, and releases the reservation
// if the call fails. A budget-exceeded reservation throws before the provider
// is ever called — so a runaway loop cannot spend past the cap.
//
// Minimal on purpose: provider allow-listing, prompt caching, retries, JSON
// schema validation and prompt-injection fencing are the full Step 20 and are
// layered on here later. Today this is the spend gate plus the OpenRouter call.

import { budgets } from "../../config/budgets";
import { ledgerPath } from "../../config/paths";
import { Ledger } from "./_ledger";

export interface Message { role: "system" | "user" | "assistant"; content: string }

export interface ProviderResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Provider-reported cost in USD, when available (preferred over estimation). */
  costUsd?: number;
}

export type Provider = (req: {
  model: string;
  messages: Message[];
  maxTokens: number;
  signal: AbortSignal;
}) => Promise<ProviderResult>;

export interface CallArgs {
  kind: string;
  messages: Message[];
  maxTokens: number;
  model?: string;
  audit?: boolean;
  /** The audit this call belongs to — see LedgerEntry.group. */
  group?: string;
  /** Injectable for tests and for a caller holding its own ledger. */
  ledger?: Ledger;
  /** Injectable for tests (mock) and for the Anthropic fallback. */
  provider?: Provider;
  /** Recorded on the ledger entry; "openrouter" unless a caller says otherwise. */
  providerName?: string;
  timeoutMs?: number;
}

export interface LlmResult {
  text: string;
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export function defaultLedger(): Ledger {
  return new Ledger(ledgerPath(), budgets);
}

/** Rough input-token estimate for the reservation. Deliberately an
 *  over-estimate (chars/3) so the worst-case reservation is never too low. */
function estInputTokens(messages: Message[]): number {
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  return Math.ceil(chars / 3);
}

export const openRouterProvider: Provider = async ({ model, messages, maxTokens, signal }) => {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
      "HTTP-Referer": process.env.PUBLIC_SITE_URL ?? "https://transfer-chance-me.local",
      "X-Title": "Transfer Chance Me",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      usage: { include: true },
      // Hidden chain-of-thought counts against max_tokens and the bill, and
      // the reply we need is a JSON object, not a deliberation. Models that
      // cannot switch it off ignore this.
      reasoning: { enabled: false },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  };
  const usage = data.usage ?? {};
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    costUsd: typeof usage.cost === "number" ? usage.cost : undefined,
  };
};

/** Anthropic direct, for deployments without an OpenRouter key. Same
 *  {text, tokens} shape; cost is left to the ledger's price table because the
 *  response carries none. */
export const anthropicProvider: Provider = async ({ model, messages, maxTokens, signal }) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const turns = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system: system || undefined, messages: turns }),
  });
  if (!res.ok) {
    // Status only: an auth error from this API can echo a key prefix back.
    throw new Error(`Anthropic ${res.status}`);
  }
  const data = (await res.json()) as {
    content?: { type?: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  // Models that think return a `thinking` block first; the answer is the
  // `text` block, wherever it sits.
  const textBlock = data.content?.find((b) => b.type === "text") ?? data.content?.find((b) => typeof b.text === "string");
  return {
    text: textBlock?.text ?? "",
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
};

export async function callModel(args: CallArgs): Promise<LlmResult> {
  const model = args.model ?? process.env.OPENROUTER_MODEL;
  if (!model) throw new Error("no model: set OPENROUTER_MODEL or pass args.model");
  const ledger = args.ledger ?? defaultLedger();
  const provider = args.provider ?? openRouterProvider;

  // Reserve first. A BudgetExceededError here means we never dispatch.
  const estIn = estInputTokens(args.messages);
  const id = ledger.reserve({
    kind: args.kind,
    provider: args.providerName ?? "openrouter",
    model,
    inputTokens: estIn,
    maxTokens: args.maxTokens,
    audit: args.audit,
    group: args.group,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 120_000);
  try {
    const res = await provider({ model, messages: args.messages, maxTokens: args.maxTokens, signal: controller.signal });
    // The call is paid for the moment the provider answers. A bookkeeping
    // failure after that must never discard the reply or release spent
    // budget: log it and keep the worst-case reservation on the books.
    let costUsd: number;
    try {
      costUsd = ledger.settle(id, { inputTokens: res.inputTokens, outputTokens: res.outputTokens, actualUsd: res.costUsd });
    } catch (settleErr) {
      console.log(JSON.stringify({ evt: "ledger_settle_failed", id, message: String((settleErr as Error)?.message ?? settleErr).slice(0, 80) }));
      costUsd = res.costUsd ?? ledger.cost(model, res.inputTokens, res.outputTokens);
    }
    return { text: res.text, model, costUsd, inputTokens: res.inputTokens, outputTokens: res.outputTokens };
  } catch (e) {
    // Our own timeout: the upstream generation may well have completed and
    // been billed, so settle at the worst case rather than releasing it. A
    // provider error (4xx/5xx, network) is not billed and frees the reservation.
    if ((e as { name?: string } | null)?.name === "AbortError") {
      try { ledger.settle(id, { inputTokens: estIn, outputTokens: args.maxTokens }); } catch { /* keep the reservation */ }
    } else {
      ledger.fail(id);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
