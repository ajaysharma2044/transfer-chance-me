// Spend caps and model pricing for the cost ledger (spec_v3 §9, Step 20).
//
// Owner-authorized envelope: $25 aggregate across all providers and retries;
// stop after 3 real full audits or if a single audit would exceed $1. The
// ledger reserves worst-case cost (max_tokens x output price) before every
// paid call and refuses anything that breaches these.
//
// Pricing is $ per MILLION tokens. default_pricing is deliberately
// conservative (high) so an un-priced model over-reserves and errs toward
// refusing rather than overspending; fill `pricing` with measured per-model
// rates as models are chosen. Actual settlement uses the provider's reported
// cost when available (OpenRouter returns it), so reported spend is accurate
// even while reservations stay conservative.
//
// Kept as a typed module (not YAML yet) so it bundles into functions and is
// type-checked; a YAML/loader form can replace it in the full Step 20.

import type { Budgets } from "../netlify/functions/_ledger";

export const budgets: Budgets = {
  total_usd: 25,
  per_audit_usd: 1,
  max_real_audits: 3,
  default_pricing: { input_per_mtok: 10, output_per_mtok: 30 },
  pricing: {
    // The live OpenRouter model. Measured 2026-10-22: 1,481 in + 4,000 out
    // settled at $0.00559 (provider-reported), i.e. well under these figures,
    // which are deliberately rounded UP. Without an entry here the default
    // pricing reserves ~25x the real cost per call, and four parallel
    // specialist reservations then trip the $1 per-audit cap on paper.
    "qwen/qwen3.7-plus": { input_per_mtok: 0.6, output_per_mtok: 1.6 },
    // The Anthropic-direct fallback (_llm.ts anthropicProvider). Rounded up
    // from the Sonnet list price; with SECTION_MAX_TOKENS 6,000/4,000 the five
    // worst-case reservations of one panel stay under per_audit_usd.
    "claude-sonnet-5": { input_per_mtok: 5, output_per_mtok: 25 },
  },
};
