# Runbook

How to work on Stratus day to day: what to install, what each command
writes, how to verify a change by hand, how to regenerate the seed without
moving an arc, how the rendered docs stay equal to the code, recipes for the
changes that recur, and the checklist before a PR. The shape of the app is in
[architecture.md](architecture.md); the rules, the matrix and the data are in
[rules.md](rules.md), [permissions.md](permissions.md) and
[data-model.md](data-model.md); the generator and its seven arcs are in
[seed-and-arcs.md](seed-and-arcs.md); the words are in
[glossary.md](glossary.md). The contributor brief, [CLAUDE.md](../CLAUDE.md),
states the rules a change must keep; this page says how to keep them.

## Setup

Three tools and no services:

| tool | used by | notes |
|---|---|---|
| Node and npm | Vite, vitest, `scripts/dump_rules.mjs` | Node 20.6 or later, or 18.19 or later: `dump_rules.mjs` calls `module.register()` from `node:module`, added in 20.6.0 and backported to 18.19.0. `package.json` pins no `engines` |
| Python 3 | `generate_data.py`, `scripts/render_analytics.py`, `scripts/render_docs.py` | standard library only (`json`, `random`, `datetime`, `os`, `collections`, `sqlite3`, `glob`, `re`, `difflib`, `subprocess`, `sys`); there is no requirements file and nothing to install |
| SQLite | through Python's `sqlite3` module | the generator writes `data/stratus.sqlite`; the renderers read it, or build a database in memory |

Then:

```bash
npm install
```

Run every command from the project root. `generate_data.py` writes
`src/data/<name>.json` and `data/stratus.sqlite` from `sql/schema.sql`;
`render_analytics.py` reads `data/stratus.sqlite` and writes
`docs/analytics.md`; `render_docs.py` runs `node scripts/dump_rules.mjs`, reads
`src/lib/rules.js`, `src/App.jsx`, `src/views/*.jsx` and `sql/schema.sql`, and
writes under `docs/`. Those paths are relative constants, so from any other
directory the scripts stop with a missing-file error or write into the wrong
place. (`dump_rules.mjs` itself locates the modules relative to its own file;
the Python that calls it does not.)

Do not run `npm audit fix`. `package.json` asks for Vite `^5.4.8` and the
major bump is deferred on purpose.

## Commands

| command | runs | what it writes |
|---|---|---|
| `npm run dev` | `vite` | nothing in the tree; serves `index.html` and prints the local URL |
| `npm run build` | `vite build` | `dist/`, gitignored. One chunk-size warning is expected: the index chunk carries the app and the imported seed JSON, about 920 KB before gzip, over Vite's default limit; Recharts lands in separate chunks loaded with the chart views. `vite.config.js` sets no `chunkSizeWarningLimit`, so the warning stays |
| `npm run preview` | `vite preview` | nothing; serves `dist/` |
| `npm test` | `vitest run` | nothing; the one suite is `src/lib/rules.test.js`, 173 tests at HEAD |
| `npm run data` | `python3 generate_data.py && python3 scripts/render_analytics.py` | the ten `src/data/*.json`, `data/stratus.sqlite` (gitignored; removed and rebuilt), `docs/analytics.md`; the sanity report on stdout |
| `npm run analytics` | `python3 scripts/render_analytics.py` | `docs/analytics.md` only, from the sqlite file on disk; stops with `data/stratus.sqlite missing — run python3 generate_data.py first` when there is none |
| `npm run docs` | `python3 scripts/render_docs.py` | `docs/permissions.md` whole, the `rules-reference` block of `docs/rules.md`, the `schema` block of `docs/data-model.md`; prints `docs — wrote N file(s)` and their names, or `wrote 0 file(s) (nothing changed)` |
| `npm run docs:check` | `python3 scripts/render_docs.py --check` | nothing; prints a unified diff per drifted file and exits 1, or `docs:check — 3 rendered file(s) match the code` and exits 0 |

