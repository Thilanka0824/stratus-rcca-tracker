# Architecture — how Stratus is built

The technical shape of the app, for a maintainer or reviewer who has read the
root [README](../README.md) and wants to know where each piece lives, what owns
what, which invariants hold, and how a change travels. The contributor brief is
[CLAUDE.md](../CLAUDE.md). The rules engine is described rule by rule in
[rules.md](rules.md), the permission matrix in [permissions.md](permissions.md),
the entities in [data-model.md](data-model.md), the generator in
[seed-and-arcs.md](seed-and-arcs.md), the commands and recipes in
[runbook.md](runbook.md), and the vocabulary in [glossary.md](glossary.md).

## Shape

One page. `src/main.jsx` creates a React 18 root on `#root` inside
`React.StrictMode`, imports the one stylesheet and renders `App`. There is no
router, no backend and no state library: eight views are selected by tab index
in `App.jsx`, every session-mutable value is React state in that one component, and a
reload returns the seed. The README's *Architecture decisions* and *Cut list*
give the reasoning: the claim being demonstrated is workflow and prioritization
design, and a backend would spend the effort proving CRUD, which is the wrong
claim. Build-time data and session-only edits keep the claim where it belongs.

The views sit in two groups, `Plan` (the upstream half: requests in, tails and
crew out) and `Execute` (the downstream half: runs → failures → triage → RCCA →
report), as the `TABS` constant in `App.jsx` lists them:

| group | tabs |
|---|---|
| Plan | Requests · Dispatch · Capacity · My day |
| Execute | Runs · Triage · Analytics · Reports |

A tab is a button that sets an index; `idx(label)` looks the index up by label,
so a deep link names a view rather than a number. The header carries the
persona picker ("Signed in as", grouped by `meta.app_roles`) and the heartbeat
strip of the last 60 runs; between it and the tabs sit five stat cards, each of
which opens the view where its number is acted on. The app opens on Requests as
the first `coordinator` persona in `src/data/users.json`.

The stack is React 18, Vite 5, Recharts 2 and vitest 2 on the JavaScript side
(`package.json`), Python 3 and SQLite on the data side. The live build is
deployed at https://stratus-rcca-tracker.vercel.app, the README's link.

## Data flows one way at build time

```
generate_data.py   (random.seed(42) · drng = Random(4242) · rrng = Random(4243))
   │
   ├─► src/data/*.json ──import──► App.jsx ──makeDb()──► db ──props──► views
   │                                  │
   │                                  └─► session state (requests, assignments, …)
   │                                      gone on reload; the seed is the truth again
   │
   └─► data/stratus.sqlite  (sql/schema.sql) ──render_analytics.py──► docs/analytics.md
```

`generate_data.py` writes ten JSON files into `src/data/`, and the app imports
them at build time; nothing is fetched at runtime. The sqlite file is a second
output of the same in-memory seed, written by `write_sqlite()` from
`sql/schema.sql`; the app never reads it, the SQL notebook does.

| file | holds | rows in the current seed |
|---|---|---|
| `test_runs.json` | every run: pipeline, scenario, build, status, artifacts, and `request_id` for Flight runs | 305 |
| `failures.json` | the RCCA items: severity, team, opened and resolved dates, `triage_status`, root cause, 5-Whys, occurrences | 14 |
| `meta.json` | the window, `today`, `tomorrow`, the airframes and their windows, `cutoff_local`, `deferral_reasons`, `rider_desk`, `app_roles` | — |
| `programs.json` | the programs: code, airframes, `priority_default`, `asset_min` and `asset_max`, `standing` | 6 |
| `assets.json` | the tails: airframe, operating windows, config, `status_history` | 12 |
| `persons.json` | the roster: roles, ratings with their effective dates, the desk qualification, `granted_by`, availability | 20 |
| `requests.json` | the queue, each request with its timeline of events carrying `by` and `day` | 535 |
| `assignments.json` | the sorties, one per (date, asset, window), with `assigned_by` and `acked` | 525 |
| `users.json` | the personas: `user_id`, name, title, app role, scope, `person_id` | 15 |
| `coverage.json` | the rider desk roster, one row per (date, window, person) | 321 |

