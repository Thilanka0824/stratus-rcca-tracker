"""
Stratus Aerial — RCCA Test Tracker
Synthetic data generator.

Generates ~90 days of test-execution data for a fictional autonomous
drone-robotaxi company, with three deliberately seeded narrative arcs:

  ARC 1  "Gusty Crosswind" precision-landing failures, SIMULATION ONLY,
         across many builds -> root cause: Scenario Definition
         (unit mismatch: config in m/s, wind service reads knots).
  ARC 2  Flight telemetry-upload gaps in a 3-week window
         -> root cause: Data / Logging (uploader race on rapid disarm).
  ARC 3  Genuine software regression in builds v2.15.0/.1 spiking
         "Obstacle Avoidance - Dynamic Intruder" failures on HIL + Flight,
         fixed in v2.15.2 -> visible dip + recovery in the trend chart.

All data is synthetic. Seeded for reproducibility.
"""

import json
import random
from datetime import date, timedelta

random.seed(42)

END = date(2026, 6, 30)
START = END - timedelta(days=89)  # 90 days inclusive

PIPELINES = ["Simulation", "HIL Bench", "Flight"]
PIPELINE_WEIGHTS = [0.52, 0.28, 0.20]

SCENARIOS = [
    "Precision Landing — Gusty Crosswind",
    "Precision Landing — Nominal",
    "Obstacle Avoidance — Dynamic Intruder",
    "Obstacle Avoidance — Static Field",
    "Comms Loss Failover",
    "GPS-Denied Navigation — Urban Canyon",
    "Battery Failsafe — Forced RTL",
    "Cabin Door Interlock Sequence",
    "Vertiport Approach — Traffic Sequencing",
    "Emergency Landing Site Selection",
    "Payload Imbalance Compensation",
    "Night Ops — Beacon Tracking",
]

OWNERS = ["A. Okafor", "J. Meyer", "S. Tanaka", "L. Alvarez",
          "P. Nguyen", "D. Whitfield", "M. Haddad", "K. Osei"]

TEAMS = ["Autonomy", "Flight Controls", "Test Infrastructure",
         "Data Platform", "Hardware", "Systems Integration"]

ROOT_CAUSES = ["Software Regression", "Scenario Definition", "Test Environment",
               "Data / Logging", "Hardware", "Process Error"]

# Build versions mapped to date windows (later window = later build)
BUILD_WINDOWS = [
    ("v2.13.2", date(2026, 4, 2),  date(2026, 4, 18)),
    ("v2.13.4", date(2026, 4, 19), date(2026, 4, 30)),
    ("v2.14.0", date(2026, 5, 1),  date(2026, 5, 14)),
    ("v2.14.1", date(2026, 5, 15), date(2026, 5, 26)),
    ("v2.14.3", date(2026, 5, 27), date(2026, 6, 1)),
    ("v2.15.0", date(2026, 6, 2),  date(2026, 6, 7)),   # ARC 3 regression in
    ("v2.15.1", date(2026, 6, 8),  date(2026, 6, 12)),  # ARC 3 still broken
    ("v2.15.2", date(2026, 6, 13), date(2026, 6, 21)),  # ARC 3 fixed
    ("v2.16.0", date(2026, 6, 22), date(2026, 6, 27)),
    ("v2.16.1", date(2026, 6, 28), date(2026, 6, 30)),
]

TELEMETRY_GAP_START = date(2026, 5, 18)   # ARC 2 window
TELEMETRY_GAP_END = date(2026, 6, 7)


def build_for(d):
    for b, s, e in BUILD_WINDOWS:
        if s <= d <= e:
            return b
    return BUILD_WINDOWS[0][0]


def iso(d):
    return d.isoformat()


runs = []
run_seq = 0


def add_run(d, pipeline, scenario, status, artifacts, duration=None, owner=None):
    global run_seq
    run_seq += 1
    runs.append({
        "run_id": f"TR-2026-{run_seq:04d}",
        "date": iso(d),
        "pipeline": pipeline,
        "scenario": scenario,
        "build": build_for(d),
        "status": status,                      # pass | fail | blocked
        "duration_min": duration or (
            random.randint(4, 18) if pipeline == "Simulation"
            else random.randint(15, 45) if pipeline == "HIL Bench"
            else random.randint(22, 60)),
        "owner": owner or random.choice(OWNERS),
        "artifacts": artifacts,                # {logs, telemetry, video(bool|None)}
    })
    return runs[-1]


