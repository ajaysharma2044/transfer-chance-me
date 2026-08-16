# Transfer Chance Me

Before exploring this codebase, read `.ai-codex/` — it maps the whole project in ~3.5k tokens:
routes, pages, components + design rules, lib signatures, and data schemas. Only open source
files you actually need to edit.

Hard rules (details in `.ai-codex/components.md`):
- Light minimal SaaS design only; brand palette only; no school seals/logos as banners.
- Activities copy says "pattern beats prestige" — never "ECs don't matter".
- Authority line is exactly: "Made by students who transferred into multiple Ivies".
- Uploads/essays are parsed client-side and never sent to a server; keep that promise true.

Dev: `npm run dev` (port 5199) · check: `npx tsc --noEmit` · deploy notes in DEPLOY.md.