The row counts are seed values that `npm run data` reproduces; the shapes are
in [data-model.md](data-model.md).

`App.jsx` hands seven of those files — programs, assets, persons, requests,
assignments, users, coverage — and `meta.rider_desk` as the desk to `makeDb()`
in `src/lib/rules.js`, which indexes them once: the raw arrays, `Map`s keyed by
id (`db.program`, `db.asset`, `db.person`, `db.request`, `db.user`) and the
desk settings. The memo re-runs only when a session-mutable input changes
(programs, persons, requests, assignments, coverage, desk); assets and users
stay the imported arrays. Views receive `db` for everything the seed indexes;
the runs and the failures travel as their own props (`runs`, `failures`),
because runs are never indexed and failures are their own slice of state.

Runs are never mutated. `runsData` is passed to the Runs, Triage and Reports
views as imported, and no handler writes to it. Two dates follow from it:

- **Today is the last run date.** `today = maxDate(runsData)` in `App.jsx`,
  which `meta.today` repeats (`2026-06-30` in the seed). Nothing ages by the
  wall clock.
- **Tomorrow is a planned day.** `meta.tomorrow` (`2026-07-01` in the seed)
  carries an unscheduled queue and is the board's default, the initial value
  of `boardDate`. Session edits are stamped in the evening of today, and the
  board accepts edits only for days after today, so a plan built in the
  session is always for tomorrow or later.

## App.jsx is the only owner of state

Every piece of session state — anything that must outlive a tab change — is a
`useState` in `App.jsx`. Views keep only their own UI state (a filter, a
selection, an open dialog) in their own hooks, and none of it survives a tab
change, because a view is mounted only while its tab is selected.

| state | holds | who changes it |
|---|---|---|
| `tab` | the selected view's index in `TABS` | the tab buttons through `go()`, the deep links, `signIn()`, the redirect effect |
| `reportsFocus` | `{ panel, n }` with panel `'trend'` or `'gaps'`, or null: the Reports panel to scroll to on arrival | the Pass rate and Artifact gaps stat cards through `go()`, which clears it on every other jump |
| `boardDate` | the day the board shows; starts at `meta.tomorrow` | the board's date picker (`setDate`), `openBoard()` |
| `requestFocus` | a request id for the Requests view to open | `openRequest()` from a chip or rail card on the board |
| `triageFocus` | a failure id for the Triage view to open | `openFailure()` from a grounded tail on the board |
| `pref` | the theme preference: `'system'`, `'light'` or `'dark'` | the theme toggle |
| `osTheme` | the OS color scheme, kept live | the `prefers-color-scheme` change listener |
| `failures` | the RCCA items with their triage status | `triage()` |
| `requests` | the queue | `assign()`, `defer()`, `scrub()`, `withdraw()`, `submitRequest()` |
| `assignments` | the sorties | `assign()`, `scrub()`, `ack()` |
| `coverage` | the rider desk roster | `cover()`, `uncover()`, `ack()` |
| `persons` | the roster's ratings and qualifications | `grant()`, `revoke()` |
| `programs` | each program's default priority and tail band | `editProgram()` |
| `desk` | `{ ratio, min_per_window }`; starts at `meta.rider_desk` | `editDesk()` |
| `audit` | actions outside a request's timeline, with their actor | `record()` |
| `currentUser` | the persona; starts as the first coordinator in `users.json` | `signIn()` from the header picker |
| `chunkAttempt` | how many times the lazy chart chunk has been retried | the `ChunkBoundary`'s Try again |

Three refs are counters, not state: `focusSeq` (a focus request is a new object
every time), `editStamp` (the evening minute) and `intakeSeq` (the next session
request id).

