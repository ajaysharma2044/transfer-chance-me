// Single source of truth for where a student's material actually goes, so the
// on-screen privacy copy can never drift from behaviour.
//
// The repo rule (CLAUDE.md) is explicit: signed in, the profile, school list
// and written/uploaded material sync to the user's account, so the copy must
// distinguish "signed in" from "signed out" and never make a blanket "nothing
// leaves your browser" claim — and it must change in the same commit as any
// behaviour change.
//
// There are three data paths, and honest copy names all three:
//   1. Deterministic work — PDF parsing (src/lib/pdf.ts), extraction
//      (extract.ts), the odds engine, and the local essay check (essay.ts) —
//      runs in the browser. Signed out, that material stays in the browser.
//   2. The deep AI review (src/lib/panel.ts + src/lib/audit/*) sends the
//      application text to a model provider: Anthropic directly on the user's
//      own key, or — through the review server (netlify/functions) — whichever
//      provider the deployment is configured with: OpenRouter (Qwen) when
//      OPENROUTER_API_KEY is set, else Anthropic. Naming the real processor
//      is part of the rule. This happens whether or not the user is signed in
//      — it is the one path that always leaves the device.
//   3. Signed in with a backend configured (src/lib/supabase.ts + sync.ts),
//      the profile, school list, essays and transcript text are saved to the
//      account under row-level security — readable and deletable only by the
//      owner.

export const PRIVACY = {
  onDevice:
    "Your transcript, essay and profile are parsed and scored on your device. Signed out, they stay in this browser.",
  signedIn:
    "Signed in, your profile, school list, essays and the text read off your transcript are saved to your account so your work follows you between devices — stored against your login, readable only by you, and deletable by you anytime.",
  review:
    "Running the deep AI review is the one exception: it sends your application text to an AI model provider to write the review — directly to Anthropic (Claude) when you use your own API key, or through our review server to the provider it is configured with (currently OpenRouter, running the Qwen model; Anthropic when it is not) — whether or not you're signed in.",
} as const;

export type PrivacyFact = keyof typeof PRIVACY;
