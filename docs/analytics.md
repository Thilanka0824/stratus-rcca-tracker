# Stratus analytics notebook

The dispatch metrics as SQL, run against the seed database the generator writes (`data/stratus.sqlite`, schema in `sql/schema.sql`). Dataset today is **2026-06-30**. The app computes the same numbers live in `src/lib/dispatch.js`; where a definition matters (percentiles, denominators) the two are written to agree. Regenerate with `npm run data`.

## on window fulfillment

On-window fulfillment (north star). Requests executed within a requested window on or before needed_by, over requests submitted before cutoff whose day has passed. Late intake is excluded from the denominator on purpose: the metric measures the plan, not intake discipline (that is R7's job).

| priority | requests | on_window | pct |
|---|---|---|---|
| P0 | 182 | 133 | 73.1 |
| P1 | 270 | 266 | 98.5 |
| P2 | 17 | 13 | 76.5 |
| all | 469 | 412 | 87.8 |

<details><summary>query</summary>

```sql
-- On-window fulfillment (north star). Requests executed within a requested
-- window on or before needed_by, over requests submitted before cutoff whose
-- day has passed. Late intake is excluded from the denominator on purpose:
-- the metric measures the plan, not intake discipline (that is R7's job).
WITH today AS (SELECT max(date) AS d FROM test_runs),
eligible AS (
  SELECT r.request_id, r.priority, r.needed_by
  FROM requests r, today
  WHERE r.late = 0 AND r.status <> 'withdrawn' AND r.needed_by <= today.d
),
hit AS (
  SELECT DISTINCT e.request_id
  FROM eligible e
  JOIN assignments a ON a.request_id = e.request_id AND a.status = 'done' AND a.date <= e.needed_by
  JOIN request_windows w ON w.request_id = e.request_id AND w.window = a.window
)
SELECT e.priority,
       count(*)                                        AS requests,
       count(h.request_id)                             AS on_window,
       round(100.0 * count(h.request_id) / count(*), 1) AS pct
FROM eligible e LEFT JOIN hit h ON h.request_id = e.request_id
GROUP BY e.priority
UNION ALL
SELECT 'all', count(*), count(h.request_id), round(100.0 * count(h.request_id) / count(*), 1)
FROM eligible e LEFT JOIN hit h ON h.request_id = e.request_id;
```

</details>

## deferrals by cause

Deferral share by cause, per airframe. Occurrence-weighted: every deferral event counts, so a request deferred three times counts three. This is the Pareto that turns "operator shortage vs pilot shortage" into a number.

| airframe | reason | n | share_pct | cumulative_pct |
|---|---|---|---|---|
| Harmattan | no_rated_pilot | 28 | 45.2 | 45.2 |
| Harmattan | no_rated_operator | 22 | 35.5 | 80.6 |
| Harmattan | late_intake | 11 | 17.7 | 98.4 |
| Harmattan | program_over_max | 1 | 1.6 | 100.0 |
| Levant | late_intake | 17 | 81.0 | 81.0 |
| Levant | asset_grounded | 4 | 19.0 | 100.0 |
| Sirocco | no_asset | 44 | 81.5 | 81.5 |
| Sirocco | late_intake | 8 | 14.8 | 96.3 |
| Sirocco | build_not_ready | 2 | 3.7 | 100.0 |

<details><summary>query</summary>

```sql
-- Deferral share by cause, per airframe. Occurrence-weighted: every deferral
-- event counts, so a request deferred three times counts three. This is the
-- Pareto that turns "operator shortage vs pilot shortage" into a number.
WITH c AS (
  SELECT r.airframe, e.reason, count(*) AS n
  FROM request_events e JOIN requests r ON r.request_id = e.request_id
  WHERE e.event = 'deferred'
  GROUP BY r.airframe, e.reason
)
SELECT airframe, reason, n,
       round(100.0 * n / sum(n) OVER (PARTITION BY airframe), 1) AS share_pct,
       round(100.0 * sum(n) OVER (PARTITION BY airframe ORDER BY n DESC, reason
                                  ROWS UNBOUNDED PRECEDING) / sum(n) OVER (PARTITION BY airframe), 1) AS cumulative_pct
FROM c
ORDER BY airframe, n DESC, reason;
```

</details>

## asset utilization

Asset utilization: assigned asset-windows over available asset-windows, on operating days (anyone rostered), up to dataset "today". Grounded and maintenance tails leave the denominator — never penalize the plan for a grounded tail.

| airframe | available_windows | used_windows | pct |
|---|---|---|---|
| Harmattan | 524 | 143 | 27.3 |
| Levant | 1131 | 306 | 27.1 |
| Sirocco | 264 | 55 | 20.8 |
| all | 1919 | 504 | 26.3 |

<details><summary>query</summary>

```sql
-- Asset utilization: assigned asset-windows over available asset-windows, on
-- operating days (anyone rostered), up to dataset "today". Grounded and
-- maintenance tails leave the denominator — never penalize the plan for a
-- grounded tail.
WITH today AS (SELECT max(date) AS d FROM test_runs),
operating AS (SELECT DISTINCT pa.date AS d FROM person_availability pa, today WHERE pa.date <= today.d),
avail AS (
  SELECT o.d, a.airframe, aw.window
  FROM operating o
  CROSS JOIN assets a
  JOIN asset_windows aw ON aw.asset_id = a.asset_id
  WHERE NOT EXISTS (
    SELECT 1 FROM asset_status_history h
    WHERE h.asset_id = a.asset_id AND h.status IN ('grounded', 'maintenance')
      AND h.date_from <= o.d AND (h.date_to IS NULL OR o.d <= h.date_to))
),
used AS (
  SELECT x.date AS d, a.airframe, x.window
  FROM assignments x JOIN assets a ON a.asset_id = x.asset_id, today
  WHERE x.status <> 'scrubbed' AND x.date <= today.d
)
SELECT av.airframe,
       count(*)                                               AS available_windows,
       (SELECT count(*) FROM used u WHERE u.airframe = av.airframe) AS used_windows,
       round(100.0 * (SELECT count(*) FROM used u WHERE u.airframe = av.airframe) / count(*), 1) AS pct
FROM avail av
GROUP BY av.airframe
UNION ALL
SELECT 'all', count(*), (SELECT count(*) FROM used),
       round(100.0 * (SELECT count(*) FROM used) / count(*), 1)
FROM avail;
```

</details>

## crew utilization

Crew utilization: seats filled over person-windows rostered, per role, up to dataset "today". A person with both roles is in both denominators.

| role | used | person_windows | pct |
|---|---|---|---|
| operator | 274 | 1028 | 26.7 |
| pilot | 489 | 1220 | 40.1 |
| all | 763 | 2248 | 33.9 |

<details><summary>query</summary>

```sql
-- Crew utilization: seats filled over person-windows rostered, per role, up
-- to dataset "today". A person with both roles is in both denominators.
WITH today AS (SELECT max(date) AS d FROM test_runs),
rostered AS (
  SELECT pr.role, count(*) AS person_windows
  FROM person_availability pa
  JOIN person_roles pr ON pr.person_id = pa.person_id, today
  WHERE pa.date <= today.d
  GROUP BY pr.role
),
seats AS (
  SELECT 'operator' AS role, count(operator_id) AS used FROM assignments, today WHERE status <> 'scrubbed' AND date <= today.d
  UNION ALL
  SELECT 'pilot',            count(pilot_id)             FROM assignments, today WHERE status <> 'scrubbed' AND date <= today.d
)
SELECT r.role, s.used, r.person_windows, round(100.0 * s.used / r.person_windows, 1) AS pct
FROM rostered r JOIN seats s ON s.role = r.role
UNION ALL
SELECT 'all', sum(s.used), sum(r.person_windows), round(100.0 * sum(s.used) / sum(r.person_windows), 1)
FROM rostered r JOIN seats s ON s.role = r.role;
```

</details>

## lead time

Lead time: submitted → executed, in days, p50 and p90 per program. The percentile is the value at rank min(n, floor(q·n) + 1) of the sorted sample — the same definition src/lib/dispatch.js uses, so the app and the notebook agree to the day.

| program | n | p50_days | p90_days |
|---|---|---|---|
| CQ | 18 | 1 | 23 |
| PLC | 141 | 1 | 3 |
| PN | 230 | 1 | 1 |
| SBU | 55 | 1 | 5 |
| SF | 5 | 1 | 1 |
| URC | 55 | 1 | 1 |
| all | 504 | 1 | 2 |

<details><summary>query</summary>

```sql
-- Lead time: submitted → executed, in days, p50 and p90 per program. The
-- percentile is the value at rank min(n, floor(q·n) + 1) of the sorted
-- sample — the same definition src/lib/dispatch.js uses, so the app and the
-- notebook agree to the day.
WITH lt AS (
  SELECT r.program_id,
         cast(julianday(e.day) - julianday(substr(r.submitted_at, 1, 10)) AS integer) AS days
  FROM requests r
  JOIN request_events e ON e.request_id = r.request_id AND e.event = 'executed'
),
ranked AS (
  SELECT program_id, days,
         row_number() OVER (PARTITION BY program_id ORDER BY days) AS rn,
         count(*)     OVER (PARTITION BY program_id)               AS n
  FROM lt
  UNION ALL
  SELECT 'all', days,
         row_number() OVER (ORDER BY days),
         count(*)     OVER ()
  FROM lt
)
SELECT coalesce(p.code, ranked.program_id) AS program,
       max(n) AS n,
       max(CASE WHEN rn = min(n, (n * 50) / 100 + 1) THEN days END) AS p50_days,
       max(CASE WHEN rn = min(n, (n * 90) / 100 + 1) THEN days END) AS p90_days
FROM ranked LEFT JOIN programs p ON p.program_id = ranked.program_id
GROUP BY ranked.program_id
ORDER BY program = 'all', program;
```

</details>

## plan churn

Plan churn: scrubs plus same-day reassignments per day, after the plan for that day was set. The busiest days are the surprises — the grounding cascade and the surge weekend should be near the top.

| day | scrubs | reassignments | churn |
|---|---|---|---|
| 2026-06-10 | 2 | 2 | 4 |
| 2026-04-09 | 1 | 1 | 2 |
| 2026-04-16 | 1 | 1 | 2 |
| 2026-05-04 | 1 | 1 | 2 |
| 2026-05-06 | 1 | 1 | 2 |
| 2026-05-22 | 1 | 1 | 2 |
| 2026-06-08 | 1 | 1 | 2 |
| 2026-04-02 | 1 | 0 | 1 |
| 2026-04-08 | 1 | 0 | 1 |
| 2026-05-20 | 1 | 0 | 1 |

<details><summary>query</summary>

```sql
-- Plan churn: scrubs plus same-day reassignments per day, after the plan for
-- that day was set. The busiest days are the surprises — the grounding
-- cascade and the surge weekend should be near the top.
SELECT day,
       sum(event = 'scrubbed')   AS scrubs,
       sum(event = 'reassigned') AS reassignments,
       count(*)                  AS churn
FROM request_events
WHERE event IN ('scrubbed', 'reassigned')
GROUP BY day
ORDER BY churn DESC, day
LIMIT 10;
```

</details>

## grounding days

The loop metric: grounding days attributable to RCCA items — the dispatch cost of the RCCA backlog. Per failure: total tail-days grounded against it and how many of those fell while the failure was still open.

| failure_id | title | triage_status | resolved | grounding_days | days_while_open | tails |
|---|---|---|---|---|---|---|
| F-0011 | Intruder track dropout above 12 m/s closure after planner refactor | Verified | 2026-06-13 | 18 | 8 | LV-03,LV-05 |

<details><summary>query</summary>

```sql
-- The loop metric: grounding days attributable to RCCA items — the dispatch
-- cost of the RCCA backlog. Per failure: total tail-days grounded against it
-- and how many of those fell while the failure was still open.
WITH RECURSIVE g(asset_id, failure_id, d, last) AS (
  SELECT asset_id, failure_id, date_from, coalesce(date_to, (SELECT max(date) FROM test_runs))
  FROM asset_status_history
  WHERE status = 'grounded' AND failure_id IS NOT NULL
  UNION ALL
  SELECT asset_id, failure_id, date(d, '+1 day'), last FROM g WHERE d < last
)
SELECT g.failure_id, f.title, f.triage_status, f.resolved,
       count(*) AS grounding_days,
       sum(CASE WHEN f.resolved IS NULL OR g.d <= f.resolved THEN 1 ELSE 0 END) AS days_while_open,
       group_concat(DISTINCT g.asset_id) AS tails
FROM g JOIN failures f ON f.failure_id = g.failure_id
GROUP BY g.failure_id;
```

</details>

## the tell

The tell. Of the deferrals logged as "no rated operator", how many fell on a day when a rated operator was rostered in a window the request asked for and sat on no sortie in that window? If most of them, the shortage the log describes is not the shortage the roster shows.

| airframe | logged_no_rated_operator | with_rated_operator_idle | pct_refuted |
|---|---|---|---|
| Harmattan | 22 | 15 | 68.2 |

<details><summary>query</summary>

```sql
-- The tell. Of the deferrals logged as "no rated operator", how many fell on
-- a day when a rated operator was rostered in a window the request asked
-- for and sat on no sortie in that window? If most of them, the shortage
-- the log describes is not the shortage the roster shows.
WITH logged AS (
  SELECT e.id, e.day, r.request_id, r.airframe
  FROM request_events e JOIN requests r ON r.request_id = e.request_id
  WHERE e.event = 'deferred' AND e.reason = 'no_rated_operator'
),
idle AS (
  SELECT DISTINCT l.id
  FROM logged l
  JOIN request_windows w  ON w.request_id = l.request_id
  JOIN person_availability pa ON pa.date = l.day AND pa.window = w.window
  JOIN person_roles pr    ON pr.person_id = pa.person_id AND pr.role = 'operator'
  JOIN person_ratings rt  ON rt.person_id = pa.person_id AND rt.airframe = l.airframe
                         AND (rt.effective_from IS NULL OR rt.effective_from <= l.day)
  WHERE NOT EXISTS (
    SELECT 1 FROM assignments a
    WHERE a.date = l.day AND a.window = w.window AND a.status <> 'scrubbed'
      AND (a.operator_id = pa.person_id OR a.pilot_id = pa.person_id))
)
SELECT l.airframe,
       count(*)                                    AS logged_no_rated_operator,
       count(i.id)                                 AS with_rated_operator_idle,
       round(100.0 * count(i.id) / count(*), 1)    AS pct_refuted
FROM logged l LEFT JOIN idle i ON i.id = l.id
GROUP BY l.airframe
ORDER BY logged_no_rated_operator DESC;
```

</details>
