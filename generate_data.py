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

The dispatch layer (upstream of the runs) adds programs, tails, crew,
requests and assignments over the same window, with three more arcs:

  ARC D1 "The misattributed shortage" (April–May): through April the PLC
         Harmattan deferrals are logged as no_rated_operator ("per thread
         consensus"); the supply view corrects the attribution at the end of
         April, but the real constraint — two Harmattan-rated pilots — holds
         through the May cert push. Two CQ cross-rating flights, deferred
         twice during that push because training is P2, fix it on May 27–28.
  ARC D2 "The bring-up surge" (Jun 20–21): SBU files 22 requests against 8
         weekend asset-windows; ~60% defer with reasons, a handful arrive
         after cutoff and carry late=true; lead time and churn spike, then
         absorb the following week.
  ARC D3 "Grounding cascade" (Jun 10–18): LV-03 and LV-05 are grounded
         against ARC 3's regression until v2.15.2 ships; asset_grounded
         deferrals rise, the remaining Levants saturate, PN misses its asset
         minimum, churn spikes, then recovers. Same event, both halves.

Dataset "today" is the last run date; tomorrow (today + 1) exists as a
planned day with an unscheduled queue — the dispatch board's default view.

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

# ================================================================ dispatch layer
#
# Everything below runs on its own RNG stream so the RCCA data above stays
# byte-identical no matter how the dispatch generator evolves. Requests,
# assignments and deferrals come from a day-by-day planner that obeys the same
# rules the app enforces (R1–R4 hard, R5–R8 soft/structural), so the seed is
# rule-clean by construction — and check_rules() re-verifies it before writing.

import os
import sqlite3
from collections import Counter, defaultdict

drng = random.Random(4242)

TOMORROW = END + timedelta(days=1)              # the planned day the board opens on
WINDOWS = ["AM", "PM", "NIGHT"]
CUTOFF = "15:00"
PRIO_RANK = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
DEFERRAL_REASONS = ["no_rated_operator", "no_rated_pilot", "no_asset", "asset_grounded",
                    "program_over_max", "build_not_ready", "late_intake", "requester_withdrew"]
BUILD_START = {b: s for b, s, _ in BUILD_WINDOWS}

AIRFRAMES = {
    "Levant":    {"role": "workhorse — urban 2-pax", "windows": ["AM", "PM", "NIGHT"]},
    "Harmattan": {"role": "instrumented mid-size",   "windows": ["AM", "PM"]},
    "Sirocco":   {"role": "bring-up airframe",       "windows": ["AM", "PM"]},
}

# ---------------------------------------------------------------- programs
PROGRAMS = [
    dict(program_id="PRG-01", code="PLC", name="Precision Landing Cert", lead="S. Tanaka",
         priority_default="P0", standing=True,  airframes=["Harmattan"],          asset_min=2, asset_max=3),
    dict(program_id="PRG-02", code="PN",  name="Perception Nightly",     lead="A. Okafor",
         priority_default="P1", standing=True,  airframes=["Levant"],             asset_min=3, asset_max=4),
    dict(program_id="PRG-03", code="SBU", name="Sirocco Bring-up",       lead="R. Okafor",
         priority_default="P0", standing=False, airframes=["Sirocco"],            asset_min=1, asset_max=2),
    dict(program_id="PRG-04", code="URC", name="Urban Route Campaign",   lead="J. Meyer",
         priority_default="P1", standing=False, airframes=["Levant"],             asset_min=1, asset_max=2),
    dict(program_id="PRG-05", code="CQ",  name="Crew Qualification",     lead="D. Whitfield",
         priority_default="P2", standing=True,  airframes=["Levant", "Harmattan"], asset_min=0, asset_max=1),
    dict(program_id="PRG-06", code="SF",  name="Showcase Flights",       lead="K. Osei",
         priority_default="P0", standing=False, airframes=["Levant"],             asset_min=0, asset_max=1),
]
for p in PROGRAMS:
    p["cutoff_local"] = CUTOFF
PROG = {p["program_id"]: p for p in PROGRAMS}
PROG_BY_CODE = {p["code"]: p for p in PROGRAMS}

# Arc anchors
PLC_PUSH = (date(2026, 5, 4), date(2026, 5, 8))          # cert push: 4 sorties/day, AM and PM
MISATTRIBUTED_UNTIL = date(2026, 4, 28)                   # D1: shortage argued as "operators" until here
CROSS_RATING_DATE = date(2026, 5, 29)                     # D1: two operator-pilots rated on Harmattan
GROUNDING = (date(2026, 6, 10), date(2026, 6, 18))        # D3
SURGE_WEEKEND = (date(2026, 6, 20), date(2026, 6, 21))    # D2

# ---------------------------------------------------------------- assets (tails)
ASSET_ROWS = [
    ("LV-01", "Levant", "baseline"), ("LV-02", "Levant", "instrumented"), ("LV-03", "Levant", "baseline"),
    ("LV-04", "Levant", "baseline"), ("LV-05", "Levant", "baseline"),     ("LV-06", "Levant", "instrumented"),
    ("HM-01", "Harmattan", "instrumented"), ("HM-02", "Harmattan", "instrumented"),
    ("HM-03", "Harmattan", "instrumented"), ("HM-04", "Harmattan", "instrumented"),
    ("SR-01", "Sirocco", "baseline"), ("SR-02", "Sirocco", "baseline"),
]
ARC3_FAILURE_ID = next(f["failure_id"] for f in failures
                       if f["title"].startswith("Intruder track dropout"))

# Status events per tail. `surprise` events were not known when the previous
# day's plan was built (the grounding, arc D3): the planner cannot see them and
# the sorties already on those tails get scrubbed on the day.
STATUS_EVENTS = {
    "LV-03": [dict(status="grounded", date_from=iso(GROUNDING[0]), date_to=iso(GROUNDING[1]), surprise=True,
                   note=f"Grounded pending v2.15.2 — intruder-track regression ({ARC3_FAILURE_ID})",
                   failure_id=ARC3_FAILURE_ID)],
    "LV-05": [dict(status="grounded", date_from=iso(GROUNDING[0]), date_to=iso(GROUNDING[1]), surprise=True,
                   note=f"Grounded pending v2.15.2 — intruder-track regression ({ARC3_FAILURE_ID})",
                   failure_id=ARC3_FAILURE_ID)],
    "LV-06": [dict(status="maintenance", date_from="2026-06-11", date_to="2026-06-17",
                   note="100-hour inspection (scheduled before the grounding)")],
    "LV-04": [dict(status="reserved", date_from="2026-06-15", date_to="2026-06-17", reserved_by="PRG-06",
                   note="Showcase config — cabin trim and livery")],
    "HM-04": [dict(status="reserved", date_from=iso(PLC_PUSH[0]), date_to=iso(PLC_PUSH[1]), reserved_by="PRG-01",
                   note="PLC cert push — instrumented config frozen"),
              dict(status="maintenance", date_from="2026-06-28", date_to=None,
                   note="Avionics bay inspection — return to service Jul 3")],
}

assets = []
for aid, af, cfg in ASSET_ROWS:
    hist = [{"status": ev["status"], "date_from": ev["date_from"], "date_to": ev["date_to"],
             "reserved_by": ev.get("reserved_by"), "note": ev.get("note", ""), "failure_id": ev.get("failure_id")}
            for ev in STATUS_EVENTS.get(aid, [])]
    assets.append({
        "asset_id": aid, "airframe": af, "config": cfg, "windows": AIRFRAMES[af]["windows"],
        "status": "available", "reserved_by": None, "status_note": "", "status_since": iso(START),
        "status_history": hist,
    })
ASSET = {a["asset_id"]: a for a in assets}


def asset_status_on(a, d, known_at=None):
    """(status, reserved_by) of a tail on day d. With known_at, surprise events
    that start after the planning date are invisible."""
    for ev in STATUS_EVENTS.get(a["asset_id"], []):
        f = date.fromisoformat(ev["date_from"])
        t = date.fromisoformat(ev["date_to"]) if ev["date_to"] else TOMORROW
        if f <= d <= t:
            if known_at is not None and ev.get("surprise") and f > known_at:
                continue
            return ev["status"], ev.get("reserved_by")
    return "available", None


for a in assets:                                   # snapshot fields = status as of "today"
    a["status"], a["reserved_by"] = asset_status_on(a, END)
    for ev in STATUS_EVENTS.get(a["asset_id"], []):
        f = date.fromisoformat(ev["date_from"])
        t = date.fromisoformat(ev["date_to"]) if ev["date_to"] else TOMORROW
        if f <= END <= t:
            a["status_note"], a["status_since"] = ev.get("note", ""), ev["date_from"]
        elif t < END:                              # back in service the day after the event ended
            a["status_since"] = max(a["status_since"], iso(t + timedelta(days=1)))

# ---------------------------------------------------------------- people
# pattern: day = Mon–Fri AM/PM · night = Mon–Fri NIGHT · swing = Mon–Fri PM/NIGHT
# · day+wkend = day plus the bring-up push weekend (arc D2)
PERSON_ROWS = [
    ("P-001", "E. Lindqvist",   ["pilot"],             ["Levant", "Harmattan"],            False, "day"),
    ("P-002", "T. Achebe",      ["pilot"],             ["Levant", "Harmattan"],            False, "day"),
    ("P-003", "N. Petrova",     ["pilot"],             ["Levant"],                         False, "night"),
    ("P-004", "I. Castellanos", ["pilot"],             ["Levant", "Sirocco"],              False, "day+wkend"),
    ("P-005", "H. Brandt",      ["pilot"],             ["Levant"],                         False, "day"),
    ("P-006", "Y. Nakamura",    ["operator"],          ["Levant", "Harmattan"],            False, "day"),
    ("P-007", "F. Mensah",      ["operator"],          ["Levant", "Harmattan"],            False, "day"),
    ("P-008", "C. Delacroix",   ["operator"],          ["Levant", "Harmattan"],            False, "day"),
    ("P-009", "O. Reyes",       ["operator"],          ["Levant"],                         False, "swing"),
    ("P-010", "B. Kowalczyk",   ["operator"],          ["Levant"],                         False, "night"),
    ("P-011", "D. Varga",       ["operator", "pilot"], ["Levant", "Harmattan", "Sirocco"], True,  "day+wkend"),
    ("P-012", "S. Oyelaran",    ["operator", "pilot"], ["Levant", "Harmattan", "Sirocco"], True,  "day+wkend"),
    ("P-013", "K. Halvorsen",   ["operator"],          ["Levant", "Sirocco"],              False, "day+wkend"),
    ("P-014", "A. Moreau",      ["operator", "pilot"], ["Levant"],                         True,  "swing"),
    ("P-015", "J. Quispe",      ["pilot"],             ["Levant"],                         False, "night"),
    ("P-016", "L. Ferreira",    ["pilot"],             ["Levant"],                         False, "day"),
    ("P-017", "W. Adeyemi",     ["pilot"],             ["Levant"],                         False, "swing"),
]
# Arc D1: the two operator-pilots earn their Harmattan rating on the CQ
# cross-rating flights (May 27–28); before that only P-001/P-002 fly Harmattan.
RATING_EFFECTIVE = {("P-011", "Harmattan"): iso(CROSS_RATING_DATE),
                    ("P-012", "Harmattan"): iso(CROSS_RATING_DATE)}
VACATIONS = {"P-002": (date(2026, 4, 27), date(2026, 5, 1)),     # inside arc D1 — deepens the pinch
             "P-001": (date(2026, 5, 18), date(2026, 5, 19)),
             "P-005": (date(2026, 6, 22), date(2026, 6, 24))}


def pattern_windows(pattern, d):
    wd = d.weekday() < 5
    surge = SURGE_WEEKEND[0] <= d <= SURGE_WEEKEND[1]
    return {"day": ["AM", "PM"] if wd else [],
            "night": ["NIGHT"] if wd else [],
            "swing": ["PM", "NIGHT"] if wd else [],
            "day+wkend": ["AM", "PM"] if (wd or surge) else []}[pattern]


persons = []
for pid, name, roles, ratings, selfp, pattern in PERSON_ROWS:
    avail = {}
    d = START
    while d <= TOMORROW:
        w = pattern_windows(pattern, d)
        vac = VACATIONS.get(pid)
        if vac and vac[0] <= d <= vac[1]:
            w = []
        elif w and d != TOMORROW and drng.random() < 0.05:   # the odd day off
            w = []
        if w:
            avail[iso(d)] = w
        d += timedelta(days=1)
    persons.append({
        "person_id": pid, "name": name, "roles": roles, "ratings": ratings, "self_pilot": selfp,
        "ratings_effective": {af: eff for (p, af), eff in RATING_EFFECTIVE.items() if p == pid},
        "availability": avail,
    })
PERSON = {p["person_id"]: p for p in persons}


def rated_on(p, airframe, d):
    if airframe not in p["ratings"]:
        return False
    eff = p["ratings_effective"].get(airframe)
    return eff is None or date.fromisoformat(eff) <= d


def available(p, d, w):
    return w in p["availability"].get(iso(d), [])


# ---------------------------------------------------------------- requests
REQUEST_TEAMS = ["Autonomy", "Perception", "Flight Controls", "Systems Integration",
                 "Test Infrastructure", "Hardware"]
TITLES = {
    "PLC": ["Precision landing cert — nominal approach, pad A", "Precision landing cert — gusty crosswind, pad B",
            "Precision landing cert — offset touchdown", "Precision landing cert — night beacon approach",
            "Precision landing cert — degraded GPS approach"],
    "PN":  ["Perception regression — night approach", "Perception regression — dynamic intruder",
            "Perception regression — static field", "Perception regression — urban canyon",
            "Perception data collection — low-light pedestrians", "Perception regression — vertiport traffic"],
    "SBU": ["Bring-up — hover envelope check", "Bring-up — motor calibration sweep", "Bring-up — battery failsafe",
            "Bring-up — door interlock sequence", "Bring-up — payload imbalance comp", "Bring-up — comms loss failover",
            "Bring-up — RTL from 40 m", "Bring-up — vibration survey"],
    "URC": ["Urban route — leg 1 (river crossing)", "Urban route — leg 2 (downtown grid)",
            "Urban route — leg 3 (vertiport approach)", "Urban route — leg 4 (canyon return)"],
    "CQ":  ["Currency check — Levant", "Type rating — Harmattan"],
    "SF":  ["Showcase flight — municipal partners", "Showcase flight — investor visit", "Showcase flight — press day",
            "Showcase flight — board visit", "Showcase flight — university partners"],
}
REQUESTERS = {
    "PLC": ["S. Tanaka", "L. Alvarez"], "PN": ["A. Okafor", "M. Sato"], "SBU": ["R. Okafor", "M. Sato", "P. Nguyen"],
    "URC": ["J. Meyer", "M. Haddad"], "CQ": ["D. Whitfield"], "SF": ["K. Osei"],
}
TEAM_OF = {"PLC": "Flight Controls", "PN": "Perception", "SBU": "Hardware", "URC": "Autonomy",
           "CQ": "Test Infrastructure", "SF": "Systems Integration"}
# Which logged scenarios a program's sorties plausibly produce (for run linkage).
SCENARIO_POOL = {
    "PLC": ["Precision Landing — Gusty Crosswind", "Precision Landing — Nominal"],
    "PN":  ["Night Ops — Beacon Tracking", "Obstacle Avoidance — Dynamic Intruder",
            "Obstacle Avoidance — Static Field", "GPS-Denied Navigation — Urban Canyon"],
    "URC": ["Vertiport Approach — Traffic Sequencing", "Comms Loss Failover",
            "Emergency Landing Site Selection", "GPS-Denied Navigation — Urban Canyon"],
    "SBU": ["Battery Failsafe — Forced RTL", "Cabin Door Interlock Sequence", "Payload Imbalance Compensation"],
    "CQ":  ["Precision Landing — Nominal"],
    "SF":  ["Vertiport Approach — Traffic Sequencing"],
}
URC_CAMPAIGNS = [(date(2026, 4, 13), date(2026, 4, 24)), (date(2026, 5, 11), date(2026, 5, 22)),
                 (date(2026, 6, 8), date(2026, 6, 19))]
SHOWCASES = [(date(2026, 4, 16), "PM"), (date(2026, 5, 8), "AM"), (date(2026, 5, 29), "PM"),
             (date(2026, 6, 16), "PM"), (date(2026, 6, 26), "AM")]

requests = []
REQ = {}
rstate = {}        # request_id -> planner-only state (never emitted)
rseq = 0


def stamp(d, hh, mm):
    return f"{iso(d)}T{hh:02d}:{mm:02d}"


def plus_minutes(ts, m):
    d_, t = ts.split("T")
    hh, mm = map(int, t.split(":"))
    mm += m
    return f"{d_}T{hh + mm // 60:02d}:{mm % 60:02d}"


def next_open_day(d, airframe):
    """First day on or after d with any rated crew available for the airframe."""
    for k in range(10):
        dd = d + timedelta(days=k)
        if dd > TOMORROW:
            return dd                      # past the window: stays queued, never clamped back
        if any(rated_on(p, airframe, dd) and p["availability"].get(iso(dd)) for p in persons):
            return dd
    return d


def event(r, at, ev, reason=None, note="", day=None):
    """Timeline entry. `day` is the plan day the event refers to (a deferral
    stamped at Tuesday's cutoff is *for* Wednesday) — the views group by it."""
    r["timeline"].append({"at": at, "day": iso(day) if day else None, "event": ev, "reason": reason, "note": note})


def add_request(code, needed_by, windows, crew, title=None, submitted_at=None, late=None,
                build=None, stage=None, priority=None, requester=None, plan_date=None, note="",
                may_withdraw=True):
    global rseq
    rseq += 1
    prog = PROG_BY_CODE[code]
    airframe = "Harmattan" if (code == "CQ" and title and "Harmattan" in title) else prog["airframes"][0]
    if submitted_at is None:
        prev = needed_by - timedelta(days=1)
        if late is None:
            late = drng.random() < 0.06
        submitted_at = (stamp(prev, drng.choice([15, 15, 16, 17]), drng.randint(0, 59)) if late
                        else stamp(prev, drng.randint(8, 14), drng.randint(0, 59)))
    if late is None:
        sub_d, sub_t = submitted_at.split("T")
        late = date.fromisoformat(sub_d) >= needed_by - timedelta(days=1) and sub_t >= CUTOFF
    build = build or build_for(min(needed_by, END))
    req = {
        "request_id": f"RQ-{rseq:04d}", "program_id": prog["program_id"],
        "requester": requester or drng.choice(REQUESTERS[code]),
        "title": title or drng.choice(TITLES[code]), "build": build,
        "build_stage": stage or ("release_candidate" if (code == "PLC" and drng.random() < 0.7)
                                 else "engineering" if drng.random() < 0.8 else "release_candidate"),
        "crew": crew, "windows": list(windows), "airframe": airframe,
        "priority": priority or prog["priority_default"],
        "supporting_team": TEAM_OF[code] if drng.random() < 0.75 else drng.choice(REQUEST_TEAMS),
        "submitted_at": submitted_at, "needed_by": iso(needed_by),
        "plan_date": None, "status": "submitted", "late": late, "deferral_reason": None,
        "timeline": [{"at": submitted_at, "day": None, "event": "submitted", "reason": None,
                      "note": note or ("submitted after the 15:00 cutoff" if late else "")}],
    }
    requests.append(req)
    REQ[req["request_id"]] = req
    rstate[req["request_id"]] = {"plan_date": None, "attempts": 0}
    if plan_date is None:
        plan_date = needed_by
        if late:                               # R7: late intake defaults to the next open day
            plan_date = next_open_day(needed_by + timedelta(days=1), airframe)
            event(req, plus_minutes(submitted_at, 1), "deferred", "late_intake",
                  "flagged at intake: after the 15:00 cutoff — moved to next open day", day=needed_by)
            req["status"], req["deferral_reason"] = "deferred", "late_intake"
    set_plan_date(req, plan_date)
    # a few requesters change their mind before the plan is built
    if may_withdraw and drng.random() < 0.03 and needed_by < END:
        event(req, plus_minutes(submitted_at, drng.randint(35, 170)), "withdrawn", "requester_withdrew",
              "withdrawn before planning", day=needed_by)
        req["status"], req["deferral_reason"] = "withdrawn", "requester_withdrew"
        set_plan_date(req, None)
    return req


def set_plan_date(r, d):
    rstate[r["request_id"]]["plan_date"] = d
    r["plan_date"] = iso(d) if d else r["plan_date"]


def queued_for(code, D):
    return [r for r in requests if PROG[r["program_id"]]["code"] == code
            and r["status"] in ("submitted", "deferred")
            and rstate[r["request_id"]]["plan_date"] and rstate[r["request_id"]]["plan_date"] <= D]


def daily_demand(D):
    """Standing programs ask for a day's worth of sorties — a sortie deferred
    yesterday is part of today's ask, not on top of it. Campaign legs and
    bring-up items are distinct work, so those back up when deferred."""
    if D.weekday() >= 5:
        return
    push = PLC_PUSH[0] <= D <= PLC_PUSH[1]
    n = 3 if D == TOMORROW else 4 if push else drng.choice([2, 3, 3, 3, 4])
    for _ in range(max(0, n - len(queued_for("PLC", D)))):
        add_request("PLC", D, ["AM", "PM"] if push else (["AM"] if drng.random() < 0.8 else ["AM", "PM"]),
                    "operator_pilot")
    n = 4 if D == TOMORROW else drng.choice([3, 4, 4, 4, 5])
    for k in range(max(0, n - len(queued_for("PN", D)))):
        if D == TOMORROW:                       # one PM sortie on the board, so R6 has a holder to name
            win = ["PM", "NIGHT"] if k == 0 else ["NIGHT"]
        else:
            win = ["NIGHT"] if drng.random() < 0.6 else ["PM", "NIGHT"]
        add_request("PN", D, win, "pilot_only")
    if D.toordinal() % 3 == 0 and D != TOMORROW and not queued_for("CQ", D):
        subjects = [p for p in persons if "Levant" in p["ratings"]
                    and any(w in p["availability"].get(iso(D), []) for w in ("AM", "PM"))]
        who = drng.choice(subjects or persons)
        r = add_request("CQ", D, ["AM", "PM"], "operator_pilot", title=f"Currency check — Levant ({who['name']})")
        rstate[r["request_id"]]["subject"] = who["person_id"]      # the check is theirs to fly
    if any(s <= D <= e for s, e in URC_CAMPAIGNS):        # route legs are distinct items: a missed leg backs up
        for k in range(2):
            add_request("URC", D, ["AM", "PM"] if k == 0 else ["PM", "AM"], "operator_pilot")


# Bring-up demand is a backlog of distinct items, not a daily ask: ramping
# through the window, paused around the surge weekend.
d = START
while d <= END:
    if d.weekday() < 5 and not (SURGE_WEEKEND[0] - timedelta(days=2) <= d <= SURGE_WEEKEND[1]):
        rate = 0.3 if d.month == 4 else 0.5 if d.month == 5 else 0.9
        if drng.random() < rate:
            add_request("SBU", d, drng.choice([["AM"], ["PM"], ["AM", "PM"]]),
                        "lone_operator" if drng.random() < 0.35 else "operator_pilot")
    d += timedelta(days=1)

for sd, w in SHOWCASES:                                                    # SF — fixed guest dates
    add_request("SF", sd, [w], "operator_pilot", late=False, title=TITLES["SF"][SHOWCASES.index((sd, w))],
                stage="release_candidate", may_withdraw=False)

# Arc D1 twist: the two Harmattan cross-rating flights are requested in early
# May for the morning slot, deferred twice during the PLC push (training is
# P2), parked, and finally flown May 27–28 in the afternoon — the
# lowest-priority program was the fix for the shortage.
cq_cross = []
for k, pid in enumerate(["P-011", "P-012"]):
    cq_cross.append(add_request("CQ", date(2026, 5, 6), ["AM"], "operator_pilot", late=False,
                                title=f"Type rating — Harmattan ({PERSON[pid]['name']})",
                                submitted_at=stamp(date(2026, 5, 4), 10, 15 + k * 20), build="v2.14.0",
                                may_withdraw=False))
cq_cross_ids = {r["request_id"] for r in cq_cross}

# Arc D2: the bring-up surge — 22 SBU requests against 8 weekend asset-windows.
surge = []
for k in range(22):
    sub_day = date(2026, 6, 18) if k < 10 else date(2026, 6, 19)
    late = sub_day == date(2026, 6, 19) and k >= 17                      # five arrive after Friday's cutoff...
    needed = SURGE_WEEKEND[0] if (k % 2 == 0 or late) else SURGE_WEEKEND[1]   # ...for Saturday (R7)
    sub_at = stamp(sub_day, drng.choice([15, 16, 17]) if late else drng.randint(9, 14), drng.randint(0, 59))
    build = "v2.16.0" if k in (7, 15) else "v2.15.2"                      # two ask for a build that ships Jun 22
    surge.append(add_request("SBU", needed, drng.choice([["AM"], ["PM"], ["AM", "PM"]]),
                             "lone_operator" if k % 4 == 3 else "operator_pilot",
                             submitted_at=sub_at, late=late, build=build, may_withdraw=False))
surge_ids = {r["request_id"] for r in surge}

# Tomorrow's queue: the spec's example request; a third type-rating (P2); and
# an ad hoc P0 showcase that arrived after cutoff — accepted because the guest
# date is fixed, so it sits on the Jul 1 rail for a decision (R6/R7 both fire).
add_request("SBU", date(2026, 7, 2), ["PM", "NIGHT"], "operator_pilot", late=False,
            title="Perception regression — night approach", submitted_at=stamp(END, 14, 10),
            build="v2.15.2", stage="engineering", requester="M. Sato", plan_date=TOMORROW, may_withdraw=False)
add_request("CQ", TOMORROW, ["AM"], "operator_pilot", late=False, title="Type rating — Harmattan (H. Brandt)",
            submitted_at=stamp(END, 11, 5), may_withdraw=False)
add_request("SF", TOMORROW, ["PM"], "operator_pilot", late=True, title="Showcase flight — city council",
            submitted_at=stamp(END, 16, 40), stage="release_candidate", plan_date=TOMORROW,
            note="after cutoff — accepted, guest date is fixed", may_withdraw=False)

# ---------------------------------------------------------------- planner
assignments = []
aseq = 0
usage = Counter()   # spreads sorties across tails and people


def defer(r, D, reason, note="", at=None):
    """The plan for day D could not include r. Deferral is structural: no
    reason, no save (R8). Re-queues for the next open day."""
    assert reason in DEFERRAL_REASONS, reason
    st = rstate[r["request_id"]]
    st["attempts"] += 1
    code = PROG[r["program_id"]]["code"]
    # Arc D1: until late April the Harmattan shortage was argued as an operator
    # shortage in chat and logged that way — the rating matrix says otherwise.
    if code == "PLC" and reason == "no_rated_pilot" and D < MISATTRIBUTED_UNTIL:
        reason, note = "no_rated_operator", "operator shortage per thread consensus"
    elif code == "PLC" and reason == "no_rated_pilot":
        note = note or "both Harmattan-rated pilots committed"
    event(r, at or stamp(D - timedelta(days=1), 15, 30), "deferred", reason, note, day=D)
    r["status"], r["deferral_reason"] = "deferred", reason
    if r["request_id"] in cq_cross_ids and st["attempts"] == 2:
        r["windows"] = ["PM"]
        event(r, stamp(D, 9, 0), "rescheduled", None,
              "parked until the PLC cert push clears; moved to the PM slot", day=D)
        set_plan_date(r, date(2026, 5, 27))
    elif st["attempts"] >= 6 or (st["attempts"] >= 3 and drng.random() < 0.4
                                 and r["request_id"] not in surge_ids and code not in ("SF", "CQ")):
        event(r, stamp(D, drng.randint(9, 16), drng.randint(0, 59)), "withdrawn", "requester_withdrew",
              "withdrawn by requester after repeated deferral", day=D)
        r["status"], r["deferral_reason"] = "withdrawn", "requester_withdrew"
        set_plan_date(r, None)
    else:
        set_plan_date(r, next_open_day(D + timedelta(days=1), r["airframe"]))


def new_assignment(D, w, r, asset, operator, pilot, note=""):
    global aseq
    aseq += 1
    a = {
        "assignment_id": f"AS-2026-{aseq:04d}", "date": iso(D), "window": w,
        "request_id": r["request_id"], "asset_id": asset["asset_id"],
        "operator_id": operator["person_id"] if operator else None,
        "pilot_id": pilot["person_id"] if pilot else None,
        "status": "planned", "scrub_reason": None, "run_id": None, "notes": note,
    }
    assignments.append(a)
    r["status"] = "scheduled"
    set_plan_date(r, D)
    usage[asset["asset_id"]] += 1
    for p in (operator, pilot):
        if p:
            usage[p["person_id"]] += 1
    return a


def pick(cands, idkey="person_id"):
    """Least-used first, then id — deterministic and spreads the load."""
    return sorted(cands, key=lambda x: (usage[x[idkey]], x[idkey]))[0]


def free_people(D, w, airframe, role, busy):
    return [p for p in persons if role in p["roles"] and rated_on(p, airframe, D)
            and available(p, D, w) and (p["person_id"], w) not in busy]


def crew_for(r, D, w, busy):
    """(operator, pilot) for the request's crew requirement, or a shortage reason."""
    af = r["airframe"]
    if r["crew"] == "none":
        return (None, None)
    pilots = free_people(D, w, af, "pilot", busy)
    ops = free_people(D, w, af, "operator", busy)
    subject = rstate.get(r["request_id"], {}).get("subject")
    if subject and r["crew"] == "operator_pilot":              # a currency check flies its own subject
        me = PERSON[subject]
        if me in ops:
            others = [p for p in pilots if p["person_id"] != subject]
            return (me, pick(others)) if others else "no_rated_pilot"
        if me in pilots:
            others = [p for p in ops if p["person_id"] != subject]
            return (pick(others), me) if others else "no_rated_operator"
        # the subject is busy or off this window: try another window, else the
        # check waits — a person being elsewhere is not a shortage
        return "subject_busy"
    if r["crew"] == "pilot_only":
        return (None, pick(pilots)) if pilots else "no_rated_pilot"
    if r["crew"] == "lone_operator":
        solo = [p for p in ops if p["self_pilot"]]
        return (pick(solo), None) if solo else "no_rated_operator"
    if not pilots:                                    # operator_pilot — two different people
        return "no_rated_pilot"
    for pilot in sorted(pilots, key=lambda p: (usage[p["person_id"]], p["person_id"])):
        others = [p for p in ops if p["person_id"] != pilot["person_id"]]
        if others:
            return (pick(others), pilot)
    return "no_rated_operator"


def busy_sets(D):
    """Tails and people already committed on D. A scrubbed sortie frees its
    crew but not its slot: one assignment per (date, asset, window), ever."""
    ba, bp = set(), set()
    for a in assignments:
        if a["date"] != iso(D):
            continue
        ba.add((a["asset_id"], a["window"]))
        if a["status"] != "scrubbed":
            for pid in (a["operator_id"], a["pilot_id"]):
                if pid:
                    bp.add((pid, a["window"]))
    return ba, bp


def place(r, D, known, busy_assets, busy_people, prog_tails, note=""):
    """Try each requested window; returns True or a shortage reason."""
    prog = PROG[r["program_id"]]
    shortage = None
    for w in r["windows"]:
        if w not in AIRFRAMES[r["airframe"]]["windows"]:
            continue
        usable, grounded_seen = [], False
        for a in assets:
            if a["airframe"] != r["airframe"] or w not in a["windows"]:
                continue
            st, rb = asset_status_on(a, D, known_at=known)
            if st in ("grounded", "maintenance"):
                grounded_seen = True
                continue
            if (st == "reserved" and rb != prog["program_id"]) or (a["asset_id"], w) in busy_assets:
                continue
            usable.append(a)
        mine = prog_tails[prog["program_id"]]
        if len(mine) >= prog["asset_max"]:            # R5: at the cap, only tails already flying for us
            capped = [a for a in usable if a["asset_id"] in mine]
            if usable and not capped:
                shortage = shortage or "program_over_max"
            usable = capped
        if not usable:
            shortage = shortage or ("asset_grounded" if grounded_seen else "no_asset")
            continue
        crew = crew_for(r, D, w, busy_people)
        if isinstance(crew, str):
            shortage = shortage or crew
            continue
        op, pi = crew
        asset = sorted(usable, key=lambda a: (usage[a["asset_id"]], a["asset_id"]))[0]
        new_assignment(D, w, r, asset, op, pi, note)
        busy_assets.add((asset["asset_id"], w))
        for p in (op, pi):
            if p:
                busy_people.add((p["person_id"], w))
        mine.add(asset["asset_id"])
        return (asset, w, op, pi)
    return shortage or "no_asset"


def plan_day(D, standing_only=False):
    """Build the plan for D the way the coordinator does at the 15:00 cutoff
    the day before: P0 first, then submission order (R6 holds by construction)."""
    known = D - timedelta(days=1)
    queued = [r for r in requests if r["status"] in ("submitted", "deferred")
              and rstate[r["request_id"]]["plan_date"] and rstate[r["request_id"]]["plan_date"] <= D]
    if standing_only:
        queued = [r for r in queued if PROG[r["program_id"]]["code"] in ("PLC", "PN")]
    queued.sort(key=lambda r: (PRIO_RANK[r["priority"]], r["submitted_at"]))
    busy_assets, busy_people = busy_sets(D)
    prog_tails = defaultdict(set)
    for a in assignments:
        if a["date"] == iso(D) and a["status"] != "scrubbed":
            prog_tails[REQ[a["request_id"]]["program_id"]].add(a["asset_id"])
    for a in assignments:                       # sorties already flown or planned
        if a["date"] == iso(D) and a["status"] != "scrubbed":
            prog_tails[REQ[a["request_id"]]["program_id"]].add(a["asset_id"])
    for r in queued:
        if BUILD_START.get(r["build"], START) > D:
            defer(r, D, "build_not_ready", f"{r['build']} ships {iso(BUILD_START[r['build']])}")
            continue
        note = ""
        if r["request_id"] in cq_cross_ids:
            note = f"cross-rating flight: {r['title'].split('(')[1].rstrip(')')} (trainee) under instruction"
        elif rstate[r["request_id"]].get("subject"):
            note = f"currency check: {PERSON[rstate[r['request_id']]['subject']]['name']}"
        out = place(r, D, known, busy_assets, busy_people, prog_tails, note)
        if out == "subject_busy":
            set_plan_date(r, next_open_day(D + timedelta(days=1), r["airframe"]))
            event(r, stamp(known, 15, 30), "rescheduled", None,
                  f"subject on another sortie — re-queued for {r['plan_date']}", day=D)
        elif isinstance(out, str):
            defer(r, D, out)
        else:
            asset, w, op, pi = out
            event(r, stamp(known, 15, 30), "scheduled", None,
                  f"{asset['asset_id']} {w} · " + " / ".join(p["name"] for p in (op, pi) if p), day=D)


def execute_day(D):
    """Fly the plan. Surprises (arc D3 grounding, weather) scrub sorties; the
    coordinator reassigns same-day when a tail and crew are free, else re-queues."""
    for a in [a for a in assignments if a["date"] == iso(D) and a["status"] == "planned"]:
        r = REQ[a["request_id"]]
        st, _ = asset_status_on(ASSET[a["asset_id"]], D)
        scrub = None
        if st in ("grounded", "maintenance"):
            scrub = "asset_grounded"
        elif D == SURGE_WEEKEND[1] and a["window"] == "AM" and a["asset_id"] == "SR-01":
            scrub = "weather"                                    # fog delay on the surge Sunday
        elif drng.random() < 0.02:
            scrub = drng.choice(["weather", "weather", "requester_withdrew", "build_not_ready"])
        if not scrub:
            a["status"], r["status"] = "done", "executed"
            event(r, stamp(D, {"AM": 11, "PM": 16, "NIGHT": 23}[a["window"]], drng.randint(0, 59)),
                  "executed", None, f"{a['asset_id']} {a['window']}", day=D)
            continue
        a["status"], a["scrub_reason"] = "scrubbed", scrub
        event(r, stamp(D, 7 if a["window"] == "AM" else 12, drng.randint(0, 59)), "scrubbed", scrub,
              f"{a['asset_id']} {a['window']} scrubbed", day=D)
        if scrub == "requester_withdrew":
            event(r, stamp(D, 8 if a["window"] == "AM" else 13, drng.randint(0, 59)), "withdrawn",
                  "requester_withdrew", "withdrawn on the day", day=D)
            r["status"], r["deferral_reason"] = "withdrawn", "requester_withdrew"
            set_plan_date(r, None)
            continue
        r["status"] = "deferred"
        # same-day reassignment: same or later window, any free tail and crew
        later = [w for w in r["windows"] if WINDOWS.index(w) >= WINDOWS.index(a["window"])] or \
                [w for w in AIRFRAMES[r["airframe"]]["windows"] if WINDOWS.index(w) > WINDOWS.index(a["window"])]
        busy_assets, busy_people = busy_sets(D)
        moved = False
        for w in later:
            free = [t for t in assets if t["airframe"] == r["airframe"] and w in t["windows"]
                    and (t["asset_id"], w) not in busy_assets and asset_status_on(t, D)[0] == "available"]
            if not free:
                continue
            crew = crew_for(r, D, w, busy_people)
            if isinstance(crew, str):
                continue
            op, pi = crew
            tail = sorted(free, key=lambda t: (usage[t["asset_id"]], t["asset_id"]))[0]
            na = new_assignment(D, w, r, tail, op, pi, f"reassigned from {a['asset_id']} {a['window']} ({scrub})")
            na["status"], r["status"] = "done", "executed"
            event(r, stamp(D, 8, drng.randint(0, 59)), "reassigned", None, f"→ {tail['asset_id']} {w}", day=D)
            event(r, stamp(D, {"AM": 11, "PM": 16, "NIGHT": 23}[w], drng.randint(0, 59)), "executed", None,
                  f"{tail['asset_id']} {w}", day=D)
            moved = True
            break
        if not moved:
            if scrub == "asset_grounded":
                defer(r, D, "asset_grounded", f"{a['asset_id']} grounded on the day", at=stamp(D, 9, 30))
            else:
                set_plan_date(r, next_open_day(D + timedelta(days=1), r["airframe"]))
                event(r, stamp(D, 9, 30), "rescheduled", None, f"{scrub} scrub — re-queued for {r['plan_date']}", day=D)


d = START
while d <= END:
    daily_demand(d)
    plan_day(d)
    execute_day(d)
    d += timedelta(days=1)
# Tomorrow: the standing programs are planned at cutoff; the ad hoc queue
# waits for the morning review — that queue is the board's default state.
daily_demand(TOMORROW)
plan_day(TOMORROW, standing_only=True)

# Chronological ids for requests and assignments (remap references).
requests.sort(key=lambda r: (r["submitted_at"], r["request_id"]))
remap = {r["request_id"]: f"RQ-{i:04d}" for i, r in enumerate(requests, 1)}
for r in requests:
    r["request_id"] = remap[r["request_id"]]
    r["timeline"].sort(key=lambda e: e["at"])
    if r["status"] not in ("deferred", "withdrawn"):
        r["deferral_reason"] = None
REQ = {r["request_id"]: r for r in requests}
cq_cross_ids = {remap[i] for i in cq_cross_ids}
surge_ids = {remap[i] for i in surge_ids}
assignments.sort(key=lambda a: (a["date"], WINDOWS.index(a["window"]), a["asset_id"]))
for i, a in enumerate(assignments, 1):
    a["assignment_id"] = f"AS-2026-{i:04d}"
    a["request_id"] = remap[a["request_id"]]

# ---------------------------------------------------------------- link sorties to logged runs
# A flight run in the RCCA log came from somebody's sortie: link same-day
# flight runs to executed sorties whose program plausibly produced that scenario.
for r in runs:
    r["request_id"] = None
by_day = defaultdict(list)
for a in assignments:
    if a["status"] == "done":
        by_day[a["date"]].append(a)
for r in runs:
    if r["pipeline"] != "Flight":
        continue
    cands = [a for a in by_day.get(r["date"], []) if a["run_id"] is None]
    fit = [a for a in cands if r["scenario"] in SCENARIO_POOL[PROG[REQ[a["request_id"]]["program_id"]]["code"]]]
    choice = (fit or cands or [None])[0]
    if choice:
        choice["run_id"] = r["run_id"]
        r["request_id"] = choice["request_id"]


# ---------------------------------------------------------------- rule check on the seed
def check_rules():
    seen_asset, seen_person = set(), set()
    for a in assignments:                                                           # one per (date, asset, window)
        key = (a["asset_id"], a["date"], a["window"])
        assert key not in seen_asset, ("R2 asset slot used twice", a)
        seen_asset.add(key)
    for a in assignments:
        if a["status"] == "scrubbed":
            continue
        D = date.fromisoformat(a["date"])
        r = REQ[a["request_id"]]
        af = ASSET[a["asset_id"]]["airframe"]
        assert af == r["airframe"], ("airframe mismatch", a)
        for pid in (a["operator_id"], a["pilot_id"]):
            if pid:
                assert rated_on(PERSON[pid], af, D), ("R1 unrated", a)                    # R1
                assert available(PERSON[pid], D, a["window"]), ("unavailable crew", a)
                key = (pid, a["date"], a["window"])
                assert key not in seen_person, ("R2 person double-booked", a)             # R2
                seen_person.add(key)
        st, rb = asset_status_on(ASSET[a["asset_id"]], D)
        assert st not in ("grounded", "maintenance"), ("R3 unassignable", a)              # R3
        assert st != "reserved" or rb == r["program_id"], ("R3 reserved", a)
        if r["crew"] == "operator_pilot":
            assert a["operator_id"] and a["pilot_id"] and a["operator_id"] != a["pilot_id"], ("R4", a)
        elif r["crew"] == "pilot_only":
            assert a["pilot_id"] and not a["operator_id"], ("R4", a)
        elif r["crew"] == "lone_operator":
            assert a["operator_id"] and not a["pilot_id"] \
                and PERSON[a["operator_id"]]["self_pilot"], ("R4 lone", a)                 # R4
    for r in requests:
        for e in r["timeline"]:
            if e["event"] == "deferred":
                assert e["reason"] in DEFERRAL_REASONS, ("R8", r)                          # R8


check_rules()

# ---------------------------------------------------------------- write
meta = {
    "company": "Stratus Aerial",
    "dataset": "synthetic",
    "generated_by": "generate_data.py (seeded, reproducible)",
    "window_start": iso(START),
    "window_end": iso(END),
    "today": iso(END),
    "tomorrow": iso(TOMORROW),
    "fleet_family": "Windz",
    "airframes": AIRFRAMES,
    "windows": WINDOWS,
    "cutoff_local": CUTOFF,
    "deferral_reasons": DEFERRAL_REASONS,
}

for name, payload in [("test_runs", runs), ("failures", failures), ("meta", meta), ("programs", PROGRAMS),
                      ("assets", assets), ("persons", persons), ("requests", requests),
                      ("assignments", assignments)]:
    with open(f"src/data/{name}.json", "w") as fh:
        json.dump(payload, fh, indent=1)


def write_sqlite(path="data/stratus.sqlite", schema="sql/schema.sql"):
    """The same seed as a relational database, for the SQL notebook."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        os.remove(path)
    con = sqlite3.connect(path)
    with open(schema) as fh:
        con.executescript(fh.read())
    ins = con.executemany
    ins("INSERT INTO failures VALUES (?,?,?,?,?,?,?,?,?)",
        [(f["failure_id"], f["title"], f["severity"], f["triage_status"], f["team"], f["root_cause"],
          f["opened"], f["resolved"], f["corrective_action"]) for f in failures])
    ins("INSERT INTO failure_whys VALUES (?,?,?)",
        [(f["failure_id"], i, w) for f in failures for i, w in enumerate(f["five_whys"], 1)])
    ins("INSERT INTO programs VALUES (?,?,?,?,?,?,?,?,?)",
        [(p["program_id"], p["code"], p["name"], p["lead"], p["priority_default"], int(p["standing"]),
          p["asset_min"], p["asset_max"], p["cutoff_local"]) for p in PROGRAMS])
    ins("INSERT INTO program_airframes VALUES (?,?)", [(p["program_id"], af) for p in PROGRAMS for af in p["airframes"]])
    ins("INSERT INTO assets VALUES (?,?,?,?,?,?,?)",
        [(a["asset_id"], a["airframe"], a["config"], a["status"], a["reserved_by"], a["status_note"],
          a["status_since"]) for a in assets])
    ins("INSERT INTO asset_windows VALUES (?,?)", [(a["asset_id"], w) for a in assets for w in a["windows"]])
    ins("INSERT INTO asset_status_history (asset_id,status,date_from,date_to,reserved_by,note,failure_id) "
        "VALUES (?,?,?,?,?,?,?)",
        [(a["asset_id"], h["status"], h["date_from"], h["date_to"], h["reserved_by"], h["note"], h["failure_id"])
         for a in assets for h in a["status_history"]])
    ins("INSERT INTO persons VALUES (?,?,?)", [(p["person_id"], p["name"], int(p["self_pilot"])) for p in persons])
    ins("INSERT INTO person_roles VALUES (?,?)", [(p["person_id"], r) for p in persons for r in p["roles"]])
    ins("INSERT INTO person_ratings VALUES (?,?,?)",
        [(p["person_id"], af, p["ratings_effective"].get(af)) for p in persons for af in p["ratings"]])
    ins("INSERT INTO person_availability VALUES (?,?,?)",
        [(p["person_id"], dd, w) for p in persons for dd, ws in p["availability"].items() for w in ws])
    ins("INSERT INTO requests VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [(r["request_id"], r["program_id"], r["requester"], r["title"], r["build"], r["build_stage"], r["crew"],
          r["airframe"], r["priority"], r["supporting_team"], r["submitted_at"], r["needed_by"], r["plan_date"],
          r["status"], int(r["late"]), r["deferral_reason"]) for r in requests])
    ins("INSERT INTO request_windows VALUES (?,?,?)",
        [(r["request_id"], i, w) for r in requests for i, w in enumerate(r["windows"])])
    ins("INSERT INTO request_events (request_id,at,day,event,reason,note) VALUES (?,?,?,?,?,?)",
        [(r["request_id"], e["at"], e["day"], e["event"], e["reason"], e["note"])
         for r in requests for e in r["timeline"]])
    ins("INSERT INTO test_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [(r["run_id"], r["date"], r["pipeline"], r["scenario"], r["build"], r["status"], r["duration_min"],
          r["owner"], int(r["artifacts"]["logs"]), int(r["artifacts"]["telemetry"]),
          None if r["artifacts"]["video"] is None else int(r["artifacts"]["video"]), r["request_id"])
         for r in runs])
    ins("INSERT INTO assignments VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [(a["assignment_id"], a["date"], a["window"], a["request_id"], a["asset_id"], a["operator_id"],
          a["pilot_id"], a["status"], a["scrub_reason"], a["run_id"], a["notes"]) for a in assignments])
    ins("INSERT INTO failure_occurrences VALUES (?,?)",
        [(f["failure_id"], rid) for f in failures for rid in f["occurrences"]])
    con.commit()
    con.close()


write_sqlite()

# ---------------------------------------------------------------- sanity report
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

print("--- dispatch ---")
a_status = Counter(a["status"] for a in assignments)
print(f"programs: {len(PROGRAMS)}  assets: {len(assets)}  persons: {len(persons)}  "
      f"requests: {len(requests)}  assignments: {len(assignments)} {dict(a_status)}")
print(f"request statuses: {dict(Counter(r['status'] for r in requests))}  late: {sum(r['late'] for r in requests)}")
def_events = [(r, e) for r in requests for e in r["timeline"] if e["event"] == "deferred"]
print(f"deferral events: {len(def_events)}  by reason: {dict(Counter(e['reason'] for _, e in def_events))}")
print(f"flight runs linked to sorties: {sum(1 for r in runs if r['request_id'])}/{c_pipe['Flight']}")
churn = Counter()
for r in requests:
    for e in r["timeline"]:
        if e["event"] in ("scrubbed", "reassigned"):
            churn[e["at"][:10]] += 1
print(f"churn (scrubs + reassignments): total {sum(churn.values())} · busiest days {churn.most_common(4)}")


def weekdays(d0, d1):
    return sum(1 for k in range((d1 - d0).days + 1) if (d0 + timedelta(days=k)).weekday() < 5)


def plan_day_of(e):                       # a deferral stamped at cutoff refers to the next day's plan
    return date.fromisoformat(e["at"][:10]) + timedelta(days=1)


def harmattan_crew_deferrals(d0, d1):
    return sum(1 for r, e in def_events if r["airframe"] == "Harmattan" and d0 <= plan_day_of(e) <= d1
               and e["reason"] in ("no_rated_pilot", "no_rated_operator"))


pre = harmattan_crew_deferrals(START, CROSS_RATING_DATE - timedelta(days=1))
post = harmattan_crew_deferrals(CROSS_RATING_DATE, END)
pre_rate = pre / weekdays(START, CROSS_RATING_DATE - timedelta(days=1))
post_rate = post / weekdays(CROSS_RATING_DATE, END)
print(f"D1 Harmattan crew deferrals/weekday: before cross-rating {pre_rate:.2f} ({pre})  after {post_rate:.2f} ({post})"
      f"  drop {1 - post_rate / pre_rate:.0%}")
harm = Counter(e["reason"] for r, e in def_events if r["airframe"] == "Harmattan")
print(f"D1 Harmattan deferral reasons: {dict(harm)}")
# The tell, as the app and sql/analytics/08_the_tell.sql define it: a rated
# operator rostered in a window the request asked for and on no sortie there.
mis = 0
for r, e in def_events:
    if r["airframe"] != "Harmattan" or e["reason"] != "no_rated_operator":
        continue
    D = plan_day_of(e)
    busy = {(pid, a["window"]) for a in assignments if a["date"] == iso(D) and a["status"] != "scrubbed"
            for pid in (a["operator_id"], a["pilot_id"]) if pid}
    idle = [p for p in persons if "operator" in p["roles"] and rated_on(p, "Harmattan", D)
            and any(available(p, D, w) and (p["person_id"], w) not in busy for w in r["windows"])]
    mis += bool(idle)
print(f"D1 the tell: {mis}/{harm['no_rated_operator']} 'no_rated_operator' deferrals had a Harmattan-rated "
      f"operator idle in a requested window")
print("D1 cross-rating flights: " + "; ".join(
    f"{r['request_id']} {r['status']} {r['plan_date']} after {sum(e['event'] == 'deferred' for e in r['timeline'])} deferrals"
    for r in requests if r["request_id"] in cq_cross_ids))

s_req = [r for r in requests if r["request_id"] in surge_ids]
s_flown_weekend = sum(1 for a in assignments if a["request_id"] in surge_ids and a["status"] == "done"
                      and SURGE_WEEKEND[0] <= date.fromisoformat(a["date"]) <= SURGE_WEEKEND[1])
print(f"D2 surge: {len(s_req)} SBU requests · flown on the weekend {s_flown_weekend} · "
      f"deferred at least once {sum(any(e['event'] == 'deferred' for e in r['timeline']) for r in s_req)} · "
      f"late {sum(r['late'] for r in s_req)} · final {dict(Counter(r['status'] for r in s_req))}")


def lead_days(rs):
    out = []
    for r in rs:
        ex = [e for e in r["timeline"] if e["event"] == "executed"]
        if ex:
            out.append((date.fromisoformat(ex[-1]["at"][:10]) - date.fromisoformat(r["submitted_at"][:10])).days)
    return sorted(out)


ld_all, ld_surge = lead_days(requests), lead_days(s_req)
p = lambda xs, q: xs[min(len(xs) - 1, int(q * len(xs)))] if xs else None
print(f"D2 lead time days p50/p90: all {p(ld_all, .5)}/{p(ld_all, .9)} · surge {p(ld_surge, .5)}/{p(ld_surge, .9)}")

g_days = sum((date.fromisoformat(h["date_to"]) - date.fromisoformat(h["date_from"])).days + 1
             for a in assets for h in a["status_history"] if h["status"] == "grounded")
print(f"D3 grounding days: {g_days} ({ARC3_FAILURE_ID})")
pn_days = []
for k in range((GROUNDING[1] - GROUNDING[0]).days + 1):
    D = GROUNDING[0] + timedelta(days=k)
    if D.weekday() >= 5:
        continue
    n = len({a["asset_id"] for a in assignments if a["date"] == iso(D) and a["status"] == "done"
             and PROG[REQ[a["request_id"]]["program_id"]]["code"] == "PN"})
    pn_days.append((iso(D)[5:], n))
print(f"D3 PN tails/day Jun 10–18: {pn_days}  under min(3): {sum(n < 3 for _, n in pn_days)}")


def util(airframe, d0, d1):
    """(asset-window utilization, tail-day saturation) over operating days;
    grounded/maintenance tails leave the denominator."""
    used_w = avail_w = used_t = avail_t = 0
    for k in range((d1 - d0).days + 1):
        D = d0 + timedelta(days=k)
        if not any(p["availability"].get(iso(D)) for p in persons):
            continue
        tails = [a for a in assets if a["airframe"] == airframe
                 and asset_status_on(a, D)[0] not in ("grounded", "maintenance")]
        avail_w += sum(len(a["windows"]) for a in tails)
        avail_t += len(tails)
        todays = [a for a in assignments if a["date"] == iso(D) and a["status"] == "done"
                  and ASSET[a["asset_id"]]["airframe"] == airframe]
        used_w += len(todays)
        used_t += len({a["asset_id"] for a in todays})
    return (used_w / avail_w if avail_w else 0, used_t / avail_t if avail_t else 0)


u3, um = util("Levant", GROUNDING[0], GROUNDING[1]), util("Levant", date(2026, 5, 1), date(2026, 5, 31))
print(f"D3 Levant utilization Jun 10–18: windows {u3[0]:.0%} · tail-days {u3[1]:.0%}  "
      f"(May: windows {um[0]:.0%} · tail-days {um[1]:.0%})  "
      f"asset_grounded deferrals: {sum(e['reason'] == 'asset_grounded' for _, e in def_events)}")

tom = [a for a in assignments if a["date"] == iso(TOMORROW)]
queue = [r for r in requests if r["status"] in ("submitted", "deferred") and r["plan_date"]
         and date.fromisoformat(r["plan_date"]) <= TOMORROW]
print(f"tomorrow {iso(TOMORROW)}: planned {len(tom)} · unscheduled {len(queue)} "
      f"(P0: {sum(r['priority'] == 'P0' for r in queue)}) · "
      f"{[(r['request_id'], PROG[r['program_id']]['code'], r['priority'], r['status']) for r in queue]}")
assert sum(r["priority"] == "P0" for r in queue) == 2, "demo needs exactly two unscheduled P0 tomorrow"
