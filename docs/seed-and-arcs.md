# The seed and its arcs

`generate_data.py` is the only source of data in the repository: one script,
run from the project root, that writes `src/data/*.json` (what Vite bundles)
and `data/stratus.sqlite` (what the SQL notebook reads) from fixed seeds. This
page is the reference for that script: which RNG stream governs what, what
each half produces, the seven stories it plants, what it asserts before and
after writing, and what a change must not move. The story version is in the
root [README](../README.md), *The stories seeded in the data*; the contributor
summary is in [CLAUDE.md](../CLAUDE.md). The shapes it writes are in
[data-model.md](data-model.md), the rules it obeys in [rules.md](rules.md),
the actors it stamps in [permissions.md](permissions.md), the metrics computed
over its output in [analytics.md](analytics.md), the commands in
[runbook.md](runbook.md), and the vocabulary in [glossary.md](glossary.md).
Every number below that comes from the seed is a
value `npm run data` reproduces.

## Two halves, three streams

The script has two halves. Above the `dispatch layer` banner it generates the
RCCA data: test runs and the failures that group them. Below the banner it
generates the dispatch data: programs, tails, people, personas, the desk
roster, requests and sorties, by playing a day-by-day planner over the same
window. Each half draws from its own random stream, and the rider desk has a
third.

| stream | created | seed | governs |
|---|---|---|---|
| the module-level `random` | `random.seed(42)`, right after the imports | 42 | everything in the RCCA half: runs per day, pipeline, scenario, status, artifacts, duration, owner, the dates of the guaranteed arc runs, the shuffle of leftover failing runs, each background failure's size, status, team fallback, root cause, resolution date and severity, and the re-dating of Open items |
| `drng` | `random.Random(4242)`, just below the banner, after the dispatch imports | 4242 | the dispatch half: the 5% odd day off per crew member per rostered weekday, every request field `add_request()` is not handed (lateness, submission time, requester, title, build stage, supporting team), the 3% pre-plan withdrawal, the size of each day's standing ask, the SBU backlog, the currency-check subject, the surge's timestamps and windows, the 40% withdrawal after repeated deferral, the 2% scrub and its kind, and the minutes on event timestamps |
| `rrng` | `random.Random(4243)`, in the arc D4 block | 4243 | one draw, in `add_request()`: whether a PN or URC request is rider-facing (p = 0.2). SF is rider-facing without a draw; PLC, SBU and CQ never are |

No `random.*` call appears below the banner, so a change to the dispatch half
cannot perturb a run or a failure. Two things cross the banner, both
deterministic: `ARC3_FAILURE_ID`, the id of the failure whose title starts
with `Intruder track dropout`, which the grounding events on LV-03 and LV-05
carry; and the run-to-sortie link at the end of the script, which writes
`request_id` onto Flight runs after the planner has finished and draws
nothing.

Each stream is fragile in its own way.

- The module stream is one sequence. Adding, removing or reordering a single
  draw in the RCCA half (a conditional draw counts: `owner or
  random.choice(OWNERS)` draws only when no owner is passed) re-rolls every run
  and failure after it; the re-sequencing that follows then renumbers the ids,
  so the diff reads as a wholesale reshuffle.
- The planner stream is consumed in date order. Arcs D1–D3 are planner
  outcomes (deferral counts and reasons, a churn peak, the dates two flights
  flew), so a draw gained or lost anywhere before Jun 15 — in the crew roster,
  in `add_request()`, in `defer()`, in `execute_day()` — re-rolls them.
- The desk's randomness is on `rrng` for that reason. The rider-facing flag is
  the desk's only draw; the eight showcase-run requests are registered with
  every intake field spelled out so they draw nothing from either stream; the
  three rider operators take no random days off. Every `drng` draw before
  Jun 15 is therefore identical to a build without the desk. From Jun 15 on,
  R10 itself changes outcomes (a refused sortie changes placement, usage and
  later draws), and the sanity report asserts that D1 and D3 still hold.

The window is three constants:

```
END      = 2026-06-30               meta.today
START    = END − 89 days = 2026-04-02   90 days inclusive; meta.window_start
TOMORROW = END + 1 day = 2026-07-01     meta.tomorrow: the planned day the board opens on
```

The app does not read `meta.today`; it takes the greatest run date
(`maxDate()` in `src/lib/helpers.js`, used by `App.jsx`). The two agree because
the background loop writes at least one run on every day from START to END.
The ten build windows in `BUILD_WINDOWS` cover START..END and nothing past
it, so `build_for(TOMORROW)` falls back to the oldest build.

## The RCCA half

### Runs

The vocabulary is a handful of constants: three pipelines with weights, twelve
scenarios, eight owners, six teams, six root causes, ten builds.

| constant | values |
|---|---|
| `PIPELINES` / `PIPELINE_WEIGHTS` | Simulation 0.52 · HIL Bench 0.28 · Flight 0.20 |
| `SCENARIOS` (12) | Precision Landing — Gusty Crosswind · Precision Landing — Nominal · Obstacle Avoidance — Dynamic Intruder · Obstacle Avoidance — Static Field · Comms Loss Failover · GPS-Denied Navigation — Urban Canyon · Battery Failsafe — Forced RTL · Cabin Door Interlock Sequence · Vertiport Approach — Traffic Sequencing · Emergency Landing Site Selection · Payload Imbalance Compensation · Night Ops — Beacon Tracking |
| `OWNERS` (8) | A. Okafor · J. Meyer · S. Tanaka · L. Alvarez · P. Nguyen · D. Whitfield · M. Haddad · K. Osei |
| `TEAMS` (6) | Autonomy · Flight Controls · Test Infrastructure · Data Platform · Hardware · Systems Integration |
| `ROOT_CAUSES` (6) | Software Regression · Scenario Definition · Test Environment · Data / Logging · Hardware · Process Error |

`BUILD_WINDOWS` maps each build to a contiguous date window; `build_for(d)`
returns the build whose window holds `d`.

| build | window | note in the source |
|---|---|---|
| v2.13.2 | Apr 2 – Apr 18 | |
| v2.13.4 | Apr 19 – Apr 30 | |
| v2.14.0 | May 1 – May 14 | |
| v2.14.1 | May 15 – May 26 | |
| v2.14.3 | May 27 – Jun 1 | |
| v2.15.0 | Jun 2 – Jun 7 | ARC 3 regression in |
| v2.15.1 | Jun 8 – Jun 12 | ARC 3 still broken |
| v2.15.2 | Jun 13 – Jun 21 | ARC 3 fixed |
| v2.16.0 | Jun 22 – Jun 27 | |
| v2.16.1 | Jun 28 – Jun 30 | |

The background loop visits every calendar day from START to END (weekends
included) and writes `random.choice([1, 2, 2, 3, 3, 3, 4, 4, 5])` runs. For
each run: the pipeline is a weighted choice, the scenario a uniform choice,
and the status comes from one uniform draw `r` against a per-run `base_fail`:
fail when `r < base_fail`, blocked when `r < base_fail + 0.05`, else pass.
`base_fail` is 0.10 unless an arc applies:

| scenario | pipeline | build | `base_fail` | arc |
|---|---|---|---|---|
| Precision Landing — Gusty Crosswind | Simulation | any | 0.85 | 1 |
| Precision Landing — Gusty Crosswind | HIL Bench or Flight | any | 0.05 | 1, the control |
| Obstacle Avoidance — Dynamic Intruder | HIL Bench or Flight | v2.15.0 or v2.15.1 | 0.80 | 3 |

`default_artifacts(pipeline, d)` draws the artifacts: logs present with
p = 0.98; video `None` for Simulation (not applicable) and otherwise present
with p = 0.96; telemetry present with p = 0.58 for a Flight run dated inside
the arc 2 gap window (`TELEMETRY_GAP_START` 2026-05-18 to `TELEMETRY_GAP_END`
2026-06-07, inclusive) and p = 0.97 everywhere else. `add_run()` then draws
the duration (4–18 minutes for Simulation, 15–45 for HIL Bench, 22–60 for
Flight) and, when no owner is passed, the owner.

Two guarantee loops follow, so the arcs are visible whatever the dice did:
six Simulation crosswind fails dated `START + randint(3, 80)` with owner
S. Tanaka, every second one paired with a same-day Flight crosswind pass by
the same owner; nine Dynamic Intruder fails dated Jun 2 + `randint(0, 10)`
(HIL Bench when `k % 3` is nonzero, else Flight — six and three) with owner
A. Okafor, and five passes dated Jun 13 + `randint(0, 16)` (HIL Bench when
`k % 2` is nonzero, else Flight). The list is then sorted by `(date, run_id)`
and the ids reassigned, so `TR-2026-NNNN` is chronological and a guaranteed
run sorts after that day's background runs.