**The persona is state, not identity.** `currentUser` is a row of `users.json`;
`signIn()` replaces it and nothing else. The plan is not reset and the audit is
not cleared. The Requests view is remounted (it is keyed by
`currentUser.user_id`) and the board drops what it had in hand (`DispatchView`
clears its selection and dialogs when `me.user_id` changes). Every permission
question a view asks goes through one closure:

```js
const allowed = (action, target = null) => can(currentUser, action, target);
```

The views read `me` only for identity — whose seats, whose requests, and when
the persona changed.

**Deep links are plain callbacks.** `openBoard(date)` sets `boardDate` and
switches to Dispatch; `openRequest(id)` sets `requestFocus` and switches to
Requests; `openFailure(id)` sets `triageFocus` and switches to Triage;
`go(i, focus)` wraps a stat card's jump to Reports in a fresh `{ panel, n }`
so that clicking the same card twice scrolls twice. Requests and Triage read
`focusId` as initial state, which works because switching tabs unmounts and
remounts them; Reports scrolls in an effect keyed on `focus`, which is why the
fresh `{ panel, n }` object matters when the card is clicked while Reports is
already open.

**The theme is one preference and one resolved value.** `pref` is persisted to
`localStorage['stratus-theme']`; `theme` is `pref === 'system' ? osTheme :
pref`, is written to `document.documentElement.dataset.theme`, and is passed
to the three chart views. The inline script in `index.html` applies the same
rule before the bundle loads — an exact `'light'` or `'dark'` is used, anything
else follows `prefers-color-scheme` — so the first paint is already the right
theme. The stylesheet only ever selects `[data-theme='light']`; dark is the
`:root` default.

**Edits are stamped in the evening of today, in order.** `stampNow()` returns
`${today}T18:MM`, the minute taken from `editStamp` and incremented on every
call. The intake form receives `nowAt = ${today}T18:00` for its R7 verdict,
which is why a request filed in the session for tomorrow is flagged late by
construction: 18:00 is after the 15:00 cutoff for the next day.

**Session ids.** A request filed in the session is `RQ-L001`, `RQ-L002`, …
(`intakeSeq` in `App.jsx`); a sortie placed on the board is `AS-2026-L001`, …
(`nextAssignmentId()` in `rules.js`, a module-level counter). They never
collide with seed ids.

**The audit list.** `record(action, target, detail)` appends
`{ at: stampNow(), by: currentUser.user_id, action, target, detail }`. It holds
the actions that do not write a request timeline: `desk.cover`, `desk.uncover`,
`sortie.ack`, `rating.grant`, `qualification.grant`, `rating.revoke`,
`program.priority` and `program.targets` (each only when that dial changed),
`triage.edit` and `desk.settings`. Assign, defer, scrub, withdraw and intake
are not recorded there; they append a timeline event with `by` to the request
itself. `actionsByRole()` in `dispatch.js` folds the audit into its `granted`
and `set` columns, counts `covered` from the coverage rows' `assigned_by` and
the seed's grants from `person.granted_by`, and reads the timelines for filed,
withdrawn, assigned, deferred and scrubbed.

**One pattern for every mutation.** A handler builds the next value by calling
a `rules.js` transition outside the state updater, inside `try`/`catch`, and
only then calls `setState`:

```js
let next;
try { next = deferRequest(currentUser, r, { reason, day: boardDate, at: stampNow(), note }); } catch (e) { return e.message; }
setRequests((prev) => prev.map((x) => (x.request_id === requestId ? next : x)));
return null;
```

An R9 refusal from `authorize()`, an R8 throw from a deferral with no reason,
or a bounds error from the desk settings therefore comes back to the view as a
returned value, never as an error thrown inside React, and nothing is saved.
The two handlers whose dialogs expect a violation list (`assign`, `cover`) run
the matching check first and return it unsaved when it contains a block; a
throw is wrapped as `[{ rule: 'R9', severity: 'block', message }]` by
`refused()`.

