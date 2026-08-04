import { useEffect, useMemo, useState } from 'react';
import runsData from './data/test_runs.json';
import failuresData from './data/failures.json';
import meta from './data/meta.json';
import { maxDate, isUnresolved, missingArtifacts, fmtDate } from './lib/helpers';
import RunsView from './views/RunsView';
import TriageView from './views/TriageView';
import AnalyticsView from './views/AnalyticsView';
import ReportsView from './views/ReportsView';

const TABS = ['Test Runs', 'Failure Triage', 'RCCA Analytics', 'Reports'];

// Theme modes cycle in this order; 'system' follows the OS preference live.
const THEMES = [
  { pref: 'system', glyph: '◐', label: 'Auto' },
  { pref: 'light', glyph: '○', label: 'Light' },
  { pref: 'dark', glyph: '●', label: 'Dark' },
];

export default function App() {
  const [tab, setTab] = useState(0);

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
            {fmtDate(meta.window_start)} – {fmtDate(meta.window_end)} 2026 · synthetic dataset ·
            seeded via generate_data.py
          </div>
        </div>
        <div className="heartbeat" aria-label="Status of the last 60 test runs">
          <div className="hb-label">Last 60 runs</div>
          <div className="hb-row">
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

      <section className="stats">
        <div className="stat">
          <div className="k">Test runs (90d)</div>
          <div className="v">{stats.total}</div>
          <div className="sub">SIM {runsData.filter((r) => r.pipeline === 'Simulation').length} ·
            HIL {runsData.filter((r) => r.pipeline === 'HIL Bench').length} ·
            FLT {runsData.filter((r) => r.pipeline === 'Flight').length}</div>
        </div>
        <div className="stat">
          <div className="k">Pass rate</div>
          <div className="v">{stats.passRate}%</div>
          <div className="sub">across all pipelines</div>
        </div>
        <div className="stat">
          <div className="k">Active failures</div>
          <div className={`v ${stats.active > 0 ? 'warn' : ''}`}>{stats.active}</div>
          <div className="sub">unresolved (not Verified)</div>
        </div>
        <div className="stat">
          <div className="k">Artifact gaps</div>
          <div className={`v ${stats.gaps > 0 ? 'bad' : ''}`}>{stats.gaps}</div>
          <div className="sub">runs missing required artifacts</div>
        </div>
      </section>

      <nav className="tabs" aria-label="Views">
        {TABS.map((t, i) => (
          <button key={t} className={`tab ${tab === i ? 'on' : ''}`} onClick={() => setTab(i)}>
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
        <ReportsView runs={runsData} failures={failures} today={today} theme={theme} />
      )}

      <footer className="foot">
        All data is synthetic — generated by generate_data.py to demonstrate RCCA workflow design.
        Built by Thilanka Rodrigo.
      </footer>
    </div>
  );
}