def default_artifacts(pipeline, d):
    logs = random.random() > 0.02
    video = None if pipeline == "Simulation" else (random.random() > 0.04)
    # ARC 2: telemetry race drops flight telemetry in the gap window
    if pipeline == "Flight" and TELEMETRY_GAP_START <= d <= TELEMETRY_GAP_END:
        telemetry = random.random() > 0.42
    else:
        telemetry = random.random() > 0.03
    return {"logs": logs, "telemetry": telemetry, "video": video}


# ---------------------------------------------------------------- background runs
d = START
while d <= END:
    n_today = random.choice([1, 2, 2, 3, 3, 3, 4, 4, 5])
    for _ in range(n_today):
        pipeline = random.choices(PIPELINES, PIPELINE_WEIGHTS)[0]
        scenario = random.choice(SCENARIOS)
        d_ = d

        # ARC 1: crosswind fails ONLY in Simulation (handled below w/ boost)
        # ARC 3: dynamic-intruder regression on HIL/Flight in v2.15.0/.1
        b = build_for(d_)
        base_fail = 0.10
        if scenario == "Precision Landing — Gusty Crosswind" and pipeline == "Simulation":
            base_fail = 0.85                      # ARC 1: chronic sim failure
        elif scenario == "Precision Landing — Gusty Crosswind":
            base_fail = 0.05                      # ...but flight/HIL pass fine
        elif scenario == "Obstacle Avoidance — Dynamic Intruder" and \
                pipeline in ("HIL Bench", "Flight") and b in ("v2.15.0", "v2.15.1"):
            base_fail = 0.80                      # ARC 3: regression window

        r = random.random()
        if r < base_fail:
            status = "fail"
        elif r < base_fail + 0.05:
            status = "blocked"
        else:
            status = "pass"

        add_run(d_, pipeline, scenario, status, default_artifacts(pipeline, d_))
    d += timedelta(days=1)

# Guarantee ARC 1 has a healthy sim-failure trail plus passing flight twins
for k in range(6):
    dd = START + timedelta(days=random.randint(3, 80))
    add_run(dd, "Simulation", "Precision Landing — Gusty Crosswind", "fail",
            default_artifacts("Simulation", dd), owner="S. Tanaka")
    if k % 2 == 0:
        add_run(dd, "Flight", "Precision Landing — Gusty Crosswind", "pass",
                default_artifacts("Flight", dd), owner="S. Tanaka")

# Guarantee ARC 3: regression fails inside v2.15.0/.1 window, recovery after v2.15.2
for k in range(9):
    dd = date(2026, 6, 2) + timedelta(days=random.randint(0, 10))   # Jun 2–12
    pipe = "HIL Bench" if k % 3 else "Flight"
    add_run(dd, pipe, "Obstacle Avoidance — Dynamic Intruder", "fail",
            default_artifacts(pipe, dd), owner="A. Okafor")
for k in range(5):
    dd = date(2026, 6, 13) + timedelta(days=random.randint(0, 16))  # post-fix
    pipe = "HIL Bench" if k % 2 else "Flight"
    add_run(dd, pipe, "Obstacle Avoidance — Dynamic Intruder", "pass",
            default_artifacts(pipe, dd), owner="A. Okafor")

runs.sort(key=lambda r: (r["date"], r["run_id"]))
# Re-sequence IDs after sort so IDs are chronological
for i, r in enumerate(runs, 1):
    r["run_id"] = f"TR-2026-{i:04d}"

# ---------------------------------------------------------------- failures
failures = []
fseq = 0


def add_failure(title, severity, status, team, opened, root_cause=None,
                resolved=None, five_whys=None, corrective=None, occ=None):
    global fseq
    fseq += 1
    failures.append({
        "failure_id": f"F-{fseq:04d}",
        "title": title,
        "severity": severity,                  # P0..P3
        "triage_status": status,               # Open | Investigating | Corrective Action | Verified
        "team": team,
        "root_cause": root_cause,              # None until determined
        "opened": iso(opened),
        "resolved": iso(resolved) if resolved else None,
        "five_whys": five_whys or [],
        "corrective_action": corrective,
        "occurrences": occ or [],
    })
    return failures[-1]


