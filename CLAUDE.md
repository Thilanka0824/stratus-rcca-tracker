# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Layout

Flat — the app lives at the project root: `package.json`, `vite.config.js`, `index.html`, `generate_data.py`, `sql/` (`schema.sql`, `analytics/*.sql`), `scripts/render_analytics.py`, `docs/analytics.md`, and `src/` (`main.jsx`, `App.jsx`, `styles.css`, `lib/{helpers,dispatch,rules}.js`, `lib/rules.test.js`, `views/`, `data/`). **Run npm and python commands from the project root**; `generate_data.py` and the render script write via relative paths and will fail from anywhere else. `data/stratus.sqlite` is generated and gitignored.

## Commands

```bash
npm install
npm run dev        # Vite dev server
npm run build      # production build (the recharts chunk-size warning is expected)
npm run preview    # serve the built bundle
npm test           # vitest run — src/lib/rules.test.js only
npm run data       # python3 generate_data.py && render docs/analytics.md — regenerates src/data/*.json and data/stratus.sqlite
npm run analytics  # re-render docs/analytics.md from the sqlite file
```

The only test suite is `rules.test.js` (vitest), deliberately scoped to the rules engine and the seed's compliance with it. There is no linter or formatter; verify UI changes by running the dev server. Do not run `npm audit fix` — the vite major bump is deferred on purpose.

## What this is

A single-page React dashboard for test operations at a **fictional** drone-robotaxi company: the upstream half (requests → prioritize → dispatch tails and crew) and the downstream half (runs → failures → triage → RCCA → report). All data is synthetic and seeded, generated offline into JSON that Vite imports at build time. There is no backend, no router, no state library — deliberately. The thing being demonstrated is workflow and prioritization design, so avoid adding CRUD/persistence plumbing unless asked. Confidentiality is a hard rule: nothing from any real workplace enters the repo — no colleague names, vehicle ids, program names, tool names, channel names or certification codes. The fiction is Stratus Aerial and the Windz fleet.

## Architecture

**Data flows one way at build time.** `generate_data.py` → `src/data/{test_runs, failures, meta, programs, assets, persons, requests, assignments}.json` → imported by `App.jsx` → `makeDb()` (from `lib/rules.js`) indexes them once → passed as props. `App.jsx` holds all mutable state, session-only: `failures` (the triage stepper), `requests` + `assignments` (the dispatch board: assign, defer, scrub), the theme preference (`localStorage['stratus-theme']`, resolved pre-paint by an inline script in `index.html`), and the deep-link targets between views (`reportsFocus`, `boardDate`, `requestFocus`, `triageFocus`). Runs are never mutated. Changing the shape of any entity means changing `generate_data.py`, regenerating, and updating `sql/schema.sql`, the consuming views, and `rules.test.js` together.

The generator has two halves on two RNG streams: the RCCA data (`random.seed(42)`) and, below the `dispatch layer` banner, a day-by-day planner (`random.Random(4242)`) that obeys the same rules the app enforces. Changing the dispatch section never perturbs runs or failures. `check_rules()` re-verifies the seed before writing; the sanity report at the end prints entity counts, the deferral mix and per-arc checks and **asserts that tomorrow's queue holds exactly two P0** — the demo depends on it.

**Derivation layers.** `src/lib/helpers.js` is the RCCA side (aging, weekly pass rate, root-cause Pareto, `chartTheme(theme)`); `src/lib/dispatch.js` is the plan side (deferral Pareto, the misattribution tell, on-window fulfillment, utilization, lead time, churn, rating matrix, demand vs supply, grounding days, `daySummary`). Put cross-view computation in one of those, never in a view. `src/lib/rules.js` is the rules engine: R1–R4 in `checkAssignment()`, R5–R6 in `dayWarnings()`, R7 in `isLate()`/`defaultPlanDate()`, R8 in `deferRequest()`/`scrubAssignment()` (they throw without a reason), intake in `validateRequest()`/`newRequest()` (the late flag and plan day are derived from the submission time, never typed), plus `queuedFor()` (the rail: live queue + what was deferred from that day) and the immutable transitions the board applies. Requests and sorties created in the session get `RQ-L…`/`AS-2026-L…` ids. SVG attributes can't resolve CSS variables, so chart colors come from `chartTheme` — chart views take `theme` as a prop and destructure it rather than hardcoding hex.

