-- Stratus Aerial · Test Operations Platform — seed database schema.
-- Written by generate_data.py into data/stratus.sqlite from the same seed that
-- produces src/data/*.json. The app renders from JSON; this database exists so
-- the analytics questions can be answered in reviewable SQL (sql/analytics/).
--
-- Conventions: dates are ISO 'YYYY-MM-DD' text, timestamps 'YYYY-MM-DDTHH:MM'
-- (local), booleans are 0/1 integers. Foreign keys are enforced.

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------- RCCA (execute)
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

CREATE TABLE failure_whys (
  failure_id TEXT NOT NULL REFERENCES failures(failure_id),
  seq        INTEGER NOT NULL,
  text       TEXT NOT NULL,
  PRIMARY KEY (failure_id, seq)
);

-- ------------------------------------------------------------- dispatch (plan)
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

CREATE TABLE program_airframes (
  program_id TEXT NOT NULL REFERENCES programs(program_id),
  airframe   TEXT NOT NULL,
  PRIMARY KEY (program_id, airframe)
);

CREATE TABLE assets (                            -- tails
  asset_id     TEXT PRIMARY KEY,
  airframe     TEXT NOT NULL,
  config       TEXT NOT NULL CHECK (config IN ('instrumented','baseline')),
  status       TEXT NOT NULL CHECK (status IN ('available','grounded','maintenance','reserved')),  -- as of "today"
  reserved_by  TEXT REFERENCES programs(program_id),
  status_note  TEXT,
  status_since TEXT
);

CREATE TABLE asset_windows (                     -- operating windows per tail
  asset_id TEXT NOT NULL REFERENCES assets(asset_id),
  window   TEXT NOT NULL CHECK (window IN ('AM','PM','NIGHT')),
  PRIMARY KEY (asset_id, window)
);

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

CREATE TABLE persons (
  person_id  TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  self_pilot INTEGER NOT NULL CHECK (self_pilot IN (0,1))
);

CREATE TABLE person_roles (                      -- seats and desks: a person can hold more than one
  person_id TEXT NOT NULL REFERENCES persons(person_id),
  role      TEXT NOT NULL CHECK (role IN ('operator','pilot','rider_ops')),
  PRIMARY KEY (person_id, role)
);

CREATE TABLE users (                             -- personas: authorization without authentication
  user_id   TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  title     TEXT NOT NULL,                       -- display
  role      TEXT NOT NULL CHECK (role IN ('requester','coordinator','authority','trainer','crew','observer')),  -- behavior
  person_id TEXT UNIQUE REFERENCES persons(person_id)   -- crew personas (and the trainer, a check pilot) are people on the roster
);

CREATE TABLE user_scopes (                       -- authority scope: a program_id, 'desk', or 'all'
  user_id TEXT NOT NULL REFERENCES users(user_id),
  scope   TEXT NOT NULL CHECK (scope IN ('all','desk') OR scope LIKE 'PRG-%'),
  PRIMARY KEY (user_id, scope)
);

CREATE TABLE person_ratings (                    -- type ratings; effective_from NULL = before the window
  person_id      TEXT NOT NULL REFERENCES persons(person_id),
  airframe       TEXT NOT NULL,
  effective_from TEXT,
  granted_by     TEXT REFERENCES users(user_id), -- the trainer, never the person themself (I2)
  PRIMARY KEY (person_id, airframe)
);

CREATE TABLE qualifications (                    -- desk qualifications, effective-dated like ratings
  person_id      TEXT NOT NULL REFERENCES persons(person_id),
  kind           TEXT NOT NULL CHECK (kind IN ('rider_ops')),
  effective_from TEXT NOT NULL,
  granted_by     TEXT REFERENCES users(user_id),
  PRIMARY KEY (person_id, kind)
);

CREATE TABLE person_availability (
  person_id TEXT NOT NULL REFERENCES persons(person_id),
  date      TEXT NOT NULL,
  window    TEXT NOT NULL CHECK (window IN ('AM','PM','NIGHT')),
  PRIMARY KEY (person_id, date, window)
);

CREATE TABLE coverage (                          -- the rider desk: who covers a window on comms
  date        TEXT NOT NULL,
  window      TEXT NOT NULL CHECK (window IN ('AM','PM','NIGHT')),
  person_id   TEXT NOT NULL REFERENCES persons(person_id),
  assigned_by TEXT NOT NULL REFERENCES users(user_id),
  acked       INTEGER NOT NULL CHECK (acked IN (0,1)),
  PRIMARY KEY (date, window, person_id)          -- nobody covers a window twice (R2, extended)
);

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

CREATE TABLE request_windows (                   -- requested windows, in preference order
  request_id TEXT NOT NULL REFERENCES requests(request_id),
  seq        INTEGER NOT NULL,
  window     TEXT NOT NULL CHECK (window IN ('AM','PM','NIGHT')),
  PRIMARY KEY (request_id, seq)
);

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

CREATE TABLE failure_occurrences (
  failure_id TEXT NOT NULL REFERENCES failures(failure_id),
  run_id     TEXT NOT NULL REFERENCES test_runs(run_id),
  PRIMARY KEY (failure_id, run_id)
);

CREATE INDEX idx_assignments_date ON assignments(date, window);
CREATE INDEX idx_requests_program ON requests(program_id, status);
CREATE INDEX idx_events_request ON request_events(request_id, at);
