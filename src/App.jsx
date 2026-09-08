import { useEffect, useMemo, useRef, useState } from 'react';
import runsData from './data/test_runs.json';
import failuresData from './data/failures.json';
import programsData from './data/programs.json';
import assetsData from './data/assets.json';
import personsData from './data/persons.json';
import requestsData from './data/requests.json';
import assignmentsData from './data/assignments.json';
import meta from './data/meta.json';
import { maxDate, isUnresolved, missingArtifacts, fmtDate } from './lib/helpers';
import { daySummary } from './lib/dispatch';
import { makeDb, checkAssignment, hasBlock, nextAssignmentId, scheduleRequest, deferRequest, scrubAssignment, scrubRequest } from './lib/rules';
import RequestsView from './views/RequestsView';
import DispatchView from './views/DispatchView';
import CapacityView from './views/CapacityView';
import RunsView from './views/RunsView';
import TriageView from './views/TriageView';
import AnalyticsView from './views/AnalyticsView';
import ReportsView from './views/ReportsView';

// Two groups by index, no router: Plan is the upstream half (requests in,
// tails and crew out), Execute is the downstream half (runs → RCCA).
// Short labels so the row fits a phone; the header says what the app is.
const TABS = [
  { label: 'Requests', group: 'Plan' },
  { label: 'Dispatch', group: 'Plan' },
  { label: 'Capacity', group: 'Plan' },
  { label: 'Runs', group: 'Execute' },
  { label: 'Triage', group: 'Execute' },
  { label: 'Analytics', group: 'Execute' },
  { label: 'Reports', group: 'Execute' },
];
const idx = (label) => TABS.findIndex((t) => t.label === label);

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
  // Deep-link targets between the Plan views: a day on the board, a request in the queue.
  const [boardDate, setBoardDate] = useState(meta.tomorrow);
  const [requestFocus, setRequestFocus] = useState(null);
  const [triageFocus, setTriageFocus] = useState(null);

  function go(i, focus = null) {
    setReportsFocus(focus);
    setTab(i);
  }
  function openBoard(date) {
    setBoardDate(date);
    go(idx('Dispatch'));
  }
  function openRequest(id) {
    setRequestFocus(id);
    go(idx('Requests'));
  }
  function openFailure(id) {
    setTriageFocus(id);
    go(idx('Triage'));
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

  // Mutable state, all session-only: failures (the triage stepper), and the
  // request queue + assignments (the dispatch board). The seed is the truth
  // on reload — by design, there is no backend to prove here.
  const [failures, setFailures] = useState(failuresData);
  const [requests, setRequests] = useState(requestsData);
  const [assignments, setAssignments] = useState(assignmentsData);
  const db = useMemo(
    () => makeDb({ programs: programsData, assets: assetsData, persons: personsData, requests, assignments }),
    [requests, assignments],
  );

  const today = useMemo(() => maxDate(runsData), []);

  // Board edits go through the rules: a block is returned to the caller and
  // nothing is saved; a deferral or scrub without a reason cannot be built.
  // Edits are stamped in the evening of dataset "today", in order.
  const editStamp = useRef(0);
  const stampNow = () => `${today}T18:${String(editStamp.current++ % 60).padStart(2, '0')}`;

  function assign(cand) {
    const violations = checkAssignment(cand, db);
    if (hasBlock(violations)) return violations;
    const a = { assignment_id: nextAssignmentId(), ...cand, status: 'planned', scrub_reason: null, run_id: null, notes: 'assigned on the board' };
    const at = stampNow();
    setAssignments((prev) => [...prev, a]);
    setRequests((prev) => prev.map((r) => (r.request_id === cand.request_id ? scheduleRequest(r, a, at) : r)));
    return violations;
  }
  function defer(requestId, reason, note) {
    const at = stampNow();
    setRequests((prev) => prev.map((r) => (r.request_id === requestId ? deferRequest(r, { reason, day: boardDate, at, note }) : r)));
  }
  function scrub(assignmentId, reason) {
    const a = assignments.find((x) => x.assignment_id === assignmentId);
    if (!a) return;
    const at = stampNow();
    setAssignments((prev) => prev.map((x) => (x.assignment_id === assignmentId ? scrubAssignment(x, { reason }) : x)));
    setRequests((prev) => prev.map((r) => (r.request_id === a.request_id ? scrubRequest(r, a, { reason, at }) : r)));
  }

  const stats = useMemo(() => {
    const total = runsData.length;
    const pass = runsData.filter((r) => r.status === 'pass').length;
    const active = failures.filter(isUnresolved).length;
    const gaps = runsData.filter((r) => missingArtifacts(r).length > 0).length;
    return { total, passRate: Math.round((pass / total) * 100), active, gaps };
  }, [failures]);

  // The upstream number that matters tonight: P0 requests still unscheduled for tomorrow.
  const tomorrow = useMemo(() => daySummary(db, meta.tomorrow), [db]);

  // Signature: last 60 runs as a mission-control heartbeat strip.
  const heartbeat = useMemo(() => runsData.slice(-60), []);

  const themeMode = THEMES.find((m) => m.pref === pref);
  const themeNext = THEMES[(THEMES.indexOf(themeMode) + 1) % THEMES.length];
  const groups = [...new Set(TABS.map((t) => t.group))];

  return (
    <div className="app">
      <header className="hdr">
        <div>
          <div className="eyebrow">Stratus Aerial · Test Operations</div>
          <h1>Test Operations Platform</h1>
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
        <button className="stat" onClick={() => go(idx('Runs'))}>
          <div className="k">Test runs (90d)</div>
          <div className="v">{stats.total}</div>
          <div className="sub">SIM {runsData.filter((r) => r.pipeline === 'Simulation').length} ·
            HIL {runsData.filter((r) => r.pipeline === 'HIL Bench').length} ·
            FLT {runsData.filter((r) => r.pipeline === 'Flight').length}</div>
        </button>
        <button className="stat" onClick={() => go(idx('Reports'), 'trend')}>
          <div className="k">Pass rate</div>
          <div className="v">{stats.passRate}%</div>
          <div className="sub">weekly trend →</div>
        </button>
        <button className="stat" onClick={() => go(idx('Triage'))}>
          <div className="k">Active failures</div>
          <div className={`v ${stats.active > 0 ? 'warn' : ''}`}>{stats.active}</div>
          <div className="sub">open triage queue →</div>
        </button>
        <button className="stat" onClick={() => go(idx('Reports'), 'gaps')}>
          <div className="k">Artifact gaps</div>
          <div className={`v ${stats.gaps > 0 ? 'bad' : ''}`}>{stats.gaps}</div>
          <div className="sub">runs missing artifacts →</div>
        </button>
        <button className="stat" onClick={() => openBoard(meta.tomorrow)}>
          <div className="k">Tomorrow: unscheduled P0</div>
          <div className={`v ${tomorrow.p0 > 0 ? 'bad' : ''}`}>{tomorrow.p0}</div>
          <div className="sub">{tomorrow.sorties} sorties planned · {tomorrow.unscheduled} waiting →</div>
        </button>
      </section>

      <nav className="tabs" aria-label="Views">
        {groups.map((g) => (
          <div key={g} className="tab-set" role="group" aria-label={`${g} views`}>
            <span className="tab-group" aria-hidden="true">{g}</span>
            {TABS.map((t, i) => t.group === g && (
              <button key={t.label} className={`tab ${tab === i ? 'on' : ''}`} aria-current={tab === i ? 'page' : undefined} onClick={() => go(i)}>
                {t.label}
              </button>
            ))}
          </div>
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

      {tab === idx('Requests') && (
        <RequestsView db={db} meta={meta} today={today} onOpenBoard={openBoard} focusId={requestFocus} />
      )}
      {tab === idx('Dispatch') && (
        <DispatchView
          db={db} meta={meta} today={today} date={boardDate} setDate={setBoardDate}
          onAssign={assign} onDefer={defer} onScrub={scrub} onOpenRequest={openRequest} onOpenFailure={openFailure}
        />
      )}
      {tab === idx('Capacity') && <CapacityView db={db} meta={meta} today={today} theme={theme} failures={failures} />}
      {tab === idx('Runs') && <RunsView runs={runsData} db={db} />}
      {tab === idx('Triage') && (
        <TriageView failures={failures} setFailures={setFailures} runs={runsData} today={today} db={db} focusId={triageFocus} onOpenBoard={openBoard} />
      )}
      {tab === idx('Analytics') && <AnalyticsView failures={failures} theme={theme} />}
      {tab === idx('Reports') && (
        <ReportsView runs={runsData} failures={failures} today={today} theme={theme} focus={reportsFocus} db={db} />
      )}

      <footer className="foot">
        All data is synthetic — generated by generate_data.py to demonstrate test-operations workflow design.
        Board and triage edits live in this session only. Built by Thilanka Rodrigo.
      </footer>
    </div>
  );
}
