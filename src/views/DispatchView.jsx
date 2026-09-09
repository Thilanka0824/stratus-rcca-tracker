import { useMemo, useState } from 'react';
import { fmtDate } from '../lib/helpers';
import {
  WINDOWS, DEFERRAL_REASONS, SCRUB_REASONS, REASON_LABELS, CREW_LABELS,
  addDays, assetStatusOn, ratedOn, availableOn, checkAssignment, hasBlock,
  dayWarnings, queuedFor, programTails, isOperatingDay,
} from '../lib/rules';
import { isQueued, personName, dailyCapacity } from '../lib/dispatch';
import Modal from './Modal';
import { fmtDate as fd } from '../lib/helpers';

// The board: one day, every program's plan against its target, and the
// queue of what is still waiting. Click a rail request, then a free cell.
export default function DispatchView({ db, meta, today, date, setDate, onAssign, onDefer, onScrub, onOpenRequest, onOpenFailure }) {
  const editable = date > today;                       // the past is history; tomorrow is the plan
  const [selReq, setSelReq] = useState(null);          // rail request being placed
  const [picker, setPicker] = useState(null);          // { asset, window } → crew picker
  const [reasonFor, setReasonFor] = useState(null);    // { kind: 'defer'|'scrub', id, label }

  const warnings = useMemo(() => dayWarnings(date, db), [date, db]);
  const rail = useMemo(() => queuedFor(date, db), [date, db]);
  const cap = useMemo(() => dailyCapacity(db, date), [db, date]);
  const sorties = useMemo(() => db.assignments.filter((a) => a.date === date), [db, date]);
  const operating = isOperatingDay(date, db);

  const selected = selReq ? db.request.get(selReq) : null;
  const r6 = warnings.filter((w) => w.rule === 'R6');
  // Live for this day: queued and not already pushed to a later day.
  const unscheduled = rail.filter((r) => isQueued(r) && r.plan_date <= date);

  function pick(d) {
    setDate(d);
    setSelReq(null);
    setPicker(null);
  }

  // Footer numbers: tails and crew used vs available on this day.
  const foot = useMemo(() => {
    const prefix = (af) => db.assets.find((a) => a.airframe === af)?.asset_id.split('-')[0] ?? af;
    const tails = Object.entries(cap).map(([af, c]) => `${prefix(af)} ${c.usedTails.size}/${c.tails}`).join(' · ');
    const rostered = db.persons.filter((p) => p.availability[date]?.length);
    const flying = new Set(sorties.filter((a) => a.status !== 'scrubbed').flatMap((a) => [a.operator_id, a.pilot_id].filter(Boolean)));
    return { tails, crew: `${flying.size}/${rostered.length}` };
  }, [cap, db, date, sorties]);

  return (
    <section className="board" tabIndex={-1}>
      <div className="board-top">
        <div className="datepick" role="group" aria-label="Board date">
          <button className="step" onClick={() => pick(addDays(date, -1))} disabled={date <= meta.window_start} aria-label="Previous day">‹</button>
          <input type="date" value={date} min={meta.window_start} max={meta.tomorrow} onChange={(e) => e.target.value && pick(e.target.value)} aria-label="Board date" />
          <button className="step" onClick={() => pick(addDays(date, 1))} disabled={date >= meta.tomorrow} aria-label="Next day">›</button>
          <button className={`step ${date === meta.tomorrow ? 'now' : ''}`} onClick={() => pick(meta.tomorrow)}>Tomorrow</button>
        </div>
        <div className="board-chips">
          <span className={`chip-note ${editable ? 'live' : ''}`}>{editable ? 'planning · edits are session-only' : date === today ? 'today · flown' : 'history'}</span>
          {!operating && <span className="chip-note">no crew rostered</span>}
          {warnings.filter((w) => w.rule === 'R5' && w.level === 'under').length > 0 && (
            <span className="chip-note bad">R5 · {warnings.filter((w) => w.rule === 'R5' && w.level === 'under').length} under target</span>
          )}
          {warnings.filter((w) => w.rule === 'R5' && w.level === 'over').length > 0 && (
            <span className="chip-note warn">R5 · {warnings.filter((w) => w.rule === 'R5' && w.level === 'over').length} over cap</span>
          )}
          {r6.length > 0 && <span className="chip-note bad">R6 · {r6.length} P0 starved</span>}
        </div>
      </div>

      <div className="board-grid">
        <div className="board-main">
          {db.programs.map((p) => (
            <ProgramGroup
              key={p.program_id} p={p} db={db} date={date} sorties={sorties} warnings={warnings}
              selected={selected} editable={editable}
              onCell={(asset, window) => setPicker({ asset, window })}
              onScrub={(a) => setReasonFor({ kind: 'scrub', id: a.assignment_id, label: `Scrub ${a.assignment_id} · ${a.asset_id} ${a.window}` })}
              onOpenRequest={onOpenRequest} onOpenFailure={onOpenFailure}
            />
          ))}
        </div>

        <aside className="rail" aria-label="Unscheduled requests">
          <div className="rail-hd">
            <span>Unscheduled · {unscheduled.length}</span>
            <span className={unscheduled.some((r) => r.priority === 'P0') ? 'bad' : ''}>P0: {unscheduled.filter((r) => r.priority === 'P0').length}</span>
          </div>
          {r6.map((w) => <div key={w.request_id} className="rail-warn">R6 · {w.message}</div>)}
          {rail.length === 0 && <div className="empty-hint">Nothing waiting on this day.</div>}
          {rail.map((r) => {
            const queued = isQueued(r) && r.plan_date <= date;          // live for this day
            const later = isQueued(r) && r.plan_date > date;            // pushed to a later day — can be pulled forward
            const deferredHere = r.timeline.filter((e) => e.event === 'deferred' && e.day === date);
            const reason = deferredHere.at(-1)?.reason;
            const isSel = selReq === r.request_id;
            return (
              <div key={r.request_id} className={`rail-card ${isSel ? 'sel' : ''} ${queued ? '' : 'past'}`}>
                <div className="fl-top">
                  <span className={`sev ${r.priority}`}>{r.priority}</span>
                  <span className="fl-id">{r.request_id}</span>
                  <span className="fl-id">· {db.program.get(r.program_id)?.code}</span>
                  {r.late && <span className="flag late" title="After cutoff (R7)">late</span>}
                </div>
                <div className="fl-title">{r.title}</div>
                <div className="fl-meta">
                  <span>{r.airframe}</span>
                  <span>{r.windows.join('/')}</span>
                  <span>{CREW_LABELS[r.crew]}</span>
                </div>
                {reason && !queued && !later && <div className="rail-reason">deferred · {REASON_LABELS[reason]}</div>}
                {reason && later && <div className="rail-reason">deferred · {REASON_LABELS[reason]} · now planned for {fd(r.plan_date)}</div>}
                {reason && queued && <div className="rail-reason">deferred once already · {REASON_LABELS[reason]}</div>}
                {(queued || later) && editable && (
                  <div className="rail-actions">
                    <button className={`btn ${isSel ? '' : 'ghost'}`} onClick={() => { setSelReq(isSel ? null : r.request_id); setPicker(null); }}>
                      {isSel ? 'Pick a cell ↑' : later ? 'Assign here (pull forward)' : 'Assign'}
                    </button>
                    <button className="btn ghost" onClick={() => setReasonFor({ kind: 'defer', id: r.request_id, label: `Defer ${r.request_id}` })}>Defer…</button>
                  </div>
                )}
                {onOpenRequest && <button className="linkish small" onClick={() => onOpenRequest(r.request_id)}>open request</button>}
              </div>
            );
          })}
        </aside>
      </div>

      <div className="board-foot">
        <span>Tails used/available · {foot.tails}</span>
        <span>Crew flying/rostered · {foot.crew}</span>
        <span className={unscheduled.some((r) => r.priority === 'P0') ? 'bad' : ''}>P0 unscheduled · {unscheduled.filter((r) => r.priority === 'P0').length}</span>
      </div>

      {picker && selected && (
        <CrewPicker
          db={db} date={date} request={selected} asset={picker.asset} window={picker.window}
          onCancel={() => setPicker(null)}
          onConfirm={(cand) => {
            const vs = onAssign(cand);
            if (!hasBlock(vs)) { setPicker(null); setSelReq(null); }
            return vs;
          }}
        />
      )}
      {reasonFor && (
        <ReasonPicker
          label={reasonFor.label}
          reasons={reasonFor.kind === 'scrub' ? SCRUB_REASONS : DEFERRAL_REASONS}
          onCancel={() => setReasonFor(null)}
          onConfirm={(reason, note) => {
            if (reasonFor.kind === 'defer') onDefer(reasonFor.id, reason, note);
            else onScrub(reasonFor.id, reason, note);
            setReasonFor(null);
            if (selReq === reasonFor.id) setSelReq(null);
          }}
        />
      )}
    </section>
  );
}

