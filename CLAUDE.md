# Transfer Chance Me

Before exploring this codebase, read `.ai-codex/` — it maps the whole project in ~3.5k tokens:
routes, pages, components + design rules, lib signatures, and data schemas. Only open source
files you actually need to edit.

Hard rules (details in `.ai-codex/components.md`):
- Light minimal SaaS design only; brand palette only; no school seals/logos as banners.
- Activities copy says "pattern beats prestige" — never "ECs don't matter".
- Authority line is exactly: "Made by students who transferred into multiple Ivies".
- Uploads/essays are parsed client-side. Signed out, nothing leaves the browser. Signed in
  (Supabase configured), the profile, school list and written/uploaded material sync to the
  user's account — so privacy copy must distinguish "signed in" from "signed out", never a
  blanket "nothing leaves your browser". Whatever the app does, the copy must change in the
  same commit.
- This stores real student records, some belonging to minors. Every table is under row-level
  security (`supabase/schema.sql`); never ship the service-role key to the browser, and keep
  `deleteAllData()` reachable from the UI.

Dev: `npm run dev` (port 5199) · check: `npm run build` (runs `tsc -b`) · deploy notes in DEPLOY.md.
NOTE: bare `npx tsc --noEmit` checks NOTHING here — the root tsconfig is `"files": []` with
project references, so it passes no matter what is broken. Use `npm run build`, or
`npx tsc -p tsconfig.app.json --noEmit` for a fast type-only pass.
