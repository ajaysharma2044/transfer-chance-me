// Deep-review settings shared by the panel (src/lib/panel.ts) and the Review
// page: which mode this deployment runs in, and the user's own key in
// browser-key mode.
//
// The single-shot review that used to live here — one prompt, one reply, with
// the model asked to set per-school odds — is retired (docs/spec.md §5). The
// panel in src/lib/audit/* is the only AI path: structured inputs, prompts
// built by whoever runs the model, odds from the engine, every section
// validated before it is shown.

const KEY_STORE = "tcm.apikey.v1";

// Proxy mode: when VITE_REVIEW_ENDPOINT is set at build time (e.g.
// "/api/review"), the structured request is POSTed there and the server holds
// the model key. When unset, the original browser-key path is used.
export const REVIEW_ENDPOINT: string =
  (import.meta.env?.VITE_REVIEW_ENDPOINT as string | undefined) ?? "";
export const proxyMode = REVIEW_ENDPOINT.length > 0;

export function getApiKey(): string {
  try { return localStorage.getItem(KEY_STORE) ?? ""; } catch { return ""; }
}
export function setApiKey(k: string): void {
  if (k) localStorage.setItem(KEY_STORE, k.trim());
  else localStorage.removeItem(KEY_STORE);
}

export { intelLines } from "./intel";