```
run = {
  run_id: "TR-2026-NNNN", date, pipeline, scenario, build,
  status: pass | fail | blocked, duration_min, owner,
  artifacts: { logs: bool, telemetry: bool, video: bool | null },
  request_id: null | "RQ-NNNN"      # added by the dispatch half, Flight runs only
}
```

### Failures

`add_failure()` appends a record and `runs_matching()` selects occurrences by
predicate (scenario, a pipeline or tuple of pipelines, status — default
`fail`, `None` disables the filter — and inclusive date bounds).

```
failure = {
  failure_id: "F-NNNN", title, severity: P0..P3,
  triage_status: Open | Investigating | Corrective Action | Verified,
  team, root_cause: str | null, opened, resolved: date | null,
  five_whys: [str], corrective_action: str | null, occurrences: [run_id]
}
```

The three arc failures are written by hand, in this order, with their
occurrences chosen by predicate over the finished run list:

| arc | title | severity · status · team | opened · resolved | root cause | occurrences |
|---|---|---|---|---|---|
| 1 | Lateral drift exceeds touchdown tolerance — gusty crosswind (SIM only) | P1 · Corrective Action · Test Infrastructure | 2026-04-09 · none | Scenario Definition | every failing Simulation run of the crosswind scenario, any date |
| 2 | Telemetry uploader race drops flight logs on rapid disarm | P2 · Investigating · Data Platform | 2026-05-22 · none | Data / Logging | every Flight run with `telemetry` false dated May 18 – Jun 7, pass or fail |
| 3 | Intruder track dropout above 12 m/s closure after planner refactor | P0 · Verified · Autonomy | 2026-06-03 · 2026-06-13 | Software Regression | every failing Dynamic Intruder run on HIL Bench or Flight dated Jun 2 – Jun 12 |

Arc 1 carries five whys and a corrective action that cites the passing Flight
runs; arc 2 carries two whys and no corrective action; arc 3 carries three
whys and a corrective action naming v2.15.2. Only these three carry whys.

Every failing run not claimed by an arc is dealt to background one-offs: the
leftover list is shuffled and consumed `randint(1, 3)` runs at a time, cycling
through the twelve `BG_TITLES` for at most 24 failures. The title's team hint
is split at ` (` and replaced by a random team when the result is not in
`TEAMS` (the bench-PSU title's hint, Test Environment, is a root cause and not
a team, so that title always gets a random team). Status is drawn from
`STATUS_POOL` (`Open` ×2, `Investigating` ×2, `Corrective Action` ×1,
`Verified` ×2); `opened` is the earliest date among the runs taken; severity
is drawn with weights P0 0.08, P1 0.27, P2 0.42, P3 0.23. Root cause and
resolution follow the status: Verified gets a random root cause,
`resolved = min(opened + randint(2, 9) days, END)` and the text "Fix verified
against re-run; monitoring for recurrence."; Corrective Action gets a random
root cause and "Corrective action in review with owning team."; Investigating
gets a root cause with p = 0.5; Open gets neither. `resolved` is therefore set
only on Verified failures, the arc 3 record explicitly and the background ones
by that rule — the convention `sql/schema.sql` documents.

Open items are then re-dated so nothing sits Open for months: a P0 to
`END − randint(2, 6)` days, anything else to `END − randint(9, 21)` days.
Finally the list is sorted by `opened` and the ids reassigned as `F-NNNN`.
Arc ids are therefore positional, not fixed: in the seed they are F-0004
(arc 1), F-0010 (arc 2) and F-0011 (arc 3), and the dispatch half locates
arc 3 by title prefix, never by id. The seed holds 14 failures.

## The dispatch half

Below the banner the script imports `os`, `sqlite3`, `Counter` and
`defaultdict`, creates `drng`, and defines the planning constants: `TOMORROW`,
`WINDOWS = ["AM", "PM", "NIGHT"]`, `CUTOFF = "15:00"`, `PRIO_RANK` (P0..P3 →
0..3), `DEFERRAL_REASONS` (nine values, exported as `meta.deferral_reasons`),
`BUILD_START` (build → window start, derived from `BUILD_WINDOWS`), and the
desk constants `RIDER_DESK = {ratio: 2, min_per_window: 1}`, `D4_DAYS`
(Jun 15–17), `D4_OUT` (Jun 15–19) and `DESK_QUAL_DATE` (Jun 17). Five arc
anchors sit with the programs: `PLC_PUSH` May 4–8, `MISATTRIBUTED_UNTIL`
Apr 28, `CROSS_RATING_DATE` May 29, `GROUNDING` Jun 10–18, `SURGE_WEEKEND`
Jun 20–21.

### Programs

| id | code | name | lead | priority | standing | airframes | tails per day | cutoff |
|---|---|---|---|---|---|---|---|---|
| PRG-01 | PLC | Precision Landing Cert | S. Tanaka | P0 | yes | Harmattan | 2–3 | 15:00 |
| PRG-02 | PN | Perception Nightly | A. Okafor | P1 | yes | Levant | 3–4 | 15:00 |
| PRG-03 | SBU | Sirocco Bring-up | R. Okafor | P0 | no | Sirocco | 1–2 | 15:00 |
| PRG-04 | URC | Urban Route Campaign | J. Meyer | P1 | no | Levant | 1–2 | 15:00 |
| PRG-05 | CQ | Crew Qualification | D. Whitfield | P2 | yes | Levant, Harmattan | 0–1 | 15:00 |
| PRG-06 | SF | Showcase Flights | K. Osei | P0 | no | Levant | 0–3 | 15:00 |

`cutoff_local` is stamped from `CUTOFF` on every row. `asset_min` and
`asset_max` are the R5 targets; `asset_max` also caps the planner.

### The fleet

`AIRFRAMES` gives each airframe its windows: Levant flies AM, PM and NIGHT;
Harmattan and Sirocco fly AM and PM only. `ASSET_ROWS` lists twelve tails.

| airframe | tails | config |
|---|---|---|
| Levant | LV-01, LV-03, LV-04, LV-05 | baseline |
| Levant | LV-02, LV-06 | instrumented |
| Harmattan | HM-01, HM-02, HM-03, HM-04 | instrumented |
| Sirocco | SR-01, SR-02 | baseline |

`STATUS_EVENTS` holds every status change; everything else is `available`.

| tail | status | from – to | reserved by | note | extra |
|---|---|---|---|---|---|
| LV-03 | grounded | Jun 10 – Jun 18 | | Grounded pending v2.15.2 — intruder-track regression (F-0011) | `surprise`, `failure_id` = arc 3 |
| LV-05 | grounded | Jun 10 – Jun 18 | | same | `surprise`, `failure_id` = arc 3 |
| LV-06 | maintenance | Jun 11 – Jun 17 | | 100-hour inspection (scheduled before the grounding) | |
| LV-04 | reserved | Jun 15 – Jun 17 | PRG-06 | Showcase config — cabin trim and livery | |
| HM-04 | reserved | May 4 – May 8 | PRG-01 | PLC cert push — instrumented config frozen | |
| HM-04 | maintenance | Jun 28 – open | | Avionics bay inspection — return to service Jul 3 | |

