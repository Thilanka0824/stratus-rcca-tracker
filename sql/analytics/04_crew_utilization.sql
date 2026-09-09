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
