# Pages

All pages are client-rendered React (Vite SPA). Entry: `src/main.tsx` → `src/App.tsx` (topbar + hash router + footer).

- **Landing** (`src/components/Landing.tsx`, `landing.css`) — hero with pointer-parallax product cards, word-cascade headline, odds ticker with progress bar, orbiting school logos, marquee school wall, `SchoolIntel` (interactive 31-school dossier explorer: tabs → stats/GPA band/deadline/counsel/majors/feeders/co-admits), feature strips, scroll-drawn rate ladder, `Playbook` (admit activity bars from the 4,087-activity inventory + moves cards + engine-lift lever cards + honest limits line), findings cards, count-up numbers band, FAQ, aurora closing CTA. Scroll reveals via `useReveal()` + `.reveal/.in`.
- **Intake** (`Intake.tsx`) — 3 steps: (1) upload/import (`ImportPanel` multi-file → `extractProfile`) + academics (GPA slider, school search, standing, trend), (2) major + courses (`CoursesEditor`) + transfer reason + work hours + first-gen, (3) essay (`EssayPanel`), activities & awards textareas, credentials. Writes `Profile` → `tcm.profile.v1`.
- **Results** (`Results.tsx`) — ranked estimate rows (expandable: counsel, drivers, official facts, `GpaStrip`), tier tally, methodology footer, print `Report`.
- **SchoolPage** (`SchoolPage.tsx`, `schoolpage.css`) — campus photo banner (`CampusPhoto`), CDS stats, GPA histogram, trend, playbook from counsel, deadline countdown, UC CC-share stat, co-admits.
- **CollegePage** (`CollegePage.tsx`, `college.css`) — generic profile for any of 4,025 directory schools: photo banner, admit rate (IPEDS ADM2023 where present), kind/size/location; links into intake.
- **SchoolsIndex** (`SchoolsIndex.tsx`) — searchable directory (`loadDirectory` + `searchDirectory`).
- **Portal** (`Portal.tsx`, `portal.css`) — cards: profile file, best positions, timeline (deadlines), essay, docs; "My Schools" tracker (status + notes, `tcm.list.v1`); printable report.
- **Review** (`Review.tsx`, `review.css`) — deep review flow: targets (≤6), paste materials, run `runReview`, render graded report; API-key setup card (browser-direct mode) or zero-setup (proxy mode).
- **Auth** (`Auth.tsx`, `auth.css`) — signup/login tabs, Google button slot (only when `googleEnabled`).
- **Pricing** (`Pricing.tsx`) — three tiers, local waitlist capture (`tcm.waitlist.v1`).
