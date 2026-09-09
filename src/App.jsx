import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import runsData from './data/test_runs.json';
import failuresData from './data/failures.json';
import programsData from './data/programs.json';
import assetsData from './data/assets.json';
import personsData from './data/persons.json';
import requestsData from './data/requests.json';
import assignmentsData from './data/assignments.json';
import usersData from './data/users.json';
import coverageData from './data/coverage.json';
import meta from './data/meta.json';
import { maxDate, isUnresolved, missingArtifacts, fmtDate } from './lib/helpers';
import { daySummary } from './lib/dispatch';
import {
  makeDb, checkAssignment, hasBlock, newAssignment, scheduleRequest, deferRequest, scrubAssignment, scrubRequest, withdrawRequest,
  validateRequest, newRequest, isOperatingDay, checkCover, coverWindow, uncoverWindow, acknowledge,
  grantRating, revokeRating, grantQualification, setProgramPriority, setProgramTargets, setDeskSettings,
} from './lib/rules';
import { can, ROLE_LABELS } from './lib/auth';
import RequestsView from './views/RequestsView';
import DispatchView from './views/DispatchView';
import RunsView from './views/RunsView';
import TriageView from './views/TriageView';
import MyDayView from './views/MyDayView';

// The chart views carry recharts (~400 KB minified); they load on first
// visit so the board and the queue paint without it. A failed chunk (offline,
// or a redeploy changed the hashed filename under an open tab) must not blank
// the app and lose the session's edits: the boundary below offers a retry
// that re-issues the import, and only that.
function lazyViews() {
  return {
    CapacityView: lazy(() => import('./views/CapacityView')),
    AnalyticsView: lazy(() => import('./views/AnalyticsView')),
    ReportsView: lazy(() => import('./views/ReportsView')),
  };
}

class ChunkBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="panel" role="alert">
        <h3>This view didn't load</h3>
        <p className="caption">The network dropped or a new version was deployed while this tab was open. Your board and triage edits are still here.</p>
        <button className="btn" onClick={() => { this.setState({ error: null }); this.props.onRetry(); }}>Try again</button>
      </div>
    );
  }
}