def runs_matching(scenario=None, pipeline=None, status="fail", d0=None, d1=None):
    out = []
    for r in runs:
        if scenario and r["scenario"] != scenario:
            continue
        if pipeline and r["pipeline"] not in (pipeline if isinstance(pipeline, tuple) else (pipeline,)):
            continue
        if status and r["status"] != status:
            continue
        rd = date.fromisoformat(r["date"])
        if d0 and rd < d0:
            continue
        if d1 and rd > d1:
            continue
        out.append(r["run_id"])
    return out


# ARC 1 — the money demo
arc1_occ = runs_matching("Precision Landing — Gusty Crosswind", "Simulation")
add_failure(
    "Lateral drift exceeds touchdown tolerance — gusty crosswind (SIM only)",
    "P1", "Corrective Action", "Test Infrastructure",
    opened=date(2026, 4, 9),
    root_cause="Scenario Definition",
    five_whys=[
        "Why did precision landing fail? Lateral drift exceeded the 0.5 m touchdown tolerance.",
        "Why the drift? The controller was compensating for gusts beyond its design envelope.",
        "Why beyond envelope? The sim wind model applied a gust profile ~2.5x the scenario spec.",
        "Why 2.5x? The scenario config supplies gust speed in m/s; the wind service reads knots.",
        "Why wasn't it caught? No unit validation on scenario schema; config was copied from a legacy suite.",
    ],
    corrective="Add unit validation to scenario schema; audit all legacy-derived configs. "
               "Flight runs of the same scenario pass — confirms sim-config root cause, not vehicle behavior.",
    occ=arc1_occ,
)

# ARC 2 — telemetry uploader race
arc2_occ = [r["run_id"] for r in runs
            if r["pipeline"] == "Flight"
            and not r["artifacts"]["telemetry"]
            and TELEMETRY_GAP_START <= date.fromisoformat(r["date"]) <= TELEMETRY_GAP_END]
add_failure(
    "Telemetry uploader race drops flight logs on rapid disarm",
    "P2", "Investigating", "Data Platform",
    opened=date(2026, 5, 22),
    root_cause="Data / Logging",
    five_whys=[
        "Why are flight telemetry files missing? Uploader session closes before final flush on rapid disarm.",
        "Why does the session close early? Disarm event triggers teardown without awaiting the upload queue.",
    ],
    corrective=None,
    occ=arc2_occ,
)

# ARC 3 — real regression, verified fixed
arc3_occ = runs_matching("Obstacle Avoidance — Dynamic Intruder", ("HIL Bench", "Flight"),
                         d0=date(2026, 6, 2), d1=date(2026, 6, 12))
add_failure(
    "Intruder track dropout above 12 m/s closure after planner refactor",
    "P0", "Verified", "Autonomy",
    opened=date(2026, 6, 3),
    root_cause="Software Regression",
    resolved=date(2026, 6, 13),
    five_whys=[
        "Why did avoidance fail? Intruder track dropped above 12 m/s closure rate.",
        "Why did the track drop? Cost-map decay constant changed in the v2.15.0 planner refactor.",
        "Why did the change ship? Perf test suite lacked a high-closure-rate intruder case.",
    ],
    corrective="Reverted cost-map decay change; fix shipped in v2.15.2. "
               "Added high-closure intruder case to the pre-merge perf suite.",
    occ=arc3_occ,
)

# ---- background one-off failures over remaining failing runs
covered = set()
for f in failures:
    covered.update(f["occurrences"])

remaining_fail_runs = [r for r in runs if r["status"] == "fail" and r["run_id"] not in covered]
random.shuffle(remaining_fail_runs)

