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
    // e.g. "anthropic/claude-sonnet-4.5": { input_per_mtok: 3, output_per_mtok: 15 },
  },
};
