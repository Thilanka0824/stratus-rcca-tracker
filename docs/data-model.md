# Data model

The entities the app and the SQL notebook share: the JSON shape of each one as
`generate_data.py` writes it, how that shape flattens into `sql/schema.sql`,
the links between entities, and the invariants the data keeps. The rendered
block under [Schema](#schema) is the reference half — every table, column,
key and foreign key, read back from SQLite itself; the prose above it is the
explanation and points at the block rather than repeating it. The story the
data tells is in the root [README](../README.md), the rules it obeys are in
[rules.md](rules.md), and the generator that produces it is in
[seed-and-arcs.md](seed-and-arcs.md). How the data reaches the views is in
[architecture.md](architecture.md).

## Two renderings of one seed

`generate_data.py` builds the whole dataset in memory, checks it with
`check_rules()`, then writes it twice.

The first rendering is ten JSON files under `src/data/`, written by one loop
with `json.dump(..., indent=1)`: `test_runs`, `failures`, `meta`, `programs`,
`assets`, `persons`, `requests`, `assignments`, `users`, `coverage`. `App.jsx`
imports all ten statically, so Vite bundles them into the build and the
browser never fetches data. `makeDb()` in `src/lib/rules.js` indexes seven of
them once — programs, assets, persons, requests, assignments, users and
coverage, with `meta.rider_desk` as the desk: the raw arrays, a `Map` by id
for programs, assets, persons, requests and users, and the desk settings — and
the result is handed to the views as a prop; runs and failures travel as their
own props, `meta` as itself. Board and triage edits live in React state for
the session and are never written back. Records the session creates take ids
with an `L` in them (`RQ-L001…` from `App.jsx`, `AS-2026-L001…` from
`nextAssignmentId()` in `rules.js`), so they cannot collide with the seed.

The second rendering is `data/stratus.sqlite`. `write_sqlite()` deletes any
existing file, runs `sql/schema.sql` through `executescript`, and fills every
table with one `executemany` from the same in-memory lists. The file is
gitignored; its only reader is `scripts/render_analytics.py`, which runs
`sql/analytics/*.sql` against it and renders [analytics.md](analytics.md).
The schema is the stricter rendering: it carries the `CHECK` constraints, the
`UNIQUE` slot key and the foreign keys that the JSON can only promise.

The conventions — dates, timestamps, booleans and references as the schema's
header states them, the rest as the schema body and `write_sqlite()` apply
them:

| convention | JSON | SQLite |
|---|---|---|
| dates | ISO `YYYY-MM-DD` strings, from `iso()` | `TEXT`, same spelling |
| timestamps | `YYYY-MM-DDTHH:MM`, local, no seconds, no zone, from `stamp()`; the board stamps its own edits `<today>T18:MM` (`stampNow()` in `App.jsx`) | `TEXT`, same spelling |
| booleans | `true` / `false` | `INTEGER` 0/1 through `int()`, with `CHECK (… IN (0,1))` on every boolean column except the three `art_*` columns of `test_runs`, which are bare `INTEGER` |
| missing values | `null` | `NULL`; `artifacts.video` is the one three-valued field and becomes `NULL` only when the JSON is `null` |
| enums | plain strings | `CHECK (… IN (…))` on the column |
| ids | strings with a typed prefix (per entity, below) | `TEXT PRIMARY KEY` |
| nested lists and objects | arrays and objects on the record | child tables (next table) |
| references | ids on the record, unchecked | `PRAGMA foreign_keys = ON` is the schema's first statement, so every reference is enforced on insert |

Nested parts flatten like this; the entity sections repeat the mapping per
entity.

| JSON | SQLite | note |
|---|---|---|
| `requests[].windows` | `request_windows` | `seq` counts from 0, in preference order |
| `requests[].timeline` | `request_events` | `by` becomes `actor_id`; the integer `id` key exists only in SQLite |
| `assets[].windows` | `asset_windows` | |
| `assets[].status_history` | `asset_status_history` | the integer `id` key exists only in SQLite |
| `persons[].roles` | `person_roles` | |
| `persons[].ratings` with `ratings_effective` and `granted_by` | `person_ratings` | one row per rating; `effective_from` is `NULL` for a rating with no effective date; `granted_by` from the map of the same name |
| `persons[].qualifications` with `granted_by` | `qualifications` | `kind` is the map key, `rider_ops` |
| `persons[].availability` | `person_availability` | one row per (date, window) |
| `programs[].airframes` | `program_airframes` | |
| `users[].scope` | `user_scopes` | the string `"all"` becomes one row, a list one row per entry, `null` no row |
| `failures[].five_whys` | `failure_whys` | `seq` counts from 1 |
| `failures[].occurrences` | `failure_occurrences` | the primary key is the pair, so a run may sit under more than one failure |
| `test_runs[].artifacts` | `art_logs`, `art_telemetry`, `art_video` on `test_runs` | `video` `null` becomes `NULL` |
| `meta` | no table | SQL derives today as `max(test_runs.date)`; query 10 writes the desk ratio as a literal |

Two generator-only things reach neither rendering: the `surprise` flag on a
status event (the planner's blindness to a grounding, see
[seed-and-arcs.md](seed-and-arcs.md)) and `rstate`, the planner's scratch
state per request.

## Entities

Each subsection lists the fields as the generator writes them, the id scheme,
what the nested parts become in SQLite, and one trimmed record from the seed
(`…` marks an elision). Types are JSON types. An `enum` row lists the values
the schema's `CHECK` accepts; where the generator or the app writes fewer, the
row says so. Counts are seed values that `npm run data` reproduces and the
sanity report prints.

### `test_runs.json`

One record per logged test run, 305 in the seed, on every calendar day from
`2026-04-02` to `2026-06-30`. Ids are `TR-2026-NNNN`, renumbered
chronologically after the runs are sorted by date, so an id says nothing about
which loop of the generator created the run.

| field | type | values and meaning |
|---|---|---|
| `run_id` | string | `TR-2026-NNNN` |
| `date` | date | the run's day |
| `pipeline` | enum | `Simulation` · `HIL Bench` · `Flight` |
| `scenario` | string | one of the twelve names in `SCENARIOS` |
| `build` | string | the build whose window in `BUILD_WINDOWS` contains `date`, `v2.13.2` through `v2.16.1` |
| `status` | enum | `pass` · `fail` · `blocked` |
| `duration_min` | integer | drawn per pipeline |
| `owner` | string | a display name from `OWNERS`, not a `user_id`; four of the eight names coincide with personas, but nothing links them |
| `artifacts.logs` | boolean | present or missing |
| `artifacts.telemetry` | boolean | present or missing; the arc 2 gap drops it on Flight runs |
| `artifacts.video` | boolean or null | `null` on every Simulation run (not applicable), `false` when missing |
| `request_id` | string or null | the sortie the run came from; set only on Flight runs, by the link step described under [Relationships](#relationships) |

In SQLite: `test_runs`, with `artifacts` spread over `art_logs`,
`art_telemetry` and `art_video`, and `request_id` a nullable foreign key to
`requests`.

```json
{
 "run_id": "TR-2026-0116",
 "date": "2026-05-07",
 "pipeline": "Flight",
 "scenario": "Battery Failsafe — Forced RTL",
 "build": "v2.14.0",
 "status": "pass",
 "duration_min": 51,
 "owner": "M. Haddad",
 "artifacts": { "logs": true, "telemetry": true, "video": false },
 "request_id": "RQ-0190"
}
```

### `failures.json`

One record per RCCA item, 14 in the seed: three planted arcs and the
background one-offs that absorb every other failing run. Ids are `F-NNNN`,
assigned after the list is sorted by `opened`, so an arc's id is positional.
The generator finds arc 3 by title prefix (`ARC3_FAILURE_ID`); code should do
the same rather than hardcode `F-0011`.

| field | type | values and meaning |
|---|---|---|
| `failure_id` | string | `F-NNNN` |
| `title` | string | |
| `severity` | enum | `P0` · `P1` · `P2` · `P3` |
| `triage_status` | enum | `Open` · `Investigating` · `Corrective Action` · `Verified` — the ladder `TRIAGE_STEPS` in `rules.js` |
| `team` | string | one of `TEAMS` |
| `root_cause` | string or null | one of `ROOT_CAUSES`; `null` until determined |
| `opened` | date | hand-set on the arcs and re-dated near the end of the window on Open items; only a background item that is not Open opens on its first occurrence's date |
| `resolved` | date or null | set only while `triage_status` is `Verified`; `triageFailure()` stamps today on `Verified` and clears it on any other step, unless an explicit `resolved` is passed, which is how Undo restores the previous value |
| `five_whys` | array of string | ordered; `[]` on every background failure |
| `corrective_action` | string or null | |
| `occurrences` | array of string | `run_id`s; the arc 2 predicate has no status filter, so a passing run can be an occurrence |

In SQLite: `failures` (nine columns), `failure_whys` (`seq` from 1) and
`failure_occurrences` (primary key `(failure_id, run_id)`; one run in the
seed belongs to two failures).

```json
{
 "failure_id": "F-0011",
 "title": "Intruder track dropout above 12 m/s closure after planner refactor",
 "severity": "P0",
 "triage_status": "Verified",
 "team": "Autonomy",
 "root_cause": "Software Regression",
 "opened": "2026-06-03",
 "resolved": "2026-06-13",
 "five_whys": ["Why did avoidance fail? Intruder track dropped above 12 m/s closure rate.", "…"],
 "corrective_action": "Reverted cost-map decay change; fix shipped in v2.15.2. …",
 "occurrences": ["TR-2026-0208", "TR-2026-0213", "…"]
}
```

### `programs.json`

Six records. Ids are `PRG-NN`; `code` is the short name the UI shows and is
unique.

| field | type | values and meaning |
|---|---|---|
| `program_id` | string | `PRG-NN` |
| `code` | string | `PLC` · `PN` · `SBU` · `URC` · `CQ` · `SF` |
| `name` | string | |
| `lead` | string | a display name, not a `user_id`; authority over a program is a persona's `scope`, not this field |
| `priority_default` | enum | `P0` … `P3`; what a request inherits when intake does not say |
| `standing` | boolean | a standing program is expected on every weekday (R5) |
| `airframes` | array of string | the airframes the program flies; `validateRequest()` refuses any other |
| `asset_min`, `asset_max` | integer | the daily tail target (R5) |
| `cutoff_local` | string | `15:00` on every row; the app reads the cutoff from `meta.cutoff_local`, and nothing under `src/` reads this column |

`editProgram()` changes `priority_default`, `asset_min` and `asset_max` in
the session; nothing else on the record moves.

In SQLite: `programs` and `program_airframes`.

```json
{
 "program_id": "PRG-01",
 "code": "PLC",
 "name": "Precision Landing Cert",
 "lead": "S. Tanaka",
 "priority_default": "P0",
 "standing": true,
 "airframes": ["Harmattan"],
 "asset_min": 2,
 "asset_max": 3,
 "cutoff_local": "15:00"
}
```

### `assets.json`

Twelve tails: six Levant (`LV-01` … `LV-06`), four Harmattan (`HM-01` …
`HM-04`), two Sirocco (`SR-01`, `SR-02`). The id prefix is the airframe.

| field | type | values and meaning |
|---|---|---|
| `asset_id` | string | `LV-NN` · `HM-NN` · `SR-NN` |
| `airframe` | string | `Levant` · `Harmattan` · `Sirocco` |
| `config` | enum | `instrumented` · `baseline` |
| `windows` | array of enum | the windows the tail operates, copied from `meta.airframes[airframe].windows`; Harmattan and Sirocco have no `NIGHT` |
| `status` | enum | `available` · `grounded` · `maintenance` · `reserved` — the snapshot as of today |
| `reserved_by` | string or null | a `program_id`; snapshot |
| `status_note` | string | snapshot; `""` when nothing is in effect |
| `status_since` | date | snapshot: the start of the event in effect today, else the day after the latest event that has ended, else the window start |
| `status_history[]` | array of object | every grounding, maintenance period and reservation in the window |
| `status_history[].status` | enum | `grounded` · `maintenance` · `reserved`; never `available` — the gaps are availability |
| `status_history[].date_from` | date | |
| `status_history[].date_to` | date or null | `null` means still in effect |
| `status_history[].reserved_by` | string or null | a `program_id` on a reservation |
| `status_history[].note` | string | |
| `status_history[].failure_id` | string or null | the RCCA item a grounding is attributable to |

The flat fields are only today. `assetStatusOn(asset, date)` in `rules.js`
is the way to ask about any day: it returns the first history row covering
the date, or `available`.

In SQLite: `assets`, `asset_windows` and `asset_status_history` (an integer
`id` key; `failure_id` a foreign key to `failures`).

```json
{
 "asset_id": "LV-03",
 "airframe": "Levant",
 "config": "baseline",
 "windows": ["AM", "PM", "NIGHT"],
 "status": "available",
 "reserved_by": null,
 "status_note": "",
 "status_since": "2026-06-19",
 "status_history": [
  {
   "status": "grounded",
   "date_from": "2026-06-10",
   "date_to": "2026-06-18",
   "reserved_by": null,
   "note": "Grounded pending v2.15.2 — intruder-track regression (F-0011)",
   "failure_id": "F-0011"
  }
 ]
}
```

### `persons.json`

Twenty people on the roster: seventeen crew (pilots, operators and three
operator-pilots) and three rider operators, one of the operators also holding
the desk role. Ids are `P-NNN`.

| field | type | values and meaning |
|---|---|---|
| `person_id` | string | `P-NNN` |
| `name` | string | |
| `roles` | array of enum | `operator` · `pilot` · `rider_ops`; a person may hold more than one |
| `ratings` | array of string | the airframes the person is rated on |
| `self_pilot` | boolean | may fly a `lone_operator` sortie (R4) |
| `ratings_effective` | object | `airframe → date`; a rating absent here counts from before the window |
| `availability` | object | `date → [windows]`, only days with at least one window, from the window start through tomorrow |
| `qualifications` | object | `rider_ops → date`; `{}` for people not on the desk |
| `granted_by` | object | `airframe or rider_ops → user_id`, one entry per key of `ratings_effective` and of `qualifications`; `U-15`, the trainer, on every seed entry |

`ratedOn(person, airframe, date)` and `qualifiedOn(person, date)` in
`rules.js` are how the rules ask, and both read the effective dates;
`ratingMatrix()` in `dispatch.js` and the ratings panel in `MyDayView` read
`ratings` and `ratings_effective` directly so they can show a pending rating
with its date. `availableOn()` reads `availability`. The trainer's
transitions `grantRating()`, `revokeRating()` and `grantQualification()`
write `ratings` or `roles`, the effective map and `granted_by` together.

In SQLite: `persons` (id, name, `self_pilot`), `person_roles`,
`person_ratings` (`effective_from` `NULL` for a rating with no date),
`qualifications` (`kind` is `rider_ops`; `effective_from` not null) and
`person_availability`.

```json
{
 "person_id": "P-011",
 "name": "D. Varga",
 "roles": ["operator", "pilot"],
 "ratings": ["Levant", "Harmattan", "Sirocco"],
 "self_pilot": true,
 "ratings_effective": { "Harmattan": "2026-05-29" },
 "availability": { "2026-04-02": ["AM", "PM"], "2026-04-03": ["AM", "PM"], "…": "…" },
 "qualifications": {},
 "granted_by": { "Harmattan": "U-15" }
}
```

### `users.json`

Fifteen personas, `U-NN`. A persona is authorization without authentication:
the header switches between them, the `title` is display and the `role` is
behaviour. What each role may do is rendered in
[permissions.md](permissions.md).

| field | type | values and meaning |
|---|---|---|
| `user_id` | string | `U-NN` |
| `name` | string | display; the generator matches `requests[].requester` against it to find the filer |
| `title` | string | display only |
| `role` | enum | `requester` · `coordinator` · `authority` · `trainer` · `crew` · `observer` (also `meta.app_roles`) |
| `scope` | null, string or array | authority reach: `null` on every non-authority persona, `"all"` for the PM, a list of `program_id`s for a program lead, `["desk"]` for the rider ops lead |
| `person_id` | string or null | the roster person this persona is; set on the crew personas and the trainer, unique |

In SQLite: `users` and `user_scopes` (`"all"` becomes one row, a list one row
per entry, `null` none; a scope is checked to be `all`, `desk` or `PRG-%`).

```json
{ "user_id": "U-05", "name": "S. Tanaka", "title": "Program Lead, PLC", "role": "authority", "scope": ["PRG-01"], "person_id": null }
```

The other shapes in the seed: `U-06` (PM) has `"scope": "all"`, `U-02` (rider
ops lead) has `["desk"]`, and `U-15` (trainer) has `"person_id": "P-001"`.

### `requests.json`

One record per request, 535 in the seed. Ids are `RQ-NNNN`, renumbered in
submission order after the planner has run.

| field | type | values and meaning |
|---|---|---|
| `request_id` | string | `RQ-NNNN`; `RQ-LNNN` when filed in the session |
| `program_id` | string | |
| `requester` | string | the display name typed at intake |
| `requester_id` | string | the persona that filed it — `newRequest()` uses the actor — or, in the seed, the coordinator on duty who filed it on behalf of a requester without a persona |
| `title` | string | |
| `build` | string | |
| `build_stage` | enum | `engineering` · `release_candidate` |
| `crew` | enum | `pilot_only` · `operator_pilot` · `lone_operator` · `none`; the seed never uses `none`, the intake form offers it and R4 handles it |
| `windows` | array of enum | the requested windows in preference order; one or two in the seed |
| `airframe` | string | one of the program's airframes; a sortie's tail must match it (R3) |
| `priority` | enum | `P0` … `P3`; the seed has no `P3` request |
| `supporting_team` | string or null | never null in the seed; `newRequest()` writes `null` when the form leaves it blank |
| `submitted_at` | timestamp | |
| `needed_by` | date | |
| `plan_date` | date | the day the request is queued or planned for; never null in the seed, and a withdrawn request keeps the last plan day it held |
| `status` | enum | `submitted` · `scheduled` · `executed` · `deferred` · `withdrawn` |
| `late` | boolean | equals the R7 predicate, see [Invariants](#invariants-the-data-must-keep) |
| `deferral_reason` | enum or null | one of `meta.deferral_reasons`; set only while the status is `deferred` or `withdrawn` (then `requester_withdrew`) |
| `rider_facing` | boolean | riders aboard: set at intake, never changed later |
| `timeline[]` | array of object | the request's history, below |

A timeline event:

| field | type | values and meaning |
|---|---|---|
| `at` | timestamp | when it was stamped |
| `day` | date or null | the plan day the event refers to; `null` only on `submitted` |
| `event` | enum | `submitted` · `scheduled` · `deferred` · `rescheduled` · `reassigned` · `scrubbed` · `executed` · `withdrawn` |
| `reason` | string or null | on `deferred`, one of `meta.deferral_reasons` (R8, checked by the schema); on `withdrawn`, `requester_withdrew`; on `scrubbed`, a scrub reason, `weather` included; otherwise `null` |
| `note` | string | free text; a desk refusal keeps what was free |
| `by` | string | the actor's `user_id`; every event has one (R9) |

`eventAction()` in `src/lib/auth.js` maps each event to the permission its
actor needed (a `deferred` event with reason `late_intake` is
`request.create`), which is how I4 is checked; the map is rendered in
[permissions.md](permissions.md#timeline-events-and-the-actions-they-are).

In SQLite: `requests` (eighteen columns), `request_windows` (`seq` from 0) and
`request_events` (an integer `id` key, `by` stored as `actor_id`, and a
`CHECK` that a `deferred` row carries an enum reason).

```json
{
 "request_id": "RQ-0416",
 "program_id": "PRG-06",
 "requester": "K. Osei",
 "title": "Showcase flight — airport operator",
 "build": "v2.15.2",
 "build_stage": "release_candidate",
 "crew": "operator_pilot",
 "windows": ["PM"],
 "airframe": "Levant",
 "priority": "P0",
 "supporting_team": "Systems Integration",
 "submitted_at": "2026-06-14T10:26",
 "needed_by": "2026-06-15",
 "plan_date": "2026-06-16",
 "status": "executed",
 "late": false,
 "deferral_reason": null,
 "timeline": [
  { "at": "2026-06-14T10:26", "day": null, "event": "submitted", "reason": null, "note": "", "by": "U-08" },
  { "at": "2026-06-14T15:30", "day": "2026-06-15", "event": "deferred", "reason": "no_rider_ops",
    "note": "R10 · desk at 3:1, ratio is 2 · LV-02 and K. Halvorsen / W. Adeyemi were free — asked T. Rodrigo (PM) to waive the ratio; there is no such action",
    "by": "U-04" },
  "…"
 ],
 "requester_id": "U-08",
 "rider_facing": true
}
```

### `assignments.json`

One record per sortie, 525 in the seed. Ids are `AS-2026-NNNN`, assigned
after sorting by (date, window order, asset); the board issues
`AS-2026-LNNN`.

| field | type | values and meaning |
|---|---|---|
| `assignment_id` | string | |
| `date`, `window` | date, enum | the slot |
| `request_id` | string | |
| `asset_id` | string | the tail |
| `operator_id`, `pilot_id` | string or null | the seats; which are filled follows the request's `crew` (R4) |
| `status` | enum | `planned` · `done` · `scrubbed`; the schema also accepts `in_progress`, which neither the generator nor the app writes |
| `scrub_reason` | string or null | when scrubbed, a deferral reason or `weather` (`SCRUB_REASONS`); the schema does not constrain this column, `scrubAssignment()` does |
| `run_id` | string or null | the logged Flight run linked back to this sortie |
| `notes` | string | `""`, one of the generator's short notes (`currency check: …`, `cross-rating flight: …`, `reassigned from …`), or `assigned on the board` |
| `assigned_by` | string | the coordinator who placed it; never the requester (I1) |
| `acked` | boolean | the crew have acknowledged it; `false` only on tomorrow's sorties in the seed; `acknowledge()` sets it |

In SQLite: `assignments`, with `UNIQUE (date, asset_id, window)` and the index
`idx_assignments_date`.

```json
{
 "assignment_id": "AS-2026-0188",
 "date": "2026-05-07",
 "window": "AM",
 "request_id": "RQ-0190",
 "asset_id": "SR-02",
 "operator_id": "P-011",
 "pilot_id": null,
 "status": "done",
 "scrub_reason": null,
 "run_id": "TR-2026-0116",
 "notes": "",
 "assigned_by": "U-03",
 "acked": true
}
```

### `coverage.json`

One row per (date, window, person) on the rider desk, 321 in the seed, on
every rostered day from the window start through tomorrow — weekdays, since
the three rider operators' shift patterns (`day`, `swing`, `night`) have no
weekend windows. There is no id: the triple is the identity.

| field | type | values and meaning |
|---|---|---|
| `date`, `window` | date, enum | |
| `person_id` | string | a rider operator qualified on that date (`qualifiedOn()`) |
| `assigned_by` | string | the coordinator who rostered it; `U-04` on every seed row |
| `acked` | boolean | `false` only on tomorrow's rows in the seed |

Rows the board adds with `coverWindow()` also carry an `at` timestamp;
`uncoverWindow()` removes by the triple. In SQLite: `coverage`, primary key
`(date, window, person_id)`.

```json
{ "date": "2026-04-02", "window": "AM", "person_id": "P-018", "assigned_by": "U-04", "acked": true }
```

### `meta.json`

One object, no table: the constants the app would otherwise have to know.

| field | meaning | read by |
|---|---|---|
| `company`, `dataset`, `generated_by`, `fleet_family` | labels | nothing under `src/` |
| `window_start`, `window_end` | the first and last day of the dataset | the header in `App.jsx`; `window_start` also bounds the date pickers in `DispatchView` and `MyDayView` and the period in `CapacityView` |
| `today` | equals `window_end`; the app derives the same value as `maxDate(runsData)` and never reads this field | nothing under `src/` |
| `tomorrow` | `today + 1`, the planned day the board opens on | `App.jsx` (the default `boardDate`, intake's earliest `needed_by`, the `notBefore` of a grant), the views, `rules.test.js` |
| `airframes` | `name → { role, windows }` | `RequestsView`, `MyDayView`, `CapacityView` |
| `windows` | `AM · PM · NIGHT` | nothing; `WINDOWS` in `rules.js` is the same list |
| `cutoff_local` | `15:00` | intake in `App.jsx` and `RequestsView`; the R7 seed test |
| `deferral_reasons` | the nine R8 reasons | nothing; `DEFERRAL_REASONS` in `rules.js` is the same list |
| `rider_desk` | `{ ratio, min_per_window }`, `{ 2, 1 }` in the seed | `App.jsx` (the `desk` state handed to `makeDb()`), the seed tests |
| `app_roles` | the six roles | the persona picker in `App.jsx` |

```json
{
 "company": "Stratus Aerial",
 "dataset": "synthetic",
 "generated_by": "generate_data.py (seeded, reproducible)",
 "window_start": "2026-04-02",
 "window_end": "2026-06-30",
 "today": "2026-06-30",
 "tomorrow": "2026-07-01",
 "fleet_family": "Windz",
 "airframes": { "Levant": { "role": "workhorse — urban 2-pax", "windows": ["AM", "PM", "NIGHT"] }, "…": "…" },
 "windows": ["AM", "PM", "NIGHT"],
 "cutoff_local": "15:00",
 "deferral_reasons": ["no_rated_operator", "no_rated_pilot", "no_asset", "asset_grounded", "program_over_max", "build_not_ready", "late_intake", "requester_withdrew", "no_rider_ops"],
 "rider_desk": { "ratio": 2, "min_per_window": 1 },
 "app_roles": ["requester", "coordinator", "authority", "trainer", "crew", "observer"]
}
```

## Relationships

The links between entities, as fields on the records. The *References* table
in the rendered block lists every foreign key the schema declares, in order.

| from | to | how | who reads it |
|---|---|---|---|
| `test_runs[].request_id` | `requests` | the generator's last step: each Flight run is matched to a same-day `done` sortie that has no `run_id` yet, preferring one whose program's `SCENARIO_POOL` contains the run's scenario; `null` on every other run. 46 of the 58 Flight runs are linked in the seed (the sanity report prints the ratio) | `RunsView` filters runs by program through it |
| `assignments[].run_id` | `test_runs` | the same link from the sortie's side, set in the same step | the request drawer in `RequestsView` |
| `failures[].occurrences[]` | `test_runs` | the runs a failure groups | the linked runs in `TriageView`; `paretoRootCauses()` weights a root cause by it |
| a failure and a program | `requests.program_id` | only through `occurrences → test_runs.request_id → requests`; a failure has no program field | the programs-hit list in `TriageView`'s `Detail` (occurrence → `runs` → `request_id` → `db.request` → `db.program`) |
| `assets[].status_history[].failure_id` | `failures` | a grounding attributable to an RCCA item — arc D3 grounds `LV-03` and `LV-05` against `F-0011` | `groundingDays()` and `tailsAgainst()` in `dispatch.js`; the tail-status button in `DispatchView` opens the failure |
| `users[].person_id` | `persons` | the crew personas and the trainer are people on the roster | the `own` predicate for `sortie.ack` and the `not-self` predicate for grants in `auth.js` |
| `requests[].requester_id` | `users` | the filer | the `own` and `not-own` predicates (I1) |
| `requests[].timeline[].by`, `assignments[].assigned_by`, `coverage[].assigned_by`, `persons[].granted_by[*]` | `users` | the actor stamps; every mutation carries one (R9) | I4 (events, sorties, coverage) and I2 (grants) in `check_rules()` and in the seed tests; `actionsByRole()` |
| `requests[].program_id`, `assets[].reserved_by`, `status_history[].reserved_by` | `programs` | | R3 and R5 in `rules.js`; `validateRequest()` |
| `assignments[].request_id`, `asset_id`, `operator_id`, `pilot_id` | `requests`, `assets`, `persons` | the parts of a sortie | R1–R4 and R10 in `checkAssignment()` |
| `coverage[].person_id` | `persons` | | `deskCoverers()` |

`requests[].airframe` is a copy, not a reference: intake requires it to be one
of the program's `airframes`, and R3 (in `checkAssignment()` and in
`check_rules()`) requires a sortie's tail to have that airframe.

## Invariants the data must keep

Each invariant and where it is enforced: in the generator before anything is
written, in the app before anything is saved, in the schema when the database
is built, and in `rules.test.js` on every `npm test` — the seed block there
loads the real `src/data/*.json`.

| invariant | `generate_data.py` | `src/lib` | `sql/schema.sql` | `rules.test.js` |
|---|---|---|---|---|
| One assignment per (date, asset, window), ever; a scrubbed sortie frees its crew but not its slot | `busy_sets()` keeps a scrubbed sortie's (asset, window) busy; `check_rules()` asserts no slot is used twice (R2) | `checkAssignment()` R2 blocks a tail already in the slot, scrubbed or not, and skips scrubbed sorties only for the crew check | `UNIQUE (date, asset_id, window)` on `assignments` | the R2 block; the seed test that no non-scrubbed sortie has a blocking violation |
| Every timeline event carries `day`, the plan day it refers to; `null` only on `submitted` | `event()` writes `day` (a deferral stamped at Tuesday's cutoff is for Wednesday); in the seed, `day` is null on `submitted` events and nowhere else | every transition writes `day` — `scheduleRequest()` and `scrubRequest()` the sortie's date, `deferRequest()` the day it was for, `newRequest()`'s late-intake deferral `needed_by`; `queuedFor()`, `deferralEvents()`, `churnByDay()`, `leadTimes()` and `misattribution()` group by it, not by `at` | `request_events.day`, nullable, commented as the plan day | the R8 test asserts the deferral event's `day` |
| `late` equals the R7 predicate: submitted at or after `15:00` on the day before `needed_by`, or later | `add_request()` derives it from `submitted_at` and `CUTOFF`, or stamps a drawn-late submission at or after 15:00 the day before; the `late_intake` deferral is stamped by the filer | `isLate()`; `newRequest()` derives `late`, `plan_date` (`defaultPlanDate()`) and the `late_intake` deferral from the submission time — none is typed | `late` 0/1, commented R7; `actor_id` comment names the filer | the R7 block; the seed test asserts `late === isLate(submitted_at, needed_by, meta.cutoff_local)` for every request |
| `artifacts.video` is `null` when not applicable (Simulation) and `false` when missing | `default_artifacts()` writes `None` for Simulation; `write_sqlite()` maps `None` to `NULL` | `missingArtifacts()` in `helpers.js` counts video only when `=== false` | `art_video` nullable, commented `NULL = not applicable (Simulation)` | none — vitest does not import `test_runs.json`, and `check_rules()` does not look at artifacts; `default_artifacts()` is the only place `video` is set, so it holds by construction |
| Ratings and qualifications are effective-dated, granted by a trainer, never to oneself | `RATING_EFFECTIVE` and `DESK_QUAL_DATE`; `rated_on()` and `qualified_on()`; `check_rules()` asserts R1 per seat, a qualified coverer per row, and I2 on `granted_by` | `ratedOn()`, `qualifiedOn()`; `grantRating()` and `grantQualification()` require an effective date not before `notBefore` (`App.jsx` passes `meta.tomorrow`) and refuse the actor's own person (`not-self`) | `person_ratings.effective_from` nullable (`NULL` = before the window), `qualifications.effective_from` not null, `granted_by` references `users` | R1 "not yet effective", R10 `deskCoverers()` by date, the grant transitions, the seed I2 test |
| The flat asset fields are only today; any other day comes from `status_history` | the snapshot pass fills `status`, `reserved_by`, `status_note`, `status_since` as of `END` after the history is built | `assetStatusOn()` reads the history; R3 in `checkAssignment()` and `dailyCapacity()` in `dispatch.js` use it | `assets.status` commented `as of "today"`; `asset_status_history` holds the rest | the R3 test reads `assetStatusOn()` on the day before and the day of a grounding |
| `rider_facing` is set at intake and never later | `add_request()`: `SF` always, about a fifth of `PN` and `URC` from the desk's own RNG stream, and explicit (`rider_facing=True`) for the PN rider flights `daily_demand()` adds on Jun 15–17 to keep two queued for PM; the showcase run itself is `SF` | `validateRequest()` refuses an `SF` request without riders; `newRequest()` stores `Boolean(f.rider_facing)`; no transition touches it | `rider_facing` not null, 0/1, commented R10 | the intake `SF` test; the seed I5 test |
| The desk's `ratio` and `min_per_window` live in `meta.rider_desk`, bounded 1–4, with no waiver | `RIDER_DESK` is exported as `meta.rider_desk`; `desk_check()` and the I5 assertion in `check_rules()` read it | `DEFAULT_DESK` when the seed does not say; `setDeskSettings()` keeps exactly two keys inside `DESK_BOUNDS`; `App.jsx` seeds its `desk` state from `meta.rider_desk` | no table; query 10 in `sql/analytics/` writes the ratio as a literal | `setDeskSettings()` bounds and keys; the seed I5 test against `meta.rider_desk` |
| A deferral carries a reason from the enum (R8) | `defer()` asserts the reason; `check_rules()` re-checks every `deferred` event | `deferRequest()`, `scrubAssignment()` and `scrubRequest()` call `assertReason()` and throw | the `CHECK` on `requests.deferral_reason` and on `deferred` rows of `request_events` | the R8 block; the seed test over every timeline |
| Every actor stamp is a persona whose role permits the action (I4); nobody assigns their own request (I1) | `permits()` over every event, sortie and coverage row in `check_rules()`; `assigned_by != requester_id` | every transition calls `authorize()` first; the `not-own` predicate in `auth.js` | `actor_id`, `assigned_by` not null and referencing `users`; comments name I1 and R9 | the seed I4 and I1 tests |
| Today is the last run date; tomorrow exists as a planned day | `END` is the last run day; `TOMORROW = END + 1` carries planned sorties and coverage rows, unacked | `App.jsx` sets `today = maxDate(runsData)` and opens the board on `meta.tomorrow` | SQL takes `max(test_runs.date)` | the seed test that tomorrow's rail holds exactly two unscheduled P0 |

## Changing the shape

A field or an entity is one thing in five places; change them together.

1. **The generator.** Add the field where the record is built — `add_run()`,
   `add_failure()`, `add_request()`, `new_assignment()`, `event()`, the asset
   and person loops, or the `USERS` literal — and derive it there rather than
   typing it. Mind the RNG streams: a new draw in the RCCA half re-rolls every
   run and failure after it, and a new `drng` draw before Jun 15 re-rolls arcs
   D1–D3 (see [seed-and-arcs.md](seed-and-arcs.md)). If a rule should hold
   over the field, assert it in `check_rules()`.
2. **The schema.** Add the column or table to `sql/schema.sql` with its
   `CHECK` and references, and the matching `INSERT` in `write_sqlite()`;
   the `?` placeholders are positional, so the count must match the column
   count or the write fails.
3. **Regenerate.** `npm run data` from the project root rewrites
   `src/data/*.json`, rebuilds `data/stratus.sqlite` and re-renders
   `docs/analytics.md`; `check_rules()` runs before the write and the sanity
   report's assertions after it. Read the report.
4. **The consumers.** `makeDb()` if a new entity needs an index; the views
   that render the field; the derivations in `dispatch.js` and `helpers.js`;
   `rules.js` if a rule reads it; the fixture builders in `rules.test.js`
   (`person()`, `req()`, `cand()`, the asset literals) and the seed block.
5. **The gates.** `npm test`; `npm run docs`, which re-renders the block
   below from the schema, then `npm run docs:check`; and, if a query under
   `sql/analytics/` reads the field, the query and the re-rendered notebook.
   Commit the regenerated `src/data/*.json`, `docs/analytics.md` and the docs
   by explicit path.

An enum value follows the same path in miniature. A new deferral reason goes
into `DEFERRAL_REASONS` in both `generate_data.py` and `rules.js` (with a
`REASON_LABELS` entry), into the two `CHECK` lists in the schema, and
`meta.deferral_reasons` follows the generator's list; `02_deferrals_by_cause`
then groups on it. A new timeline event needs `EVENT_ACTION` in `auth.js` and
the generator's mirror of it, the `request_events.event` `CHECK`, the `CASE`
in `09_actions_by_role`, and its twin `column()` inside `actionsByRole()` in
`dispatch.js`, which drops an event it does not know.

## Schema

<!-- rendered:begin schema (scripts/render_docs.py) -->
### Tables

21 tables, in declaration order. Columns, keys and references come from `PRAGMA table_info`, `PRAGMA index_list`/`index_info` and `PRAGMA foreign_key_list` on a database built from `sql/schema.sql`; the DDL under each table is what SQLite stored in `sqlite_master`, comments and `CHECK` constraints included. The `null` column is what `table_info` reports: SQLite leaves a `TEXT PRIMARY KEY` nullable unless `NOT NULL` is spelled out, so single-column text keys read `null` here; the generator never writes a null id.

#### `failures`

| column | type | null | default | key | references |
|---|---|---|---|---|---|
| `failure_id` | TEXT | null | · | PK | · |
| `title` | TEXT | not null | · | · | · |
| `severity` | TEXT | not null | · | · | · |
| `triage_status` | TEXT | not null | · | · | · |
| `team` | TEXT | not null | · | · | · |
| `root_cause` | TEXT | null | · | · | · |
| `opened` | TEXT | not null | · | · | · |
| `resolved` | TEXT | null | · | · | · |
| `corrective_action` | TEXT | null | · | · | · |

<details><summary>DDL</summary>

```sql
CREATE TABLE failures (
  failure_id        TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  severity          TEXT NOT NULL CHECK (severity IN ('P0','P1','P2','P3')),
  triage_status     TEXT NOT NULL CHECK (triage_status IN ('Open','Investigating','Corrective Action','Verified')),
  team              TEXT NOT NULL,
  root_cause        TEXT,                       -- NULL until determined
  opened            TEXT NOT NULL,
  resolved          TEXT,                       -- stamped only when Verified
  corrective_action TEXT
);
```

</details>

#### `failure_whys`

| column | type | null | default | key | references |
|---|---|---|---|---|---|
| `failure_id` | TEXT | not null | · | PK 1 | failures(failure_id) |
| `seq` | INTEGER | not null | · | PK 2 | · |
| `text` | TEXT | not null | · | · | · |

<details><summary>DDL</summary>

```sql
CREATE TABLE failure_whys (
  failure_id TEXT NOT NULL REFERENCES failures(failure_id),
  seq        INTEGER NOT NULL,
  text       TEXT NOT NULL,
  PRIMARY KEY (failure_id, seq)
);
```

</details>

#### `programs`

| column | type | null | default | key | references |
|---|---|---|---|---|---|
| `program_id` | TEXT | null | · | PK | · |
| `code` | TEXT | not null | · | UNIQUE | · |
| `name` | TEXT | not null | · | · | · |
| `lead` | TEXT | null | · | · | · |
| `priority_default` | TEXT | not null | · | · | · |
| `standing` | INTEGER | not null | · | · | · |
| `asset_min` | INTEGER | not null | · | · | · |
| `asset_max` | INTEGER | not null | · | · | · |
| `cutoff_local` | TEXT | not null | · | · | · |

<details><summary>DDL</summary>

```sql
CREATE TABLE programs (
  program_id       TEXT PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  lead             TEXT,
  priority_default TEXT NOT NULL CHECK (priority_default IN ('P0','P1','P2','P3')),
  standing         INTEGER NOT NULL CHECK (standing IN (0,1)),
  asset_min        INTEGER NOT NULL,            -- daily tail target, lower bound (R5)
  asset_max        INTEGER NOT NULL,            -- daily tail target, upper bound (R5)
  cutoff_local     TEXT NOT NULL                -- intake cutoff for the next day (R7)
);
```

</details>

#### `program_airframes`

| column | type | null | default | key | references |
|---|---|---|---|---|---|
| `program_id` | TEXT | not null | · | PK 1 | programs(program_id) |
| `airframe` | TEXT | not null | · | PK 2 | · |

<details><summary>DDL</summary>

```sql
CREATE TABLE program_airframes (
  program_id TEXT NOT NULL REFERENCES programs(program_id),
  airframe   TEXT NOT NULL,
  PRIMARY KEY (program_id, airframe)
);
```

</details>

#### `assets`

| column | type | null | default | key | references |
|---|---|---|---|---|---|
| `asset_id` | TEXT | null | · | PK | · |
| `airframe` | TEXT | not null | · | · | · |
| `config` | TEXT | not null | · | · | · |
| `status` | TEXT | not null | · | · | · |
| `reserved_by` | TEXT | null | · | · | programs(program_id) |
| `status_note` | TEXT | null | · | · | · |
| `status_since` | TEXT | null | · | · | · |

<details><summary>DDL</summary>

```sql
CREATE TABLE assets (                            -- tails
  asset_id     TEXT PRIMARY KEY,
  airframe     TEXT NOT NULL,
  config       TEXT NOT NULL CHECK (config IN ('instrumented','baseline')),
  status       TEXT NOT NULL CHECK (status IN ('available','grounded','maintenance','reserved')),  -- as of "today"
  reserved_by  TEXT REFERENCES programs(program_id),
  status_note  TEXT,
  status_since TEXT
);
```

</details>

#### `asset_windows`

| column | type | null | default | key | references |
|---|---|---|---|---|---|
| `asset_id` | TEXT | not null | · | PK 1 | assets(asset_id) |
| `window` | TEXT | not null | · | PK 2 | · |

<details><summary>DDL</summary>

```sql
CREATE TABLE asset_windows (                     -- operating windows per tail
  asset_id TEXT NOT NULL REFERENCES assets(asset_id),
  window   TEXT NOT NULL CHECK (window IN ('AM','PM','NIGHT')),
  PRIMARY KEY (asset_id, window)
);
```

</details>

#### `asset_status_history`

| column | type | null | default | key | references |
|---|---|---|---|---|---|
| `id` | INTEGER | null | · | PK | · |
| `asset_id` | TEXT | not null | · | · | assets(asset_id) |
| `status` | TEXT | not null | · | · | · |
| `date_from` | TEXT | not null | · | · | · |
| `date_to` | TEXT | null | · | · | · |
| `reserved_by` | TEXT | null | · | · | programs(program_id) |
| `note` | TEXT | null | · | · | · |
| `failure_id` | TEXT | null | · | · | failures(failure_id) |

<details><summary>DDL</summary>

```sql
CREATE TABLE asset_status_history (              -- groundings, maintenance, reservations
  id          INTEGER PRIMARY KEY,
  asset_id    TEXT NOT NULL REFERENCES assets(asset_id),
  status      TEXT NOT NULL CHECK (status IN ('grounded','maintenance','reserved')),
  date_from   TEXT NOT NULL,
  date_to     TEXT,                              -- NULL = still in effect
  reserved_by TEXT REFERENCES programs(program_id),
  note        TEXT,
  failure_id  TEXT REFERENCES failures(failure_id)   -- the loop: a grounding attributable to an RCCA item
);
```

</details>

#### `persons`

| column | type | null | default | key | references |
|---|---|---|---|---|---|
| `person_id` | TEXT | null | · | PK | · |
| `name` | TEXT | not null | · | · | · |
| `self_pilot` | INTEGER | not null | · | · | · |

<details><summary>DDL</summary>

```sql
CREATE TABLE persons (
  person_id  TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  self_pilot INTEGER NOT NULL CHECK (self_pilot IN (0,1))
);
```

</details>

#### `person_roles`

| column | type | null | default | key | references |
|---|---|---|---|---|---|
| `person_id` | TEXT | not null | · | PK 1 | persons(person_id) |
| `role` | TEXT | not null | · | PK 2 | · |

<details><summary>DDL</summary>

```sql
CREATE TABLE person_roles (                      -- seats and desks: a person can hold more than one
  person_id TEXT NOT NULL REFERENCES persons(person_id),
  role      TEXT NOT NULL CHECK (role IN ('operator','pilot','rider_ops')),
  PRIMARY KEY (person_id, role)
);
```

</details>

#### `users`

| column | type | null | default | key | references |
|---|---|---|---|---|---|
| `user_id` | TEXT | null | · | PK | · |
| `name` | TEXT | not null | · | · | · |
| `title` | TEXT | not null | · | · | · |
| `role` | TEXT | not null | · | · | · |
| `person_id` | TEXT | null | · | UNIQUE | persons(person_id) |

<details><summary>DDL</summary>

```sql
CREATE TABLE users (                             -- personas: authorization without authentication
  user_id   TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  title     TEXT NOT NULL,                       -- display
  role      TEXT NOT NULL CHECK (role IN ('requester','coordinator','authority','trainer','crew','observer')),  -- behavior
  person_id TEXT UNIQUE REFERENCES persons(person_id)   -- crew personas (and the trainer, a check pilot) are people on the roster
);
```

</details>

#### `user_scopes`

| column | type | null | default | key | references |
|---|---|---|---|---|---|
| `user_id` | TEXT | not null | · | PK 1 | users(user_id) |
| `scope` | TEXT | not null | · | PK 2 | · |

<details><summary>DDL</summary>

```sql
CREATE TABLE user_scopes (                       -- authority scope: a program_id, 'desk', or 'all'
  user_id TEXT NOT NULL REFERENCES users(user_id),
  scope   TEXT NOT NULL CHECK (scope IN ('all','desk') OR scope LIKE 'PRG-%'),
  PRIMARY KEY (user_id, scope)
);
```

</details>

#### `person_ratings`

| column | type | null | default | key | references |
|---|---|---|---|---|---|
| `person_id` | TEXT | not null | · | PK 1 | persons(person_id) |
| `airframe` | TEXT | not null | · | PK 2 | · |
| `effective_from` | TEXT | null | · | · | · |
| `granted_by` | TEXT | null | · | · | users(user_id) |

<details><summary>DDL</summary>

```sql
CREATE TABLE person_ratings (                    -- type ratings; effective_from NULL = before the window
  person_id      TEXT NOT NULL REFERENCES persons(person_id),
  airframe       TEXT NOT NULL,
  effective_from TEXT,
  granted_by     TEXT REFERENCES users(user_id), -- the trainer, never the person themself (I2)
  PRIMARY KEY (person_id, airframe)
);
```

</details>

#### `qualifications`

| column | type | null | default | key | references |
|---|---|---|---|---|---|
| `person_id` | TEXT | not null | · | PK 1 | persons(person_id) |
| `kind` | TEXT | not null | · | PK 2 | · |
| `effective_from` | TEXT | not null | · | · | · |
| `granted_by` | TEXT | null | · | · | users(user_id) |

<details><summary>DDL</summary>

```sql
CREATE TABLE qualifications (                    -- desk qualifications, effective-dated like ratings
  person_id      TEXT NOT NULL REFERENCES persons(person_id),
  kind           TEXT NOT NULL CHECK (kind IN ('rider_ops')),
  effective_from TEXT NOT NULL,
  granted_by     TEXT REFERENCES users(user_id),
  PRIMARY KEY (person_id, kind)
);
```

</details>

#### `person_availability`

| column | type | null | default | key | references |
|---|---|---|---|---|---|
| `person_id` | TEXT | not null | · | PK 1 | persons(person_id) |
| `date` | TEXT | not null | · | PK 2 | · |
| `window` | TEXT | not null | · | PK 3 | · |

<details><summary>DDL</summary>

```sql
CREATE TABLE person_availability (
  person_id TEXT NOT NULL REFERENCES persons(person_id),
  date      TEXT NOT NULL,
  window    TEXT NOT NULL CHECK (window IN ('AM','PM','NIGHT')),
  PRIMARY KEY (person_id, date, window)
);
```

</details>

#### `coverage`

| column | type | null | default | key | references |
|---|---|---|---|---|---|
| `date` | TEXT | not null | · | PK 1 | · |
| `window` | TEXT | not null | · | PK 2 | · |
| `person_id` | TEXT | not null | · | PK 3 | persons(person_id) |
| `assigned_by` | TEXT | not null | · | · | users(user_id) |
| `acked` | INTEGER | not null | · | · | · |

<details><summary>DDL</summary>

```sql
CREATE TABLE coverage (                          -- the rider desk: who covers a window on comms
  date        TEXT NOT NULL,
  window      TEXT NOT NULL CHECK (window IN ('AM','PM','NIGHT')),
  person_id   TEXT NOT NULL REFERENCES persons(person_id),
  assigned_by TEXT NOT NULL REFERENCES users(user_id),
  acked       INTEGER NOT NULL CHECK (acked IN (0,1)),
  PRIMARY KEY (date, window, person_id)          -- nobody covers a window twice (R2, extended)
);
```

</details>

#### `requests`

| column | type | null | default | key | references |
|---|---|---|---|---|---|
| `request_id` | TEXT | null | · | PK | · |
| `program_id` | TEXT | not null | · | · | programs(program_id) |
| `requester` | TEXT | not null | · | · | · |
| `title` | TEXT | not null | · | · | · |
| `build` | TEXT | not null | · | · | · |
| `build_stage` | TEXT | not null | · | · | · |
| `crew` | TEXT | not null | · | · | · |
| `airframe` | TEXT | not null | · | · | · |
| `priority` | TEXT | not null | · | · | · |
| `supporting_team` | TEXT | null | · | · | · |
| `submitted_at` | TEXT | not null | · | · | · |
| `needed_by` | TEXT | not null | · | · | · |
| `plan_date` | TEXT | null | · | · | · |
| `status` | TEXT | not null | · | · | · |
| `late` | INTEGER | not null | · | · | · |
| `deferral_reason` | TEXT | null | · | · | · |
| `rider_facing` | INTEGER | not null | · | · | · |
| `requester_id` | TEXT | not null | · | · | users(user_id) |

Indexes: `idx_requests_program` — `requests(program_id, status)`

<details><summary>DDL</summary>

```sql
CREATE TABLE requests (
  request_id      TEXT PRIMARY KEY,
  program_id      TEXT NOT NULL REFERENCES programs(program_id),
  requester       TEXT NOT NULL,
  title           TEXT NOT NULL,
  build           TEXT NOT NULL,
  build_stage     TEXT NOT NULL CHECK (build_stage IN ('engineering','release_candidate')),
  crew            TEXT NOT NULL CHECK (crew IN ('none','pilot_only','operator_pilot','lone_operator')),
  airframe        TEXT NOT NULL,
  priority        TEXT NOT NULL CHECK (priority IN ('P0','P1','P2','P3')),
  supporting_team TEXT,
  submitted_at    TEXT NOT NULL,
  needed_by       TEXT NOT NULL,
  plan_date       TEXT,                          -- day the request is queued/planned for
  status          TEXT NOT NULL CHECK (status IN ('submitted','scheduled','executed','deferred','withdrawn')),
  late            INTEGER NOT NULL CHECK (late IN (0,1)),   -- submitted after cutoff (R7)
  deferral_reason TEXT CHECK (deferral_reason IS NULL OR deferral_reason IN
    ('no_rated_operator','no_rated_pilot','no_asset','asset_grounded',
     'program_over_max','build_not_ready','late_intake','requester_withdrew','no_rider_ops')),
  rider_facing    INTEGER NOT NULL CHECK (rider_facing IN (0,1)),   -- riders aboard: the desk must cover it (R10)
  requester_id    TEXT NOT NULL REFERENCES users(user_id)           -- the persona that filed it, or the coordinator on their behalf
);
```

</details>

#### `request_windows`

| column | type | null | default | key | references |
|---|---|---|---|---|---|
| `request_id` | TEXT | not null | · | PK 1 | requests(request_id) |
| `seq` | INTEGER | not null | · | PK 2 | · |
| `window` | TEXT | not null | · | · | · |

<details><summary>DDL</summary>

```sql
CREATE TABLE request_windows (                   -- requested windows, in preference order
  request_id TEXT NOT NULL REFERENCES requests(request_id),
  seq        INTEGER NOT NULL,
  window     TEXT NOT NULL CHECK (window IN ('AM','PM','NIGHT')),
  PRIMARY KEY (request_id, seq)
);
```

</details>

#### `request_events`

| column | type | null | default | key | references |
|---|---|---|---|---|---|
| `id` | INTEGER | null | · | PK | · |
| `request_id` | TEXT | not null | · | · | requests(request_id) |
| `at` | TEXT | not null | · | · | · |
| `day` | TEXT | null | · | · | · |
| `event` | TEXT | not null | · | · | · |
| `reason` | TEXT | null | · | · | · |
| `note` | TEXT | null | · | · | · |
| `actor_id` | TEXT | not null | · | · | users(user_id) |

Indexes: `idx_events_request` — `request_events(request_id, at)`

<details><summary>DDL</summary>

```sql
CREATE TABLE request_events (                    -- the request timeline; deferrals carry a reason (R8)
  id         INTEGER PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(request_id),
  at         TEXT NOT NULL,
  day        TEXT,                              -- the plan day the event refers to (NULL for submission)
  event      TEXT NOT NULL CHECK (event IN
    ('submitted','scheduled','deferred','rescheduled','reassigned','scrubbed','executed','withdrawn')),
  reason     TEXT,
  note       TEXT,
  actor_id   TEXT NOT NULL REFERENCES users(user_id),   -- every event carries who did it (R9); a late_intake deferral is stamped by the filer, as part of intake
  CHECK (event <> 'deferred' OR reason IN
    ('no_rated_operator','no_rated_pilot','no_asset','asset_grounded',
     'program_over_max','build_not_ready','late_intake','requester_withdrew','no_rider_ops'))
);
```

</details>

#### `test_runs`

| column | type | null | default | key | references |
|---|---|---|---|---|---|
| `run_id` | TEXT | null | · | PK | · |
| `date` | TEXT | not null | · | · | · |
| `pipeline` | TEXT | not null | · | · | · |
| `scenario` | TEXT | not null | · | · | · |
| `build` | TEXT | not null | · | · | · |
| `status` | TEXT | not null | · | · | · |
| `duration_min` | INTEGER | not null | · | · | · |
| `owner` | TEXT | not null | · | · | · |
| `art_logs` | INTEGER | not null | · | · | · |
| `art_telemetry` | INTEGER | not null | · | · | · |
| `art_video` | INTEGER | null | · | · | · |
| `request_id` | TEXT | null | · | · | requests(request_id) |

<details><summary>DDL</summary>

```sql
CREATE TABLE test_runs (
  run_id        TEXT PRIMARY KEY,
  date          TEXT NOT NULL,
  pipeline      TEXT NOT NULL CHECK (pipeline IN ('Simulation','HIL Bench','Flight')),
  scenario      TEXT NOT NULL,
  build         TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pass','fail','blocked')),
  duration_min  INTEGER NOT NULL,
  owner         TEXT NOT NULL,
  art_logs      INTEGER NOT NULL,
  art_telemetry INTEGER NOT NULL,
  art_video     INTEGER,                         -- NULL = not applicable (Simulation)
  request_id    TEXT REFERENCES requests(request_id)   -- the sortie this run came from, if any
);
```

</details>

#### `assignments`

| column | type | null | default | key | references |
|---|---|---|---|---|---|
| `assignment_id` | TEXT | null | · | PK | · |
| `date` | TEXT | not null | · | UNIQUE (date, asset_id, window) | · |
| `window` | TEXT | not null | · | UNIQUE (date, asset_id, window) | · |
| `request_id` | TEXT | not null | · | · | requests(request_id) |
| `asset_id` | TEXT | not null | · | UNIQUE (date, asset_id, window) | assets(asset_id) |
| `operator_id` | TEXT | null | · | · | persons(person_id) |
| `pilot_id` | TEXT | null | · | · | persons(person_id) |
| `status` | TEXT | not null | · | · | · |
| `scrub_reason` | TEXT | null | · | · | · |
| `run_id` | TEXT | null | · | · | test_runs(run_id) |
| `notes` | TEXT | null | · | · | · |
| `assigned_by` | TEXT | not null | · | · | users(user_id) |
| `acked` | INTEGER | not null | · | · | · |

Indexes: `idx_assignments_date` — `assignments(date, window)`

<details><summary>DDL</summary>

```sql
CREATE TABLE assignments (                       -- one per (date, asset, window)
  assignment_id TEXT PRIMARY KEY,
  date          TEXT NOT NULL,
  window        TEXT NOT NULL CHECK (window IN ('AM','PM','NIGHT')),
  request_id    TEXT NOT NULL REFERENCES requests(request_id),
  asset_id      TEXT NOT NULL REFERENCES assets(asset_id),
  operator_id   TEXT REFERENCES persons(person_id),
  pilot_id      TEXT REFERENCES persons(person_id),
  status        TEXT NOT NULL CHECK (status IN ('planned','in_progress','done','scrubbed')),
  scrub_reason  TEXT,
  run_id        TEXT REFERENCES test_runs(run_id),
  notes         TEXT,
  assigned_by   TEXT NOT NULL REFERENCES users(user_id),   -- never the requester (I1)
  acked         INTEGER NOT NULL CHECK (acked IN (0,1)),   -- the crew have acknowledged it
  UNIQUE (date, asset_id, window)                -- one per slot, scrubbed or not
);
```

</details>

#### `failure_occurrences`

| column | type | null | default | key | references |
|---|---|---|---|---|---|
| `failure_id` | TEXT | not null | · | PK 1 | failures(failure_id) |
| `run_id` | TEXT | not null | · | PK 2 | test_runs(run_id) |

<details><summary>DDL</summary>

```sql
CREATE TABLE failure_occurrences (
  failure_id TEXT NOT NULL REFERENCES failures(failure_id),
  run_id     TEXT NOT NULL REFERENCES test_runs(run_id),
  PRIMARY KEY (failure_id, run_id)
);
```

</details>

### References

31 foreign keys (`PRAGMA foreign_key_list`), in declaration order; `PRAGMA foreign_keys = ON` is the first statement of the schema, so they are enforced.

| from | to |
|---|---|
| `failure_whys.failure_id` | `failures.failure_id` |
| `program_airframes.program_id` | `programs.program_id` |
| `assets.reserved_by` | `programs.program_id` |
| `asset_windows.asset_id` | `assets.asset_id` |
| `asset_status_history.asset_id` | `assets.asset_id` |
| `asset_status_history.reserved_by` | `programs.program_id` |
| `asset_status_history.failure_id` | `failures.failure_id` |
| `person_roles.person_id` | `persons.person_id` |
| `users.person_id` | `persons.person_id` |
| `user_scopes.user_id` | `users.user_id` |
| `person_ratings.person_id` | `persons.person_id` |
| `person_ratings.granted_by` | `users.user_id` |
| `qualifications.person_id` | `persons.person_id` |
| `qualifications.granted_by` | `users.user_id` |
| `person_availability.person_id` | `persons.person_id` |
| `coverage.person_id` | `persons.person_id` |
| `coverage.assigned_by` | `users.user_id` |
| `requests.program_id` | `programs.program_id` |
| `requests.requester_id` | `users.user_id` |
| `request_windows.request_id` | `requests.request_id` |
| `request_events.request_id` | `requests.request_id` |
| `request_events.actor_id` | `users.user_id` |
| `test_runs.request_id` | `requests.request_id` |
| `assignments.request_id` | `requests.request_id` |
| `assignments.asset_id` | `assets.asset_id` |
| `assignments.operator_id` | `persons.person_id` |
| `assignments.pilot_id` | `persons.person_id` |
| `assignments.run_id` | `test_runs.run_id` |
| `assignments.assigned_by` | `users.user_id` |
| `failure_occurrences.failure_id` | `failures.failure_id` |
| `failure_occurrences.run_id` | `test_runs.run_id` |

### Indexes

| index | table | statement |
|---|---|---|
| `idx_assignments_date` | `assignments` | `CREATE INDEX idx_assignments_date ON assignments(date, window)` |
| `idx_requests_program` | `requests` | `CREATE INDEX idx_requests_program ON requests(program_id, status)` |
| `idx_events_request` | `request_events` | `CREATE INDEX idx_events_request ON request_events(request_id, at)` |
<!-- rendered:end schema -->
