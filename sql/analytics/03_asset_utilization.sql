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
