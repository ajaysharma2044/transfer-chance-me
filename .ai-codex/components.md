# Components

All in `src/components/`. Styling: hand-written CSS (no Tailwind) — global tokens in `src/index.css`, page-scoped files imported by their component (`landing.css`, `portal.css`, `review.css`, `auth.css`, `college.css`, `schoolpage.css`).

## Brand
Palette (from the logo): `--ink #14183f` navy · `--blue #2478e5` · `--accent #6c4be0` purple · `--teal #14b8a0` · `--coral #ee6352`. Tri-color wordmark: Transfer=navy, Chance=purple, Me=teal. Font: Inter (`@fontsource-variable/inter`).

## Shared building blocks
- `Logo()` — inline SVG mark + tri-color wordmark
- `Tile({ name, size? })` — uniform white-chrome logo tile (`.tile-sync`): favicon img via `logoUrl()` with color monogram fallback. ALL school logos go through this.
- `GpaStrip({ school, gpa })` — p25–p75 GPA band with teal "you" marker; shows "GPA range not published" when p50 null
- `CampusPhoto({ name, color?, height? })` — Wikipedia media-list photo banner. Scores filenames: `ICONIC` per-school landmark regex +6, montage/aerial +3, campus-like +2; logos/seals/people excluded (`NOT_A_PHOTO`), historical −5. Requires score ≥2 else school-color gradient. **Titles are underscore-normalized before matching** (`norm()`). Never use seals/logos as banners.
- `Report({ profile, ests, date })` — print-only report (rendered by Results and Portal)
- `SchoolSearch` — directory typeahead with favicons; used in Intake
- `CoursesEditor({ value, onChange })` — course chips + `SEQUENCE_HINTS`
- `ImportPanel` — multi-file upload (≤6 files, 20MB cap) → `fileToText` → `extractProfile`
- `EssayPanel` — essay paste + `analyzeEssay` verdict

## Page components
See `pages.md`. Landing internals: `HeroStage` (3 floating product cards, pointer parallax via `--px/--py` vars on `.ld-herowrap`), `OddsTicker` (2.6s cycle, rAF-tweened rate, color by rate: <5 coral / <15 purple / <40 blue / else teal), `OrbitLogos`, `SchoolIntel` (31 tile tabs → per-school dossier from MODEL; guards null UC GPA; TAG note via `TAG_CAMPUSES`), `RateLadder` (scroll-drawn bars), `FeatureStrip`, `Playbook` (ADMIT_ACTIVITIES bars — real aggregates from `data/processed/analysis/ACTIVITY_INVENTORY.csv`: 4,087 activities, 628 admitted files, scope 50% campus / 9% national — plus MOVES and LEVERS cards mirroring engine multipliers), `Findings`, `CountUp`.

## Motion conventions
- Scroll reveal: add `reveal` class; `useReveal()` toggles `.in`. Stagger via inline `transitionDelay` (+ `--d` var if child animations need the same delay).
- Every animation has a `prefers-reduced-motion` fallback (global kill in index.css line ~559 + per-feature overrides at end of landing.css). Anything hidden-by-default must be force-shown there.
- Hover: tiles scale/rotate, cards lift, `.btn` gets a light sweep (`btn-shine`).

## Design rules (user-enforced — do not regress)
- Light minimal SaaS look (callix.io / esslo.org register). No dark ornamental themes, no gray pill chips, no "AI slop" widgets.
- Brand colors only; no school seals/logos as banners; campus photos must be scenic landmark shots.
- ECs copy: "pattern beats prestige" — never reintroduce hard "ECs don't matter" claims.
- Authority line is exactly: "Made by students who transferred into multiple Ivies".
