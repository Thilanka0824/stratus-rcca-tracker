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
