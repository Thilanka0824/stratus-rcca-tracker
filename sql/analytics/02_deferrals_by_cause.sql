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
