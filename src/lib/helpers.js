// Shared helpers. "Today" is anchored to the last date in the dataset so
// aging math is deterministic — honest for synthetic data.

export const dayMs = 86400000;

export function maxDate(runs) {
  return runs.reduce((m, r) => (r.date > m ? r.date : m), runs[0].date);
}

export function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / dayMs);
}

export function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Age in days for a failure, relative to dataset "today".
// Resolved failures stop aging at their resolution date.
export function failureAge(f, today) {
  return daysBetween(f.opened, f.resolved || today);
}

export function isUnresolved(f) {
  return f.triage_status !== 'Verified';
}

export function isAging(f, today) {
  return isUnresolved(f) && failureAge(f, today) > 7;
}

// Required artifacts differ by pipeline: video is n/a for Simulation.
export function missingArtifacts(run) {
  const miss = [];
  if (!run.artifacts.logs) miss.push('logs');
  if (!run.artifacts.telemetry) miss.push('telemetry');
  if (run.artifacts.video === false) miss.push('video');
  return miss;
}

// Weekly pass-rate series: one point per ISO week, overall + per pipeline.
export function weeklyPassRate(runs) {
  const weeks = new Map();
  for (const r of runs) {
    const d = new Date(r.date + 'T00:00:00');
    // Snap to Monday of that week for a stable bucket key
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    if (!weeks.has(key)) {
      weeks.set(key, { key, total: 0, pass: 0, pipes: {} });
    }
    const w = weeks.get(key);
    w.total += 1;
    if (r.status === 'pass') w.pass += 1;
    const p = (w.pipes[r.pipeline] ||= { total: 0, pass: 0 });
    p.total += 1;
    if (r.status === 'pass') p.pass += 1;
  }
  return [...weeks.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((w) => {
      const row = { week: fmtDate(w.key), Overall: pct(w.pass, w.total) };
      for (const [pipe, p] of Object.entries(w.pipes)) {
        row[pipe] = pct(p.pass, p.total);
      }
      return row;
    });
}

function pct(a, b) {
  return b === 0 ? null : Math.round((a / b) * 100);
}

// Pareto of root causes, weighted by occurrence count (a failure seen 9 times
// matters more than one seen once). Uncategorized failures are excluded —
// you can't Pareto what you haven't root-caused yet.
export function paretoRootCauses(failures) {
  const counts = new Map();
  for (const f of failures) {
    if (!f.root_cause) continue;
    const n = Math.max(1, f.occurrences.length);
    counts.set(f.root_cause, (counts.get(f.root_cause) || 0) + n);
  }
  const rows = [...counts.entries()]
    .map(([cause, count]) => ({ cause, count }))
    .sort((a, b) => b.count - a.count);
  const total = rows.reduce((s, r) => s + r.count, 0);
  let running = 0;
  return rows.map((r) => {
    running += r.count;
    return { ...r, cumulative: Math.round((running / total) * 100) };
  });
}

export function failuresByTeam(failures) {
  const counts = new Map();
  for (const f of failures) {
    counts.set(f.team, (counts.get(f.team) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([team, count]) => ({ team, count }))
    .sort((a, b) => b.count - a.count);
}

// Shared recharts theme — one source of truth for both chart views.
// SVG presentation attributes can't resolve CSS variables, so chart colors
// live here per theme; keep values in sync with the tokens in styles.css.
const MONO = "'IBM Plex Mono', monospace";

const CHART_THEMES = {
  dark: {
    AXIS: { fill: '#8b96a8', fontSize: 11, fontFamily: MONO },
    GRID: '#232b3a',
    TIP: {
      contentStyle: {
        background: '#171c26', border: '1px solid #232b3a', borderRadius: 6,
        fontFamily: MONO, fontSize: 12,
      },
      labelStyle: { color: '#e8ecf4' },
    },
    INK: '#e8ecf4',
    ACCENT: '#6e8cb8',
    AMBER: '#d9a441',
    GREEN: '#4caf7d',
    CURSOR: 'rgba(110, 140, 184, 0.08)',
  },
  light: {
    AXIS: { fill: '#5a6478', fontSize: 11, fontFamily: MONO },
    GRID: '#d7dce5',
    TIP: {
      contentStyle: {
        background: '#ffffff', border: '1px solid #d7dce5', borderRadius: 6,
        fontFamily: MONO, fontSize: 12,
      },
      labelStyle: { color: '#1a2130' },
    },
    INK: '#1a2130',
    ACCENT: '#3d6398',
    AMBER: '#96700a',
    GREEN: '#1f7a4d',
    CURSOR: 'rgba(61, 99, 152, 0.08)',
  },
};

export function chartTheme(theme) {
  return CHART_THEMES[theme] ?? CHART_THEMES.dark;
}
