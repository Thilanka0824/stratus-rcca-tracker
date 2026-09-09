import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  weeklyPassRate, missingArtifacts, fmtDate, failureAge, isUnresolved, isAging,
  chartTheme,
} from '../lib/helpers';
import { addDays, REASON_LABELS, WINDOWS } from '../lib/rules';
import { daySummary, deskByDay, actionsByRole, ACTION_COLUMNS } from '../lib/dispatch';

export default function ReportsView({ runs, failures, today, theme, focus, db, audit = [] }) {
  const { AXIS, GRID, TIP, INK, ACCENT, AMBER, GREEN } = chartTheme(theme);
  const lineColors = {
    Overall: INK,
    Simulation: ACCENT,
    'HIL Bench': AMBER,
    Flight: GREEN,
  };
  const trend = useMemo(() => weeklyPassRate(runs), [runs]);
  const gaps = useMemo(
    () =>
      runs
        .filter((r) => missingArtifacts(r).length > 0)
        .slice()
        .reverse(),
    [runs],
  );

  const dates = useMemo(
    () => [...new Set(runs.map((r) => r.date))].sort().reverse(),
    [runs],
  );
  const [reportDate, setReportDate] = useState(dates[0]);
  const [copied, setCopied] = useState(false);

  // Arriving from a stat card: land on the panel that number came from, and
  // put keyboard focus there too, so the next Tab continues from the panel
  // instead of snapping back to the header. Reduced motion means no animation.
  const trendRef = useRef(null);
  const gapsRef = useRef(null);
  useEffect(() => {
    const el = focus?.panel === 'gaps' ? gapsRef.current : focus?.panel === 'trend' ? trendRef.current : null;
    if (!el) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  }, [focus]);

  const report = useMemo(
    () => buildEodReport(runs, failures, reportDate, today, db, audit),
    [runs, failures, reportDate, today, db, audit],
  );

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard API can be unavailable (permissions, older browsers).
      // The report is selectable text, so manual copy still works.
      setCopied(false);
    }
  }

  return (
    <section>
      <div className="panel" ref={trendRef} tabIndex={-1}>
        <h3>Weekly pass rate by pipeline</h3>
        <p className="caption">
          The v2.15.0 regression is visible as the early-June dip — and the recovery after the
          v2.15.2 fix shipped. A trend chart earns its place when it shows a story like that.
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={trend} margin={{ top: 8, right: 16, left: -12, bottom: 4 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="week" tick={AXIS} />
            <YAxis tick={AXIS} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <Tooltip {...TIP} formatter={(v) => (v == null ? '—' : `${v}%`)} />
            <Legend wrapperStyle={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }} />
            {Object.entries(lineColors).map(([key, color]) => (
              <Line
                key={key}
                dataKey={key}
                stroke={color}
                strokeWidth={key === 'Overall' ? 2.5 : 1.5}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="panel" ref={gapsRef} tabIndex={-1}>
        <h3>Artifact integrity — {gaps.length} runs with missing artifacts</h3>
        <p className="caption">
          A test you can't audit is a test you can't trust. The May–June cluster of missing
          flight telemetry traces to the "telemetry uploader race" failure in the triage queue.
        </p>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Date</th>
                <th>Pipeline</th>
                <th>Scenario</th>
                <th>Missing</th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((r) => (
                <tr key={r.run_id}>
                  <td className="mono">{r.run_id}</td>
                  <td className="mono dim">{fmtDate(r.date)}</td>
                  <td className="dim">{r.pipeline}</td>
                  <td className="scenario">{r.scenario}</td>
                  <td className="mono" style={{ color: 'var(--fail)' }}>
                    {missingArtifacts(r).join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>End-of-day test report</h3>
        <p className="caption">
          Generated from the selected day's data — the report a test coordinator sends before
          leaving the building.
        </p>
        <div className="filters">
          <select
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            aria-label="Report date"
          >
            {dates.map((d) => (
              <option key={d} value={d}>
                {fmtDate(d)}
              </option>
            ))}
          </select>
          <button className="btn" onClick={copyReport}>
            {copied ? 'Copied ✓' : 'Copy report'}
          </button>
        </div>
        <div className="eod">{report}</div>
      </div>
    </section>
  );
}

function buildEodReport(runs, failures, date, today, db, audit) {
  const day = runs.filter((r) => r.date === date);
  const by = (s) => day.filter((r) => r.status === s).length;
  const pipe = (p) => day.filter((r) => r.pipeline === p).length;
  const rate = day.length ? Math.round((by('pass') / day.length) * 100) : 0;

  const newFailures = failures.filter((f) => f.opened === date);
  const aging = failures
    .filter((f) => isUnresolved(f) && isAging(f, today))
    .sort((a, b) => failureAge(b, today) - failureAge(a, today));
  const verifiedToday = failures.filter((f) => f.resolved === date);
  const dayGaps = day.filter((r) => missingArtifacts(r).length > 0);

  const lines = [];
  lines.push(`STRATUS RCCA — END OF DAY TEST REPORT — ${date}`);
  lines.push('');
  lines.push(
    `Runs: ${day.length} (SIM ${pipe('Simulation')} / HIL ${pipe('HIL Bench')} / FLT ${pipe('Flight')})` +
      ` · Pass ${by('pass')} · Fail ${by('fail')} · Blocked ${by('blocked')} · Pass rate ${rate}%`,
  );
  lines.push('');
  lines.push('NEW FAILURES:');
  if (newFailures.length === 0) lines.push('  none');
  newFailures.forEach((f) =>
    lines.push(`  ${f.failure_id} (${f.severity}) ${f.title} — ${f.team}, ${f.triage_status}`),
  );
  lines.push('');
  lines.push('AGING (>7d unresolved):');
  if (aging.length === 0) lines.push('  none');
  aging.forEach((f) =>
    lines.push(
      `  ${f.failure_id} (${f.severity}) ${failureAge(f, today)}d — ${f.triage_status} — ${f.title}`,
    ),
  );
  lines.push('');
  lines.push('FIX VERIFIED TODAY:');
  if (verifiedToday.length === 0) lines.push('  none');
  verifiedToday.forEach((f) => lines.push(`  ${f.failure_id} — ${f.title}`));
  lines.push('');
  lines.push('ARTIFACT GAPS TODAY:');
  if (dayGaps.length === 0) lines.push('  none');
  dayGaps.forEach((r) =>
    lines.push(`  ${r.run_id} (${r.pipeline}) missing ${missingArtifacts(r).join(', ')}`),
  );
  // The upstream half: what tomorrow's plan looks like as of this evening.
  const plan = daySummary(db, addDays(date, 1));
  lines.push('');
  lines.push(`TOMORROW'S PLAN (${plan.date}):`);
  lines.push(`  ${plan.sorties} sorties planned · ${plan.unscheduled} unscheduled (P0: ${plan.p0})${plan.late ? ` · ${plan.late} late intake` : ''}`);
  lines.push(
    plan.byCause.length === 0
      ? '  deferrals by cause: none'
      : `  deferrals by cause: ${plan.byCause.map((c) => `${REASON_LABELS[c.cause] ?? c.cause} ${c.count}`).join(' · ')}`,
  );
  // The desk that covered today, and who did what — every action has an actor (R9).
  const desk = deskByDay(db, date, date)[0];
  lines.push('');
  lines.push('RIDER DESK TODAY:');
  lines.push(desk
    ? `  ${WINDOWS.map((w) => `${w} ${desk[`${w} coverers`]} covering / ${desk[`${w} riders`]} rider-facing`).join(' · ')}`
    : '  no operations');
  const acts = actionsByRole(db, audit, { from: date, to: date });
  lines.push('');
  lines.push('ACTIONS BY ROLE TODAY:');
  if (acts.length === 0) lines.push('  none');
  acts.forEach((row) =>
    lines.push(`  ${row.user.name} (${row.user.role}) — ${ACTION_COLUMNS.filter((c) => row[c]).map((c) => `${c} ${row[c]}`).join(' · ')}`),
  );
  return lines.join('\n');
}
