import { useState } from 'react';
import { fmtDate } from '../lib/helpers';
import { CREW_LABELS, WINDOWS, addDays, checkCoverage, qualifiedOn } from '../lib/rules';

const ROLE_WORDS = { operator: 'operator', pilot: 'safety pilot', rider_ops: 'rider operator' };
import { personName } from '../lib/dispatch';

// The crew persona's page: tomorrow's sortie or desk coverage, the ratings
// and qualifications with their dates, and one button — Acknowledge. Crew
// see their own seat; the rest of the plan is someone else's to change.
export default function MyDayView({ db, meta, me, allowed, onAck }) {
  const [date, setDate] = useState(meta.tomorrow);
  const person = me.person_id ? db.person.get(me.person_id) : null;
  if (!person) return <section><div className="empty-hint">My day is for personas on the roster.</div></section>;

  const mine = db.assignments.filter((a) => a.date === date && a.status !== 'scrubbed'
    && (a.operator_id === person.person_id || a.pilot_id === person.person_id));
  const covers = db.coverage.filter((c) => c.date === date && c.person_id === person.person_id)
    .sort((a, b) => WINDOWS.indexOf(a.window) - WINDOWS.indexOf(b.window));
  const rostered = person.availability[date] || [];
  const airframes = Object.keys(meta.airframes);
  const deskEff = person.qualifications?.rider_ops;
  const deskState = !deskEff ? 'none' : qualifiedOn(person, date) ? 'rated' : 'pending';
  const grantors = [...new Set(Object.values(person.granted_by || {}))].map((u) => db.user.get(u)?.name ?? u);

  return (
    <section className="myday">
      <div className="banner">
        <span className="banner-k">{person.name} · {person.roles.map((r) => ROLE_WORDS[r] ?? r).join(' · ')}</span>
        <div className="datepick" role="group" aria-label="My day date">
          <button className="step" onClick={() => setDate(addDays(date, -1))} disabled={date <= meta.window_start} aria-label="Previous day">‹</button>
          <input type="date" value={date} min={meta.window_start} max={meta.tomorrow} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="My day date" />
          <button className="step" onClick={() => setDate(addDays(date, 1))} disabled={date >= meta.tomorrow} aria-label="Next day">›</button>
          <button className={`step ${date === meta.tomorrow ? 'now' : ''}`} onClick={() => setDate(meta.tomorrow)}>Tomorrow</button>
        </div>
        <span>{rostered.length ? `rostered ${rostered.join(' / ')}` : 'not rostered'}</span>
      </div>

      <div className="split-2">
        <div>
          <div className="panel">
            <h3>Sorties · {fmtDate(date)}</h3>
            {mine.length === 0 && <div className="empty-hint">No sortie for you on this day.</div>}
            {mine.map((a) => {
              const r = db.request.get(a.request_id);
              const seat = a.operator_id === person.person_id ? 'Operator' : 'Safety pilot';
              const mate = a.operator_id === person.person_id ? a.pilot_id : a.operator_id;
              const ok = allowed('sortie.ack', a);
              return (
                <div key={a.assignment_id} className={`chip ${a.status}`}>
                  <div className="chip-top">
                    <span className="mono">{a.assignment_id}</span>
                    <span className="mono">{a.asset_id} · {a.window}</span>
                    <span className={`pill ${a.status}`}>{a.status}</span>
                    {r?.rider_facing && <span className="flag riders" title="Riders aboard — the desk covers this window (R10)">riders</span>}
                  </div>
                  <div className="chip-title">{r?.title}</div>
                  <div className="chip-crew">{seat}{mate ? ` · with ${personName(db, mate)}` : ''} · {CREW_LABELS[r?.crew]}</div>
                  <div className="chip-actions">
                    {a.acked
                      ? <span className="mono dim-note">acknowledged</span>
                      : <button className="btn small" disabled={!ok.ok} title={ok.ok ? undefined : ok.message} onClick={() => onAck(a)}>Acknowledge</button>}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="panel">
            <h3>Rider desk · {fmtDate(date)}</h3>
            {covers.length === 0 && <div className="empty-hint">Not on the desk this day.</div>}
            {covers.map((c) => {
              const cov = checkCoverage(c.date, c.window, db);
              const riders = db.assignments.filter((a) => a.date === c.date && a.window === c.window && a.status !== 'scrubbed'
                && db.request.get(a.request_id)?.rider_facing);
              const ok = allowed('sortie.ack', c);
              return (
                <div key={c.window} className={`chip desk-${cov.level}`}>
                  <div className="chip-top">
                    <span className="mono">{c.window}</span>
                    <span className={`pill desk-${cov.level}`}>{cov.message}</span>
                  </div>
                  {riders.map((a) => (
                    <div key={a.assignment_id} className="chip-crew">
                      {a.asset_id} · {db.request.get(a.request_id)?.title} · {personName(db, a.operator_id)} / {personName(db, a.pilot_id)}
                    </div>
                  ))}
                  {riders.length === 0 && <div className="chip-crew">No rider-facing sorties in this window yet.</div>}
                  <div className="chip-actions">
                    {c.acked
                      ? <span className="mono dim-note">acknowledged</span>
                      : <button className="btn small" disabled={!ok.ok} title={ok.ok ? undefined : ok.message} onClick={() => onAck(c)}>Acknowledge</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <h3>Ratings and qualifications</h3>
          <p className="caption">Effective-dated: the board re-evaluates R1 and R10 from the day a grant takes effect.</p>
          <div className="tbl-wrap">
            <table className="matrix">
              <thead><tr><th>Airframe</th><th>As of {fmtDate(date)}</th></tr></thead>
              <tbody>
                {airframes.map((af) => {
                  const has = person.ratings.includes(af);
                  const since = person.ratings_effective?.[af];
                  const state = !has ? 'none' : since && since > date ? 'pending' : 'rated';
                  return (
                    <tr key={af}>
                      <td>{af}</td>
                      <td className={`mx ${state}`}>{state === 'rated' ? (since ? `since ${fmtDate(since)}` : 'rated') : state === 'pending' ? `from ${fmtDate(since)}` : '·'}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td>Rider desk</td>
                  <td className={`mx ${deskState}`}>{deskState === 'rated' ? `since ${fmtDate(deskEff)}` : deskState === 'pending' ? `from ${fmtDate(deskEff)}` : '·'}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {grantors.length > 0 && <p className="caption">Granted by {grantors.join(', ')}.</p>}
        </div>
      </div>
    </section>
  );
}
