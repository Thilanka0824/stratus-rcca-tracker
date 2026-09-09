import { useMemo, useState } from 'react';
import { fmtDate } from '../lib/helpers';
import { REASON_LABELS, CREW_LABELS, CREW_KINDS, BUILD_STAGES, WINDOWS, validateRequest, isLate, addDays, operatingWindows, pruneWindows } from '../lib/rules';
import Modal from './Modal';
import { STATUS_ORDER, fmtStamp, requestAge, isQueued, programCode, latestAssignment, personName } from '../lib/dispatch';

const PRIO = { P0: 0, P1: 1, P2: 2, P3: 3 };

// The intake queue: everything that came in, what happened to it, and why.
export default function RequestsView({ db, meta, today, onOpenBoard, focusId = null, onSubmit, builds = [], nowAt }) {
  const [showForm, setShowForm] = useState(false);
  const [program, setProgram] = useState('all');
  const [status, setStatus] = useState('all');
  const [priority, setPriority] = useState('all');
  const [airframe, setAirframe] = useState('all');
  const [q, setQ] = useState(focusId || '');           // arriving from the board: land on that request
  const [selId, setSelId] = useState(focusId);

  const tomorrow = meta.tomorrow;
  const planning = useMemo(() => {
    const forTomorrow = db.requests.filter((r) => r.plan_date === tomorrow && r.status !== 'withdrawn');
    const askedForTomorrow = db.requests.filter((r) => r.needed_by === tomorrow && r.status !== 'withdrawn');
    return { late: askedForTomorrow.filter((r) => r.late).length, queued: forTomorrow.filter(isQueued).length, total: forTomorrow.length };
  }, [db, tomorrow]);

  // Attention order: what is still open first, then priority, then newest.
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return db.requests
      .filter((r) => (program === 'all' ? true : r.program_id === program))
      .filter((r) => (status === 'all' ? true : status === 'queued' ? isQueued(r) : r.status === status))
      .filter((r) => (priority === 'all' ? true : r.priority === priority))
      .filter((r) => (airframe === 'all' ? true : r.airframe === airframe))
      .filter((r) => needle === '' ? true
        : `${r.request_id} ${r.title} ${r.requester} ${r.build}`.toLowerCase().includes(needle))
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        || PRIO[a.priority] - PRIO[b.priority]
        || b.submitted_at.localeCompare(a.submitted_at));
  }, [db, program, status, priority, airframe, q]);

  const sel = db.request.get(selId) || rows[0] || null;

  return (
    <section>
      <div className="banner">
        <span className="banner-k">Planning {fmtDate(tomorrow)}</span>
        <span>intake closed {meta.cutoff_local}</span>
        <span>{planning.total} requests · {planning.queued} unscheduled</span>
        <span className={planning.late ? 'late' : ''}>{planning.late} late</span>
        {onSubmit && <button className="btn" onClick={() => setShowForm(true)}>+ New request</button>}
      </div>

      <div className="filters">
        <select value={program} onChange={(e) => setProgram(e.target.value)} aria-label="Program">
          <option value="all">All programs</option>
          {db.programs.map((p) => <option key={p.program_id} value={p.program_id}>{p.code} · {p.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="all">All statuses</option>
          <option value="queued">Queued (submitted + deferred)</option>
          <option value="submitted">Submitted</option>
          <option value="deferred">Deferred</option>
          <option value="scheduled">Scheduled</option>
          <option value="executed">Executed</option>
          <option value="withdrawn">Withdrawn</option>
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
          <option value="all">All priorities</option>
          <option>P0</option><option>P1</option><option>P2</option>
        </select>
        <select value={airframe} onChange={(e) => setAirframe(e.target.value)} aria-label="Airframe">
          <option value="all">All airframes</option>
          {Object.keys(meta.airframes).map((af) => <option key={af}>{af}</option>)}
        </select>
        <input placeholder="Search id, title, requester, build…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search requests" />
      </div>
      <p className="count-note">Showing {rows.length} of {db.requests.length} requests</p>

      <div className="split">
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Request</th>
                <th>Program</th>
                <th>Prio</th>
                <th className="col-md">Crew</th>
                <th>Windows</th>
                <th className="col-md">Airframe</th>
                <th className="col-md">Build</th>
                <th>Status</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const age = requestAge(r, today);
                const hot = isQueued(r) && age > 2;
                return (
                  <tr key={r.request_id} className={sel?.request_id === r.request_id ? 'sel' : ''} onClick={() => setSelId(r.request_id)}>
                    <td className="mono">
                      <button className="linkish" onClick={() => setSelId(r.request_id)}>{r.request_id}</button>
                      {r.late && <span className="flag late" title="Submitted after cutoff (R7)">late</span>}
                    </td>
                    <td className="mono dim">{programCode(db, r)}</td>
                    <td><span className={`sev ${r.priority}`}>{r.priority}</span></td>
                    <td className="dim col-md">{CREW_LABELS[r.crew]}</td>
                    <td className="mono dim">{r.windows.join('/')}</td>
                    <td className="dim col-md">{r.airframe}</td>
                    <td className="mono dim col-md">{r.build}</td>
                    <td><span className={`pill ${r.status}`}>{r.status}</span></td>
                    <td className={`mono ${hot ? 'age-hot' : 'dim'}`}>{age}d</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {sel ? <Drawer r={sel} db={db} today={today} onOpenBoard={onOpenBoard} />
             : <div className="detail empty-hint">No request matches these filters.</div>}
      </div>

      {showForm && (
        <IntakeForm
          db={db} meta={meta} builds={builds} nowAt={nowAt} onSubmit={onSubmit}
          onCancel={() => setShowForm(false)}
          onCreated={(r) => { setShowForm(false); setStatus('all'); setQ(''); setSelId(r.request_id); }}
        />
      )}
    </section>
  );
}

// Intake: what a requesting engineer fills in before the cutoff. Validation
// runs live and names the field; the R7 verdict is shown before you submit,
// because a late request should never be a surprise to the person who filed it.
function IntakeForm({ db, meta, builds, nowAt, onSubmit, onCancel, onCreated }) {
  const first = db.programs[0];
  const teams = useMemo(() => [...new Set(db.requests.map((r) => r.supporting_team).filter(Boolean))].sort(), [db]);
  const [f, setF] = useState({
    program_id: first.program_id, title: '', build: builds.at(-1) || '', build_stage: 'engineering',
    crew: 'operator_pilot', windows: ['AM'], airframe: first.airframes[0], priority: first.priority_default,
    supporting_team: teams[0] || '', requester: '', needed_by: meta.tomorrow,
  });
  const [tried, setTried] = useState(false);
  const [initial] = useState(f);
  const program = db.program.get(f.program_id);
  const operating = useMemo(() => operatingWindows(db, f.airframe), [db, f.airframe]);
  const errors = validateRequest(f, db, { tomorrow: meta.tomorrow });
  const shown = tried ? errors : [];
  const bad = (field) => shown.some((e) => e.field === field) || undefined;
  const late = f.needed_by && isLate(nowAt, f.needed_by, meta.cutoff_local);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  // Switching program or airframe re-fits the picked windows, so a box can
  // never be checked and disabled at once.
  function setProgram(e) {
    const p = db.program.get(e.target.value);
    setF((x) => ({ ...x, program_id: p.program_id, airframe: p.airframes[0], priority: p.priority_default, windows: pruneWindows(x.windows, db, p.airframes[0]) }));
  }
  function setAirframe(e) {
    setF((x) => ({ ...x, airframe: e.target.value, windows: pruneWindows(x.windows, db, e.target.value) }));
  }
  function close() {
    if (!dirty || window.confirm('Discard this request?')) onCancel();
  }
  function toggleWindow(w) {
    setF((x) => ({ ...x, windows: x.windows.includes(w) ? x.windows.filter((v) => v !== w) : [...x.windows, w].sort((a, b) => WINDOWS.indexOf(a) - WINDOWS.indexOf(b)) }));
  }
  function submit(e) {
    e.preventDefault();
    setTried(true);
    if (errors.length) {
      e.currentTarget.querySelector(`[name="${errors[0].field}"]`)?.focus();   // first problem gets the keyboard
      return;
    }
    const res = onSubmit(f);
    if (res.request) onCreated(res.request);
  }

  return (
    <Modal as="form" label="New request" className="wide" onClose={close} closeOnBackdrop={false} onSubmit={submit} noValidate>
        <div className="sect-label">Intake · cutoff {meta.cutoff_local}</div>
        <h2>New request</h2>
        <div className="form-grid">
          <label className="seat"><span className="k">Program</span>
            <select autoFocus name="program_id" value={f.program_id} onChange={setProgram}>
              {db.programs.map((p) => <option key={p.program_id} value={p.program_id}>{p.code} · {p.name}</option>)}
            </select>
          </label>
          <label className="seat"><span className="k">Airframe</span>
            <select name="airframe" aria-invalid={bad('airframe')} value={f.airframe} onChange={setAirframe} disabled={program.airframes.length === 1}>
              {program.airframes.map((af) => <option key={af}>{af}</option>)}
            </select>
          </label>
          <label className="seat" style={{ gridColumn: '1 / -1' }}><span className="k">Title</span>
            <input name="title" aria-invalid={bad('title')} value={f.title} onChange={set('title')} placeholder="what the sortie is for" />
          </label>
          <label className="seat"><span className="k">Build</span>
            <select name="build" aria-invalid={bad('build')} value={f.build} onChange={set('build')}>{builds.map((b) => <option key={b}>{b}</option>)}</select>
          </label>
          <label className="seat"><span className="k">Build stage</span>
            <select name="build_stage" value={f.build_stage} onChange={set('build_stage')}>{BUILD_STAGES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
          </label>
          <label className="seat"><span className="k">Crew</span>
            <select name="crew" value={f.crew} onChange={set('crew')}>{CREW_KINDS.map((c) => <option key={c} value={c}>{CREW_LABELS[c]}</option>)}</select>
          </label>
          <label className="seat"><span className="k">Priority</span>
            <select name="priority" value={f.priority} onChange={set('priority')}><option>P0</option><option>P1</option><option>P2</option></select>
          </label>
          <div className="seat"><span className="k">Windows · {f.airframe} flies {operating.join(' / ')}</span>
            <div className="checks" role="group" aria-label="Requested windows" aria-invalid={bad('windows')}>
              {WINDOWS.map((w, i) => (
                <label key={w}>
                  <input type="checkbox" name={i === 0 ? 'windows' : undefined} checked={f.windows.includes(w)} disabled={!operating.includes(w)} onChange={() => toggleWindow(w)} />
                  <span>{w}</span>
                </label>
              ))}
            </div>
          </div>
          <label className="seat"><span className="k">Needed by</span>
            <input type="date" name="needed_by" aria-invalid={bad('needed_by')} value={f.needed_by} min={meta.tomorrow} onChange={set('needed_by')} />
          </label>
          <label className="seat"><span className="k">Requester</span>
            <input name="requester" aria-invalid={bad('requester')} value={f.requester} onChange={set('requester')} placeholder="initial and surname" />
          </label>
          <label className="seat"><span className="k">Supporting team</span>
            <select name="supporting_team" value={f.supporting_team} onChange={set('supporting_team')}>{teams.map((t) => <option key={t}>{t}</option>)}</select>
          </label>
        </div>

        <div className={`tell ${late ? 'hot' : ''}`}>
          <div className="sect-label">R7 · intake cutoff</div>
          {late
            ? <>Submitting now ({fmtStamp(nowAt)}) is after the {meta.cutoff_local} cutoff for {fmtDate(f.needed_by)}. This request will be flagged <strong>late</strong> and default to {fmtDate(addDays(f.needed_by, 1))}; the coordinator can still pull it forward on the board.</>
            : <>Before the cutoff for {f.needed_by ? fmtDate(f.needed_by) : 'that day'}: it goes straight into that day's queue.</>}
        </div>

        {/* Always mounted, so the announcement happens when the text arrives. */}
        <ul className="rule-list" aria-live="polite">
          {shown.map((e, i) => <li key={i} className="block"><strong>{FIELD_LABELS[e.field] ?? e.field}</strong> {e.message}</li>)}
        </ul>
        <div className="stepper">
          <button className="btn" type="submit">Submit request</button>
          <button className="btn ghost" type="button" onClick={close}>Cancel</button>
        </div>
    </Modal>
  );
}

const FIELD_LABELS = {
  program_id: 'Program', title: 'Title', build: 'Build', build_stage: 'Build stage', crew: 'Crew', priority: 'Priority',
  airframe: 'Airframe', windows: 'Windows', needed_by: 'Needed by', requester: 'Requester',
};

function Drawer({ r, db, today, onOpenBoard }) {
  const prog = db.program.get(r.program_id);
  const a = latestAssignment(db, r.request_id);
  const boardDate = a?.date || r.plan_date || r.needed_by;
  return (
    <div className="detail">
      <div className="fl-top">
        <span className={`sev ${r.priority}`}>{r.priority}</span>
        <span className="fl-id">{r.request_id}</span>
        <span className="fl-id">· {prog?.code}</span>
        <span className={`pill ${r.status}`}>{r.status}</span>
        {r.late && <span className="flag late">late intake</span>}
      </div>
      <h2>{r.title}</h2>

      <div className="meta-grid">
        <div><div className="k">Program</div><div className="v">{prog?.name}</div></div>
        <div><div className="k">Requester</div><div className="v">{r.requester}</div></div>
        <div><div className="k">Needed by</div><div className="v">{fmtDate(r.needed_by)}</div></div>
        <div><div className="k">Planned for</div><div className="v">{r.plan_date ? fmtDate(r.plan_date) : '—'}</div></div>
        <div><div className="k">Airframe · windows</div><div className="v">{r.airframe} · {r.windows.join(' / ')}</div></div>
        <div><div className="k">Crew</div><div className="v">{CREW_LABELS[r.crew]}</div></div>
        <div><div className="k">Build</div><div className="v">{r.build} · {r.build_stage.replace('_', ' ')}</div></div>
        <div><div className="k">Supporting team</div><div className="v">{r.supporting_team}</div></div>
        <div><div className="k">Submitted</div><div className="v">{fmtStamp(r.submitted_at)}</div></div>
        <div><div className="k">Age</div><div className="v">{requestAge(r, today)} days</div></div>
      </div>

      {r.deferral_reason && (
        <div className="corrective">
          {r.status === 'withdrawn' ? 'Withdrawn' : 'Deferred'}: <strong>{REASON_LABELS[r.deferral_reason]}</strong>
        </div>
      )}

      {a && (
        <>
          <div className="sect-label">Sortie</div>
          <div className="corrective">
            <span className="mono">{a.assignment_id}</span> · {fmtDate(a.date)} {a.window} · <strong>{a.asset_id}</strong>
            {' · '}{personName(db, a.operator_id)} / {personName(db, a.pilot_id)} · <span className={`pill ${a.status}`}>{a.status}</span>
            {a.scrub_reason && <> · scrubbed: {REASON_LABELS[a.scrub_reason]}</>}
            {a.run_id && <> · run <span className="mono">{a.run_id}</span></>}
            {a.notes && <div className="dim-note">{a.notes}</div>}
          </div>
        </>
      )}

      <div className="sect-label">Timeline</div>
      <ol className="tl">
        {r.timeline.map((e, i) => (
          <li key={i} className={`tl-${e.event}`}>
            <span className="tl-at">{fmtStamp(e.at)}</span>
            <span className="tl-ev">{e.event}{e.reason ? ` · ${REASON_LABELS[e.reason] ?? e.reason}` : ''}</span>
            {e.day && e.day !== e.at.slice(0, 10) && <span className="tl-day">for {fmtDate(e.day)}</span>}
            {e.note && <span className="tl-note">{e.note}</span>}
          </li>
        ))}
      </ol>

      {onOpenBoard && (
        <div className="stepper">
          <button className="btn ghost" onClick={() => onOpenBoard(boardDate)}>Open {fmtDate(boardDate)} on the board</button>
        </div>
      )}
    </div>
  );
}
