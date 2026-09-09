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
