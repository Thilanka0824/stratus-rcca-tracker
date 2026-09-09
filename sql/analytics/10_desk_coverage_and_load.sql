-- The rider desk: coverers on comms vs rider-facing sorties flown, per
-- window, and the load per coverer against the ratio of 2 (R10). Only the
-- windows worth reading are listed — at or over the ratio, or in the
-- showcase week (Jun 15–19, arc D4), which is where the ratio cost a P0.
WITH cov AS (
  SELECT date, window, count(*) AS coverers FROM coverage GROUP BY date, window
),
riders AS (
  SELECT a.date, a.window, count(*) AS rider_facing
  FROM assignments a JOIN requests r ON r.request_id = a.request_id
  WHERE a.status <> 'scrubbed' AND r.rider_facing = 1
  GROUP BY a.date, a.window
),
slots AS (
  SELECT date, window FROM cov UNION SELECT date, window FROM riders
)
SELECT s.date, s.window,
       coalesce(c.coverers, 0)     AS coverers,
       coalesce(r.rider_facing, 0) AS rider_facing,
       CASE WHEN coalesce(c.coverers, 0) = 0 THEN NULL
            ELSE round(1.0 * coalesce(r.rider_facing, 0) / c.coverers, 2) END AS load_per_coverer,
       CASE WHEN s.date BETWEEN '2026-06-15' AND '2026-06-19' THEN 'D4' ELSE '' END AS arc
FROM slots s
LEFT JOIN cov c    ON c.date = s.date AND c.window = s.window
LEFT JOIN riders r ON r.date = s.date AND r.window = s.window
WHERE coalesce(r.rider_facing, 0) > 0
  AND (coalesce(r.rider_facing, 0) >= 2 * coalesce(c.coverers, 0) OR s.date BETWEEN '2026-06-15' AND '2026-06-19')
ORDER BY s.date, CASE s.window WHEN 'AM' THEN 0 WHEN 'PM' THEN 1 ELSE 2 END;