| handler | rules.js transition(s) | action `authorize()` checks | before the transition | returns |
|---|---|---|---|---|
| `assign(cand)` | `newAssignment`, `scheduleRequest` | `plan.assign`, twice, against the request | `checkAssignment(cand, db)` | the violations; unsaved when any is a block |
| `defer(id, reason, note)` | `deferRequest` with `day: boardDate` | `plan.defer` | — | a message, or null |
| `scrub(id, reason, note)` | `scrubAssignment`, `scrubRequest` | `plan.scrub`, against the sortie then the request | — | a message, or null |
| `withdraw(id)` | `withdrawRequest` | `request.withdraw` | — | a message, or null |
| `submitRequest(fields)` | `newRequest` | `request.create` against `{ program_id }` | `validateRequest(fields, db, { tomorrow })` | `{ request }` or `{ errors }` |
| `cover(cand)` | `coverWindow` | `desk.cover` | `checkCover(cand, db)` | the violations; unsaved on a block |
| `uncover(cand)` | `uncoverWindow` | `desk.cover` | `checkUncover(cand, db)` | the first block's message, or null |
| `ack(target)` | `acknowledge` | `sortie.ack` against the sortie or coverage row | — | a message, or null |
| `grant(personId, kind, effective)` | `grantRating`, or `grantQualification` when `kind === 'rider_ops'`, both with `notBefore: meta.tomorrow` | `rating.grant` or `qualification.grant` against the person | — | a message, or null |
| `revoke(personId, airframe)` | `revokeRating` | `rating.revoke` against the person | — | a message, or null |
| `editProgram(programId, patch)` | `editProgram`, which calls `setProgramPriority` and/or `setProgramTargets` | `program.priority`, `program.targets`, each only if that dial changed | — | a message, or null |
| `editDesk(patch)` | `setDeskSettings` | `desk.settings` | — | a message, or null |
| `triage(failureId, status, resolved)` | `triageFailure` with `{ today, resolved }` | `triage.edit` | — | a message, or null |

The return shapes are the contract the dialogs depend on: `onAssign` and
`onCover` close only when the returned list has no block; the message-or-null
callbacks show the message in place and close on null; the intake form reads
`errors` by field.

## The modules

### `src/lib/rules.js`, the engine

R1–R10 as pure functions over plain data, called by the board before anything
is saved and run over the seed in `rules.test.js`. Its header fixes the
severity model: `'block'` rejects an edit, `'warn'` renders inline and in the
day summary, R8 is structural (`deferRequest()` and `scrubAssignment()` throw
without a reason from the enum), and R9 is authorization — every mutating
transition takes the actor first and calls `authorize()` before it touches
anything. Its exports, by concern:

