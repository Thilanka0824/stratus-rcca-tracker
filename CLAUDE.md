# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Layout

Flat — the app lives directly at the project root: `package.json`, `vite.config.js`, `index.html`, `generate_data.py`, and `src/` (`main.jsx`, `App.jsx`, `styles.css`, `lib/helpers.js`, `views/`, `data/`). **Run npm and python commands from the project root**; `generate_data.py` writes to `src/data/*.json` via relative paths and will fail from anywhere else.

## Commands

```bash
npm install
npm run dev       # Vite dev server
npm run build     # production build
npm run preview   # serve the built bundle
npm run data      # python3 generate_data.py — regenerate src/data/*.json
```

There is no test suite, linter, or formatter configured. Don't invent commands for them; verify changes by running the dev server.

## What this is

A single-page React dashboard for test-execution and root-cause/corrective-action (RCCA) tracking at a **fictional** drone company. All data is synthetic and seeded (`random.seed(42)`), generated offline into JSON that Vite imports at build time. There is no backend, no database, no router, no state library — deliberately. The thing being demonstrated is RCCA workflow design, so avoid adding CRUD/persistence plumbing unless asked.

## Architecture

**Data flows one way at build time.** `generate_data.py` → `src/data/{test_runs.json, failures.json, meta.json}` → imported by `App.jsx` → passed as props to the four views. `App.jsx` holds the only mutable state: `failures` in `useState`, so the triage stepper can advance a failure's `triage_status`. Runs are never mutated. Changing the shape of a run or failure means changing `generate_data.py`, regenerating, and updating the consuming views together.

`src/lib/helpers.js` is the shared derivation layer — put any cross-view computation there rather than in a view. It also exports the recharts theme constants (`AXIS`, `GRID`, `TIP`) that both chart views use; new charts should import those rather than restyle inline.

Views are `src/views/{RunsView, TriageView, AnalyticsView, ReportsView}.jsx`, selected by tab index in `App.jsx`. `src/styles.css` is a single global stylesheet with CSS custom properties at `:root` (`--pass`/`--fail`/`--blocked`, `--p0`..`--p3`) — status color *is* the data encoding, so reuse the tokens instead of hardcoding hex.

## Domain invariants

These are load-bearing; breaking them makes the dashboard dishonest.

- **"Today" is the last date in the dataset**, not the wall clock (`maxDate(runsData)` in `App.jsx`, threaded down as the `today` prop). Never call `new Date()` for aging math — static data would age indefinitely.
- **Artifact requirements vary by pipeline.** `run.artifacts.video` is `null` for Simulation runs meaning *not applicable*, `false` meaning *missing*. `missingArtifacts()` tests `=== false` for exactly this reason — a truthiness check would flag every sim run.
- **The Pareto is occurrence-weighted**, counting `f.occurrences.length` rather than one per failure, and it **excludes failures with no `root_cause`** (you can't Pareto what hasn't been root-caused). `AnalyticsView` surfaces that exclusion count in the caption.
- **Triage order is not chronological**: unresolved first, then severity `P0→P3`, then oldest-first. "Unresolved" means `triage_status !== 'Verified'`; "aging" means unresolved and open >7 days.
- **Triage status is a 4-step ladder** — `Open → Investigating → Corrective Action → Verified` — mirrored in both `generate_data.py`'s `STATUS_POOL` and `TriageView`'s `STEPS`. Setting `Verified` stamps `resolved = today`; anything else clears it.

## The seeded narrative arcs

`generate_data.py` deliberately plants three stories, documented in its docstring. Regenerating with a different seed or altering the failure-probability logic will break the captions in `ReportsView` and `AnalyticsView` that reference them by name:

1. **Sim-only crosswind failure** — "Precision Landing — Gusty Crosswind" fails ~85% in Simulation but passes in Flight. Root cause: Scenario Definition (m/s vs. knots unit mismatch). This is the flagship RCCA demo.
2. **Telemetry gap cluster** — Flight runs between 2026-05-18 and 2026-06-07 drop telemetry ~42% of the time; drives the artifact-integrity table.
3. **Software regression** — "Obstacle Avoidance — Dynamic Intruder" spikes on HIL/Flight in builds v2.15.0/.1, fixed in v2.15.2; produces the visible dip-and-recovery in the weekly pass-rate chart.

The generator prints a sanity report (run counts, pass rate, per-arc occurrence counts) after writing — check it after any change to the generation logic.

## README roadmap (unimplemented)

Deploy to Vercel · failure → linked-run drill-through · CSV export of the integrity audit · code-split recharts (bundle is ~640 KB).