// One program: its target meter, then a row per tail. Tails without a sortie
// for this program stay collapsed unless one of its requests is being placed.
function ProgramGroup({ p, db, date, sorties, warnings, selected, editable, onCell, onScrub, onOpenRequest, onOpenFailure }) {
  const tails = programTails(date, p.program_id, db);
  const r5 = warnings.find((w) => w.rule === 'R5' && w.program_id === p.program_id);
  const placing = selected && selected.program_id === p.program_id;
  const level = r5?.level || (tails.size === 0 ? 'idle' : 'ok');
  const own = sorties.filter((a) => db.request.get(a.request_id)?.program_id === p.program_id);
  const assets = db.assets.filter((a) => p.airframes.includes(a.airframe) && (placing ? a.airframe === selected.airframe : own.some((x) => x.asset_id === a.asset_id)));
  const hidden = db.assets.filter((a) => p.airframes.includes(a.airframe)).length - assets.length;

  return (
    <div className={`prog ${placing ? 'placing' : ''}`}>
      <div className="prog-hd">
        <span className="prog-code">{p.code}</span>
        <span className="prog-name">{p.name}</span>
        <span className={`meter ${level}`} title={r5?.message || `${p.code}: ${tails.size} of ${p.asset_min}–${p.asset_max} tails`}>
          {Array.from({ length: Math.max(p.asset_max, tails.size) }, (_, i) => (
            <i key={i} className={i < tails.size ? 'on' : i < p.asset_min ? 'need' : ''} />
          ))}
          <span className="meter-k">{tails.size} of {p.asset_min}–{p.asset_max}</span>
        </span>
        <span className="prog-airframes">{p.airframes.join(' · ')}</span>
      </div>
      {assets.length === 0 ? (
        <div className="prog-empty">{placing ? 'No tails of that airframe.' : hidden ? `No sorties · ${hidden} ${p.airframes.join('/')} tail${hidden > 1 ? 's' : ''} available` : 'No tails.'}</div>
      ) : (
        <table className="grid">
          <thead>
            <tr><th>Tail</th>{WINDOWS.map((w) => <th key={w}>{w}</th>)}</tr>
          </thead>
          <tbody>
            {assets.map((asset) => {
              const st = assetStatusOn(asset, date);
              const down = st.status === 'grounded' || st.status === 'maintenance';
              return (
                <tr key={asset.asset_id}>
                  <td className="tail-cell">
                    <span className="mono">{asset.asset_id}</span>
                    <span className="tail-sub">{asset.config}</span>
                    {st.status !== 'available' && (
                      <button className={`tail-status ${st.status}`} onClick={() => st.failure_id && onOpenFailure?.(st.failure_id)} title={st.note} disabled={!st.failure_id || !onOpenFailure}>
                        {st.status}{st.failure_id ? ` · ${st.failure_id}` : ''}
                      </button>
                    )}
                  </td>
                  {WINDOWS.map((w) => {
                    const a = sorties.find((x) => x.asset_id === asset.asset_id && x.window === w && x.status !== 'scrubbed');
                    const scrubbed = sorties.filter((x) => x.asset_id === asset.asset_id && x.window === w && x.status === 'scrubbed');
                    if (!asset.windows.includes(w)) return <td key={w} className="cell na">—</td>;
                    if (a) {
                      const req = db.request.get(a.request_id);
                      const mine = req?.program_id === p.program_id;
                      return (
                        <td key={w} className={`cell ${mine ? '' : 'held'}`}>
                          <Chip a={a} req={req} db={db} mine={mine} editable={editable} onScrub={onScrub} onOpenRequest={onOpenRequest} />
                        </td>
                      );
                    }
                    if (down) return <td key={w} className="cell down">{st.status}</td>;
                    if (st.status === 'reserved' && st.reserved_by !== p.program_id) {
                      return <td key={w} className="cell down">reserved · {db.program.get(st.reserved_by)?.code}</td>;
                    }
                    const wanted = placing && selected.windows.includes(w);
                    return (
                      <td key={w} className={`cell empty ${placing ? (wanted ? 'target' : 'target-off') : ''}`}>
                        {scrubbed.length > 0 && <span className="scrubbed-note">{scrubbed.length} scrubbed</span>}
                        {placing && editable && (
                          <button className="cell-btn" onClick={() => onCell(asset, w)} title={wanted ? `Assign ${selected.request_id} here` : `${w} is not a requested window`}>
                            + {selected.request_id}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Chip({ a, req, db, mine, editable, onScrub, onOpenRequest }) {
  return (
    <div className={`chip ${a.status} ${mine ? '' : 'held'}`}>
      <div className="chip-top">
        <span className="mono">{a.request_id}</span>
        {!mine && <span className="chip-prog">{db.program.get(req?.program_id)?.code}</span>}
        <span className={`pill ${a.status}`}>{a.status}</span>
      </div>
      <div className="chip-title">{req?.title}</div>
      <div className="chip-crew">{personName(db, a.operator_id)} / {personName(db, a.pilot_id)}</div>
      {a.notes && <div className="chip-memo">{a.notes}</div>}
      <div className="chip-actions">
        {onOpenRequest && <button className="linkish small" onClick={() => onOpenRequest(a.request_id)}>request</button>}
        {editable && a.status === 'planned' && mine && <button className="linkish small" onClick={() => onScrub(a)}>scrub…</button>}
      </div>
    </div>
  );
}

// Choose the seats a request needs; every rule is checked live, and a block
// keeps the confirm button off — the rejection names the rule.
function CrewPicker({ db, date, request, asset, window, onCancel, onConfirm }) {
  const [operator, setOperator] = useState('');
  const [pilot, setPilot] = useState('');
  const seats = { none: [], pilot_only: ['pilot'], operator_pilot: ['operator', 'pilot'], lone_operator: ['operator'] }[request.crew];
  const cand = { date, window, request_id: request.request_id, asset_id: asset.asset_id, operator_id: operator || null, pilot_id: pilot || null };
  const violations = checkAssignment(cand, db);
  const blocks = violations.filter((v) => v.severity === 'block');
  const warns = violations.filter((v) => v.severity === 'warn');

  const options = (role) => db.persons
    .filter((p) => p.roles.includes(role))
    .map((p) => ({
      p,
      rated: ratedOn(p, asset.airframe, date),
      rostered: availableOn(p, date, window),
    }))
    .sort((x, y) => (y.rated - x.rated) || (y.rostered - x.rostered) || x.p.name.localeCompare(y.p.name));

  return (
    <Modal label="Assign crew" onClose={onCancel} fallbackFocus=".board">
        <div className="sect-label">Assign</div>
        <h2>{request.request_id} → {asset.asset_id} · {window}</h2>
        <p className="caption">{request.title} · {CREW_LABELS[request.crew]}{request.windows.includes(window) ? '' : ` · ${window} is not a requested window`}</p>
        {seats.map((role, i) => (
          <label key={role} className="seat">
            <span className="k">{role === 'pilot' ? 'Safety pilot' : 'Operator'}</span>
            <select autoFocus={i === 0} value={role === 'pilot' ? pilot : operator} onChange={(e) => (role === 'pilot' ? setPilot : setOperator)(e.target.value)}>
              <option value="">— choose —</option>
              {options(role).map(({ p, rated, rostered }) => (
                <option key={p.person_id} value={p.person_id}>
                  {p.name} · {rated ? `rated ${asset.airframe}` : `NOT rated on ${asset.airframe}`}{rostered ? '' : ' · off shift'}
                </option>
              ))}
            </select>
          </label>
        ))}
        <ul className="rule-list" aria-live="polite">
          {blocks.map((v, i) => <li key={`b${i}`} className="block"><strong>{v.rule}</strong> {v.message}</li>)}
          {warns.map((v, i) => <li key={`w${i}`} className="warn"><strong>{v.rule}</strong> {v.message}</li>)}
          {violations.length === 0 && <li className="ok">All rules pass.</li>}
        </ul>
        <div className="stepper">
          <button className="btn" disabled={blocks.length > 0} onClick={() => onConfirm(cand)}>Confirm assignment</button>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
        </div>
    </Modal>
  );
}

// R8 lives here: the confirm button does not exist without a reason.
function ReasonPicker({ label, reasons, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  return (
    <Modal label={label} onClose={onCancel} fallbackFocus=".board">
        <div className="sect-label">Reason required · R8</div>
        <h2>{label}</h2>
        <label className="seat">
          <span className="k">Reason</span>
          <select autoFocus value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">— choose —</option>
            {reasons.map((r) => <option key={r} value={r}>{REASON_LABELS[r]}</option>)}
          </select>
        </label>
        <label className="seat">
          <span className="k">Note (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="what you'd have said in the thread" />
        </label>
        <div className="stepper">
          <button className="btn" disabled={!reason} onClick={() => onConfirm(reason, note)}>Confirm</button>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
        </div>
    </Modal>
  );
}
