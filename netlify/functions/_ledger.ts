// Atomic-enough cost ledger for model spend (spec_v3 Step 20, minimal).
//
// Every paid model call reserves its WORST-CASE cost before dispatch, then
// reconciles to the provider's actual usage afterwards. The ledger refuses any
// reservation that would push total committed spend past the budget, a single
// audit past its per-audit cap, or the number of real audits past the limit.
//
// Persistence is an APPEND-ONLY event log (DATA_DIR/derived/ledger.jsonl),
// folded on every read so the numbers survive a restart. It used to be a JSON
// snapshot rewritten on every operation, and the first live panel run showed
// why that cannot work: the four specialist calls ran in parallel worker
// processes, each rewrote the whole file from its own stale read, three
// reservations vanished, and when those calls returned — successfully, money
// spent — settle() found no entry and the sections failed. A small O_APPEND
// write is atomic, so processes can append concurrently and nothing is lost;
// a torn trailing line is skipped on read. The budget CHECK can still race
// (two reservations both pass against the same committed total), so this is a
// local guard, not a distributed lock — the production spend_ledger table
// (Supabase) provides true atomic accounting; see the note in _llm.ts.

import { appendFileSync, closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync } from "node:fs";
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
  /** The audit this call belongs to. One panel run is five calls (four
   *  specialists + lead) sharing a group; the per-audit cap and the real-audit
   *  count are measured per group, not per call. Absent on entries written
   *  before groups existed — each of those counts as its own audit. */
  group?: string | null;
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
  group?: string;
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

type LedgerEvent =
  | { t: "reserve"; e: LedgerEntry }
  | { t: "settle"; id: string; actualUsd: number; inputTokens: number; outputTokens: number }
  | { t: "fail"; id: string };

export class Ledger {
  constructor(private readonly path: string, private readonly budgets: Budgets) {}

  /** Current state = the legacy snapshot (if any) with every logged event
   *  applied in order. Read fresh on every operation: other processes append. */
  private read(): { entries: LedgerEntry[] } {
    const entries = this.legacySnapshot();
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch {
      return { entries };
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let ev: LedgerEvent;
      try { ev = JSON.parse(line) as LedgerEvent; } catch { continue; } // torn line: skip
      if (ev.t === "reserve") {
        entries.push({ ...ev.e });
        continue;
      }
      const e = entries.find((x) => x.id === ev.id);
      if (!e) continue;
      if (ev.t === "settle") {
        e.state = "settled";
        e.actualUsd = ev.actualUsd;
        e.inputTokens = ev.inputTokens;
        e.outputTokens = ev.outputTokens;
      } else {
        e.state = "failed";
      }
    }
    return { entries };
  }

  /** Entries recorded before the event log existed: the `ledger.json` snapshot
   *  beside `ledger.jsonl`. Copied, never mutated in place. */
  private legacySnapshot(): LedgerEntry[] {
    if (!this.path.endsWith(".jsonl")) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.path.slice(0, -1), "utf8")) as { entries?: LedgerEntry[] };
      return Array.isArray(parsed?.entries) ? parsed.entries.map((e) => ({ ...e })) : [];
    } catch {
      return [];
    }
  }

  private append(ev: LedgerEvent): void {
    mkdirSync(dirname(this.path), { recursive: true });
    // Start on a fresh line even when a previous writer died mid-line, so one
    // torn fragment cannot swallow the next event.
    let prefix = "";
    try {
      const fd = openSync(this.path, "r");
      try {
        const size = fstatSync(fd).size;
        if (size > 0) {
          const last = Buffer.alloc(1);
          readSync(fd, last, 0, 1, size - 1);
          if (last[0] !== 0x0a) prefix = "\n";
        }
      } finally {
        closeSync(fd);
      }
    } catch { /* no file yet */ }
    appendFileSync(this.path, prefix + JSON.stringify(ev) + "\n");
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
   *  is measured against. Calls sharing a group are one audit. */
  realAudits(state = this.read()): number {
    return new Set(
      state.entries.filter((e) => e.audit && e.state !== "failed").map((e) => e.group ?? e.id),
    ).size;
  }

  /** Dollars committed so far by the calls of one audit. */
  groupCommitted(group: string, state = this.read()): number {
    return state.entries.reduce((sum, e) => {
      if (e.group !== group) return sum;
      if (e.state === "reserved") return sum + e.reservedUsd;
      if (e.state === "settled") return sum + (e.actualUsd ?? e.reservedUsd);
      return sum;
    }, 0);
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

    if (args.audit) {
      // The cap covers the whole audit: what its earlier calls committed plus
      // this reservation.
      const already = args.group ? this.groupCommitted(args.group, state) : 0;
      if (already + reservedUsd > this.budgets.per_audit_usd) {
        throw new BudgetExceededError(
          `per-audit total $${(already + reservedUsd).toFixed(4)} exceeds the $${this.budgets.per_audit_usd} cap`,
        );
      }
      // A call that continues an audit already counted does not start a new
      // one; only a new group does.
      const known = args.group != null && state.entries.some((e) => e.group === args.group && e.audit && e.state !== "failed");
      if (!known && this.realAudits(state) >= this.budgets.max_real_audits) {
        throw new BudgetExceededError(
          `the ${this.budgets.max_real_audits}-real-audit limit has been reached`,
        );
      }
    }
    if (this.committed(state) + reservedUsd > this.budgets.total_usd) {
      throw new BudgetExceededError(
        `reserving $${reservedUsd.toFixed(4)} would exceed the $${this.budgets.total_usd} total budget`,
      );
    }

    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.append({
      t: "reserve",
      e: {
        id,
        ts: new Date().toISOString(),
        kind: args.kind,
        provider: args.provider,
        model: args.model,
        state: "reserved",
        audit: !!args.audit,
        group: args.group ?? null,
        reservedUsd,
        actualUsd: null,
        inputTokens: null,
        outputTokens: null,
      },
    });
    return id;
  }

  /** Reconcile a reservation to actual usage. Uses the provider's reported cost
   *  when supplied, otherwise computes it from the token counts. Returns the
   *  settled dollar cost. */
  settle(id: string, actual: { inputTokens: number; outputTokens: number; actualUsd?: number }): number {
    const e = this.read().entries.find((x) => x.id === id);
    if (!e) throw new Error(`ledger: no entry ${id} to settle`);
    const actualUsd = actual.actualUsd ?? this.cost(e.model, actual.inputTokens, actual.outputTokens);
    this.append({ t: "settle", id, actualUsd, inputTokens: actual.inputTokens, outputTokens: actual.outputTokens });
    return actualUsd;
  }

  /** Mark a reservation failed, releasing its budget. */
  fail(id: string): void {
    if (this.read().entries.some((x) => x.id === id)) this.append({ t: "fail", id });
  }
}