Each asset record carries `asset_id`, `airframe`, `config`, `windows` (the
airframe's), the snapshot fields `status`, `reserved_by`,
`status_note`, `status_since`, and `status_history`, one entry per event with
`status`, `date_from`, `date_to`, `reserved_by`, `note` and `failure_id`. The
`surprise` flag is generator-only and never written.

`asset_status_on(a, d, known_at=None)` returns `(status, reserved_by)` on day
`d`, treating an open `date_to` as running to TOMORROW. With `known_at`, a
surprise event that starts after `known_at` is invisible: this is how the
planner, which builds day D at D − 1, places sorties on LV-03 and LV-05 for
Jun 10 and `execute_day()`, which looks without `known_at`, scrubs them. A
snapshot pass then sets the flat fields as of END: an event spanning END
copies its note and `date_from`; an event that ended before END moves
`status_since` to the day after it ended (LV-03 reads `available` since
2026-06-19; HM-04 reads `maintenance` since 2026-06-28).

### The people

Seventeen crew rows in `PERSON_ROWS`, then three rider operators in
`RIDER_OPS_ROWS`: twenty persons.

| id | name | roles | ratings | self-pilot | pattern | effective dates and absences |
|---|---|---|---|---|---|---|
| P-001 | E. Lindqvist | pilot | Levant, Harmattan | | day | vacation May 18–19; the trainer persona U-15 |
| P-002 | T. Achebe | pilot | Levant, Harmattan | | day | vacation Apr 27 – May 1 (inside arc D1) |
| P-003 | N. Petrova | pilot | Levant | | night | |
| P-004 | I. Castellanos | pilot | Levant, Sirocco | | day+wkend | |
| P-005 | H. Brandt | pilot | Levant | | day | vacation Jun 22–24; persona U-10 |
| P-006 | Y. Nakamura | operator | Levant, Harmattan | | day | |
| P-007 | F. Mensah | operator | Levant, Harmattan | | day | |
| P-008 | C. Delacroix | operator | Levant, Harmattan | | day | |
| P-009 | O. Reyes | operator, rider_ops | Levant | | swing | `rider_ops` qualification effective 2026-06-17 (arc D4) |
| P-010 | B. Kowalczyk | operator | Levant | | night | |
| P-011 | D. Varga | operator, pilot | Levant, Harmattan, Sirocco | yes | day+wkend | Harmattan effective 2026-05-29 (arc D1); persona U-09 |
| P-012 | S. Oyelaran | operator, pilot | Levant, Harmattan, Sirocco | yes | day+wkend | Harmattan effective 2026-05-29 (arc D1) |
| P-013 | K. Halvorsen | operator | Levant, Sirocco | | day+wkend | |
| P-014 | A. Moreau | operator, pilot | Levant | yes | swing | |
| P-015 | J. Quispe | pilot | Levant | | night | |
| P-016 | L. Ferreira | pilot | Levant | | day | |
| P-017 | W. Adeyemi | pilot | Levant | | swing | |
| P-018 | M. Lindgren | rider_ops | | | day | `rider_ops` effective 2026-04-01; persona U-11 |
| P-019 | G. Abara | rider_ops | | | swing | `rider_ops` effective 2026-04-01; on leave Jun 15–19 (arc D4); persona U-14 |
| P-020 | Z. Halim | rider_ops | | | night | `rider_ops` effective 2026-04-01 |

`pattern_windows(pattern, d)` turns the pattern into windows for a day.

| pattern | Mon–Fri | Sat–Sun | Jun 20–21 (the surge weekend) |
|---|---|---|---|
| day | AM, PM | — | — |
| night | NIGHT | — | — |
| swing | PM, NIGHT | — | — |
| day+wkend | AM, PM | — | AM, PM |

Availability is built for every day START..TOMORROW and stored only for days
with a window. For a crew row a vacation day empties the windows; otherwise,
on any day but TOMORROW, a 5% `drng` draw empties them (the odd day off) — the
one `drng` draw in this part of the script, taken once per rostered day per
crew row, which is why reordering `PERSON_ROWS` or changing a pattern or a
vacation re-rolls the planner. The rider operators take no such draw; P-019's
windows are emptied on every day of `D4_OUT`.

Ratings held since before the window carry no date. `RATING_EFFECTIVE` dates
exactly two: P-011 and P-012 on Harmattan, both `CROSS_RATING_DATE`
(2026-05-29), the day after the second cross-rating flight. Until then only
P-001 and P-002 fly Harmattan, and P-002 is on vacation for the last week of
April. The desk qualification is effective-dated the same way: the three rider
operators from `DESK_QUAL_EFFECTIVE` (2026-04-01, before the window), and
P-009 from `DESK_QUAL_DATE` after `rider_ops` is appended to the operator's
roles. Three predicates read these: `rated_on(p, airframe, d)` (rating held
and effective on or before `d`), `available(p, d, w)` and `qualified_on(p,
d)`.

Every effective-dated rating and every desk qualification carries its grantor
in `granted_by`, always `TRAINER` (U-15, E. Lindqvist, who is P-001). The
trainer is a pilot on the roster — a check pilot who also flies — which is
what makes I2 a real constraint: `check_rules()` asserts the grantor is a
trainer persona whose `person_id` differs from the grantee's, and it passes
because P-001 has no effective-dated rating or qualification of their own.

### The personas

Fifteen `USERS` rows: a persona is a user record the header switches between.
The title is display, the role is behaviour, and only crew personas and the
trainer are people on the roster.

| id | name | title | role | scope | person |
|---|---|---|---|---|---|
| U-01 | G. Petrakis | Manager | observer | | |
| U-02 | N. Achterberg | Rider Ops Lead | authority | desk | |
| U-03 | P. Nwosu | Test Coordinator (AM) | coordinator | | |
| U-04 | T. Ibarra | Test Coordinator (PM) | coordinator | | |
| U-05 | S. Tanaka | Program Lead, PLC | authority | PRG-01 | |
| U-06 | T. Rodrigo | PM | authority | all | |
| U-07 | A. Okafor | Program Lead, PN | authority | PRG-02 | |
| U-08 | K. Osei | Program Lead, SF | authority | PRG-06 | |
| U-09 | D. Varga | Operator / Pilot | crew | | P-011 |
| U-10 | H. Brandt | Pilot | crew | | P-005 |
| U-11 | M. Lindgren | Rider Operator | crew | | P-018 |
| U-12 | L. Alvarez | Test Engineer, PLC | requester | | |
| U-13 | M. Sato | Engineer, Perception | requester | | |
| U-14 | G. Abara | Rider Operator | crew | | P-019 |
| U-15 | E. Lindqvist | Trainer | trainer | | P-001 |

Four constants name the actors the planner stamps: `COORD_AM = "U-03"`,
`COORD_PM = "U-04"`, `PM_USER = "U-06"`, `TRAINER = "U-15"`.
`coordinator_on(at)` returns U-03 when the timestamp's hour is below 14 and
U-04 otherwise (the shift boundary is 14:00; the intake cutoff is 15:00).
`requester_user(name, submitted_at)` returns the persona whose display name
matches the requester, else the coordinator on duty, who files on their
behalf: S. Tanaka, L. Alvarez, A. Okafor, M. Sato and K. Osei resolve to
personas; R. Okafor, P. Nguyen, J. Meyer, M. Haddad and D. Whitfield do not,
so every CQ and URC request, and the SBU requests drawn for R. Okafor or
P. Nguyen, are filed by a coordinator (109 of 535 requests in the seed: all 18
CQ, all 60 URC, 31 of 57 SBU).

The generator also carries a hand-maintained mirror of `src/lib/auth.js` for
the I4 audit: `EVENT_ACTION` (submitted → `request.create`, withdrawn →
`request.withdraw`, deferred and rescheduled → `plan.defer`, scrubbed →
`plan.scrub`, scheduled, reassigned and executed → `plan.assign`) and a
six-action `PERMISSIONS` dict (`request.create`, `request.withdraw`,
`plan.assign` as `not-own` for coordinators, `plan.defer`, `plan.scrub`,
`desk.cover`), read by `permits(user, action, request)`, which understands
`yes`, `own`, `not-own` and `scope` and refuses anything else. It differs from
the app's matrix in two known ways: it covers six of the app's seventeen
actions, and it maps `reassigned` to `plan.assign` where `auth.js` maps it to `plan.reassign`
(both grant coordinators `not-own`, so the verdict is the same). A change to
either side must be mirrored on the other or the seed check and the app will
disagree; `rules.test.js` runs the same audit with the real `can()`.

### The desk roster

`desk_roster(D)` runs for every day START..TOMORROW, before any request
exists, and writes one coverage row per (date, window, person). For each
window, `base` is every person whose roles are exactly `["rider_ops"]`,
qualified on D and available in the window; `dual` is every person with
`rider_ops` among other roles, likewise qualified and available. Everyone in
`base` covers; `dual` people are pulled only up to `DESK_ROSTER_TARGET = 2`,
because an operator who is also desk-qualified would rather fly. Each row is
`{date, window, person_id, assigned_by: "U-04", acked: D != TOMORROW}`, and
`covering[(date, window)]` indexes the set. The seed has 321 rows.

| days | AM | PM | NIGHT |
|---|---|---|---|
| ordinary weekday | P-018 | P-018, P-019 | P-019, P-020 |
| Jun 15 – Jun 16 | P-018 | P-018 | P-020 |
| Jun 17 – Jun 19 | P-018 | P-009, P-018 | P-009, P-020 |
| weekends | — | — | — |
| Jul 1 (tomorrow) | P-018 | P-018, P-019 | P-019, P-020 — rows unacked |

`desk_check(D, w, extra=1)` is the planner's R10: `None` when one more
rider-facing sortie fits, else `{reason: "no_rider_ops", note}` with one of
two notes.

```
R10 · no rider operator covering {w} on {Mon} {day}     coverers below min_per_window
R10 · desk at {load}:{coverers}, ratio is {ratio}       load + 1 would exceed ratio × coverers
```

### Demand

`add_request()` is the only constructor of requests. Everything it is not
handed, it derives or draws.

| field | rule |
|---|---|
| `airframe` | Harmattan for a CQ request whose title contains "Harmattan"; else the program's first airframe |
| `submitted_at`, `late` | without a `submitted_at`: `late` drawn with p = 0.06 unless given; stamped on `needed_by − 1` at hour 15, 15, 16 or 17 (late) or 8–14 (on time), minute 0–59. With a `submitted_at` and no `late`: `late` = submission date ≥ `needed_by − 1` and time ≥ 15:00 (R7). Every caller in the script that passes `submitted_at` also passes `late` |
| `build` | given, else `build_for(min(needed_by, END))` |
| `build_stage` | given, else `release_candidate` with p = 0.7 for PLC, otherwise `engineering` with p = 0.8 else `release_candidate` |
| `requester`, `title` | given, else drawn from the program's `REQUESTERS` and `TITLES` pools |
| `supporting_team` | given, else `TEAM_OF[code]` with p = 0.75 else a random `REQUEST_TEAMS` entry |
| `priority` | given, else the program's `priority_default` |
| `requester_id` | `requester_user()`; also the `by` of the `submitted` event |
| `rider_facing` | given, else SF → true; PN and URC → `rrng.random() < 0.2`; else false |
| `plan_date` | given, else `needed_by`; a late request instead gets `next_open_day(needed_by + 1, airframe)` and a `deferred` event with reason `late_intake`, stamped one minute after submission, `day = needed_by`, `by = requester_id`, note "flagged at intake: after the 15:00 cutoff — moved to next open day"; status `deferred`. An explicit `plan_date` skips this block, late or not |
| withdrawal | with `may_withdraw` and `needed_by < END`, p = 0.03: a `withdrawn` event (`requester_withdrew`) 35–170 minutes after submission by the requester; status `withdrawn` |

`next_open_day(d, airframe)` is the first day on or after `d` (within ten)
with any person rated on the airframe and rostered that day; a day past
TOMORROW is returned as it is, so late work stays queued rather than clamped
back. The emitted request has `request_id`, `program_id`, `requester`,
`title`, `build`, `build_stage`, `crew`, `windows` (preference order),
`airframe`, `priority`, `supporting_team`, `submitted_at`, `needed_by`,
`plan_date`, `status`, `late`, `deferral_reason`, `timeline`, `requester_id`
and `rider_facing`; planner-only state (`plan_date`, `attempts`, a currency
check's `subject`) lives in `rstate` and is never written.

Demand arrives from `daily_demand(D)`, which returns at once on Saturday and
Sunday, plus fixed registrations.

| source | when | what is filed |
|---|---|---|
| PLC standing ask | every weekday, and TOMORROW | n = 3 on TOMORROW, 4 during `PLC_PUSH`, else `choice([2, 3, 3, 3, 4])`, minus the PLC already queued for the day; windows AM+PM during the push, else AM (p = 0.8) or AM+PM; crew `operator_pilot` |
| PN standing ask | every weekday, and TOMORROW | n = 4 on TOMORROW else `choice([3, 4, 4, 4, 5])`, minus the PN queued for the day not counting queued rider-facing PM flights; windows NIGHT (p = 0.6) or PM+NIGHT; on TOMORROW the first gets PM+NIGHT and the rest NIGHT (so R6 has a holder to name); on Jun 15–17 the first `2 − queued rider PM flights` get PM with `rider_facing = True`; crew `pilot_only` |
| CQ currency check | weekdays with `D.toordinal() % 3 == 0`, not TOMORROW, when no CQ is queued | subject drawn from Levant-rated people available AM or PM that day; windows AM+PM; `operator_pilot`; title "Currency check — Levant (name)"; the subject is kept in `rstate` |
| URC campaign legs | weekdays in Apr 13–24, May 11–22, Jun 8–19 | two requests, windows AM+PM and PM+AM; `operator_pilot` |
| SBU backlog | weekdays outside Jun 18–21 | with p = 0.3 in April, 0.5 in May, 0.9 in June: windows AM, PM or AM+PM; `lone_operator` (p = 0.35) else `operator_pilot` |
| `SHOWCASES` | Apr 16 PM, May 8 AM, May 29 PM, Jun 16 PM, Jun 26 AM | SF, `late=False`, the SF title pool in order, `release_candidate`, no withdrawal |
| `SHOWCASE_RUN` (arc D4) | Jun 15 ×3, Jun 16 ×2, Jun 17 ×3, all PM | every field passed: submitted the day before at 10:20 + 3k, requester K. Osei, team Systems Integration, `release_candidate`, `late=False`, no withdrawal — no draw on either stream |
| `cq_cross` (arc D1) | two CQ requests needed May 6, window AM | "Type rating — Harmattan (D. Varga)" and "(S. Oyelaran)", submitted May 4 at 10:15 and 10:35, build v2.14.0, no withdrawal |
| the surge (arc D2) | 22 SBU requests submitted Jun 18 and Jun 19 | see arc D2 below |
| tomorrow's rail | three requests submitted on END | an SBU request titled "Perception regression — night approach", needed Jul 2, PM+NIGHT, submitted 14:10, build v2.15.2, requester M. Sato, `plan_date = TOMORROW`; a CQ "Type rating — Harmattan (H. Brandt)", needed TOMORROW, AM, submitted 11:05; an SF "Showcase flight — city council", needed TOMORROW, PM, submitted 16:40 with `late=True` and `plan_date = TOMORROW` (so it carries the flag with no `late_intake` deferral), note "after cutoff — accepted, guest date is fixed" |

### The planner

`plan_day(D, standing_only=False)` builds the plan for D the way the
coordinator does at the cutoff the day before; `known = D − 1` is what it may
see of the fleet.

1. The queue is every request with status `submitted` or `deferred` whose
   planner `plan_date` is set and `≤ D` — PLC and PN only when
   `standing_only` — sorted by `(PRIO_RANK[priority], submitted_at)`: P0
   first, then submission order. R6 holds by construction.
2. `prog_tails` is seeded with the tails each program already flies on D
   (non-scrubbed sorties).
3. A request whose build has not shipped (`BUILD_START[build] > D`) is
   deferred `build_not_ready` with the note "{build} ships {date}".
4. The note is set for a cross-rating flight ("cross-rating flight: {trainee}
   (trainee) under instruction") or a currency check ("currency check:
   {name}").
5. I1: the placing coordinator `who` is U-03 when the request's
   `requester_id` is U-04, else U-04.
6. `place()` runs. `subject_busy` re-queues the request to the next open day
   with a `rescheduled` event; a shortage goes to `defer()`; success stamps a
   `scheduled` event at `(D − 1) 15:30`, `day = D`, `by = who`, note
   "{tail} {window} · {operator} / {pilot}". When the shortage is the desk
   refusing an SF request, the note gains " — asked T. Rodrigo (PM) to waive
   the ratio; there is no such action" (or "the desk minimum").

`place(r, D, known, …)` tries the request's windows in order, skipping a
window the airframe lacks. A tail is usable when it has the airframe and the
window, its status as known at `known` is not grounded or maintenance, it is
not reserved for another program, and its (tail, window) is not busy. R5:
when the program already has `asset_max` distinct tails on D, only usable
tails among them remain; if that empties a non-empty list the shortage is
`program_over_max`. No usable tail is `asset_grounded` when a grounded or
maintenance tail was seen, else `no_asset`. `crew_for()` then picks crew;
the tail is the least-used usable one (`usage` counts sorties per tail and
per person, ties by id). For a rider-facing request `desk_check()` runs last:
a refusal appends " · {tail} and {crew names} were free" to the desk's note
and becomes the shortage — the note keeps what was free, which is the tell.
Only the first shortage across windows is kept.

`crew_for(r, D, w, busy)` reads the crew kind. `free_people()` is the
candidate pool: role held, `rated_on()`, `available()`, not busy in the
window, and not in `covering[(D, w)]` — a person covering a window can't fly
in it (R2, extended). `busy_sets(D)` marks a (tail, window) busy for every
sortie on D, scrubbed or not, but a (person, window) busy only for
non-scrubbed sorties: a scrubbed sortie frees its crew but not its slot.

| crew | result |
|---|---|
| `pilot_only` | the least-used free pilot, else `no_rated_pilot` |
| `lone_operator` | the least-used free operator with `self_pilot`, else `no_rated_operator` |
| `operator_pilot` | the least-used free pilot paired with the least-used free operator who is a different person; `no_rated_pilot` when no pilot is free, `no_rated_operator` when no pairing exists |
| `operator_pilot` with a currency-check subject | the subject flies their own check, as operator with another pilot or as pilot with another operator (`no_rated_pilot` or `no_rated_operator` when no partner is free); `subject_busy` when the subject is not free in the window — a reschedule, not a shortage |

`defer(r, D, reason, note, at)` asserts the reason is in `DEFERRAL_REASONS`
(R8) and counts an attempt. Arc D1 lives here: a PLC `no_rated_pilot` before
`MISATTRIBUTED_UNTIL` is rewritten to `no_rated_operator` with the note
"operator shortage per thread consensus"; from Apr 28 the note defaults to
"both Harmattan-rated pilots committed". The `deferred` event is stamped at
`at` or `(D − 1) 15:30` with `day = D`. Then one of three things: a
cross-rating flight on its second deferral has its windows set to `["PM"]`, a
`rescheduled` event "parked until the PLC cert push clears; moved to the PM
slot", and a plan date of May 27; a request with six attempts, or with three
or more attempts when a 40% draw says so and it is neither a surge request
nor SF or CQ, is withdrawn by its requester ("withdrawn by requester after
repeated deferral"); anything else is re-queued to `next_open_day(D + 1)`.
The 40% draw is taken whenever attempts are three or more, before the
exemptions are tested.

| reason | produced by |
|---|---|
| `late_intake` | `add_request()`, at intake, by the filer |
| `requester_withdrew` | `add_request()` (3% before planning); `defer()` after repeated deferral; `execute_day()` when the 2% scrub draws it — a withdrawal, not a deferral, in all three |
| `build_not_ready` | `plan_day()` when the build ships after D; also one of the four 2% scrub kinds |
| `no_rated_pilot`, `no_rated_operator` | `crew_for()`; a PLC `no_rated_pilot` before Apr 28 becomes `no_rated_operator` in `defer()` |
| `program_over_max` | `place()`, the R5 cap |
| `asset_grounded` | `place()` when no tail is usable and one was grounded or in maintenance; `execute_day()` after a grounding scrub with no same-day move |
| `no_asset` | `place()` when no tail is usable and none was grounded; the fallback when no window worked |
| `no_rider_ops` | `desk_check()`, R10, the only reason that carries a note of its own |

`new_assignment()` writes the sortie — `assignment_id`, `date`, `window`,
`request_id`, `asset_id`, `operator_id`, `pilot_id`, `status: planned`,
`scrub_reason: null`, `run_id: null`, `notes`, `assigned_by` (the caller's
`who`, default U-04), `acked: D != TOMORROW` — sets the request `scheduled`
with `plan_date = D`, bumps `usage` for the tail and crew and, for a
rider-facing request, `rider_load[(date, window)]`, the desk's numerator.

### Executing the day

`execute_day(D)` flies every `planned` sortie on D. Three things scrub one:
the tail's real status (no `known_at`) is grounded or maintenance →
`asset_grounded`; D is the surge Sunday and the sortie is SR-01 in AM →
`weather` (the fog delay); otherwise a 2% draw → one of `weather`, `weather`,
`requester_withdrew`, `build_not_ready`. An unscrubbed sortie becomes `done`,
the request `executed`, with an `executed` event stamped at 11:xx (AM), 16:xx
(PM) or 23:xx (NIGHT) by the sortie's `assigned_by`. A scrubbed sortie keeps
its slot, releases its `rider_load`, and stamps a `scrubbed` event at 07:xx
(AM) or 12:xx; a `requester_withdrew` scrub adds a `withdrawn` event by the
requester and stops there. Otherwise the coordinator tries a same-day move:
the request's windows at or after the scrubbed one (else the airframe's later
windows), a tail of the airframe not busy in that window and `available` on
D, crew from `crew_for()`, and `desk_check()` again for a rider-facing request
(R10 holds on the day too). A move creates a new sortie noted "reassigned
from {tail} {window} ({scrub})", immediately `done`, with `reassigned` and
`executed` events; without one, a grounding scrub goes through `defer(…,
"asset_grounded", "{tail} grounded on the day")` at 09:30 and any other scrub
re-queues with a reason-less `rescheduled` event.

| event | stamped at | `by` |
|---|---|---|
| `submitted` | `submitted_at` | `requester_id` |
| `deferred` (`late_intake`) | `submitted_at` + 1 minute | `requester_id` |
| `withdrawn` | 35–170 minutes after submission; D 09–16:xx after repeated deferral; D 08:xx or 13:xx on the day | `requester_id` |
| `deferred` (planner) | `(D − 1) 15:30` | the coordinator on duty at that hour: U-04 |
| `deferred` (`asset_grounded`, on the day) | D 09:30 | U-03 |
| `rescheduled` | `(D − 1) 15:30` (subject busy) → U-04; D 09:00 (cross-rating parking) and D 09:30 (after a scrub) → U-03 | the coordinator on duty |
| `scheduled` | `(D − 1) 15:30` | `who`: U-03 if the requester is U-04, else U-04 (I1); also `assigned_by` on the sortie |
| `executed` | D 11:xx, 16:xx or 23:xx by window | the sortie's `assigned_by` |
| `scrubbed` | D 07:xx (AM) or 12:xx | U-03 |
| `reassigned`, then `executed` | D 08:xx, then by window | `who`: U-04 if the requester is U-03, else U-03 (I1, same day); also `assigned_by` on the new sortie |
| coverage row | — | U-04, always |

The main loop runs `daily_demand(d)`, `plan_day(d)`, `execute_day(d)` for
every day START..END, then `daily_demand(TOMORROW)` and `plan_day(TOMORROW,
standing_only=True)` with no execution: the standing programs are planned at
cutoff and the ad hoc queue waits for the morning review, which is the
board's default state. Requests are then sorted by `(submitted_at,
request_id)` and renumbered `RQ-0001..`, each timeline sorted by `at`,
`deferral_reason` cleared unless the status is `deferred` or `withdrawn`, and
sorties sorted by `(date, window, asset_id)` and renumbered `AS-2026-0001..`
with `request_id` remapped.

### Linking Flight runs to sorties

Every run gets `request_id: null`. Then, for each Flight run in order, the
candidates are that day's `done` sorties with no `run_id` yet; one whose
program's `SCENARIO_POOL` contains the run's scenario is preferred, else any
candidate. The sortie gets the run's `run_id` and the run the sortie's
`request_id`. In the seed 46 of 58 Flight runs are linked; no Simulation or
HIL Bench run ever is.

## The seven arcs

Three arcs live in the RCCA half and four in the dispatch half. Each is a set
of constants, a mechanism, and a list of places that speak about it by name.
The seed values quoted are from the sanity report at HEAD and `src/data`.

### Arc 1 — the sim-only crosswind failure

Constants: the scenario "Precision Landing — Gusty Crosswind"; `base_fail`
0.85 in Simulation and 0.05 in any other pipeline; six guaranteed Simulation
fails (owner S. Tanaka) with three same-day Flight passes by the same owner.
The failure record is written with root cause Scenario Definition, five whys
ending at the m/s-versus-knots mismatch, and a corrective action that cites
the passing Flight runs; its occurrences are every failing Simulation
crosswind run in the window.

Seed: F-0004, P1, Corrective Action, opened Apr 9, 9 occurrences (Apr 5 –
Jun 13, all Simulation), and 5 passing Flight crosswind runs as the control.

Depends on it: the root-cause Pareto in `AnalyticsView` counts the nine
occurrences under Scenario Definition (occurrence-weighted, failures without
a root cause excluded); README story 5 and the corrective-action text carry
the sim-versus-flight contrast. No view caption names the arc.

### Arc 2 — the telemetry gap cluster

Constants: `TELEMETRY_GAP_START` 2026-05-18 and `TELEMETRY_GAP_END`
2026-06-07; in `default_artifacts()` a Flight run in that window keeps its
telemetry with p = 0.58 instead of 0.97. The failure record has root cause
Data / Logging, two whys and no corrective action; its occurrences are every
Flight run with `telemetry` false in the window, with no status filter, so
passing runs qualify.

Seed: F-0010, P2, Investigating, opened May 22, 8 occurrences (May 18 –
Jun 4), of which 6 passed and 2 failed; one of them, TR-2026-0213, is also an
occurrence of arc 3 (a run may belong to more than one failure).

Depends on it: the artifact-integrity caption in `ReportsView` ("The May–June
cluster of missing flight telemetry traces to the 'telemetry uploader race'
failure in the triage queue"); README story 6 ("about 40% of the time", the
drop probability 0.42). The gap is counted by `missingArtifacts()` in
`src/lib/helpers.js`, which tests `=== false`, so the `null` video on
Simulation runs never appears beside it.

### Arc 3 — the software regression

Constants: `BUILD_WINDOWS` places v2.15.0 on Jun 2–7, v2.15.1 on Jun 8–12 and
v2.15.2 from Jun 13; `base_fail` 0.80 for "Obstacle Avoidance — Dynamic
Intruder" on HIL Bench or Flight in the two broken builds; nine guaranteed
fails dated Jun 2–12 (owner A. Okafor) and five passes dated Jun 13–29. The
failure record is P0, Verified, Autonomy, root cause Software Regression,
opened Jun 3, resolved Jun 13 (the first v2.15.2 day), with a corrective
action that names v2.15.2; its occurrences are every failing Dynamic Intruder
run on HIL Bench or Flight dated Jun 2–12.

The window is encoded in three places that must move together: the build
names in the `base_fail` test, the dates of the guaranteed runs, and the date
bounds of the occurrence predicate; the fix date likewise in the v2.15.2
window start, the guaranteed passes' start date and `resolved`.

Seed: F-0011, 9 occurrences (Jun 2 – Jun 12; 6 HIL Bench, 3 Flight).

Depends on it: the weekly pass-rate caption in `ReportsView` ("The v2.15.0
regression is visible as the early-June dip — and the recovery after the
v2.15.2 fix shipped"); README story 7; and arc D3, which grounds two tails
against this failure. `ARC3_FAILURE_ID` is resolved by the title prefix
`Intruder track dropout`; renaming the title breaks the generator with
`StopIteration` before anything is written.

### Arc D1 — the misattributed shortage

Constants: `MISATTRIBUTED_UNTIL` 2026-04-28; `CROSS_RATING_DATE` 2026-05-29
in `RATING_EFFECTIVE` for P-011 and P-012 on Harmattan; `PLC_PUSH` May 4–8
(four PLC sorties a day, AM and PM, with HM-04 reserved for PRG-01); P-002's
vacation Apr 27 – May 1; the two `cq_cross` requests (CQ, P2, needed May 6,
AM, submitted May 4, build v2.14.0); the parking rule in `defer()`.

Mechanism: until May 29 only P-001 and P-002 are rated on Harmattan, so the
PLC `operator_pilot` ask (two to four a day) runs out of pilots, not
operators — three Harmattan-rated operators (P-006, P-007, P-008) are on the
day roster. `crew_for()`
returns `no_rated_pilot`; before Apr 28 `defer()` logs it as
`no_rated_operator` "per thread consensus", after Apr 28 as `no_rated_pilot`
with "both Harmattan-rated pilots committed". The cross-rating flights, P2 in
a P0 queue, are deferred twice during the push, parked to May 27 in the PM
slot, and fly May 27–28; the rating takes effect May 29.

Seed: RQ-0176 executed May 27 after 2 deferrals; RQ-0177 executed May 28
after 3 (two `no_rated_pilot`, one `program_over_max` on May 27). Harmattan
crew deferrals per weekday 1.10 (45) before the rating, 0.35 (8) after, a 68%
drop. Harmattan deferral reasons: `no_rated_operator` 24, `no_rated_pilot`
29, `late_intake` 11, `program_over_max` 2. The tell: 16 of the 24
`no_rated_operator` deferrals had a Harmattan-rated operator idle in a
requested window.

Depends on it: the deferrals-by-cause caption and the tell box in
`CapacityView` ("{refuted} of {total} deferrals logged as No rated
operator…"), its rating-matrix option "As of May 15 · before the cross-rating
flights"; README story 1, the *Metrics* paragraph on the tell ("16 of the 24
on Harmattan") and demo steps 3–4 (the P2 type-rating request on tomorrow's
rail is RQ-0530, "Type rating — Harmattan (H. Brandt)"); query 08 in
[analytics.md](analytics.md).

### Arc D2 — the bring-up surge

Constants: `SURGE_WEEKEND` Jun 20–21; 22 SBU requests, `k < 10` submitted
Jun 18 and the rest Jun 19, late when submitted Jun 19 with `k ≥ 17` (five),
needed Jun 20 when `k` is even or late and Jun 21 otherwise, build v2.16.0 for
`k` in (7, 15) and v2.15.2 otherwise, `lone_operator` when `k % 4 == 3`, no
pre-plan withdrawal, and exempt from the 40% repeat-deferral withdrawal. The
SBU backlog loop pauses Jun 18–21. Supply is 8 asset-windows: SR-01 and
SR-02, AM and PM, two days, flown by the `day+wkend` people (P-004, P-011,
P-012, P-013). The fog scrub in `execute_day()` takes SR-01 AM on the Sunday.
v2.16.0 ships Jun 22, so the two requests asking for it are deferred
`build_not_ready` until then.

Seed: 22 requests, 7 flown on the weekend, 15 deferred at least once, 5 late,
all 22 executed by Jun 25; the fog scrub hits RQ-0451, which flies Jun 22.
Lead time p50/p90 is 1/2 days overall and 5/6 for the surge.

Depends on it: README story 2 ("Seven fly, one is lost to fog, fifteen defer
with reasons, and five arrived after the Friday cutoff and carry `late`.
Lead-time p90 for the surge is 6 days against 2 overall"); the lead-time
table and churn chart in `CapacityView` show it without naming it; queries 05
and 06 in [analytics.md](analytics.md).

### Arc D3 — the grounding cascade

Constants: `GROUNDING` Jun 10–18; the `surprise` grounding events on LV-03 and
LV-05 with `failure_id = ARC3_FAILURE_ID`; LV-06's maintenance Jun 11–17,
scheduled before the grounding.

Mechanism: the plan for Jun 10 is built at Jun 9 with `known_at = Jun 9`, so
the planner places sorties on LV-03 and LV-05; `execute_day()` sees the real
status and scrubs them `asset_grounded`, then moves what it can to a free
tail in the same or a later window and defers the rest on the day. For the
rest of the window `place()` sees the grounding and reports `asset_grounded`
whenever no Levant is left. With two tails grounded and a third in
maintenance, PN cannot reach its minimum of three tails on most days.

Seed: churn (scrubs plus reassignments) totals 22 and peaks at 4 on Jun 10;
18 grounding days (two tails × nine days), of which 8 fall on or before the
failure's `resolved` date; PN flew fewer than three tails on five of the seven
weekdays (2, 3, 1, 2, 2, 2, 4 tails on Jun 10–18); Levant utilization in the
window is 58% of asset-windows and 100% of tail-days, against 27% and 77% in
May; 9 `asset_grounded` deferrals in the whole seed.

Depends on it: the utilization caption in `CapacityView` ("In the grounding
week the four remaining Levants flew every day while their window utilization
barely moved" — with LV-06 in maintenance Jun 11–17 the available count is
three on those days and four on Jun 10 and Jun 18; the saturation figure is
per available tail, so it holds either way) and its "Grounding days" KPI from
`groundingDays()`; README story 3 ("18 tail-days, 8 of them while the failure
was still open", "misses its asset minimum on five days", "churn peaks on the
day of the grounding") and demo step 5; the board's tail-status button in
`DispatchView`, which opens the failure through `status_history.failure_id`;
the "tails grounded against" panel in `TriageView` through `tailsAgainst()`;
query 07 in [analytics.md](analytics.md).

### Arc D4 — the desk shortage

Constants: `D4_DAYS` Jun 15–17 (the showcase run); `D4_OUT` Jun 15–19
(P-019's leave); `DESK_QUAL_DATE` Jun 17; `RIDER_DESK` ratio 2, minimum 1;
`DESK_ROSTER_TARGET` 2; the eight `SHOWCASE_RUN` requests plus the Jun 16 PM
entry of `SHOWCASES`, nine SF requests needed Jun 15–17, all PM; LV-04
reserved for PRG-06 Jun 15–17; two PN rider-facing PM flights a day on the
showcase days from `daily_demand()`; P-009's `rider_ops` role and
qualification.

Mechanism: PM normally has two coverers (P-018 and P-019). With P-019 on
leave the PM desk is P-018 alone on Jun 15–16, so the ratio allows two
rider-facing PM sorties. The planner places P0 first, so the showcases take
those two places; the next showcase in the queue finds a Levant and a rated
crew free, then `desk_check()` returns `R10 · desk at 3:1, ratio is 2`, the
note records the free tail and crew, and because the program is SF the note
asks the PM to waive a ratio that has no waiver. On Jun 17 P-009 is qualified,
`desk_roster()` pulls them onto the PM and NIGHT desk to reach the target of
two, and the backlog flies.

Seed: 5 `no_rider_ops` deferrals in all, three of them showcases on Jun
15–17, every one with "R10 · desk at 3:1, ratio is 2" and a free tail and
crew named:

```
RQ-0416 · Jun 15 · R10 · desk at 3:1, ratio is 2 · LV-02 and K. Halvorsen / W. Adeyemi were free — asked T. Rodrigo (PM) to waive the ratio; there is no such action
RQ-0425 · Jun 16 · R10 · desk at 3:1, ratio is 2 · LV-01 and C. Delacroix / A. Moreau were free — asked T. Rodrigo (PM) to waive the ratio; there is no such action
RQ-0426 · Jun 16 · same note as RQ-0425
```

All nine showcase requests end `executed`: six fly as asked, RQ-0416 flies
Jun 16, RQ-0425 and RQ-0426 fly Jun 17, and RQ-0437 and RQ-0438 — deferred
`asset_grounded` on Jun 17, when the grounding and LV-06's inspection leave
too few Levants — fly Jun 18. PM coverers: P-018 alone on Jun 15–16, P-009
and P-018 on Jun 17–19; P-009's `rider_ops` is effective 2026-06-17, granted
by E. Lindqvist. Rider-facing share by program: PLC 0/143, PN 56/243, SBU
0/57, URC 17/60, CQ 0/18, SF 14/14. On Jun 15 PM the desk holds 2
rider-facing sorties on 1 coverer, a load of 2.0.

Depends on it: the desk caption in `CapacityView` ("The showcase week in June
is where it cost a P0, and the fix was cross-training, not a waiver") and its
rating-matrix option "As of Jun 14 · before the desk qualification"; README's
*The principle*, story 4, the *Metrics* desk-load line ("peaks at 2.0 per
coverer on Jun 15") and demo steps 7–9 (step 7 quotes RQ-0416's note
verbatim); the last test in `src/lib/rules.test.js` (nine SF requests, the
note regex on Jun 15, P-018 alone on Jun 16, P-018 and P-009 on Jun 17,
P-009's date); query 10 in [analytics.md](analytics.md), which hardcodes the
ratio 2 and the week Jun 15–19.

### Tomorrow

Not an arc, but load-bearing for the demo: the rail on Jul 1 holds four
unscheduled requests, two of them P0, beside six planned sorties (three PLC
on HM-01..03 in AM, PN on LV-04 and LV-06 in PM and LV-05 in NIGHT).

```
RQ-0519  CQ   P2  submitted  Currency check — Levant (W. Adeyemi)      AM, PM
RQ-0530  CQ   P2  submitted  Type rating — Harmattan (H. Brandt)        AM
RQ-0533  SBU  P0  submitted  Perception regression — night approach     PM, NIGHT
RQ-0534  SF   P0  submitted  Showcase flight — city council             PM   late
```

README demo steps 1–3 and the seed test "tomorrow's rail holds two
unscheduled P0 and R6 fires for the late showcase" depend on exactly this
queue.

## check_rules() and the sanity report

`check_rules()` runs after the planner and before anything is written. It
asserts, with these messages:

| assert | message |
|---|---|
| one sortie per (asset, date, window), scrubbed or not | `R2 asset slot used twice` |
| a non-scrubbed sortie's tail has the request's airframe | `airframe mismatch` |
| every seat is rated on the airframe as of the day (R1) | `R1 unrated` |
| every seat is rostered in the window | `unavailable crew` |
| no person twice in a (date, window) (R2) | `R2 person double-booked` |
| the tail is not grounded or in maintenance that day (R3) | `R3 unassignable` |
| a reserved tail flies only for its program (R3) | `R3 reserved` |
| the seats match the crew kind; a lone operator has `self_pilot` (R4) | `R4`, `R4 lone` |
| every `deferred` event's reason is in `DEFERRAL_REASONS` (R8) | `R8` |
| no coverage row twice (R2, desk) | `R2 desk: covered twice` |
| every coverer is qualified on the day (R10) | `R10 unqualified coverer` |
| every coverer is rostered in the window | `desk coverer off shift` |
| no non-scrubbed seat is covering its own window (R2, extended) | `R2 flying while covering` |
| every (date, window) with rider-facing sorties has at least `min_per_window` coverers and load ≤ ratio × coverers (I5) | `R10 uncovered window`, `R10 over ratio` |
| every timeline event's `by` is permitted its action, a `late_intake` deferral counting as `request.create` (I4) | `I4 event actor` |
| every sortie's `assigned_by` is permitted `plan.assign` and is not the requester (I4, I1) | `I4 assignment actor`, `I1 assigned own request` |
| every coverage row's `assigned_by` is permitted `desk.cover` (I4) | `I4 coverage actor` |
| every grantor is a trainer persona who is not the grantee (I2) | `I2` |

A further assert runs during planning: `defer()` refuses any reason outside
`DEFERRAL_REASONS` (`assert reason in DEFERRAL_REASONS, reason`).

The order of what follows matters. `check_rules()` passes, the `invariants`
line prints, the ten JSON files are written, `write_sqlite()` deletes and
rebuilds `data/stratus.sqlite` from `sql/schema.sql`, and only then does the
sanity report print — so its asserts fire after the files are on disk. A
failed arc assert leaves regenerated files behind; `git status` shows them,
and `npm run data` stops before the analytics render because the two
commands are chained with `&&`.

| line | computed from | asserts |
|---|---|---|
| `invariants` | event, sortie and coverage counts after `check_rules()` | — |
| `runs`, `pipelines`, `failures` | counters over the RCCA lists | — |
| `ARC1 occurrences`, `ARC1 nuance`, `ARC2 occurrences`, `ARC3 occurrences` | the arc occurrence lists; the nuance line is `runs_matching()` with `status="pass"` on Flight | — |
| `programs … assignments`, `request statuses`, `deferral events` | counters over the dispatch lists | — |
| `flight runs linked to sorties` | runs with a `request_id` over Flight runs | — |
| `churn` | `scrubbed` and `reassigned` events keyed by the date of their stamp | `arc D3: plan churn must peak on the grounding day` |
| `D1 Harmattan crew deferrals/weekday` | `no_rated_pilot` and `no_rated_operator` deferrals on Harmattan, plan day taken as the stamp date + 1, per weekday before and from `CROSS_RATING_DATE` | — |
| `D1 Harmattan deferral reasons` | reasons of all Harmattan deferrals | — |
| `D1 the tell` | Harmattan `no_rated_operator` deferrals with a rated operator rostered in a requested window and on no non-scrubbed sortie there (the report's version does not exclude desk coverers; in this seed no Harmattan-rated operator covers the desk, so it agrees with query 08 and `misattribution()`) | — |
| `D1 cross-rating flights` | the two `cq_cross` requests | `arc D1: each cross-rating flight must fly before the rating takes effect` (status `executed` and `plan_date < CROSS_RATING_DATE`) |
| `D2 surge`, `D2 lead time days` | the 22 surge requests; lead days from submission date to the last `executed` stamp, percentile `xs[min(len − 1, int(q · len))]` | — |
| `D3 grounding days`, `D3 PN tails/day`, `D3 Levant utilization` | `grounded` history spans; distinct PN tails flown per weekday Jun 10–18; `util()` over operating days with grounded and maintenance tails out of the denominator | — |
| `personas`, `rider-facing share` | `USERS`; `rider_facing` per program | — |
| `D4 no_rider_ops deferrals` | `no_rider_ops` deferrals; showcases on Jun 15–17; notes containing "were free" | `arc D4: every desk refusal of a showcase must have had a tail and crew free` |
| `D4 PM coverers Jun 15–19` | `covering` for PM on the five days; P-009's qualification and grantor | — |
| `D4 showcases` | the nine SF requests needed Jun 15–17 | `arc D4: a showcase must be refused by the ratio on the first day of the run`; `arc D4 needs at least two showcase deferrals for the desk`; `arc D4: the showcase backlog must fly once the desk is covered` |
| `tomorrow` | sorties and the unscheduled queue for Jul 1 | `demo needs exactly two unscheduled P0 tomorrow` |

The report at HEAD, verbatim — the output of `python3 generate_data.py`:

```
invariants: I1 ok · I2 ok · I4 ok (1786 events, 525 sorties, 321 coverage rows) · I5 ok · R2 desk ok
runs: 305  {'pass': 250, 'fail': 45, 'blocked': 10}  pass_rate=82%
pipelines: {'Simulation': 159, 'HIL Bench': 88, 'Flight': 58}
failures: 14  statuses=Counter({'Investigating': 6, 'Verified': 4, 'Corrective Action': 2, 'Open': 2})
ARC1 occurrences: 9 (sim crosswind fails)
ARC1 nuance: flight crosswind PASSES: 5
ARC2 occurrences: 8 (flight telemetry gaps)
ARC3 occurrences: 9 (regression window fails)
--- dispatch ---
programs: 6  assets: 12  persons: 20  requests: 535  assignments: 525 {'done': 505, 'scrubbed': 14, 'planned': 6}
request statuses: {'executed': 505, 'withdrawn': 19, 'submitted': 4, 'scheduled': 6, 'deferred': 1}  late: 40
deferral events: 168  by reason: {'no_rated_operator': 29, 'late_intake': 39, 'no_rated_pilot': 31, 'program_over_max': 6, 'asset_grounded': 9, 'no_rider_ops': 5, 'no_asset': 47, 'build_not_ready': 2}
flight runs linked to sorties: 46/58
churn (scrubs + reassignments): total 22 · busiest days [('2026-06-10', 4), ('2026-04-09', 2), ('2026-04-16', 2), ('2026-05-04', 2)]
D1 Harmattan crew deferrals/weekday: before cross-rating 1.10 (45)  after 0.35 (8)  drop 68%
D1 Harmattan deferral reasons: {'no_rated_operator': 24, 'late_intake': 11, 'no_rated_pilot': 29, 'program_over_max': 2}
D1 the tell: 16/24 'no_rated_operator' deferrals had a Harmattan-rated operator idle in a requested window
D1 cross-rating flights: RQ-0176 executed 2026-05-27 after 2 deferrals; RQ-0177 executed 2026-05-28 after 3 deferrals
D2 surge: 22 SBU requests · flown on the weekend 7 · deferred at least once 15 · late 5 · final {'executed': 22}
D2 lead time days p50/p90: all 1/2 · surge 5/6
D3 grounding days: 18 (F-0011)
D3 PN tails/day Jun 10–18: [('06-10', 2), ('06-11', 3), ('06-12', 1), ('06-15', 2), ('06-16', 2), ('06-17', 2), ('06-18', 4)]  under min(3): 5
D3 Levant utilization Jun 10–18: windows 58% · tail-days 100%  (May: windows 27% · tail-days 77%)  asset_grounded deferrals: 9
--- roles & the desk ---
personas: 15 by role {'observer': 1, 'authority': 5, 'coordinator': 2, 'crew': 4, 'requester': 2, 'trainer': 1} · coverage rows: 321 · on behalf (filed by a coordinator): 109/535
rider-facing share: PLC 0/143 · PN 56/243 · SBU 0/57 · URC 17/60 · CQ 0/18 · SF 14/14
D4 no_rider_ops deferrals: 5 total · showcases on Jun 15–17: 3 · with a Levant and a rated crew free: 3 · by message: {'R10 · desk at 3:1, ratio is 2': 5}
D4 PM coverers Jun 15–19: [('Jun 15', ['P-018']), ('Jun 16', ['P-018']), ('Jun 17', ['P-009', 'P-018']), ('Jun 18', ['P-009', 'P-018']), ('Jun 19', ['P-009', 'P-018'])] · P-009 rider_ops effective 2026-06-17 (granted by E. Lindqvist)
D4 showcases: RQ-0413 transit authority executed 2026-06-15 (flew as asked); RQ-0415 hospital network executed 2026-06-15 (flew as asked); RQ-0416 airport operator executed 2026-06-16 (no_rider_ops); RQ-0424 board visit executed 2026-06-16 (flew as asked); RQ-0425 insurance partners executed 2026-06-17 (no_rider_ops); RQ-0426 state regulator executed 2026-06-17 (no_rider_ops); RQ-0436 partner airline executed 2026-06-17 (flew as asked); RQ-0437 logistics partner executed 2026-06-18 (asset_grounded); RQ-0438 tourism board executed 2026-06-18 (asset_grounded)
tomorrow 2026-07-01: planned 6 · unscheduled 4 (P0: 2) · [('RQ-0519', 'CQ', 'P2', 'submitted'), ('RQ-0530', 'CQ', 'P2', 'submitted'), ('RQ-0533', 'SBU', 'P0', 'submitted'), ('RQ-0534', 'SF', 'P0', 'submitted')]
```

Nothing in the RCCA lines is asserted; a change that emptied an arc's
occurrences would still write. The seven asserts are all on the dispatch
side, and the two-P0 one is the demo's.

## Regenerating safely

Run from the project root; the script and the renderer write through relative
paths.

```bash
npm run data           # python3 generate_data.py && python3 scripts/render_analytics.py
git status --short     # src/data and docs/analytics.md clean = nothing moved
npm test               # the seed block in src/lib/rules.test.js
npm run docs:check     # when src/lib/rules.js, src/lib/auth.js or sql/schema.sql changed
```

`npm run data` rewrites `src/data/*.json`, `data/stratus.sqlite` and
`docs/analytics.md`. `data/stratus.sqlite` is gitignored and is deleted and
rebuilt on every run; the JSON and `docs/analytics.md` are tracked, so a
clean `git status` after a run is the proof that a change was a pure
refactor. A change meant to leave the seed alone — anything in the dispatch
half that adds no `drng` draw before Jun 15, anything in `write_sqlite()`,
the report, or a new assert — must leave it clean.

After a change to generation logic:

- Read the sanity report, every line, not only the asserts. The D1 rate, the
  D2 counts, the D3 tails per day and the D4 coverers are the numbers the
  README and the captions quote.
- Run `npm test`. The seed block re-verifies, with the app's own functions:
  no blocking violation on any non-scrubbed sortie, `late` equal to
  `isLate()` on every request, every deferral reason in the enum, exactly two
  P0 on tomorrow's rail with an R6 warning and SBU under its minimum, I4, I1
  and I2, I5 over more than twenty covered windows, nobody flying while
  covering, and the D4 arc (nine SF requests Jun 15–17, the Jun 15 note
  regex, P-018 alone on Jun 16, P-018 and P-009 on Jun 17, P-009's date).
- Re-read the captions listed under each arc above, and README's *The
  stories seeded in the data*, *Metrics* and *The ten-minute demo*; they quote
  the seed by number and by request id.
- Commit the regenerated `src/data/*.json` and `docs/analytics.md` with the
  generator change. Query 10 in `sql/analytics` hardcodes the ratio 2 and the
  week Jun 15–19; moving D4 or the ratio means editing it too.

Stream discipline, restated as rules:

- RCCA half: never add, remove or reorder a draw unless you mean to re-roll
  every run and failure. Arc failure ids are positional; locate an arc by
  title, as `ARC3_FAILURE_ID` does, never by `F-NNNN`.
- Dispatch half: no new `drng` draw before Jun 15. A hand-registered request
  draws nothing when it passes `title`, `requester`, `stage`, `team`,
  `submitted_at`, `late` and `may_withdraw=False`, as `SHOWCASE_RUN` does;
  `rider_facing` draws from `rrng` only for PN and URC when not passed.
- The desk: new randomness goes on `rrng`. The roster loop for the rider
  operators draws nothing and must stay that way.
- `check_rules()` is the gate before writing; the arc asserts are the gate
  after. Add an assert for any new story the README will quote.

Adding a deferral reason touches three places, then a regeneration:

1. `DEFERRAL_REASONS` in `generate_data.py` — `defer()` asserts against it,
   `check_rules()` re-checks every event against it, and it is exported as
   `meta.deferral_reasons`.
2. `DEFERRAL_REASONS` in `src/lib/rules.js`, with a label in `REASON_LABELS`
   (`SCRUB_REASONS` derives from it, `validateReason()` lists it in the R8
   message, and `DispatchView`, `RequestsView`, `ReportsView` and
   `CapacityView` read the labels).
3. The two CHECK constraints in `sql/schema.sql`, on `requests.deferral_reason`
   and on `request_events` — `write_sqlite()` fails on the first row that
   carries a reason the schema does not list.

Then `npm run data` (the schema and the data move together), `npm test` (the
R8 tests assert the enum), and `npm run docs:check` (the reference block in
`rules.md` renders the enum from the code). A reason with actor semantics of
its own, as `late_intake` has, also needs `eventAction()` in `src/lib/auth.js`,
the I4 audit in `check_rules()` and query 09, which all name `late_intake`
literally.
