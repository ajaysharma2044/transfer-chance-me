// Atomic-enough cost ledger for model spend (spec_v3 Step 20, minimal).
//
// Every paid model call reserves its WORST-CASE cost before dispatch, then
// reconciles to the provider's actual usage afterwards. The ledger refuses any
// reservation that would push total committed spend past the budget, a single
// audit past its per-audit cap, or the number of real audits past the limit.
//
// Persistence is a JSON file (DATA_DIR/derived/ledger.json in production), read
// fresh on every operation so the numbers survive a restart. This is a
// single-process local guard, not a distributed lock — the production
// spend_ledger table (Supabase) provides true atomic accounting; see the note
// in _llm.ts. Until then this is the gate that keeps a runaway loop from
// spending past $25.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Pricing { input_per_mtok: number; output_per_mtok: number }

export interface Budgets {
  total_usd: number;
  per_audit_usd: number;
  max_real_audits: number;
  default_pricing: Pricing;
  pricing: Record<string, Pricing>;
}

export type EntryState = "reserved" | "settled" | "failed";

export interface LedgerEntry {
  id: string;
  ts: string;
  kind: string;
  provider: string;
  model: string;
  state: EntryState;
  audit: boolean;
  reservedUsd: number;
  actualUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ReserveArgs {
  kind: string;
  provider: string;
  model: string;
  inputTokens: number;
  maxTokens: number;
  audit?: boolean;
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export class Ledger {
  constructor(private readonly path: string, private readonly budgets: Budgets) {}

  private read(): { entries: LedgerEntry[] } {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8"));
      return Array.isArray(parsed?.entries) ? parsed : { entries: [] };
    } catch {
      return { entries: [] };
    }
  }

  private write(state: { entries: LedgerEntry[] }): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(state, null, 2));
  }

  private priceFor(model: string): Pricing {
    return this.budgets.pricing[model] ?? this.budgets.default_pricing;
  }

  /** Dollar cost of input+output token counts at this model's price. */
  cost(model: string, inputTokens: number, outputTokens: number): number {
    const p = this.priceFor(model);
    return (inputTokens / 1e6) * p.input_per_mtok + (outputTokens / 1e6) * p.output_per_mtok;
  }

  /** Worst-case dollar cost of a request: every output token at max. */
  estimate(model: string, inputTokens: number, maxTokens: number): number {
    return this.cost(model, inputTokens, maxTokens);
  }

  /** Total dollars not available for new work: settled actuals + still-open
   *  reservations. Failed entries free their reservation. */
  committed(state = this.read()): number {
    return state.entries.reduce((sum, e) => {
      if (e.state === "reserved") return sum + e.reservedUsd;
      if (e.state === "settled") return sum + (e.actualUsd ?? e.reservedUsd);
      return sum; // failed
    }, 0);
  }

  /** Real audits attempted (reserved or settled) — the count the 3-audit stop
   *  is measured against. */
  realAudits(state = this.read()): number {
    return state.entries.filter((e) => e.audit && e.state !== "failed").length;
  }

  totalSpent(): number {
    return this.read().entries.reduce((s, e) => s + (e.state === "settled" ? e.actualUsd ?? 0 : 0), 0);
  }

  totalReserved(): number {
    return this.read().entries.reduce((s, e) => s + (e.state === "reserved" ? e.reservedUsd : 0), 0);
  }

  /** Reserve worst-case cost before dispatch. Throws BudgetExceededError when
   *  the call cannot be afforded — the caller must not dispatch on a throw. */
  reserve(args: ReserveArgs): string {
    const state = this.read();
    const reservedUsd = this.estimate(args.model, args.inputTokens, args.maxTokens);

    if (args.audit && reservedUsd > this.budgets.per_audit_usd) {
      throw new BudgetExceededError(
        `per-audit reservation $${reservedUsd.toFixed(4)} exceeds the $${this.budgets.per_audit_usd} cap`,
      );
    }
    if (args.audit && this.realAudits(state) >= this.budgets.max_real_audits) {
      throw new BudgetExceededError(
        `the ${this.budgets.max_real_audits}-real-audit limit has been reached`,
      );
    }
    if (this.committed(state) + reservedUsd > this.budgets.total_usd) {
      throw new BudgetExceededError(
        `reserving $${reservedUsd.toFixed(4)} would exceed the $${this.budgets.total_usd} total budget`,
      );
    }

    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    state.entries.push({
      id,
      ts: new Date().toISOString(),
      kind: args.kind,
      provider: args.provider,
      model: args.model,
      state: "reserved",
      audit: !!args.audit,
      reservedUsd,
      actualUsd: null,
      inputTokens: null,
      outputTokens: null,
    });
    this.write(state);
    return id;
  }

  /** Reconcile a reservation to actual usage. Uses the provider's reported cost
   *  when supplied, otherwise computes it from the token counts. Returns the
   *  settled dollar cost. */
  settle(id: string, actual: { inputTokens: number; outputTokens: number; actualUsd?: number }): number {
    const state = this.read();
    const e = state.entries.find((x) => x.id === id);
    if (!e) throw new Error(`ledger: no entry ${id} to settle`);
    const actualUsd = actual.actualUsd ?? this.cost(e.model, actual.inputTokens, actual.outputTokens);
    e.state = "settled";
    e.actualUsd = actualUsd;
    e.inputTokens = actual.inputTokens;
    e.outputTokens = actual.outputTokens;
    this.write(state);
    return actualUsd;
  }

  /** Mark a reservation failed, releasing its budget. */
  fail(id: string): void {
    const state = this.read();
    const e = state.entries.find((x) => x.id === id);
    if (e) {
      e.state = "failed";
      this.write(state);
    }
  }
}
