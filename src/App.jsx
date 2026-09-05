import { useEffect, useMemo, useState } from 'react';
import runsData from './data/test_runs.json';
import failuresData from './data/failures.json';
import meta from './data/meta.json';
import { maxDate, isUnresolved, missingArtifacts, fmtDate } from './lib/helpers';
import RunsView from './views/RunsView';
import TriageView from './views/TriageView';
import AnalyticsView from './views/AnalyticsView';
import ReportsView from './views/ReportsView';

// Short labels so all four fit a phone width; the header already says
// what the app is, the tabs only need to say where you're going.
const TABS = ['Runs', 'Triage', 'Analytics', 'Reports'];

// Theme modes cycle in this order; 'system' follows the OS preference live.
const THEMES = [
  { pref: 'system', glyph: '◐', label: 'Auto' },
  { pref: 'light', glyph: '○', label: 'Light' },
  { pref: 'dark', glyph: '●', label: 'Dark' },
];

export default function App() {
  const [tab, setTab] = useState(0);
  // Which panel the Reports view should scroll to on arrival (from a stat card).
  const [reportsFocus, setReportsFocus] = useState(null);

  function go(i, focus = null) {
    setReportsFocus(focus);
    setTab(i);
  }

  // Theme preference ('system' | 'light' | 'dark') vs. resolved theme: only
  // the preference is persisted; index.html re-resolves it before first paint.
  const [pref, setPref] = useState(() => {
    const saved = localStorage.getItem('stratus-theme');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  });
  const [osTheme, setOsTheme] = useState(() =>
    matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
  );
  const theme = pref === 'system' ? osTheme : pref;

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: light)');
    const onChange = (e) => setOsTheme(e.matches ? 'light' : 'dark');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('stratus-theme', pref);
  }, [theme, pref]);

  // Failures live in state so the triage stepper can advance them.
  const [failures, setFailures] = useState(failuresData);

  const today = useMemo(() => maxDate(runsData), []);

  const stats = useMemo(() => {
    const total = runsData.length;
    const pass = runsData.filter((r) => r.status === 'pass').length;
    const active = failures.filter(isUnresolved).length;
    const gaps = runsData.filter((r) => missingArtifacts(r).length > 0).length;
    return { total, passRate: Math.round((pass / total) * 100), active, gaps };
  }, [failures]);

  // Signature: last 60 runs as a mission-control heartbeat strip.
  const heartbeat = useMemo(() => runsData.slice(-60), []);

  const themeMode = THEMES.find((m) => m.pref === pref);
  const themeNext = THEMES[(THEMES.indexOf(themeMode) + 1) % THEMES.length];

  return (
    <div className="app">
      <header className="hdr">
        <div>
          <div className="eyebrow">Stratus Aerial · Flight Test Operations</div>
          <h1>RCCA Test Tracker</h1>
          <div className="window">
            {fmtDate(meta.window_start)} – {fmtDate(meta.window_end)} 2026 · 90-day window
          </div>
        </div>
        <div className="heartbeat" role="img"
          aria-label={`Last 60 runs: ${heartbeat.filter((r) => r.status === 'pass').length} pass, ${heartbeat.filter((r) => r.status === 'fail').length} fail, ${heartbeat.filter((r) => r.status === 'blocked').length} blocked`}>
          <div className="hb-label">
            Last 60 runs
            <span className="hb-key"><i className="pass" />pass <i className="fail" />fail <i className="blocked" />blocked</span>
          </div>
          <div className="hb-row" aria-hidden="true">
            {heartbeat.map((r, i) => (
              <span
                key={r.run_id}
                className={`hb-cell ${r.status}`}
                style={{ animationDelay: `${i * 12}ms` }}
                title={`${r.run_id} · ${r.scenario} · ${r.status}`}
              />
            ))}
          </div>
        </div>
      </header>

      {/* Each number links to the view where you act on it — a stat you can't
          click is a stat card that looks clickable and isn't. */}
      <section className="stats" aria-label="Summary">
        <button className="stat" onClick={() => go(0)}>
          <div className="k">Test runs (90d)</div>
          <div className="v">{stats.total}</div>
          <div className="sub">SIM {runsData.filter((r) => r.pipeline === 'Simulation').length} ·
            HIL {runsData.filter((r) => r.pipeline === 'HIL Bench').length} ·
            FLT {runsData.filter((r) => r.pipeline === 'Flight').length}</div>
        </button>
        <button className="stat" onClick={() => go(3, 'trend')}>
          <div className="k">Pass rate</div>
          <div className="v">{stats.passRate}%</div>
          <div className="sub">weekly trend →</div>
        </button>
        <button className="stat" onClick={() => go(1)}>
          <div className="k">Active failures</div>
          <div className={`v ${stats.active > 0 ? 'warn' : ''}`}>{stats.active}</div>
          <div className="sub">open triage queue →</div>
        </button>
        <button className="stat" onClick={() => go(3, 'gaps')}>
          <div className="k">Artifact gaps</div>
          <div className={`v ${stats.gaps > 0 ? 'bad' : ''}`}>{stats.gaps}</div>
          <div className="sub">runs missing artifacts →</div>
        </button>
      </section>

      <nav className="tabs" aria-label="Views">
        {TABS.map((t, i) => (
          <button key={t} className={`tab ${tab === i ? 'on' : ''}`} aria-current={tab === i ? 'page' : undefined} onClick={() => go(i)}>
            {t}
          </button>
        ))}
        <button
          className="theme-toggle"
          onClick={() => setPref(themeNext.pref)}
          title={`Theme: ${themeMode.label} · click for ${themeNext.label}`}
          aria-label={`Theme: ${themeMode.label}. Switch to ${themeNext.label}`}
        >
          {themeMode.glyph} {themeMode.label}
        </button>
      </nav>

      {tab === 0 && <RunsView runs={runsData} />}
      {tab === 1 && (
        <TriageView failures={failures} setFailures={setFailures} runs={runsData} today={today} />
      )}
      {tab === 2 && <AnalyticsView failures={failures} theme={theme} />}
      {tab === 3 && (
        <ReportsView runs={runsData} failures={failures} today={today} theme={theme} focus={reportsFocus} />
      )}

      <footer className="foot">
        All data is synthetic — generated by generate_data.py to demonstrate RCCA workflow design.
        Built by Thilanka Rodrigo.
      </footer>
    </div>
  );
}
