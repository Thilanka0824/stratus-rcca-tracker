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