// Two groups by index, no router: Plan is the upstream half (requests in,
// tails and crew out), Execute is the downstream half (runs → RCCA).
// Short labels so the row fits a phone; the header says what the app is.
const TABS = [
  { label: 'Requests', group: 'Plan' },
  { label: 'Dispatch', group: 'Plan' },
  { label: 'Capacity', group: 'Plan' },
  { label: 'My day', group: 'Plan' },
  { label: 'Runs', group: 'Execute' },
  { label: 'Triage', group: 'Execute' },
  { label: 'Analytics', group: 'Execute' },
  { label: 'Reports', group: 'Execute' },
];
const idx = (label) => TABS.findIndex((t) => t.label === label);
// The views everyone but crew can open (the matrix's "Capacity, Reports, RCCA analytics" row).
const ANALYTICS_TABS = ['Capacity', 'Analytics', 'Reports'];

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

  // A focus request is a fresh object every time, so clicking the same stat
  // card twice scrolls twice (React would otherwise bail out on equal state).
  const focusSeq = useRef(0);
  function go(i, focus = null) {
    setReportsFocus(focus ? { panel: focus, n: ++focusSeq.current } : null);
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
  const [coverage, setCoverage] = useState(coverageData);            // the rider desk roster
  const [persons, setPersons] = useState(personsData);               // ratings and qualifications the trainer edits
  const [programs, setPrograms] = useState(programsData);            // priority and targets the authority edits
  const [desk, setDesk] = useState(meta.rider_desk);                 // ratio and minimum the PM edits
  // Actions that live outside a request's timeline, with their actor.
  const [audit, setAudit] = useState([]);
  // The persona: state, not identity. Every mutation below carries it as
  // the actor and is refused by the rules when the role does not permit it.
  const [currentUser, setCurrentUser] = useState(() => usersData.find((u) => u.role === 'coordinator'));
  const db = useMemo(
    () => makeDb({ programs, assets: assetsData, persons, requests, assignments, users: usersData, coverage, desk }),
    [programs, persons, requests, assignments, coverage, desk],
  );

  const today = useMemo(() => maxDate(runsData), []);

  // The UI's question, answered by the matrix: { ok } or { ok: false, message }.
  // Controls are disabled with the message as their tooltip, never hidden;
  // enforcement is in the rules, the disabled state is a courtesy.
  const allowed = (action, target = null) => can(currentUser, action, target);
  const viewOk = allowed('view.analytics');
  const isCrew = currentUser.role === 'crew';
  useEffect(() => {
    const label = TABS[tab].label;
    if (!viewOk.ok && ANALYTICS_TABS.includes(label)) setTab(isCrew ? idx('My day') : idx('Dispatch'));
    else if (!isCrew && label === 'My day') setTab(idx('Dispatch'));
  }, [currentUser, tab, viewOk.ok, isCrew]);
  function signIn(user) {
    setCurrentUser(user);
    if (user.role === 'crew') setTab(idx('My day'));
  }

  // Board edits go through the rules: a block is returned to the caller and
  // nothing is saved; a deferral or scrub without a reason cannot be built.
  // Edits are stamped in the evening of dataset "today", in order.
  const editStamp = useRef(0);
  const stampNow = () => `${today}T18:${String(editStamp.current++ % 60).padStart(2, '0')}`;

  // An R9 refusal from a transition is shown like any other block, never thrown at the UI.
  const refused = (e) => [{ rule: 'R9', severity: 'block', message: e.message }];

  function assign(cand) {
    const violations = checkAssignment(cand, db);
    if (hasBlock(violations)) return violations;
    const request = db.request.get(cand.request_id);
    let a;
    try { a = newAssignment(currentUser, request, cand); } catch (e) { return refused(e); }
    const at = stampNow();
    setAssignments((prev) => [...prev, a]);
    setRequests((prev) => prev.map((r) => (r.request_id === cand.request_id ? scheduleRequest(currentUser, r, a, at) : r)));
    return violations;
  }
  // Transitions are built outside the state updater so an R9 or R8 refusal
  // is a returned message, never an error thrown inside React.
  function defer(requestId, reason, note) {
    const r = requests.find((x) => x.request_id === requestId);
    if (!r) return null;
    let next;
    try { next = deferRequest(currentUser, r, { reason, day: boardDate, at: stampNow(), note }); } catch (e) { return e.message; }
    setRequests((prev) => prev.map((x) => (x.request_id === requestId ? next : x)));
    return null;
  }
  function withdraw(requestId) {
    const r = requests.find((x) => x.request_id === requestId);
    if (!r) return null;
    let next;
    try { next = withdrawRequest(currentUser, r, { at: stampNow(), note: 'withdrawn from the queue' }); } catch (e) { return e.message; }
    setRequests((prev) => prev.map((x) => (x.request_id === requestId ? next : x)));
    return null;
  }
  // Intake: the form's fields become a request only through the rules — the
  // late flag and plan day are derived from the submission time (R7).
  const intakeSeq = useRef(0);
  const builds = useMemo(() => [...new Set(runsData.map((r) => r.build))].sort(), []);
  function submitRequest(fields) {
    const errors = validateRequest(fields, db, { tomorrow: meta.tomorrow });
    if (errors.length) return { errors };
    let request;
    try {
      request = newRequest(currentUser, fields, {
        id: `RQ-L${String(intakeSeq.current + 1).padStart(3, '0')}`, submittedAt: stampNow(), cutoff: meta.cutoff_local,
        isOpen: (d) => d > meta.tomorrow || isOperatingDay(d, db),
      });
    } catch (e) {
      return { errors: [{ field: 'program_id', message: e.message }] };
    }
    intakeSeq.current += 1;
    setRequests((prev) => [...prev, request]);
    return { request };
  }
  function record(action, target, detail = '') {
    setAudit((prev) => [...prev, { at: stampNow(), by: currentUser.user_id, action, target, detail }]);
  }
  // The rider desk (desk.cover): a block from checkCover is shown, an R9 refusal too.
  function cover(cand) {
    const vs = checkCover(cand, db);
    if (hasBlock(vs)) return vs;
    let next;
    try { next = coverWindow(currentUser, coverage, cand, { at: stampNow() }); } catch (e) { return refused(e); }
    setCoverage(next);
    record('desk.cover', `${cand.date} ${cand.window}`, db.person.get(cand.person_id)?.name ?? cand.person_id);
    return vs;
  }
  function uncover(cand) {
    let next;
    try { next = uncoverWindow(currentUser, coverage, cand); } catch (e) { return e.message; }
    setCoverage(next);
    record('desk.uncover', `${cand.date} ${cand.window}`, db.person.get(cand.person_id)?.name ?? cand.person_id);
    return null;
  }
  // Crew acknowledge their own seat: a sortie or a coverage row.
  function ack(target) {
    let next;
    try { next = acknowledge(currentUser, target); } catch (e) { return e.message; }
    if (target.assignment_id) setAssignments((prev) => prev.map((a) => (a.assignment_id === target.assignment_id ? next : a)));
    else setCoverage((prev) => prev.map((c) => (c.date === target.date && c.window === target.window && c.person_id === target.person_id ? next : c)));
    record('sortie.ack', target.assignment_id || `${target.date} ${target.window}`);
    return null;
  }
  // The trainer: ratings by airframe, or the desk qualification ('rider_ops'), effective-dated.
  function grant(personId, kind, effective) {
    const p = db.person.get(personId);
    let next;
    try {
      next = kind === 'rider_ops' ? grantQualification(currentUser, p, { effective }) : grantRating(currentUser, p, kind, { effective });
    } catch (e) { return e.message; }
    setPersons((prev) => prev.map((x) => (x.person_id === personId ? next : x)));
    record(kind === 'rider_ops' ? 'qualification.grant' : 'rating.grant', p.name, `${kind === 'rider_ops' ? 'rider desk' : kind} from ${effective}`);
    return null;
  }
  function revoke(personId, airframe) {
    const p = db.person.get(personId);
    let next;
    try { next = revokeRating(currentUser, p, airframe); } catch (e) { return e.message; }
    setPersons((prev) => prev.map((x) => (x.person_id === personId ? next : x)));
    record('rating.revoke', p.name, airframe);
    return null;
  }
  // Authority: a program's default priority or its tail band; the PM, the desk's settings.
  function editProgram(programId, patch) {
    const p = db.program.get(programId);
    let next;
    try {
      next = 'priority_default' in patch ? setProgramPriority(currentUser, p, patch.priority_default) : setProgramTargets(currentUser, p, patch);
    } catch (e) { return e.message; }
    setPrograms((prev) => prev.map((x) => (x.program_id === programId ? next : x)));
    record('priority_default' in patch ? 'program.priority' : 'program.targets', p.code,
      'priority_default' in patch ? patch.priority_default : `${patch.asset_min}–${patch.asset_max} tails`);
    return null;
  }
  function editDesk(patch) {
    let next;
    try { next = setDeskSettings(currentUser, desk, patch); } catch (e) { return e.message; }
    setDesk(next);
    record('desk.settings', 'rider desk', `ratio ${next.ratio} · min ${next.min_per_window}`);
    return null;
  }
  function scrub(assignmentId, reason) {
    const a = assignments.find((x) => x.assignment_id === assignmentId);
    const r = a && requests.find((x) => x.request_id === a.request_id);
    if (!a || !r) return null;
    let nextA;
    let nextR;
    try {
      nextA = scrubAssignment(currentUser, a, { reason });
      nextR = scrubRequest(currentUser, r, a, { reason, at: stampNow() });
    } catch (e) { return e.message; }
    setAssignments((prev) => prev.map((x) => (x.assignment_id === assignmentId ? nextA : x)));
    setRequests((prev) => prev.map((x) => (x.request_id === a.request_id ? nextR : x)));
    return null;
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

  // A retry swaps in fresh lazy wrappers; React.lazy remembers a rejection.
  const [chunkAttempt, setChunkAttempt] = useState(0);
  const { CapacityView, AnalyticsView, ReportsView } = useMemo(lazyViews, [chunkAttempt]);

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
        {/* Authorization without authentication: the persona is state, not
            identity. Switching it never resets the plan; it changes what the
            plan allows. */}
        <label className="whoami">
          <span className="k">Signed in as</span>
          <span className="whoami-row">
            <select aria-label="Signed in as" value={currentUser.user_id} onChange={(e) => signIn(usersData.find((u) => u.user_id === e.target.value))}>
              {meta.app_roles.map((role) => (
                <optgroup key={role} label={ROLE_LABELS[role]}>
                  {usersData.filter((u) => u.role === role).map((u) => (
                    <option key={u.user_id} value={u.user_id}>{u.name} — {u.title}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <span className={`role-badge ${currentUser.role}`} title={`App role: ${currentUser.role}`}>{ROLE_LABELS[currentUser.role]}</span>
          </span>
        </label>
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
              <button key={t.label} className={`tab ${tab === i ? 'on' : ''}`} aria-current={tab === i ? 'page' : undefined} onClick={() => go(i)}
                disabled={(ANALYTICS_TABS.includes(t.label) && !viewOk.ok) || (t.label === 'My day' && !isCrew)}
                title={ANALYTICS_TABS.includes(t.label) && !viewOk.ok ? viewOk.message : t.label === 'My day' && !isCrew ? allowed('sortie.ack').message : undefined}>
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
        <RequestsView key={currentUser.user_id} db={db} meta={meta} today={today} onOpenBoard={openBoard} focusId={requestFocus}
          onSubmit={submitRequest} onWithdraw={withdraw} builds={builds} nowAt={`${today}T18:00`}
          me={currentUser} allowed={allowed} defaultMine={currentUser.role === 'requester'} />
      )}
      {tab === idx('Dispatch') && (
        <DispatchView
          db={db} meta={meta} today={today} date={boardDate} setDate={setBoardDate}
          onAssign={assign} onDefer={defer} onScrub={scrub} onOpenRequest={openRequest} onOpenFailure={openFailure}
          me={currentUser} allowed={allowed} onCover={cover} onUncover={uncover} onEditProgram={editProgram} onEditDesk={editDesk}
        />
      )}
      {tab === idx('My day') && <MyDayView db={db} meta={meta} me={currentUser} allowed={allowed} onAck={ack} />}
      <ChunkBoundary key={chunkAttempt} onRetry={() => setChunkAttempt((n) => n + 1)}>
      <Suspense fallback={<div className="empty-hint">Loading charts…</div>}>
        {tab === idx('Capacity') && <CapacityView db={db} meta={meta} today={today} theme={theme} failures={failures} me={currentUser} allowed={allowed} onGrant={grant} onRevoke={revoke} audit={audit} />}
      {tab === idx('Runs') && <RunsView runs={runsData} db={db} />}
      {tab === idx('Triage') && (
        <TriageView failures={failures} setFailures={setFailures} runs={runsData} today={today} db={db} focusId={triageFocus} onOpenBoard={openBoard}
          canEdit={allowed('triage.edit')} />
      )}
      {tab === idx('Analytics') && <AnalyticsView failures={failures} theme={theme} />}
      {tab === idx('Reports') && (
        <ReportsView runs={runsData} failures={failures} today={today} theme={theme} focus={reportsFocus} db={db} />
      )}
      </Suspense>
      </ChunkBoundary>

      <footer className="foot">
        All data is synthetic — generated by generate_data.py to demonstrate test-operations workflow design.
        Board and triage edits live in this session only. Demo personas, not accounts: no passwords, nothing persists.
        Built by Thilanka Rodrigo.
      </footer>
    </div>
  );
}
