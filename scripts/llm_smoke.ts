// One tiny real OpenRouter call through the ledger, to confirm the key works
// and that cost is reserved + reconciled. Prints model, reply, tokens and cost
// only — never the key. Run: npx tsx scripts/llm_smoke.ts

import { loadEnvLocal } from "./_loadenv";
import { callModel, defaultLedger } from "../netlify/functions/_llm";

loadEnvLocal();

async function main() {
  const before = defaultLedger().totalSpent();
  const r = await callModel({
    kind: "smoke",
    messages: [{ role: "user", content: "Reply with exactly: ok" }],
    maxTokens: 8,
  });
  const after = defaultLedger().totalSpent();
  console.log("model:          ", r.model);
  console.log("reply:          ", JSON.stringify(r.text.slice(0, 80)));
  console.log("tokens:         ", "in", r.inputTokens, "out", r.outputTokens);
  console.log("cost this call:  $" + r.costUsd.toFixed(6));
  console.log("ledger spent:    $" + after.toFixed(6), "(was $" + before.toFixed(6) + ")");
  console.log("budget remaining:$" + (25 - after).toFixed(6), "of $25");
}

main().catch((e) => {
  console.error("smoke failed:", (e as Error).message);
  process.exit(1);
});
