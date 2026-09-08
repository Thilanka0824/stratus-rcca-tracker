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
