# Rules

The dispatch rules R1–R10 are `src/lib/rules.js`; the permission matrix R9
consults is `src/lib/auth.js`. This page explains each rule as the code states
it: the function that raises it, the message it writes, the edge cases it
handles, and how the same checks are repeated over the seed. The block under
[Reference](#reference) is rendered from `rules.js` by `npm run docs` and
carries the vocabulary (windows, priorities, reasons, crew kinds, the triage
ladder, the desk bounds), the two R8 messages, every function with the rule and
severity literals written inside it, and the export list. The prose does not
repeat those tables; it points at them.

The rules as a story are in the root README, [The rules](../README.md#the-rules).
The matrix, every refusal message and the event-to-action map are rendered
whole in [permissions.md](permissions.md). Where the engine sits in the app is
[architecture.md](architecture.md); the shapes it reads are
[data-model.md](data-model.md); the generator that must obey it is
[seed-and-arcs.md](seed-and-arcs.md); the commands are [runbook.md](runbook.md);
the words are [glossary.md](glossary.md).

## How a rule is shaped

A rule is a pure function over plain data. It takes a candidate and the
indexed seed `db` that `makeDb()` builds (arrays plus `Map`s by id for
`program`, `asset`, `person`, `request`, `user`, and the desk settings) and
returns an array of violations. Nothing is read from React state or the DOM,
so the same call runs in a dialog and in `rules.test.js`, and
`scripts/dump_rules.mjs` can import the module under Node to render the
Reference block.

A violation is one object:

```js
{ rule: 'R2', severity: 'block', message: 'HM-01 is already used (scrubbed sortie) in AM on 2026-07-01.' }
```

`rule` is the id a view prints in bold before the message. `severity` is one
of two values. `block` rejects the edit: the CrewPicker and CoverPicker in
`DispatchView.jsx` keep their confirm button disabled while any live block
exists, and `App.jsx` returns the violations unsaved when `hasBlock()` is true.
`warn` renders inline and in the day summary: in the dialog's rule list, on the
board chips (`R5 · 2 under target`, `R6 · 1 P0 starved`), in the program meter's
title and in the rail's R6 line. Two ids ride alongside R1–R10. `AV` is
availability: a person who is not rostered for the window is a `warn`, never a
block, from both `checkAssignment()` and `checkCover()`. `R9` never comes out of
a check; `App.jsx` manufactures it (`refused()`) when a transition throws, so
the dialog shows an authorization refusal in the same list as a rule block.

Two rules are not violations at all. R8 is structural: `deferRequest()`,
`scrubAssignment()` and `scrubRequest()` call `assertReason()`, which throws
`R8: …` when the reason is not in the enum, so a deferral without a reason
cannot be built; `validateReason()` is the non-throwing form the renderer and
the tests use. R9 is authorization: every mutating transition takes the actor
as its first argument and calls `authorize(actor, action, target)` before it
touches anything; `authorize()` throws the exact message `can()` returns.

Checks and transitions are separate functions on purpose. The checks
(`checkAssignment`, `checkCover`, `checkUncover`, `checkCoverage`,
`dayWarnings`, `validateRequest`) return and never throw; running them is the
caller's job, because a block is shown on the board, not thrown. The
transitions (`newAssignment`, `deferRequest`, `coverWindow`, `grantRating` and
the rest of the table below) return a new object and throw on R9, R8 or a bad
argument. `App.jsx` runs the check first, then builds the transition inside a
`try` outside the state updater, so a refusal comes back to the view as a
returned value and never as an error thrown inside React.

Day-level results carry more than the triple. `dayWarnings()` adds `level`
(`under` or `over`), `program_id` and `count` to an R5 entry and `request_id`
and `holder` to an R6 entry. `checkCoverage()` returns the desk row itself
(`rule: 'R10'` with `level`, no severity) because a row is a colour, not a
refusal. Messages are not uniform about dates: `checkAssignment()`'s R1, R2, R3
and AV print the ISO day (`2026-07-01`); the desk's messages (R10, the R2
extension, `checkCover`, `checkUncover`, `checkCoverage`) print `fmtDate()`'s
short form (`Jul 1`). The tests assert several messages with `toBe`, so a
wording change is a test change.

The same functions run over the seed. The `seed data` block of
`rules.test.js` imports the real `src/data/*.json`, builds `makeDb()` with
`desk: meta.rider_desk` and re-runs `checkAssignment()` on every non-scrubbed
sortie, `isLate()` on every request and `can()` on every actor. `generate_data.py`
mirrors the checks in Python in `check_rules()`, which asserts over the seed
before anything is written; the mirror is maintained by hand and the section
on the invariants below says where it is stricter and where it is narrower.

## The dispatch rules R1–R10

Every check below except R5's day level, R6, R7 and the desk's own checks
(`checkCover`, `checkUncover` and `checkCoverage`, under
[The desk](#the-desk)) lives in `checkAssignment(cand, db)`, where `cand` is
`{ date, window, request_id, asset_id, operator_id, pilot_id, assignment_id? }`
and `assignment_id` is passed only when editing an existing sortie. If the
request or the tail is unknown the function returns a single R3 block,
`Unknown request or tail.`, and checks nothing else.

### R1 · type rating

Every seat must hold the rating for the tail's airframe as of the sortie's
date. Severity `block`. `checkAssignment()` asks `ratedOn(person, airframe, date)`
for `operator_id` and `pilot_id`: the airframe must be in `person.ratings`, and
`person.ratings_effective[airframe]` must be absent or `<= date`. The message is

```
<name> is not rated on <airframe>[ until <effective date>].
```

The airframe is the tail's (`asset.airframe`), not the request's; a request on
the wrong airframe is R3. An absent effective date means the rating was held
before the window. A rating the trainer grants in the session carries its
`effective` date, so the board re-evaluates R1 from that day and no earlier
(`grantRating()` below). In the seed, the two operator-pilots' Harmattan rating
is effective 2026-05-29 (`RATING_EFFECTIVE` in the generator; `npm run data`
reproduces it), which is what arc D1 turns on.

### R2 · double booking

No tail and no person in two sorties in the same date and window. Severity
`block`. `checkAssignment()` walks every assignment on the candidate's date and
window, skipping the one whose `assignment_id` equals `cand.assignment_id` so an
edit does not collide with itself. The tail check runs regardless of status;
the crew check skips scrubbed sorties:

```
<tail> is already assigned to <request_id> in <window> on <date>.
<tail> is already used (scrubbed sortie) in <window> on <date>.
<name> is already on <request_id> (<tail>) in <window> on <date>.
```

A scrubbed sortie frees its crew but not its slot: one assignment per (date,
asset, window), ever. `sql/schema.sql` says the same with
`UNIQUE (date, asset_id, window)` on `assignments`, and the generator's
`busy_sets()` keeps a scrubbed sortie's (asset, window) busy while releasing
its people.

R2 extends to the desk. A person covering the window cannot fly in it
(`checkAssignment()`: `<name> is covering the rider desk in <window> on <Mon D>.`).
Nobody covers a window twice or covers one they are flying in
(`checkCover()`: `<name> is already covering <window> on <Mon D>.` and
`<name> is flying <request_id> (<tail>) in <window> on <Mon D>.`). Releasing
someone who is not on the desk is R2 too (`checkUncover()`:
`<name> is not covering <window> on <Mon D>.`). The schema's
`PRIMARY KEY (date, window, person_id)` on `coverage` is the no-double-cover
half of it.

### R3 · asset status

The tail must be assignable to this program on this day: the request's
airframe, a window the tail operates, not grounded or in maintenance, and if
reserved, reserved by this program. Severity `block`. Status comes from
`assetStatusOn(asset, date)`, which returns the first `status_history` entry
with `date_from <= date` and `date_to` null or `>= date`, else `available`; the
flat `status` and `status_since` on the asset are today's snapshot and are not
consulted. The four messages:

```
<tail> is a <airframe>; <request_id> needs a <airframe>.
<tail> does not operate in the <window> window.
<tail> is <grounded|maintenance> on <date>[ — <note>].
<tail> is reserved by <program code> on <date>.
```

A tail reserved by the request's own program raises nothing. The grounded
message carries the history entry's note, which in the seed names the pending
build. `assetStatusOn()` also returns `failure_id`, which the board's tail-status
button uses to open the failure in Triage.

### R4 · crew requirement

The seats must match `request.crew`. Severity `block`. One branch per kind:

| kind | required | refused |
|---|---|---|
| `operator_pilot` | both seats, two different people; the operator has the `operator` role, the pilot the `pilot` role | `<request_id> needs an operator and a safety pilot.` · `<name> cannot be both operator and safety pilot on one sortie.` · `<name> is not an operator.` · `<name> is not a safety pilot.` |
| `pilot_only` | a pilot with the role, no operator seat | `<request_id> needs a safety pilot.` · `<name> is not a safety pilot.` · `<request_id> is safety-pilot only; no operator seat.` |
| `lone_operator` | an operator with the role and `self_pilot`, no pilot seat | `<request_id> needs a lone operator.` · `<name> cannot fly as a lone operator (needs the operator role and self-pilot).` · `<request_id> is a lone-operator sortie; no pilot seat.` |
| `none` | no seats | `<request_id> takes no crew.` |

R4 checks roles and `self_pilot`; the rating on the airframe is R1, so a lone
operator who is unrated gets both. The CrewPicker derives the seats it shows
from the same kind, so a `pilot_only` request offers one select.

### R5 · program tail target

A program's distinct tails on a day should sit between its `asset_min` and
`asset_max`. Severity `warn`, at two levels.

At day level, `dayWarnings(date, db)` counts `programTails(date, program_id, db)`,
the distinct `asset_id`s on the program's non-scrubbed sorties that day, and
emits one of

```
<code>: <n> of <min>–<max> tails — under target.
<code>: <n> tails — over the <max> cap.
```

with `level`, `program_id` and `count`. `under` fires only when the day is
operating (`isOperatingDay()`: anyone has rostered windows), the program has
demand and `n < asset_min`. Demand is any of: a request of the program on that
day's rail (`queuedFor()`), `n > 0`, or the program is `standing` and the date
is not a weekend. A standing program is therefore expected every weekday
someone is rostered; a non-standing one only when it asked; a weekend with no
demand is not under target. `over` fires whenever `n > asset_max`, operating or
not.

At edit time, `checkAssignment()` says so before the day does: when the
candidate's tail is new to the program (`programTails()` with the candidate's
own `assignment_id` excluded) and the program already has `asset_max` tails, it
warns `<code> would be at <n+1> tails today; target is <min>–<max>.` The board
reads the day level as chips (`R5 · N under target`, `R5 · N over cap`) and as
each program's meter, whose title is the R5 message when there is one.

The band is set by the program's authority through `setProgramTargets()`,
which refuses anything but whole numbers with `0 <= min <= max`. The
generator's planner does not warn: `place()` treats `asset_max` as a cap, keeps
only tails already flying for the program once it is reached, and defers with
`program_over_max`, so the seed never contains an over-cap day.

### R6 · P0 starvation

An unscheduled P0 waits for the day while a lower-priority sortie holds a
compatible tail. Severity `warn`, from `dayWarnings()` only. For each request on
the day's rail with priority `P0` and status `submitted` or `deferred`, the
function looks for a non-scrubbed sortie on that date whose request has a
lower priority (a higher `PRIORITY_RANK`), whose tail is the P0's airframe and
whose window is one the P0 asked for. The first such sortie is the holder:

```
<request_id> (P0) is unscheduled while <holder request_id> (<priority>) holds <tail> in <window>.
```

The entry carries `request_id` and `holder` (the assignment id). The board
shows a chip (`R6 · N P0 starved`) and a line per entry at the top of the rail.
There is no action attached: the coordinator can scrub the holder and place
the P0, or defer the P0 with a reason. The planner sorts its queue P0 first
and places in order, so R6 holds by construction inside the generator; the
seed test `tomorrow's rail holds two unscheduled P0 and R6 fires for the late
showcase` asserts that tomorrow nevertheless carries one, which is the demo's
opening state.

### R7 · intake cutoff

A request submitted at or after the cutoff on the day before `needed_by`, or
at any time on or after the day itself, is late, and a late request's plan
day is the next open day after `needed_by`. The cutoff is `meta.cutoff_local`
(`15:00` in the seed) and every function below defaults to `'15:00'`. The
predicate is `isLate(submittedAt, neededBy, cutoff)`:

```
cutoffDay = neededBy − 1 day
late      = d > cutoffDay || (d === cutoffDay && t >= cutoff)     // d, t from 'YYYY-MM-DDTHH:MM'
```

`defaultPlanDate(request, { cutoff, isOpen })` starts at `needed_by + 1` when
late, else `needed_by`, then walks forward one day at a time while
`!isOpen(d)`, at most 14 steps. `App.jsx` passes
`isOpen = (d) => d > meta.tomorrow || isOperatingDay(d, db)`: a day up to
tomorrow is open only when someone is rostered on it, and every day past
tomorrow counts as open, since no roster exists there. `lateWarning(request,
cutoff)` is the warning form, `{ rule: 'R7', severity: 'warn', request_id,
message }` or `null`; no view imports it today, they flag lateness from
`request.late` and `isLate()` directly:

```
<request_id> was submitted after the <cutoff> cutoff for <needed_by>; it defaults to the next open day.
```

In the app the rule is applied at intake rather than displayed: `newRequest()`
derives `late`, `plan_date`, the status and the timeline from the submission
time (see Intake). The requests table flags a late row (`Submitted after cutoff
(R7)`), the rail flags a late card (`After cutoff (R7)`), and the intake form
shows the verdict before submission, computed with `isLate(nowAt, needed_by,
meta.cutoff_local)`. Because `App.jsx` stamps session edits at `18:xx` of
dataset today, a request filed in the session for tomorrow is always late and
the form says it will default to the day after; the coordinator can still pull
it forward on the board. The seed test asserts
`r.late === isLate(r.submitted_at, r.needed_by, meta.cutoff_local)` for every
request.

### R8 · a deferral needs a reason

A deferral carries a reason from `DEFERRAL_REASONS`; a scrub carries one from
`SCRUB_REASONS`, the same nine plus `weather`. Structural. `validateReason(reason,
allowed)` returns `{ ok: true }` or `{ ok: false, rule: 'R8', message }`, with
the message naming the whole list (both texts are in the rendered block).
`assertReason()` throws `R8: <message>`, and `deferRequest()`,
`scrubAssignment()` and `scrubRequest()` call it immediately after
`authorize()`.

`weather` is a scrub reason only: a sortie scrubs for fog, but a request is
not deferred for it; the scrubbed request goes back on the same day's rail and
a later deferral names a reason from the shorter list. `requester_withdrew` is
in the deferral list because `deferRequest()` with that reason writes a
`withdrawn` event and status instead of `deferred`. The ReasonPicker's confirm
button is disabled until a reason is chosen (its header reads `Reason required
· R8`), and the desk can pre-select `no_rider_ops` when every requested window
would refuse the riders. The schema checks both the flat `requests.deferral_reason`
and the `reason` of every `deferred` row in `request_events` against the same
list; the generator's `defer()` asserts the reason and `check_rules()` re-checks
every `deferred` event.

### R9 · authorization

Every mutation names an actor whose role the matrix grants the action, under
the row's predicate. Structural. `PERMISSIONS` in `auth.js` maps 17 actions to,
per role, one of `yes`, `own`, `not-own`, `scope`, `desk` or `not-self`; a role
absent from the row is refused. `can(actor, action, target)` is the UI's
question and returns `{ ok: true }` or `{ ok: false, message }`; `authorize()`
is the rules' question and throws that message. The predicates are functions
in `auth.js`, never string parsing in a view:

| grant | predicate | refusal |
|---|---|---|
| `yes` | — | — |
| `own` | `ownsRequest()`: `request.requester_id === actor.user_id`; for `sortie.ack`, `ownSeat()`: the target's `person_id`, `operator_id` or `pilot_id` is the actor's `person_id` | `R9 · not your request (signed in as <Role>)` · `R9 · not your sortie (signed in as <Role>)` |
| `not-own` | not `ownsRequest()` | `R9 · you can't assign your own request` |
| `scope` | `inScope()`: `actor.scope === 'all'` or the list includes `target.program_id` | `R9 · <code or program_id or "that program"> is outside your scope (signed in as <Role>)` |
| `desk` | `deskScope()`: `actor.scope === 'all'` or the list includes `'desk'` | `R9 · PM or rider ops lead only (signed in as <Role>)` |
| `not-self` | not `isSelf()`: `target.person_id !== actor.person_id` | `R9 · you can't grant your own rating or qualification` |
| absent | — | `R9 · <role, role or role> only (signed in as <Role>)` |

Three more messages exist for the edges: `R9 · unknown action <action>`,
`R9 · <roles> only (nobody signed in)` when there is no actor, and
`R9 · <action> refused (signed in as <Role>)` from `can()`'s `default` branch,
reached only by a grant value that has no `case` — what a new grant kind
returns until its predicate is added. The desk actions
take no target: `coverWindow()`, `uncoverWindow()` and `setDeskSettings()`
authorize `desk.cover` and `desk.settings` against `null`.

A view asks `allowed(action, target)`, which `App.jsx` defines as
`can(currentUser, action, target)`, and renders a refused control disabled with
the message as its tooltip, never hidden. The transitions enforce it: a view
that forgot to disable a button would still be refused, and `App.jsx` hands
the thrown message back, as a string for most callbacks or wrapped as
`[{ rule: 'R9', severity: 'block', message }]` for assign and cover. Which
timeline event is which action is `EVENT_ACTION` plus `eventAction()`, with
the one exception that a `deferred` event whose reason is `late_intake` is
`request.create`, because the filer stamps it at intake. That map is what lets
the seed's actors be checked (I4, below).

### R10 · the rider desk

A rider-facing sortie needs a qualified rider operator covering its window,
at least `min_per_window` of them, and may not push the window's rider-facing
load past `ratio × coverers`. Severity `block`. `checkAssignment()` runs it
only when `request.rider_facing`:

```
no rider operator covering <window> on <Mon D>          // coverers < min_per_window
desk at <load>:<coverers>, ratio is <ratio>             // load = riderLoad(…, cand.assignment_id) + 1 > ratio × coverers
```

The settings are `db.desk`, which `App.jsx` seeds from `meta.rider_desk`
(`ratio 2, min_per_window 1` in the seed) and `DEFAULT_DESK` supplies when a
caller gives none. The load excludes the candidate's own `assignment_id`, so
re-seating a rider-facing sortie onto another tail does not count itself, and
`riderLoad()` skips scrubbed sorties, so a scrub frees the desk. R10 holds on
the way out (`checkUncover()`), at rostering (`checkCover()`) and as the board's
desk row (`checkCoverage()`); the next section has them. There is no waiver:
the only settings are the two numbers, and no action in the matrix lifts the
rule. The generator's `desk_check()` writes the same two notes prefixed
`R10 ·` and the planner re-runs it when it re-seats a sortie on the day.

## The desk

`deskCoverers(db, date, window)` is who is on the desk: the coverage rows for
the date and window, resolved to persons, kept only when `qualifiedOn(person,
date)` — `person.qualifications.rider_ops` exists and is `<= date`. The
qualification is effective-dated like a rating, and the date check runs per
day, so a person rostered before their qualification counts from the day it
takes effect and not before.

`riderLoad(db, date, window, excludeAssignmentId)` is the demand: the
non-scrubbed sorties in the window whose request is `rider_facing`, minus the
excluded one. A scrubbed sortie carries no riders.

`checkCoverage(date, window, db)` is the board's desk row:

```js
{ rule: 'R10', date, window, coverers, demand, capacity, ratio, min, level, message }
```

`capacity` is `ratio × coverers.length`. `level` is `red` when there are fewer
coverers than `min_per_window` on an operating day or with any demand, `quiet`
when there are fewer than the minimum with no operations and no demand, `red`
when `demand > capacity`, `amber` when `demand === capacity`, else `green`. The
message is `no rider operator covering <window> on <Mon D>` below the minimum,
else `<n> covering · <demand> rider-facing · ratio <ratio>`. The DeskPanel
renders one row per window with the level as the pill's class, counts red rows
into the chip `R10 · desk short in N window(s)` on operating days, and My day
shows the same row to a coverer for their own windows.

`checkCover(cand, db)` guards rostering, with `cand = { date, window, person_id }`.
An unknown person is one R10 block (`Unknown person.`). Otherwise it collects:
R10 when the person lacks the `rider_ops` role or is not qualified on the day
(`<name> is not qualified on the rider desk[ until <Mon D>].`); R2 when already
covering that window; R2 when flying in it on either seat of a non-scrubbed
sortie; and the `AV` warning when not rostered
(`<name> is not rostered for <window> on <Mon D>.`). The CoverPicker runs it
live once a person is picked.

`checkUncover(cand, db)` guards release, R2 first and then R10 on the way out.
Not a coverer: R2. Otherwise with `left = coverers − 1` and `riders =
riderLoad()`: when `riders > 0` and `left < min_per_window`,
`<riders> rider-facing sortie[s] in <window> on <Mon D> would be left with no rider operator covering`
(or `… with only <left> covering, below the minimum of <min>` when some remain);
when `riders > ratio × left`, `desk would be at <riders>:<left>, ratio is <ratio>`.
It returns an array like the other checks, but `App.jsx`'s `uncover()` hands
the first block's message back as a string, and the DeskPanel computes the same
block ahead of time to disable each coverer's release button with it as the
tooltip.

`coverWindow(actor, coverage, cand, { at })` appends
`{ date, window, person_id, assigned_by: actor.user_id, acked: false, at }` and
`uncoverWindow(actor, coverage, cand)` filters that row out; both authorize
`desk.cover`, a coordinator's action. A coverer acknowledges their own row
through `acknowledge()` like a seat.

`setDeskSettings(actor, desk, patch)` is the only way the numbers change. It
authorizes `desk.settings` (an authority whose scope is `'all'` or includes
`'desk'`: the PM or the rider ops lead), builds exactly
`{ ratio, min_per_window }` from the patch over the current desk, and throws
unless each is a whole number inside `DESK_BOUNDS`:

```
The ratio must be a whole number between 1 and 4.
Coverers per window must be a whole number between 1 and 4.
```

Any other key in the patch is dropped: a `waiver` field cannot be stored. The
principle has a floor (never below one coverer) and the desk a ceiling (never
above ratio 4), and the seed's arc D4 note records the PM being asked to waive
the ratio and that there is no such action.

One courtesy lives in the view. `DispatchView.jsx`'s `deskBlocks(r)` reads the
desk rows and, when every window a rider-facing request asked for is below the
minimum or at capacity, the rail card says so and opens the ReasonPicker with
`no_rider_ops` pre-selected. The coordinator still chooses; the engine only
sees the reason they confirm.

## Intake

`validateRequest(f, db, { tomorrow })` is what intake refuses, as
`[{ field, message }]` with every message naming its field. The form runs it on
every render and shows the result after the first submit attempt;
`App.jsx`'s `submitRequest()` runs it again and returns `{ errors }` before any
transition.

| field | accepted | message |
|---|---|---|
| `program_id` | a program in `db.program` | `Pick a program.` |
| `title` | 4 or more characters after trimming | `Give the sortie a title (4+ characters).` |
| `build` | non-empty | `Name the build.` |
| `build_stage` | one of `BUILD_STAGES` | `Build stage must be engineering or release candidate.` |
| `crew` | one of `CREW_KINDS` | `Pick a crew requirement.` |
| `priority` | a key of `PRIORITY_RANK` | `Pick a priority.` |
| `airframe` | in the program's `airframes` | `<code> flies <A or B>, not <airframe or "nothing">.` |
| `windows` | at least one, each operated by some tail of the airframe | `Ask for at least one window.` · `<airframe> does not fly in the <w> window.` |
| `needed_by` | `>= tomorrow` | `Needed-by must be <tomorrow> or later — today's plan is set.` |
| `requester` | non-blank | `Who is asking?` |
| `rider_facing` | `true` when the program's code is `SF` | `A showcase always carries guests — riders aboard is not optional (R10).` |

The showcase rule is where `rider_facing` is fixed for good: no transition
touches the flag afterwards, so a showcase can never be saved without the desk
covering it. The form enforces the same thing by forcing the checkbox on for
`SF` and disabling it.

`operatingWindows(db, airframe)` is `WINDOWS` filtered to the windows some tail
of that airframe operates, in board order. `pruneWindows(windows, db, airframe)`
keeps the picked windows that survive that filter and, when none do, falls
back to the airframe's first operating window rather than an empty list. The
form calls it whenever the program or the airframe changes, so a checked box
can never be both checked and disabled.

`newRequest(actor, f, { id, submittedAt, cutoff = '15:00', isOpen = () => true })`
builds the request the way intake would, and only the way intake would. It
authorizes `request.create` against `{ program_id }` first (a requester or a
coordinator always, an authority inside scope), then derives what nobody
types: `late = isLate(submittedAt, needed_by, cutoff)`,
`plan_date = defaultPlanDate(…)`, `status` (`deferred` when late, else
`submitted`), `deferral_reason` (`late_intake` or `null`), and
`requester_id = actor.user_id`. The timeline starts with a `submitted` event by
the actor, noted `submitted after the <cutoff> cutoff` when late, and a late
request gets a second event at the same stamp:

```js
{ at: submittedAt, day: needed_by, event: 'deferred', reason: 'late_intake',
  note: 'flagged at intake: after the <cutoff> cutoff — moved to <plan_date>', by: actor.user_id }
```

That deferral is the filer's own action, which is why `eventAction()` counts it
as `request.create` and why a requester, who holds no `plan.defer`, is a legal
actor on it. The typed `requester` is a display string and is kept as such;
the filer is the actor, so a coordinator filing for someone without a persona
shows as `<name> · on behalf` in the drawer and, under I1, cannot place that
request. `rider_facing` is stored as `Boolean(f.rider_facing)` and `windows` is
copied. `App.jsx` supplies `id` as `RQ-L<seq>`, `submittedAt` from `stampNow()`,
`cutoff` from `meta.cutoff_local` and the `isOpen` described under R7; an R9
throw comes back as an error on the `program_id` field.

## The transitions

Every transition takes the actor first, authorizes before anything else, and
returns a new object, leaving its input untouched. `App.jsx` runs the matching
check first where there is one, builds the transition in a `try`, saves the
result and, for actions outside a request's timeline, appends an audit row
`{ at, by, action, target, detail }` through `record()`. Session stamps come
from `stampNow()`, `<today>T18:<nn>`, where `nn` is a counter so that edits
sort in the order they were made.

| transition | authorizes | returns | throws (after R9) | `App.jsx` |
|---|---|---|---|---|
| `newAssignment(actor, request, cand, id?)` | `plan.assign` on the request (`not-own`) | `{ assignment_id, …cand, status: 'planned', scrub_reason: null, run_id: null, notes: 'assigned on the board', assigned_by, acked: false }`; `id` defaults to `nextAssignmentId()`, `AS-2026-L001…` | — | `assign()`: `checkAssignment()` first; a block returns the violations unsaved; else the sortie is appended and the request replaced by `scheduleRequest()`; an R9 throw returns `[{ rule: 'R9', … }]` |
| `scheduleRequest(actor, request, assignment, at)` | `plan.assign` on the request | request with `status: 'scheduled'`, `plan_date: assignment.date`, `deferral_reason: null`, event `scheduled` (`day` the sortie's date, note `<tail> <window> (board)`) | — | paired with `newAssignment()` in `assign()` |
| `deferRequest(actor, request, { reason, day, at, note })` | `plan.defer` on the request | `status: 'deferred'`, `deferral_reason: reason`, `plan_date: day + 1`, event `deferred` with `day`; with `requester_withdrew`, `status: 'withdrawn'`, `plan_date` unchanged, event `withdrawn` | R8 | `defer()`: `day` is the board date; returns the message or `null` |
| `scrubAssignment(actor, assignment, { reason })` | `plan.scrub` on the sortie | `{ …assignment, status: 'scrubbed', scrub_reason: reason }` | R8 against `SCRUB_REASONS` | `scrub()` applies it with `scrubRequest()` |
| `scrubRequest(actor, request, assignment, { reason, at, note })` | `plan.scrub` on the request | `status: 'deferred'`, `plan_date: assignment.date` (back on the same day's rail), event `scrubbed` noted `<tail> <window> scrubbed (board)[ — <note>]` | R8 against `SCRUB_REASONS` | `scrub()` returns the message or `null` |
| `withdrawRequest(actor, request, { at, note })` | `request.withdraw` on the request (`own` for a requester) | `status: 'withdrawn'`, `deferral_reason: 'requester_withdrew'`, event `withdrawn` with `day: plan_date` | `<request_id> is <status>; a request can only be withdrawn before it is scheduled.` unless `submitted` or `deferred` | `withdraw()` with note `withdrawn from the queue`; the drawer composes the same not-queued message itself to disable the button |
| `newRequest(actor, f, opts)` | `request.create` on `{ program_id }` | the request (Intake) | — | `submitRequest()`; `{ errors }` or `{ request }` |
| `coverWindow(actor, coverage, cand, { at })` / `uncoverWindow(actor, coverage, cand)` | `desk.cover`, no target | the new coverage array | — | `cover()`: `checkCover()` first; `uncover()`: `checkUncover()` first, returns the first block's message; both record |
| `acknowledge(actor, target)` | `sortie.ack` on the sortie or coverage row (`own` seat) | `{ …target, acked: true }` | — | `ack()` swaps the sortie by `assignment_id` or the row by (date, window, person_id); records `sortie.ack`; My day ignores the return and relies on the disabled button |
| `grantRating(actor, person, airframe, { effective, notBefore })` | `rating.grant` on the person (`not-self`) | `ratings` with the airframe added, `ratings_effective[airframe] = effective`, `granted_by[airframe] = actor.user_id` | `A grant needs the day it takes effect.` · `A grant takes effect from <Mon D> at the earliest — history is not rewritten.` when `effective < notBefore` | `grant()` with `notBefore: meta.tomorrow`; records `rating.grant` |
| `revokeRating(actor, person, airframe)` | `rating.revoke` on the person (`not-self`) | the airframe removed from `ratings`, `ratings_effective` and `granted_by`, immediately | — | `revoke()`; records `rating.revoke`; there is no effective date and no check against planned sorties |
| `grantQualification(actor, person, { effective, notBefore })` | `qualification.grant` on the person (`not-self`) | `rider_ops` added to `roles` if absent, `qualifications.rider_ops = effective`, `granted_by.rider_ops` | the two grant-date messages | `grant()` with kind `rider_ops`; records `qualification.grant`; there is no qualification revoke |
| `setProgramPriority(actor, program, priority)` | `program.priority` on the program (`scope`) | `priority_default` | `Priority must be one of P0 · P1 · P2 · P3.` | through `editProgram()` |
| `setProgramTargets(actor, program, { asset_min, asset_max })` | `program.targets` on the program (`scope`) | `asset_min`, `asset_max` | `Tail targets must be whole numbers with min ≤ max.` (also refuses a negative minimum) | through `editProgram()` |
| `editProgram(actor, program, patch)` | each dial behind its own permission: calls the two above only for values that changed | the same object when nothing changed | whichever dial throws | `editProgram()`: `null` when unchanged; records `program.priority` and `program.targets` separately |
| `setDeskSettings(actor, desk, patch)` | `desk.settings`, no target (`desk`) | exactly `{ ratio, min_per_window }` | the two bounds messages | `editDesk()`; records `desk.settings` |
| `triageFailure(actor, failure, status, { today, resolved })` | `triage.edit` on the failure (requester only) | `triage_status: status`; `resolved` as passed, else `today` for `Verified`, else `null` | `Triage status must be one of Open → Investigating → Corrective Action → Verified.` | `triage()`; records `triage.edit`; the Triage toast's Undo calls it again with the previous status and `resolved`, and a refusal lands in the toast with no undo |

The return shapes are a contract the dialogs depend on: `assign` and `cover`
return a violations array and the dialog closes only when it has no block;
every other callback returns a message string on refusal and `null` on
success; `submitRequest` returns `{ request }` or `{ errors }`. `editProgram()`
is one transition for two dials so that a dialog changing both cannot lose one
to a stale base; the test asserts that an unchanged patch returns the very
same object.

## Separation of duties and the seed invariants I1–I5

| invariant | statement | enforced in `src/lib` | `rules.test.js` | `generate_data.py` |
|---|---|---|---|---|
| I1 | Nobody assigns their own request, even a coordinator | `plan.assign` and `plan.reassign` are `not-own`; `can()` answers `R9 · you can't assign your own request`; `newAssignment()` and `scheduleRequest()` throw it | the ownership block (`can()`, both transitions); the seed test that no sortie's `assigned_by` equals its request's `requester_id` | `plan_day()` places with the coordinator who did not file (`who = COORD_AM if requester_id == COORD_PM else COORD_PM`); `check_rules()` asserts `assigned_by != requester_id` |
| I2 | Nobody grants their own rating or qualification | `rating.grant`, `rating.revoke`, `qualification.grant` are `not-self`; `R9 · you can't grant your own rating or qualification` | the ownership block with the trainer's own person; the seed test that every `granted_by` entry is a `trainer` persona whose `person_id` differs from the grantee's | `granted_by` is stamped with `TRAINER` for every effective-dated rating and qualification; `check_rules()` asserts the grantor's role and that the `person_id` differs |
| I3 | Coordinators consume priority and cannot set it; authority sets it and cannot assign | the shape of `PERMISSIONS`: `program.priority` and `program.targets` are authority-only, `plan.*` coordinator-only | `R9 · authority only (signed in as Coordinator)` on `program.priority`; `R9 · coordinator only (signed in as Authority)` on `plan.assign` | the six-action mirror grants `plan.*` to coordinators only and carries no `program.*` action; nothing is asserted |
| I4 | Every actor's role permits the event it stamped | `eventAction(e)` names the action; `can(user, action, request)` answers | the seed test over every timeline event, every sortie's `assigned_by` (`plan.assign`) and every coverage row's `assigned_by` (`desk.cover`) | `permits()` over the same three sets, with the `late_intake` deferral remapped to `request.create` |
| I5 | Every rider-facing sortie flew with a qualified coverer in its window, at or under ratio | `checkAssignment()`'s R10 per sortie | the seed test: for every (date, window) with non-scrubbed rider-facing sorties, `deskCoverers().length >= min_per_window` and `n <= ratio × coverers`, over more than 20 such windows; plus `R2, extended · nobody flew in a window they were covering` | `check_rules()`: every coverage row's person qualified on the day, no `(date, window, person)` twice, no seat in `covering[(date, window)]`, and per window `cov >= min_per_window` and `load <= ratio × cov` |

The trainer persona in the seed is also a person on the roster (U-15 is
P-001), which is what gives I2 something to refuse: in the rating matrix the
trainer's own row is disabled with the `not-self` message.

The generator's mirror is kept by hand and differs from `auth.js` in three
ways worth knowing before a change. It covers six actions (`request.create`,
`request.withdraw`, `plan.assign`, `plan.defer`, `plan.scrub`, `desk.cover`),
the ones the seed stamps, and `permits()` knows `yes`, `own`, `not-own` and
`scope` only; a `desk` or `not-self` grant would read as refused there. Its
`EVENT_ACTION` maps `reassigned` to `plan.assign` where `auth.js` says
`plan.reassign`; both are coordinator `not-own`, so the verdict is the same
today. And it is stricter on availability: `check_rules()` asserts every seat
and every coverer is rostered (`"unavailable crew"`, `"desk coverer off shift"`)
where the engine only warns `AV`. R5, R6 and R7 are not in `check_rules()` at
all; the planner satisfies them by construction (`place()`'s cap, the P0-first
queue, `add_request()` deriving the late flag), and the vitest seed block is
what checks R7 on every request and R5 and R6 on tomorrow.

## Where the tests come from

`npm test` runs `vitest run` over the one suite, `src/lib/rules.test.js`. Its
fixture, `fx()`, returns a fresh `makeDb()` on every call: three programs
(`PRG-A` PLC on Harmattan, standing, 2–3 tails, P0; `PRG-B` PN on Levant,
standing, 3–4, P1; `PRG-C` SBU on Sirocco, not standing, 1–2, P0), nine tails
including a reserved `HM-03` and a grounded `LV-03`, ten persons spanning
every case the rules distinguish (a rating not yet effective, a self-pilot, an
unrostered pilot, a desk-qualified pilot, a qualification dated in the
future), ten requests including three rider-facing ones and one filed by the
coordinator, two planned sorties, one coverage row and a desk of
`{ ratio: 2, min_per_window: 1 }`. The plan day is `D = '2026-07-01'` and board
edits are stamped `AT = '2026-06-30T18:00'`. Eight personas in `U` cover the six
roles and the three authority scopes the matrix distinguishes: a lead on
`['PRG-A']`, the PM on `'all'`, the rider ops lead on `['desk']`.

Fourteen `describe` blocks follow in file order: R1 through R8 as unit tests
of `checkAssignment()`, `dayWarnings()`, `isLate()`, `defaultPlanDate()` and
`deferRequest()`; two R9 blocks; R10; `transitions`, whose first case checks
that six transitions (`deferRequest`, `scrubAssignment`, `scrubRequest`,
`grantRating`, `setProgramPriority`, `newAssignment`) refuse the wrong role
before touching anything, and whose other cases walk a sortie built on the
board, the grants, the program dials, a scrub's note, triage and withdraw,
three of them ending on an `// immutable` assertion over the input; `intake`;
and `seed data`. The wrong-role refusals of `coverWindow` and
`setDeskSettings` are under R10, `acknowledge`'s in the second R9 block and
`newRequest`'s under `intake`.

The first R9 block is generated rather than written. At collection time it
asserts `ACTIONS.length >= 16` and then loops `for action of ACTIONS` × `for
role of ROLES`, registering one `it()` per pair named
`<action> · <role> → allowed|refused`. Each case expects
`can(actor, action, friendly(action, actor)).ok` to equal
`Boolean(PERMISSIONS[action][role])`, where `friendly()` builds a target that
satisfies the role's predicate (a request filed by the actor for a requester's
`own` grants, `PRG-A` for the lead's `scope`, a person other than the trainer's
for `not-self`, the actor's own seat for `sortie.ack`) and `actorFor()` swaps
the PM in for the `desk` grant on `desk.settings`. Every refusal must match
`/^R9 · .+ only \(signed in as /`. With 17 actions and 6 roles that is 102
cases, and with the 71 written `it()`s the suite reports 173 at HEAD.

That is why a change to the matrix is a change to the tests. Adding an action
adds six cases and a role adds seventeen; granting or removing a cell flips
the expected verdict of its case without anyone editing the test file; a new
action granted under a predicate needs `friendly()` to produce a target that
satisfies it, or its `allowed` case fails. The suite cannot be edited into
agreement with a stale matrix, and the predicate refusals (`not your request`,
`outside your scope`, `you can't assign your own request`) are asserted
separately in the second R9 block because `friendly()` never triggers them.

The `seed data` block is the integration half: nine tests over the generated
JSON. No non-scrubbed sortie has a blocking violation; `late` matches the R7
predicate on every request; every `deferred` event's reason is in the enum;
tomorrow's rail holds exactly two unscheduled P0, an R6 fires and SBU is under
target; I4; I1 and I2; I5 over more than twenty covered windows; the R2
extension; and arc D4 (nine SF requests needed 2026-06-15 to 06-17, at least
two `no_rider_ops` deferrals, a Jun 15 note matching
`desk at 3:1, ratio is 2 · … were free — asked … (PM) to waive the ratio; there
is no such action`, every one of them `executed`, P-018 alone on PM Jun 16,
P-018 and P-009 on Jun 17, P-009 qualified `2026-06-17`). These are seed
values that `npm run data` reproduces; regenerating with different arc logic
breaks them, which is the point. [seed-and-arcs.md](seed-and-arcs.md) says
what must not move.

Three habits keep the suite honest when the engine changes. `makeDb()` builds
its `Map`s once, so a test that pushes a tail or replaces a person must also
update `db.asset` or `db.person` by hand, as the R5 and grant tests do.
Several assertions are exact strings (`toBe`, or `toEqual` on an array of
them), including the ISO-dated R2 slot message and the short-dated desk
messages, so a wording change in `rules.js` is a deliberate test change. And
the `rules()` helper keeps only `block` severities, so demoting a rule to
`warn` silently drops it from those assertions; the warning tests look the
violation up and check `.severity` or `.level` instead.

## Reference

<!-- rendered:begin rules-reference (scripts/render_docs.py) -->
### Vocabulary

**Windows** (`WINDOWS`): `AM` · `PM` · `NIGHT`

**Priorities** (`PRIORITY_RANK`, lower sorts first):

| priority | rank |
|---|---|
| `P0` | 0 |
| `P1` | 1 |
| `P2` | 2 |
| `P3` | 3 |

**Deferral reasons** (`DEFERRAL_REASONS`, labels from `REASON_LABELS`) — the only values R8 accepts for a deferral:

| reason | label |
|---|---|
| `no_rated_operator` | No rated operator |
| `no_rated_pilot` | No rated pilot |
| `no_asset` | No tail available |
| `asset_grounded` | Tail grounded |
| `program_over_max` | Program at tail cap |
| `build_not_ready` | Build not ready |
| `late_intake` | Late intake |
| `requester_withdrew` | Requester withdrew |
| `no_rider_ops` | No rider operator |

**Scrub reasons** (`SCRUB_REASONS`): every deferral reason plus `weather` (Weather).

**Crew requirements** (`CREW_KINDS`, labels from `CREW_LABELS`) — what R4 matches a sortie's seats against:

| kind | label |
|---|---|
| `none` | No crew |
| `pilot_only` | Safety pilot only |
| `operator_pilot` | Operator + safety pilot |
| `lone_operator` | Lone operator (self-pilot) |

**Build stages** (`BUILD_STAGES`): `engineering` · `release_candidate`

**Triage ladder** (`TRIAGE_STEPS`): `Open` → `Investigating` → `Corrective Action` → `Verified`

**The desk** — `DEFAULT_DESK` when the seed does not say (`meta.rider_desk` does), and `DESK_BOUNDS`, the only two settings that exist:

| setting | default | bounds |
|---|---|---|
| `min_per_window` | 1 | 1–4 |
| `ratio` | 2 | 1–4 |

### R8, as `validateReason()` says it

- deferral: `A deferral needs a reason: no_rated_operator · no_rated_pilot · no_asset · asset_grounded · program_over_max · build_not_ready · late_intake · requester_withdrew · no_rider_ops.`
- scrub: `A scrub needs a reason: no_rated_operator · no_rated_pilot · no_asset · asset_grounded · program_over_max · build_not_ready · late_intake · requester_withdrew · no_rider_ops · weather.`

### Functions

Every function in `src/lib/rules.js`, in file order, with the literals written inside it: the R9 action it passes to `authorize()`, the `rule`/`severity` pairs it can return (`(no severity)` marks a result object without a severity field — the desk row's level in `checkCoverage()`, the ok/message pair of `validateReason()`), the reason list it asserts (R8), and whether it throws. Exported names are what views, `App.jsx` and the tests may import. This table is a scan of the source text, not an execution: one row per `function name(` or `export function name(` declaration (an arrow-function export would not be a row), the `rule: '…', severity: '…'`, `authorize(actor, '…')` and `assertReason(reason, …)` literals written inside it, and whether the text `throw new Error` appears — so a rule, action, reason list or throw written any other way drops out of this table while `docs:check` still passes. Keep writing them literally.

| function | exported | authorizes (R9) | raises | asserts reason (R8) | throws |
|---|---|---|---|---|---|
| `makeDb` | yes | · | · | · | · |
| `addDays` | yes | · | · | · | · |
| `isWeekend` | yes | · | · | · | · |
| `ratedOn` | yes | · | · | · | · |
| `availableOn` | yes | · | · | · | · |
| `qualifiedOn` | yes | · | · | · | · |
| `deskCoverers` | yes | · | · | · | · |
| `riderLoad` | yes | · | · | · | · |
| `checkCoverage` | yes | · | R10 (no severity) | · | · |
| `checkUncover` | yes | · | R2·block, R10·block | · | · |
| `checkCover` | yes | · | R10·block, R2·block, AV·warn | · | · |
| `assetStatusOn` | yes | · | · | · | · |
| `isOperatingDay` | yes | · | · | · | · |
| `isLate` | yes | · | · | · | · |
| `defaultPlanDate` | yes | · | · | · | · |
| `lateWarning` | yes | · | R7·warn | · | · |
| `validateReason` | yes | · | R8 (no severity) | · | · |
| `assertReason` | no | · | · | · | yes |
| `personName` | no | · | · | · | · |
| `checkAssignment` | yes | · | R3·block, R2·block, R1·block, AV·warn, R10·block, R4·block, R5·warn | · | · |
| `hasBlock` | yes | · | · | · | · |
| `programTails` | yes | · | · | · | · |
| `queuedFor` | yes | · | · | · | · |
| `dayWarnings` | yes | · | R5·warn, R6·warn | · | · |
| `validateRequest` | yes | · | · | · | · |
| `operatingWindows` | yes | · | · | · | · |
| `pruneWindows` | yes | · | · | · | · |
| `newRequest` | yes | `request.create` | · | · | · |
| `nextAssignmentId` | yes | · | · | · | · |
| `newAssignment` | yes | `plan.assign` | · | · | · |
| `scheduleRequest` | yes | `plan.assign` | · | · | · |
| `deferRequest` | yes | `plan.defer` | · | `DEFERRAL_REASONS` | · |
| `scrubAssignment` | yes | `plan.scrub` | · | `SCRUB_REASONS` | · |
| `scrubRequest` | yes | `plan.scrub` | · | `SCRUB_REASONS` | · |
| `triageFailure` | yes | `triage.edit` | · | · | yes |
| `withdrawRequest` | yes | `request.withdraw` | · | · | yes |
| `coverWindow` | yes | `desk.cover` | · | · | · |
| `uncoverWindow` | yes | `desk.cover` | · | · | · |
| `acknowledge` | yes | `sortie.ack` | · | · | · |
| `assertGrantDate` | no | · | · | · | yes |
| `grantRating` | yes | `rating.grant` | · | · | · |
| `revokeRating` | yes | `rating.revoke` | · | · | · |
| `grantQualification` | yes | `qualification.grant` | · | · | · |
| `setProgramPriority` | yes | `program.priority` | · | · | yes |
| `setProgramTargets` | yes | `program.targets` | · | · | yes |
| `editProgram` | yes | · | · | · | · |
| `setDeskSettings` | yes | `desk.settings` | · | · | yes |

### Exports of `src/lib/rules.js`

| name | kind |
|---|---|
| `acknowledge` | function |
| `addDays` | function |
| `assetStatusOn` | function |
| `availableOn` | function |
| `BUILD_STAGES` | constant |
| `checkAssignment` | function |
| `checkCover` | function |
| `checkCoverage` | function |
| `checkUncover` | function |
| `coverWindow` | function |
| `CREW_KINDS` | constant |
| `CREW_LABELS` | constant |
| `dayWarnings` | function |
| `DEFAULT_DESK` | constant |
| `defaultPlanDate` | function |
| `DEFERRAL_REASONS` | constant |
| `deferRequest` | function |
| `DESK_BOUNDS` | constant |
| `deskCoverers` | function |
| `editProgram` | function |
| `grantQualification` | function |
| `grantRating` | function |
| `hasBlock` | function |
| `isLate` | function |
| `isOperatingDay` | function |
| `isWeekend` | function |
| `lateWarning` | function |
| `makeDb` | function |
| `newAssignment` | function |
| `newRequest` | function |
| `nextAssignmentId` | function |
| `operatingWindows` | function |
| `PRIORITY_RANK` | constant |
| `programTails` | function |
| `pruneWindows` | function |
| `qualifiedOn` | function |
| `queuedFor` | function |
| `ratedOn` | function |
| `REASON_LABELS` | constant |
| `revokeRating` | function |
| `riderLoad` | function |
| `scheduleRequest` | function |
| `SCRUB_REASONS` | constant |
| `scrubAssignment` | function |
| `scrubRequest` | function |
| `setDeskSettings` | function |
| `setProgramPriority` | function |
| `setProgramTargets` | function |
| `TRIAGE_STEPS` | constant |
| `triageFailure` | function |
| `uncoverWindow` | function |
| `validateReason` | function |
| `validateRequest` | function |
| `WINDOWS` | constant |
| `withdrawRequest` | function |
<!-- rendered:end rules-reference -->