BG_TITLES = [
    ("Route replanner oscillates at vertiport hold point", "Autonomy"),
    ("Door interlock sensor intermittent open state", "Hardware"),
    ("HIL bench power brownout aborts scenario mid-run", "Test Environment (bench PSU)"),
    ("Beacon tracker loses lock under strobing backlight", "Autonomy"),
    ("RTL triggers 4% above configured battery threshold", "Flight Controls"),
    ("Log indexer mislabels pipeline field on re-ingest", "Data Platform"),
    ("Payload comp gains untuned for aft-heavy loadout", "Flight Controls"),
    ("Urban-canyon GPS multipath exceeds nav filter bound", "Autonomy"),
    ("Comms failover handshake exceeds 800 ms budget", "Systems Integration"),
    ("Scenario runner picks stale map tile cache", "Test Infrastructure"),
    ("Landing-site scorer ranks occupied pad viable", "Autonomy"),
    ("Test card missing sign-off before flight release", "Systems Integration"),
]

STATUS_POOL = ["Open", "Open", "Investigating", "Investigating",
               "Corrective Action", "Verified", "Verified"]

i = 0
while remaining_fail_runs and i < len(BG_TITLES) * 2:
    take = remaining_fail_runs[:random.randint(1, 3)]
    remaining_fail_runs = remaining_fail_runs[len(take):]
    title, team_hint = BG_TITLES[i % len(BG_TITLES)]
    team = team_hint.split(" (")[0]
    if team not in TEAMS:
        team = random.choice(TEAMS)
    st = random.choice(STATUS_POOL)
    opened = date.fromisoformat(min(r_["date"] for r_ in
                                    [next(r for r in runs if r["run_id"] == rid) for rid in
                                     [t["run_id"] for t in take]]))
    resolved = None
    rc = None
    corrective = None
    if st == "Verified":
        rc = random.choice(ROOT_CAUSES)
        resolved = min(opened + timedelta(days=random.randint(2, 9)), END)
        corrective = "Fix verified against re-run; monitoring for recurrence."
    elif st == "Corrective Action":
        rc = random.choice(ROOT_CAUSES)
        corrective = "Corrective action in review with owning team."
    elif st == "Investigating" and random.random() < 0.5:
        rc = random.choice(ROOT_CAUSES)
    sev = random.choices(["P0", "P1", "P2", "P3"], [0.08, 0.27, 0.42, 0.23])[0]
    add_failure(title, sev, st, team, opened, root_cause=rc, resolved=resolved,
                corrective=corrective, occ=[t["run_id"] for t in take])
    i += 1

# Age Open items realistically: nothing sits Open for months, and an Open P0
# older than ~a week would be an organizational failure, not a data point.
for f in failures:
    if f["triage_status"] == "Open":
        if f["severity"] == "P0":
            f["opened"] = iso(END - timedelta(days=random.randint(2, 6)))
        else:
            f["opened"] = iso(END - timedelta(days=random.randint(9, 21)))

failures.sort(key=lambda f: f["opened"])
for i, f in enumerate(failures, 1):
    f["failure_id"] = f"F-{i:04d}"

# ---------------------------------------------------------------- write + report
meta = {
    "company": "Stratus Aerial",
    "dataset": "synthetic",
    "generated_by": "generate_data.py (seeded, reproducible)",
    "window_start": iso(START),
    "window_end": iso(END),
}

with open("src/data/test_runs.json", "w") as fh:
    json.dump(runs, fh, indent=1)
with open("src/data/failures.json", "w") as fh:
    json.dump(failures, fh, indent=1)
with open("src/data/meta.json", "w") as fh:
    json.dump(meta, fh, indent=1)

# sanity report
from collections import Counter
c_status = Counter(r["status"] for r in runs)
c_pipe = Counter(r["pipeline"] for r in runs)
print(f"runs: {len(runs)}  {dict(c_status)}  pass_rate={c_status['pass']/len(runs):.0%}")
print(f"pipelines: {dict(c_pipe)}")
print(f"failures: {len(failures)}  statuses={Counter(f['triage_status'] for f in failures)}")
print(f"ARC1 occurrences: {len(arc1_occ)} (sim crosswind fails)")
flight_cross_pass = len(runs_matching('Precision Landing — Gusty Crosswind', 'Flight', status='pass'))
print(f"ARC1 nuance: flight crosswind PASSES: {flight_cross_pass}")
print(f"ARC2 occurrences: {len(arc2_occ)} (flight telemetry gaps)")
print(f"ARC3 occurrences: {len(arc3_occ)} (regression window fails)")
