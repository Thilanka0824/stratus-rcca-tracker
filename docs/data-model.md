# Data model

The explanatory half of this page is being written. The schema below is
rendered from `sql/schema.sql` through SQLite's own pragmas by `npm run docs`
and checked by `npm run docs:check`.

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