| concern | functions |
|---|---|
| constants | `WINDOWS`, `PRIORITY_RANK`, `DEFERRAL_REASONS`, `SCRUB_REASONS` (adds `weather`), `REASON_LABELS`, `CREW_LABELS`, `CREW_KINDS`, `BUILD_STAGES`, `TRIAGE_STEPS`, `DEFAULT_DESK`, `DESK_BOUNDS` |
| lookups | `makeDb`, `addDays`, `isWeekend`, `ratedOn`, `availableOn`, `qualifiedOn`, `assetStatusOn`, `isOperatingDay` |
| the rider desk | `deskCoverers`, `riderLoad`, `checkCoverage` (the board's desk row), `checkCover` (rostering), `checkUncover` (release) |
| intake timing | `isLate`, `defaultPlanDate`, `lateWarning` (R7); `validateReason` (R8) |
| one sortie | `checkAssignment` (R1–R4 and R10 as blocks; R5 at edit time and `AV`, an unrostered person, as warnings), `hasBlock` |
| one day | `programTails`, `queuedFor` (the rail: live requests plus those deferred from that day), `dayWarnings` (R5, R6) |
| intake | `validateRequest`, `operatingWindows`, `pruneWindows`, `newRequest` |
| transitions | `nextAssignmentId`, `newAssignment`, `scheduleRequest`, `deferRequest`, `scrubAssignment`, `scrubRequest`, `triageFailure`, `withdrawRequest`, `coverWindow`, `uncoverWindow`, `acknowledge`, `grantRating`, `revokeRating`, `grantQualification`, `setProgramPriority`, `setProgramTargets`, `editProgram`, `setDeskSettings` |

Transitions are immutable: each leaves its input untouched and returns a new
object, which is what lets `App.jsx` build the next value first and save it
second. The one exception is `editProgram()`, which hands back the same program
when the patch changes nothing — the identity `App.jsx` checks before it saves
or records anything. `newRequest()` derives the late flag and the plan day from the
submission time and stamps the filer as the actor; the late-intake deferral it
appends is part of filing. The rule-by-rule account is [rules.md](rules.md).

### `src/lib/auth.js`, the matrix as data

`PERMISSIONS` maps 17 actions to, per app role, a grant: `yes`, `own`,
`not-own`, `scope`, `desk` or `not-self`; a role absent from an action's row is
refused. `can(actor, action, target)` is the UI's question and returns
`{ ok: true }` or `{ ok: false, message }`, the message in the house format
with the role and the action named; `authorize()` is the rules' question and
throws that same message. The predicates (`inScope`, `deskScope`,
`ownsRequest`, `ownSeat`, `isSelf`) are functions here, never string parsing
in a view. `EVENT_ACTION` and `eventAction()` map a timeline event to the
action it was, so the seed's actors can be checked (I4); a `deferred` event
with reason `late_intake` is `request.create`. The matrix carries
`request.edit` and `plan.reassign` ahead of any control that uses them. The
whole module is rendered into [permissions.md](permissions.md).

### `src/lib/dispatch.js` and `src/lib/helpers.js`, the derivations

Cross-view computation lives in these two files and nowhere else; a view that
needs a number imports it. Both mutate nothing.

`helpers.js` is the RCCA side: `maxDate` (dataset today), `daysBetween`,
`fmtDate`, `failureAge`, `isUnresolved`, `isAging`, `missingArtifacts` (video
counts only when `=== false`, so Simulation's `null` is not a gap),
`weeklyPassRate`, `paretoRootCauses` (occurrence-weighted, failures without a
`root_cause` excluded), `failuresByTeam`, and `chartTheme`.

`dispatch.js` is the plan side, imported by the Requests, Dispatch, Capacity,
My day, Triage and Reports views: request helpers (`STATUS_ORDER`, `fmtStamp`,
`requestAge`, `isQueued`, `programCode`, `latestAssignment`, `personName`); the
deferral Pareto (`deferralEvents`, `deferralPareto`) and the tell (`idleRated`,
`misattribution` — someone on the desk is on comms, not idle); fulfillment
(`onWindowFulfillment`, `riderFulfillment`); capacity and utilization
(`dailyCapacity`, `utilizationByWeek`, `assetUtilization`, `crewUtilization`,
`demandVsSupply`); `leadTimes` and `churnByDay`; `ratingMatrix`; the desk
(`deskByDay`, `deskLoad`); `actionsByRole` with `ACTION_COLUMNS`; the loop back
into RCCA (`groundingDays`, `tailsAgainst`); and `daySummary`, which feeds the
header's "Tomorrow: unscheduled P0" card and the end-of-day report. The SQL
notebook restates these metrics against the seed database;
[analytics.md](analytics.md) is the rendered result.

### The views

Views are presentation over props. Each takes `db` where it needs the seed,
`me` and `allowed` where it has controls, and fires callbacks that `App.jsx`
implements. They import checks, lookups and labels from `rules.js`; every
transition is called from `App.jsx`.

| view | group | shows | callbacks it can fire | actions it checks with `allowed()` | who edits here |
|---|---|---|---|---|---|
| `RequestsView` | Plan | the queue in attention order, the intake form, a drawer per request with its timeline | `onSubmit`, `onWithdraw`, `onOpenBoard` | `request.create` per program, `request.withdraw` | requesters, coordinators (on behalf), authority in scope; the default tab |
| `DispatchView` | Plan | one day: the desk row, a program group per program with its tail × window grid, the rail, the chips and footer, five dialogs (the reason picker serves both defer and scrub) | `onAssign`, `onDefer`, `onScrub`, `onCover`, `onUncover`, `onEditProgram`, `onEditDesk`, `onOpenRequest`, `onOpenFailure`, `setDate` | `plan.assign`, `plan.defer`, `plan.scrub`, `desk.cover`, `desk.settings`, `program.priority`, `program.targets` | the coordinator (the plan and the desk roster), authority (a program's dials), the PM or rider ops lead (the desk's settings) |
| `CapacityView` | Plan, lazy | KPI cards, demand vs supply, the deferral Pareto and the tell, desk load, utilization, lead time and churn, the rating matrix, actions by role | `onGrant`, `onRevoke` | `rating.grant`, `qualification.grant` | the trainer, in the matrix's edit mode; refused to crew |
| `MyDayView` | Plan | the crew persona's own sorties and coverage rows for a day, their ratings as of that day, who granted them | `onAck` | `sortie.ack` per seat | crew only; the tab is disabled for everyone else |
| `RunsView` | Execute | the run log, newest first, with filters and the artifact dots | — | — | nobody; read-only |
| `TriageView` | Execute | the queue in triage order, the detail with the four-step ladder and its undo toast, the dispatch impact | `onTriage`, `onOpenBoard` | `canEdit`, which is `allowed('triage.edit')` passed in | the requester; everyone else sees the stepper disabled |
| `AnalyticsView` | Execute, lazy | the root-cause Pareto, failures by team | — | — (the tab is gated) | nobody; refused to crew |
| `ReportsView` | Execute, lazy | the weekly pass rate, the artifact integrity audit, the end-of-day report | — (`focus` arrives as a prop) | — (the tab is gated) | nobody; refused to crew |

The three chart views take `theme` as a prop and read every color from
`chartTheme(theme)`.

### `src/views/Modal.jsx`, the dialog contract

Every dialog in the app — the crew picker, reason picker, cover picker, desk
settings and program dialog on the board; the intake form and its discard
confirm and the withdraw confirm in Requests; the grant dialog and the revoke
confirm in Capacity — is a `Modal` or a `ConfirmDialog`. The shell owes the
keyboard three things and does them: focus lands inside on open (the first
focusable control, unless an `autoFocus` already took it), Tab and Shift+Tab
cycle inside while it is open, and focus returns to the opener on close, or to
the element matching `fallbackFocus` when the opener has left the DOM (a cell
button is gone after an assign, so the board's dialogs pass `.board` and the
withdraw confirm `.detail`). It renders through a portal into `document.body`
so dialogs can stack; open dialogs are tracked in a module-level stack and only
the topmost answers Escape, so a confirm on top of the intake form closes
itself and leaves the form alone. A backdrop mousedown closes the dialog only
when `closeOnBackdrop` is true; the intake form passes `false`. The `as` prop
lets the dialog element be a `<form>`. `ConfirmDialog` is the yes/no case:
`role="alertdialog"`, the cancel button auto-focused, the confirm button styled
`danger` when asked. No file outside `Modal.jsx` renders a `.modal-bg` or calls
`window.confirm`; keep it that way.

### `src/styles.css` and `chartTheme`

One global stylesheet. Design tokens are custom properties on `:root` (dark,
`color-scheme: dark`), and the color tokens are redefined under
`[data-theme='light']`; the font tokens (`--mono`, `--display`, `--body`) and
the radius `--r` are defined once. Status color is the data encoding: `--pass`,
`--fail` and `--blocked` color the heartbeat cells, pills, artifact dots,
meters, chips and timeline dots, and `--p0` to `--p3` color the priority and
severity badges. Tints are derived with
`color-mix(in srgb, var(--token) N%, transparent)`, never new hexes. A refused
control is styled through `:disabled` (opacity .45, `cursor: not-allowed`); the
stylesheet's personas comment states the contract the views keep.

Chart colors cannot come from the stylesheet: SVG presentation attributes do
not resolve CSS variables, so a `var(--x)` handed to Recharts does nothing.
`CHART_THEMES` in `helpers.js` therefore holds hex copies of the tokens per
theme — `AXIS`, `GRID`, `TIP`, `INK`, `ACCENT`, `AMBER`, `GREEN`, `CURSOR` — and
`chartTheme(theme)` returns the matching object, falling back to dark. A new
color goes in both CSS blocks and, if a chart uses it, in both `CHART_THEMES`
entries.

## Views are courtesy, rules are enforcement

A view never decides what a persona may do; it asks `allowed(action, target)`
and renders the answer. A refused control stays on screen, disabled, with the
R9 message as its `title`, so every persona can see what they cannot do and
why. The messages are `can()`'s, in one format:

```
R9 · coordinator only (signed in as Observer)
R9 · requester only (signed in as Coordinator)
R9 · you can't assign your own request
R9 · PN is outside your scope (signed in as Authority)
R9 · PM or rider ops lead only (signed in as Authority)
R9 · you can't grant your own rating or qualification
R9 · not your sortie (signed in as Crew)
```

The disabled state is a courtesy. Enforcement is in `rules.js`: every
transition calls `authorize()` first, `App.jsx` catches the throw and hands the
message back, and `rules.test.js` checks the seed for every actor's right to
the event it stamped (I4). A view that forgot to disable a button would still
be refused.

One gate is not a permission. The board's edit controls (assign, defer, scrub,
cover, release, the cell buttons) are rendered only when `date > today`; today
and the past are history and show no controls at all. The disabled-not-hidden
convention is about who, not when.

Two tabs are gated by role in `App.jsx`. My day is enabled only for `crew`
(its tooltip otherwise is `allowed('sortie.ack').message`), and `signIn()`
lands a crew persona there. Capacity, Analytics and Reports (`ANALYTICS_TABS`)
need `view.analytics`, which every role but `crew` holds; a persona without it
sees those tabs disabled with the message as tooltip. An effect keeps the
selected tab honest when the persona changes: a crew persona on an analytics
tab is moved to My day, anyone else on My day is moved to Dispatch.

The chart views are the one lazy boundary. `lazyViews()` wraps `CapacityView`,
`AnalyticsView` and `ReportsView` in `React.lazy`, so Recharts loads on first
visit and the board and the queue paint without it; they render inside a
`Suspense` fallback ("Loading charts…") and a `ChunkBoundary`. That class
component is an error boundary for a failed chunk — the network dropped, or a
redeploy changed the hashed filename under an open tab. It renders a panel with
Try again, which bumps `chunkAttempt`; the lazy wrappers are memoized on that
counter and so re-created, because `React.lazy` remembers a rejection. Session
edits survive, since every piece of state lives in `App`, above the boundary.

## Build, test, data

| command | runs | notes |
|---|---|---|
| `npm run dev` | `vite` | the dev server; there is no linter or formatter, UI changes are verified here |
| `npm run build` | `vite build` | one chunk-size warning is expected |
| `npm run preview` | `vite preview` | serves the built bundle |
| `npm test` | `vitest run` | `src/lib/rules.test.js` only |
| `npm run data` | `python3 generate_data.py && python3 scripts/render_analytics.py` | regenerates `src/data/*.json`, `data/stratus.sqlite` and `docs/analytics.md` |
| `npm run analytics` | `python3 scripts/render_analytics.py` | re-renders the notebook from the existing sqlite file |
| `npm run docs` | `python3 scripts/render_docs.py` | re-renders the code-derived blocks of these docs |
| `npm run docs:check` | `python3 scripts/render_docs.py --check` | exits non-zero when those blocks have drifted |

Run every command from the project root; the Python scripts write through
relative paths.

**Vite.** `vite.config.js` registers the React plugin and nothing else: no
`base`, no alias, no manual chunks, no `chunkSizeWarningLimit`. The split is
the `React.lazy` boundary above: the index chunk carries the app and the
imported seed JSON — about 920 KB before gzip and about 120 KB gzipped, the
README's figures — and Recharts lands in chunks loaded with the chart views.
The index chunk is over Vite's default 500 kB limit, which is the one warning
the build prints. The lockfile resolves Vite 5.4; `dist/` is gitignored.

**vitest.** The only suite is `src/lib/rules.test.js`, deliberately scoped to
the rules engine, the matrix and the seed's compliance with them; there is no
vitest config, so `vite.config.js` applies. It reports 173 tests: 71
hand-written cases in thirteen `describe` blocks (R1 to R8 one each; R9
ownership, scope and the invariants I1–I3; R10; the transitions; intake; and
the seed block, which imports the real `src/data/*.json`), plus 102 generated
at collection time by looping `ACTIONS × ROLES` from `PERMISSIONS` — 17
actions × 6 roles, each expecting `can()` to agree with the matrix against a
target that satisfies the role's predicate. A change to the matrix is therefore
a change to the tests, and a regeneration that moves a load-bearing arc fails
the seed block.

**The generator.** `generate_data.py` is two halves on two RNG streams: the
RCCA half under `random.seed(42)` (runs, failures, arcs 1–3) and, below the
`dispatch layer` banner, a day-by-day planner under
`drng = random.Random(4242)` that obeys the same rules the app enforces, with
the rider desk on its own `rrng = random.Random(4243)`. `check_rules()`
re-verifies R1–R4, R8, R10, R2 on the desk and I1, I2, I4 and I5 over the
finished seed before anything is written; the ten JSON files are then dumped,
`write_sqlite()` rebuilds `data/stratus.sqlite` from `sql/schema.sql`, and the
sanity report prints the counts and asserts the arcs, including that tomorrow's
queue holds exactly two P0. What each arc needs and what must not move is in
[seed-and-arcs.md](seed-and-arcs.md).

**The SQL notebook.** `sql/analytics/NN_*.sql` holds one statement per file,
headed by `--` comment lines that state the question. `scripts/render_analytics.py`
runs each against `data/stratus.sqlite`, derives the heading from the filename,
and writes the question, the result table and the query (collapsed) to
`docs/analytics.md`; it refuses to run when the sqlite file is missing. The
committed notebook is the reviewable artifact; the sqlite file is not
committed.

**The docs render.** `scripts/render_docs.py` keeps three parts of these pages
equal to the code: `permissions.md` as a whole, the *Reference* block of
`rules.md` and the *Schema* block of `data-model.md`, each between
`<!-- rendered:begin … -->` and `<!-- rendered:end … -->` markers. It executes
`auth.js` and `rules.js` under Node through `scripts/dump_rules.mjs` (with
`scripts/esm_extensionless.mjs` registered so the app's extensionless relative
imports resolve), reads the matrix, the refusal messages `can()` produces and
the export inventories from that run, and loads the schema into an in-memory
SQLite database to read the tables back through the engine. `--check` exits
non-zero and names the drifted files. It is the gate for any change to
`auth.js`, `rules.js` or `sql/schema.sql`; the recipes are in
[runbook.md](runbook.md).

## What is deliberately not here

The README keeps the list and the reasons under *Cut list, with reasons* and
*Next*, and the contributor brief repeats the roadmap. In short: no real login
or SSO (a gate, not a door; it arrives with a backend), no notifications (the
board and the end-of-day report are the notification), no live multi-user
backend, no drag-and-drop, no mobile layout for the board, no training ladder,
handbook or calendar sync, and no free-text intake parser yet (it needs a
serverless function for a key). Ahead of their controls, the matrix already
carries `request.edit` and `plan.reassign`, and the `view.analytics` comment in
`auth.js` notes that a requester today sees every program's numbers; the
per-program filter is on the roadmap. Next, per the README and the brief:
structured intake from free text into the form that already validates it, live
multi-user state once there is something worth persisting, lazy-loading the
seed JSON the way the chart views already are, a CSV export of the integrity
audit, and rider incidents feeding RCCA with a rider comms log on the sortie
and role-based notifications.