vitest has no config file of its own, so `vite.config.js` (the React plugin and
nothing else) applies. The suite is deliberately scoped to the rules engine,
the permission matrix and the seed's compliance with them; its 102 matrix
cases are generated at collection time from `PERMISSIONS`, so a change to the
matrix is a change to the tests
([rules.md](rules.md#where-the-tests-come-from)). There is no linter, formatter
or CI configuration in the repository; every gate on this page is run by hand.

Of the data pipeline's outputs, `data/stratus.sqlite` is the one not committed
(`.gitignore`); `src/data/*.json` and `docs/analytics.md` are committed and are
regenerated, never edited.

## The dev loop

```bash
npm run dev
```

The app opens as the first coordinator in `src/data/users.json`, the AM Test
Coordinator (`App.jsx` picks `usersData.find((u) => u.role === 'coordinator')`).
The header's *Signed in as* picker switches persona. The persona is state, not
identity: switching never resets the plan, it changes what the plan allows.
Pick the persona for what you are checking:

| to exercise | sign in as |
|---|---|
| the board: assign, defer, scrub, cover the desk, release a coverer | Test Coordinator (AM) `U-03` or (PM) `U-04`; a request one coordinator filed must be placed by the other (I1) |
| intake, withdraw, the triage ladder and its Undo toast | Test Engineer, PLC `U-12` or Engineer, Perception `U-13` (`requester`) |
| program priority and tail targets inside a scope, and the `outside your scope` refusal | Program Lead, PLC `U-05` (scope `PRG-01`), PN `U-07` (`PRG-02`), SF `U-08` (`PRG-06`) |
| the desk's ratio and minimum, and everything an authority may do | PM `U-06` (scope `all`); Rider Ops Lead `U-02` (scope `desk`) for the desk's settings alone |
| grants, effective from tomorrow at the earliest; revokes, which take effect at once; and the refusal of one's own row (I2) | Trainer `U-15`, whose own row is `P-001` |
| My day and acknowledgements; the analytics tabs refused | the crew personas `U-09`, `U-10`, `U-11`, `U-14`; crew land on My day |
| every refusal tooltip at once | Manager `U-01` (`observer`): read-only, plus the three analytics tabs (Capacity, Analytics, Reports) |

The board is editable only for days after today (`editable = date > today` in
`DispatchView.jsx`); tomorrow, `meta.tomorrow`, is its default view and the
last day its stepper reaches. Board edits are stamped in the evening of today
(`stampNow()` in `App.jsx` issues `<today>T18:MM`), and requests and sorties
created in the session get `RQ-L…` and `AS-2026-L…` ids.

There is no linter or formatter, so a UI change is verified in the browser:
both themes (the toggle in the tab row cycles Auto → Light → Dark), phone width
(the stylesheet collapses at 900px and 700px and raises touch targets under
`pointer: coarse`), the keyboard inside every dialog (Tab cycles, Escape
closes the topmost dialog, focus returns to the opener), and the personas
above, so that a refused control shows disabled with the R9 message as its
tooltip rather than disappearing.

Everything the session edits lives in `App.jsx` state: `failures`, `requests`,
`assignments`, `coverage`, `persons`, `programs`, `desk`, `audit`, the board
date and the deep-link targets between views. A reload returns to the seed;
the footer says so. The one thing that persists is the theme preference,
`localStorage['stratus-theme']`, read before first paint by the inline script
in `index.html`.

## Regenerating the seed

```bash
npm run data
```

`generate_data.py` builds the seed in memory, runs `check_rules()` over it (R1
to R4, R8, R10, the R2 extension to the desk, and I1, I2, I4, I5, each an
`assert` tagged with the offending record and, for the numbered rules and
invariants, the rule id; three carry a description instead: the airframe
match and the two availability checks the app shows as the `AV` warning),
prints `invariants: I1 ok · I2 ok · I4 ok (…) · I5 ok · R2 desk ok`, writes
the ten JSON files, calls `write_sqlite()`, which removes `data/stratus.sqlite`
and rebuilds it from `sql/schema.sql`, and then prints the sanity report. The
report ends in assertions, and the `&&` in the npm script means
`render_analytics.py` runs only when the generator exits cleanly.

Read the report every time. It prints the run and failure counts, the RCCA arc
occurrences, a `--- dispatch ---` block (entity counts, request statuses and
the late count, deferral events by reason, flight runs linked to sorties, the
churn total and its busiest days), one block per dispatch arc, a
`--- roles & the desk ---` block, and tomorrow's queue. The lines that assert
are the ones the demo depends on:

| after this line | the generator asserts |
|---|---|
| `churn (scrubs + reassignments)` | arc D3: plan churn peaks on the grounding day |
| `D1 cross-rating flights` | each cross-rating flight was executed before the rating takes effect |
| `D4 no_rider_ops deferrals` | every desk refusal of a showcase had a Levant and a rated crew free (the note says `were free`) |
| `D4 showcases` | a showcase is refused by the ratio on the first day of the run; at least two desk deferrals; the whole showcase backlog ends `executed` |
| `tomorrow 2026-07-01` | exactly two unscheduled P0 in tomorrow's queue |

Order matters when something fails. `check_rules()` runs before anything is
written, but the sanity report runs after the JSON and the sqlite file are on
disk, so a failed report assertion leaves regenerated files in the tree and no
re-rendered notebook. `git diff -- src/data` shows what moved;
`git checkout -- src/data` puts the seed back.

Byte-identity is the check that a change did not touch the seed. The
generator is deterministic — `random.seed(42)`, two `random.Random` streams,
no clock, and `json.dump(…, indent=1)` — so after a change to anything but the
generation logic:

```bash
npm run data
git status --short -- src/data docs/analytics.md     # expect no output
```

If something is listed, the change moved the seed. Decide whether it meant
to, read the report, and commit the regenerated files with the change.

The RNG-stream rule is what makes a targeted change possible. The RCCA half
(runs, failures, arcs 1 to 3) draws from the module-level `random` seeded 42;
the planner below the `dispatch layer` banner draws from
`drng = random.Random(4242)`; the desk's rider-facing flags draw from
`rrng = random.Random(4243)`. A new draw in one stream re-rolls everything
after it in that stream and nothing in the others, so the dispatch section can
change without re-rolling a single run or failure — only the run-to-sortie
link, `run.request_id` on Flight runs, follows the planner; but the dispatch
stream must not gain or lose a draw before Jun 15, or arcs D1 to D3 re-roll.
That is why the showcase run is registered with its intake fields spelled out
instead of drawn. What each arc needs and what must not move is in
[seed-and-arcs.md](seed-and-arcs.md).

The sqlite file and the notebook follow the seed. `write_sqlite()` fills every
table from the same in-memory records that became the JSON, so the two
renderings cannot disagree, and `render_analytics.py` then runs each
`sql/analytics/*.sql` against the fresh database and overwrites
`docs/analytics.md` wholesale. Never hand-edit the notebook. A change to a query
alone needs only `npm run analytics`.

## Keeping the docs honest

```bash
npm run docs          # write
npm run docs:check    # exit 1 on drift, with a diff
```

Three parts of `docs/` are rendered from the code by `scripts/render_docs.py`:

| target | source | contents |
|---|---|---|
| `docs/permissions.md`, the whole file | `src/lib/auth.js`, executed; for the table of actions no transition authorizes, the `scan_functions()` scan of `src/lib/rules.js` and a search of `src/App.jsx` and `src/views/*.jsx` for the single-quoted action name | the roles, the grant legend (`LEGEND` in `render_docs.py`), the matrix, the I3 sentence, the table of actions no transition authorizes and which file asks for them, the by-role summary, every refusal message `can()` returns, `EVENT_ACTION`, the export inventory |
| the `rules-reference` block of `docs/rules.md` | `src/lib/rules.js` | the vocabulary (windows, priorities, deferral and scrub reasons with labels, crew kinds, build stages, the triage ladder, the desk's defaults and bounds), the two R8 messages `validateReason()` returns, the function inventory, the export inventory |
| the `schema` block of `docs/data-model.md` | `sql/schema.sql` | every table's columns, keys and references read back through SQLite's pragmas, the stored DDL, the foreign-key list, the indexes |

A block sits between two markers; the prose outside them is hand-written:

```html
<!-- rendered:begin rules-reference (scripts/render_docs.py) -->
…
<!-- rendered:end rules-reference -->
```

`splice()` matches `<!-- rendered:begin <id>` followed by anything up to
`-->`, finds `<!-- rendered:end <id> -->` after it, and replaces what lies
between; the markers stay. The hand-written file must already exist (the render
stops with `the hand-written half must exist` otherwise) and the end marker
must follow the begin marker. `permissions.md` has no markers because nothing
in it is hand-written.

The JavaScript is executed, not parsed. `scripts/dump_rules.mjs` imports
`src/lib/auth.js` and `src/lib/rules.js` under Node, builds one persona per
role, asks `can()` for the refusal each role gets on each action — with a
target that fails the predicate where the grant is conditional, and once with
no actor — reads the constants and `validateReason()`'s messages, and prints
one JSON document that `render_docs.py` consumes. A renamed constant or a
reworded message changes the output, so the doc cannot keep an old message
quietly.

The one obstacle is module resolution. The app's modules import each other
without file extensions — `import { authorize } from './auth'` — which Vite
resolves (and vitest, through Vite) and plain Node does not.
`scripts/esm_extensionless.mjs` is a resolve hook that `dump_rules.mjs`
registers with `module.register()` before importing anything: when a relative
specifier (`./` or `../`) has no extension of the `.js` family and the `.js`
file exists next to the importer, it resolves to that file; everything else
passes through untouched. The app source is executed as-is, nothing is
rewritten, and the hook is why the dump works without a bundler.

One part of the rules block is a scan of source text, not an execution: the
function inventory. `scan_functions()` finds each `function name(` or
`export function name(` declaration in `rules.js` and, inside it, the literals
`rule: '…', severity: '…'`, `authorize(actor, '…')` and
`assertReason(reason, LIST)`, plus whether `throw new Error` appears. A rule,
action or reason list written any other way drops out of that table while
`docs:check` still passes, so keep writing them literally.

Three conditions make the render fail rather than render something wrong: a
grant kind in `PERMISSIONS` that the `LEGEND` table in `render_docs.py` does
not define; a matrix that has lost the I3 shape (coordinators hold every
`plan.*` action and no `program.*`, authority the reverse); and a relative link
in rendered text whose target does not exist on disk. A missing `node` stops
it with `node is required to render docs/`. `--check` renders everything to
memory, compares it with what is on disk, prints a unified diff per drifted
file and exits 1 with a `docs:check — N file(s) drifted from the code` line
that names them and says to run `npm run docs`; otherwise it exits 0.

After changing `src/lib/auth.js`, `src/lib/rules.js` or `sql/schema.sql`, or
which matrix actions `src/App.jsx` and `src/views/*.jsx` quote:

```bash
npm test
npm run docs
npm run docs:check
```

and commit the rendered files with the change. Nothing runs `docs:check`
automatically: it is the gate for any PR that touches those three files, and
for one that adds or removes in `src/App.jsx` or `src/views/*.jsx` the
single-quoted name of a matrix action no transition authorizes — the *asked by*
column of `permissions.md` is a search of those files. A reviewer can run it
against the branch.

## Recipes

Each recipe is the set of places one change touches, in the order that keeps
the gates green.

### Adding a rule

1. Decide where it is checked. A rule on one sortie is a clause in
   `checkAssignment()`; a day-level one is in `dayWarnings()`; a rule on the
   desk roster is in `checkCover()` or `checkUncover()`; an intake rule is in
   `validateRequest()` or beside `lateWarning()`. Checks return and never
   throw; `App.jsx` runs them before the transition and returns the
   violations instead of saving when `hasBlock()` is true, and the dialog in
   the view keeps its confirm button disabled while a block is live.
2. Return a violation in the house shape, with the literals written out so
   the docs scan sees them. Rule ids are global, and R11–R13 are reserved by
   the Field Ops spec ([specs/README.md](specs/README.md)), so the next rule
   takes `R14`:

   ```js
   out.push({ rule: 'R14', severity: 'block', message: `${asset.asset_id} … in ${cand.window} on ${cand.date}.` });
   ```

   `block` rejects the edit, `warn` renders inline and in the day summary.
   The message is a sentence that names the entities (tail id, person name,
   request id, window, date); the id is printed by the views, in bold before
   the message.
3. Make the seed obey it. The planner in `generate_data.py` must respect the
   rule when it builds assignments, and `check_rules()` must assert it with a
   tag such as `("R14 …", record)`, so `npm run data` fails the first time
   the seed breaks it.
4. Add a `describe('R14 · …')` block to `src/lib/rules.test.js`, extending
   `fx()` where the fixture lacks the case. Use the `rules()` helper for
   blocks; for a warning, look the violation up and check `.severity`.
5. `npm run data` and confirm the seed is byte-identical (or read the report),
   `npm test`, then `npm run docs` and `npm run docs:check` so the function
   inventory shows the new literals. Add the row to the rules table in the
   root `README.md` and the prose in [rules.md](rules.md).

### Adding an action to the matrix

1. Add the row to `PERMISSIONS` in `src/lib/auth.js` using the existing grant
   kinds (`yes`, `own`, `not-own`, `scope`, `desk`, `not-self`). A new kind
   needs a case in `can()`, a line in the header comment, and an entry in
   `LEGEND` in `scripts/render_docs.py`; the render fails without it. Keep the
   I3 shape, which the render also asserts.
2. If a timeline event carries the action, map the event in `EVENT_ACTION`
   (and in `eventAction()` if it has an exception, as `late_intake` does), add
   the event to the `request_events.event` `CHECK` in `sql/schema.sql`, to the
   `CASE` in `sql/analytics/09_actions_by_role.sql`, and to the generator's
   mirrored `EVENT_ACTION`.
3. Write the transition in `src/lib/rules.js` with
   `authorize(actor, 'the.action', target)` as its first line, literally, so
   the docs scan lists it. `App.jsx` builds the transition inside a `try`
   outside the state updater and returns the refusal as a message.
4. In the view, ask `allowed('the.action', target)` and render the control
   `disabled` with the message as its `title` when refused. Never hide it.
5. If the seed stamps the action on an event, sortie or coverage row, add it
   to the mirrored `PERMISSIONS` in `generate_data.py` (a new grant kind also
   needs a branch in `permits()`, which switches on the kind and has no
   per-action code). `check_rules()` verifies I4 with `permits()` over every
   timeline event, through the mirrored `EVENT_ACTION`, and over each sortie's
   and coverage row's `assigned_by`; a stamp on any other field needs its own
   assert there. The mirror carries only the actions the seed uses.
6. The matrix tests write themselves: six new cases per action. A predicate
   grant needs `friendly()` in `rules.test.js` to build a target that
   satisfies it for the granted role (`PRG-A` for the lead's scope, the
   actor's own request for `own`, a person other than `P-HP` for `not-self`),
   and a `desk` grant needs the `actorFor()` swap to the PM. Test the
   predicate refusals by hand in the ownership block; the generated cases
   never trigger them.
7. `npm test`, `npm run docs`, `npm run docs:check`. `permissions.md` picks up
   the row, every message and the by-role summary.

### Adding a deferral reason

1. `src/lib/rules.js`: append to `DEFERRAL_REASONS` and add a `REASON_LABELS`
   entry. `SCRUB_REASONS` is the deferral list plus `weather`, so a
   scrub-only reason goes there instead. The pickers in `DispatchView.jsx`
   read the lists; the rail, the timeline, the Pareto and the end-of-day
   report read the labels.
2. `generate_data.py`: append to its own `DEFERRAL_REASONS`.
   `meta.deferral_reasons` is written from it, `check_rules()` asserts every
   deferred event's reason is in it, and the planner may now defer with it.
3. `sql/schema.sql`: add it to both `CHECK` lists, the one on
   `requests.deferral_reason` and the table-level one on `request_events`, or
   `write_sqlite()` fails on the first row that uses it.
4. `npm run data` (the notebook's `02_deferrals_by_cause` groups on whatever
   reasons exist), `npm test` (the R8 tests iterate the list), then
   `npm run docs` and `npm run docs:check` (the rules block lists the reasons
   and labels; the schema block shows both checks).

### Adding a derivation

1. Put it in `src/lib/dispatch.js` (the plan side: requests, sorties, the
   roster, the desk) or `src/lib/helpers.js` (the RCCA side: runs and
   failures), never in a view. Take `db` and a date range, mutate nothing,
   and round to a whole percent like its neighbours.
2. Write the SQL counterpart under `sql/analytics/` as `NN_name.sql`: exactly
   one statement, headed by `--` comment lines that state the question. The
   renderer derives the heading from the filename (the `NN_` prefix and
   `.sql` stripped, underscores to spaces), runs the file with a single
   `execute()`, and uses the column aliases as the table headers.
3. Make the two agree where a definition matters — the percentile rank rule,
   the denominators, "today" as `max(test_runs.date)` — and accept that the
   SQL prints one decimal where the JS rounds whole.
4. `npm run analytics` re-renders `docs/analytics.md`; commit it with the
   query. The notebook is the reviewable artifact; the sqlite file is not
   committed.

### Adding a view or a dialog

1. A view is a file in `src/views/` and an entry in `TABS` in `App.jsx` with
   its group, `Plan` or `Execute`. It takes `me` and `allowed` and asks
   `allowed(action, target)` for each control. If it carries Recharts, add it
   to `lazyViews()`, render it inside the existing `ChunkBoundary` and
   `Suspense`, take `theme` as a prop and destructure `chartTheme(theme)` for
   its colors: SVG attributes cannot resolve CSS variables.
2. Every dialog goes through `src/views/Modal.jsx`. `Modal` takes `label`,
   `onClose`, an optional `className` (`wide`, `confirm`), `as` (the intake
   form renders as a `form`), `closeOnBackdrop={false}` for a form that must
   not vanish on a stray click, and `fallbackFocus` (a selector such as
   `.board`) for when the opener has left the DOM; `ConfirmDialog` is the
   yes/no. The portal, the focus trap, Escape on the topmost dialog only and
   the focus return live there once. Do not hand-roll a `.modal-bg`, and never
   call `window.confirm`.
3. Run the check first and show its violations in a `.rule-list`, keep the
   confirm button disabled while a `block` is live, then call the handler
   `App.jsx` passed, which returns a refusal rather than throwing.
4. A refused control stays on screen, disabled, with the R9 message as its
   `title`. Check the view at phone width and in both themes.

### Adding a color

1. Reuse first. Status color is the data encoding: a pass/fail/blocked
   meaning takes `--pass`, `--fail` or `--blocked`, and a priority takes
   `--p0` to `--p3`.
2. A new token goes in both blocks of `src/styles.css`: `:root` (dark) and
   `[data-theme='light']`. The non-color tokens (`--mono`, `--display`,
   `--body`, `--r`) live in `:root` only.
3. Derive tints with `color-mix(in srgb, var(--token) N%, transparent)` rather
   than a second hex; the stylesheet does this for pill borders (40%), pill
   backgrounds (8%) and highlighted cells.
4. If a chart uses it, add a hex copy to both `CHART_THEMES.dark` and
   `CHART_THEMES.light` in `src/lib/helpers.js` and keep them equal to the
   tokens; the comment above `CHART_THEMES` says so.

### Changing an entity's shape

The long form is in [data-model.md](data-model.md#changing-the-shape). In
order: the generator (derive the field where the record is built, mind the
RNG streams, assert it in `check_rules()` if a rule holds over it), together
with `sql/schema.sql` and the matching `INSERT` in `write_sqlite()` (positional
placeholders, so the count must match the column count or the write fails);
`npm run data`, and read the report; `makeDb()`, the views and the
derivations that read the field; the fixture builders (`person()`, `req()`,
`cand()`, the asset literals) and the seed block in `rules.test.js`;
`npm run docs` and `npm run docs:check`, and the prose in `data-model.md`.
Commit the regenerated `src/data/*.json`, `docs/analytics.md` and the rendered
docs by explicit path.

## Before you open a PR

From the project root:

```bash
npm test             # 173 passing at HEAD; the count moves only with a new test or a matrix change
npm run build        # one chunk-size warning, on the index chunk, and nothing else
npm run data         # then: git status --short -- src/data docs/analytics.md  → empty unless you changed the generator
npm run docs:check   # exit 0
```

If `npm run data` changed files, read the sanity report, make sure every arc
still asserts, and commit the regenerated files with the change. If
`docs:check` fails, `npm run docs` and commit the rendered files.

Then the confidentiality check. Nothing from any real workplace enters the
repo: no colleague names, vehicle ids, program names, tool names, channel
names or certification codes. The fiction is Stratus Aerial, the Windz fleet
(Levant, Harmattan, Sirocco) and the names already in `generate_data.py` and
`src/data/users.json`. List every proper-noun-shaped token the staged change
adds and check each one against the fiction:

```bash
git diff --cached -U0 | grep '^+[^+]' | grep -oE '\b[A-Z][A-Za-z0-9.-]{2,}\b' | sort -u
```

Then search the whole tree for any term you removed or replaced while writing
(`git grep -i <term>`). A grep only finds what you name, so read the diff once
more as a stranger would.

Stage by explicit path (`git add src/lib/rules.js docs/rules.md …`), never
`git add -A`: planning docs and patch archives sometimes sit untracked at the
repo root. Never run `npm audit fix`; the Vite major bump is deferred on
purpose.

Deployment is the production build and nothing else. The live URL in the root
[README](../README.md) is a Vercel deployment of what `vite build` writes to
`dist/`. The repository holds no deployment configuration — no `vercel.json`,
no CI workflow — and `vite.config.js` sets no `base`, so the app is served
from the root of its domain. There is nothing else to configure.
