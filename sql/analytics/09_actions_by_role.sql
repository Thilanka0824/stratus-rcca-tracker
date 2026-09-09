-- Actions by role. Every request event carries its actor (R9) and the desk
-- roster carries who built it. Deferrals and scrubs are the coordinators';
-- filings are the requesters' and the leads' — a coordinator files on behalf
-- of people without a persona. The late-intake deferral is stamped at intake
-- by the filer, so it counts as filing, not as a plan decision.
WITH ev AS (
  SELECT e.actor_id AS user_id,
         CASE WHEN e.event = 'submitted' OR (e.event = 'deferred' AND e.reason = 'late_intake') THEN 'filed'
              WHEN e.event IN ('scheduled', 'reassigned', 'executed') THEN 'assigned'
              WHEN e.event IN ('deferred', 'rescheduled') THEN 'deferred'
              WHEN e.event = 'scrubbed' THEN 'scrubbed'
              ELSE 'other' END AS action
  FROM request_events e
  UNION ALL
  SELECT c.assigned_by, 'covered' FROM coverage c
  UNION ALL
  SELECT q.granted_by, 'granted' FROM qualifications q WHERE q.granted_by IS NOT NULL
  UNION ALL
  SELECT r.granted_by, 'granted' FROM person_ratings r WHERE r.granted_by IS NOT NULL
)
SELECT u.user_id, u.name, u.role,
       sum(action = 'filed')    AS filed,
       sum(action = 'assigned') AS assigned,
       sum(action = 'deferred') AS deferred,
       sum(action = 'scrubbed') AS scrubbed,
       sum(action = 'covered')  AS covered,
       sum(action = 'granted')  AS granted,
       count(*)                 AS total
FROM ev JOIN users u ON u.user_id = ev.user_id
GROUP BY u.user_id, u.name, u.role
ORDER BY total DESC, u.user_id;
