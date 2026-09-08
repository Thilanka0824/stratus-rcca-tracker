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
