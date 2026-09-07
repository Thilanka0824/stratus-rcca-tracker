import { useMemo, useState } from 'react';
import { fmtDate } from '../lib/helpers';
import { REASON_LABELS, CREW_LABELS } from '../lib/rules';
import { STATUS_ORDER, fmtStamp, requestAge, isQueued, programCode, latestAssignment, personName } from '../lib/dispatch';

const PRIO = { P0: 0, P1: 1, P2: 2, P3: 3 };

// The intake queue: everything that came in, what happened to it, and why.
export default function RequestsView({ db, meta, today, onOpenBoard }) {
  const [program, setProgram] = useState('all');
  const [status, setStatus] = useState('all');
  const [priority, setPriority] = useState('all');
  const [airframe, setAirframe] = useState('all');
  const [q, setQ] = useState('');
  const [selId, setSelId] = useState(null);

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
    </section>
  );
}

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