Views are `src/views/{RequestsView, DispatchView, CapacityView, RunsView, TriageView, AnalyticsView, ReportsView}.jsx`, selected by tab index in `App.jsx` in two groups (Plan · Execute); the three chart views are `React.lazy` so recharts loads on first visit. `src/styles.css` is one global stylesheet with tokens at `:root` (dark) overridden under `[data-theme='light']` — status color *is* the data encoding, so reuse `--pass`/`--fail`/`--blocked`, `--p0`..`--p3` and derive tints with `color-mix()`. New colors go in both theme blocks and, if charts use them, in both `chartTheme` objects.

## Domain invariants

These are load-bearing; breaking them makes the dashboard dishonest.

- **"Today" is the last run date** (`maxDate(runsData)` in `App.jsx`, also `meta.today`), never the wall clock. **Tomorrow = today + 1 exists** as a planned day with an unscheduled queue (`meta.tomorrow`) — the board's default view. Board edits are stamped in the evening of today.
- **A deferral requires a reason** from the enum in `meta.deferral_reasons` (R8); a scrub takes the same enum plus `weather`. `deferRequest()` throws otherwise; `sql/schema.sql` checks it too.
- **Rated-only assignment.** Ratings have an effective date (`person.ratings_effective`); `ratedOn(person, airframe, date)` is the only way to ask. The two operator-pilots earn Harmattan on 2026-05-29 (arc D1).
- **One assignment per (date, asset, window), ever.** A scrubbed sortie frees its crew but not its slot — the generator, R2 in `rules.js` and a UNIQUE constraint all enforce it.
- **Grounded and maintenance tails leave the utilization denominator**; utilization is computed over operating days (anyone rostered). Asset status on a day comes from `asset.status_history` via `assetStatusOn()`; the flat `status`/`status_since` fields are only today's snapshot.
- **Late intake is flagged, not absorbed** (R7): `request.late` equals the predicate `submitted_at >= (needed_by − 1 day) 15:00`, and a late request's `plan_date` is the next open day. The seed test asserts the flag matches the predicate for every request.
- **Timeline events carry `day`**, the plan day they refer to (a deferral stamped at Tuesday's cutoff is *for* Wednesday). Group deferrals, scrubs and churn by `day`, not by the timestamp.
- **Artifact requirements vary by pipeline.** `run.artifacts.video` is `null` for Simulation (not applicable), `false` (missing). `missingArtifacts()` tests `=== false`.
- **Paretos are occurrence-weighted** (root causes by `occurrences.length`, deferrals by event) and the root-cause one **excludes failures with no `root_cause`**.
- **Triage order is not chronological**: unresolved first, then severity `P0→P3`, then oldest-first. **Triage status is a 4-step ladder** `Open → Investigating → Corrective Action → Verified`; setting `Verified` stamps `resolved = today`; every status change shows a 6-second Undo toast — keep that reversible.
- **Runs link to sorties through `request_id`** (Flight runs only, nullable); failures link to programs through their occurrences, with no new field.

## The seeded narrative arcs

`generate_data.py` plants six stories, documented in its docstring. Regenerating with a different seed or altering the probability logic will break captions in `ReportsView`, `AnalyticsView`, `CapacityView` and the README that reference them by name:

1. **Sim-only crosswind failure** — fails ~85% in Simulation, passes in Flight; root cause Scenario Definition.
2. **Telemetry gap cluster** — Flight runs 2026-05-18..06-07 drop telemetry ~42%.
3. **Software regression** — v2.15.0/.1 spike intruder-avoidance failures, fixed in v2.15.2; the weekly dip.
4. **D1, the misattributed shortage** — April Harmattan deferrals logged `no_rated_operator` (note "per thread consensus"); the constraint is two rated pilots until the CQ cross-rating flights on May 27–28 (deferred twice during the May cert push); the Harmattan crew-deferral rate drops ~80%.
5. **D2, the bring-up surge** — 22 SBU requests for June 20–21 against 8 asset-windows; 7 fly, 15 defer, 5 are late; lead-time p90 spikes then absorbs.
6. **D3, the grounding cascade** — LV-03/LV-05 grounded June 10–18 against arc 3's failure (`status_history.failure_id`); PN under its minimum; churn peaks June 10.

Check the sanity report after any change to the generation logic.

## README roadmap (unimplemented)

Structured intake from free text (the form and its validation exist) · live multi-user state · lazy-load the seed JSON (initial chunk ~780 KB, recharts already split) · CSV export of the integrity audit.
