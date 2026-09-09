import { useMemo, useState } from 'react';
import {
  ComposedChart, BarChart, LineChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { chartTheme, fmtDate } from '../lib/helpers';
import { addDays, REASON_LABELS, qualifiedOn } from '../lib/rules';
import Modal, { ConfirmDialog } from './Modal';
import {
  onWindowFulfillment, assetUtilization, crewUtilization, leadTimes, churnByDay, groundingDays,
  deferralPareto, misattribution, utilizationByWeek, ratingMatrix, demandVsSupply,
  deskLoad, riderFulfillment, actionsByRole, ACTION_COLUMNS,
} from '../lib/dispatch';

const PERIODS = { 30: 'Last 30 days', 60: 'Last 60 days', 90: 'Whole window (90 days)' };
const MONO = "'IBM Plex Mono', monospace";

// Demand vs supply, and which constraint is actually binding. Every number
// here is derived from the same requests and assignments the board edits.
// `allowed`, `onGrant` and `onRevoke` make the rating matrix the trainer's
// desk: grants are effective-dated and never to oneself (I2). For every other
// persona the editing control is disabled with the reason, not hidden.
export default function CapacityView({ db, meta, today, theme, failures, me = null, allowed = () => ({ ok: true }), onGrant, onRevoke, audit = [] }) {
  const { AXIS, GRID, TIP, INK, ACCENT, AMBER, GREEN, CURSOR } = chartTheme(theme);
  const AF_COLOR = { Levant: ACCENT, Harmattan: AMBER, Sirocco: GREEN };
  const airframes = Object.keys(meta.airframes);
  const prefix = (af) => db.assets.find((a) => a.airframe === af)?.asset_id.split('-')[0] ?? af;

  const [period, setPeriod] = useState('90');
  const [afFilter, setAfFilter] = useState('all');
  const [utilMetric, setUtilMetric] = useState('windows');
  const [asOf, setAsOf] = useState(today);
  const [editing, setEditing] = useState(false);       // the trainer's mode
  const [grant, setGrant] = useState(null);             // { person, kind } → GrantDialog
  const [revoke, setRevoke] = useState(null);           // { person, kind } → confirm
  const [refusal, setRefusal] = useState(null);
  const trainOk = allowed('rating.grant', { person_id: null });

  const from = useMemo(() => {
    const f = addDays(today, -(Number(period) - 1));
    return f < meta.window_start ? meta.window_start : f;
  }, [today, period, meta.window_start]);
  const to = today;

  const fulfil = useMemo(() => onWindowFulfillment(db, today, from, to), [db, today, from, to]);
  const util = useMemo(() => assetUtilization(db, from, to), [db, from, to]);
  const crew = useMemo(() => crewUtilization(db, from, to), [db, from, to]);
  const lead = useMemo(() => leadTimes(db, from, to), [db, from, to]);
  const churn = useMemo(() => churnByDay(db, from, to), [db, from, to]);
  const ground = useMemo(() => groundingDays(db, failures, today), [db, failures, today]);
  const supply = useMemo(() => demandVsSupply(db, from, to), [db, from, to]);
  const paretoOpts = { airframe: afFilter === 'all' ? null : afFilter, from, to };
  const pareto = useMemo(() => deferralPareto(db.requests, paretoOpts).map((r) => ({ ...r, label: REASON_LABELS[r.cause] ?? r.cause })), [db, afFilter, from, to]);
  const tell = useMemo(() => misattribution(db, paretoOpts), [db, afFilter, from, to]);
  const weekly = useMemo(() => utilizationByWeek(db, from, to), [db, from, to]);
  const matrix = useMemo(() => ratingMatrix(db, airframes, asOf), [db, asOf]);
  const desk = useMemo(() => deskLoad(db, from, to), [db, from, to]);
  const riders = useMemo(() => riderFulfillment(db, today, from, to), [db, today, from, to]);
  const actions = useMemo(() => actionsByRole(db, audit, { from, to }), [db, audit, from, to]);

  const peak = churn.reduce((m, r) => (r.total > (m?.total ?? 0) ? r : m), null);
  const churnTotal = churn.reduce((s, r) => s + r.total, 0);
  const pct = (x) => (x?.pct == null ? '—' : `${x.pct}%`);

  return (
    <section>
      <div className="filters">
        <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
          {Object.entries(PERIODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="count-note" style={{ alignSelf: 'center', margin: 0 }}>{fmtDate(from)} – {fmtDate(to)} · operating days only · grounded tails leave every denominator</span>
      </div>

      <div className="kpis" aria-label="Capacity metrics">
        <Kpi k="On-window fulfillment" v={pct(fulfil.all)} sub={`P0 ${pct(fulfil.P0)} · P1 ${pct(fulfil.P1)} · P2 ${pct(fulfil.P2)} · n=${fulfil.all?.den ?? 0}`} tone={fulfil.all?.pct < 80 ? 'warn' : ''} />
        <Kpi k="Asset utilization" v={pct(util)} sub={Object.entries(util.per).map(([af, p]) => `${prefix(af)} ${p.pct}%`).join(' · ')} />
        <Kpi k="Crew utilization" v={pct(crew)} sub={`operators ${pct(crew.operator)} · pilots ${pct(crew.pilot)}`} />
        <Kpi k="Lead time p50 / p90" v={lead.all ? `${lead.all.p50}d / ${lead.all.p90}d` : '—'} sub="submitted → executed" />
        <Kpi k="Plan churn" v={churnTotal} sub={peak?.total ? `peak ${peak.day} (${peak.total})` : 'scrubs + reassignments'} tone={peak?.total >= 4 ? 'warn' : ''} />
        <Kpi k="Grounding days" v={ground.days} sub={`${ground.openDays} while the failure was still open`} tone={ground.openDays ? 'bad' : ''} />
      </div>

      <div className="panel">
        <h3>Demand vs supply by window and airframe</h3>
        <p className="caption">
          Demand counts requests by their first-choice window; supply is asset-windows on operating days.
          A bar that clears supply is a queue that cannot drain — and a supply bar with no demand under it is
          capacity nobody asked for.
        </p>
        <div className="charts-3">
          {airframes.map((af) => (
            <div key={af}>
              <div className="sect-label">{af} · {db.assets.filter((a) => a.airframe === af).length} tails</div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={supply[af] || []} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="window" tick={AXIS} />
                  <YAxis tick={AXIS} allowDecimals={false} />
                  <Tooltip {...TIP} cursor={{ fill: CURSOR }} />
                  <Bar dataKey="supply" name="Supply (asset-windows)" fill={INK} fillOpacity={0.22} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="demand" name="Demand (requests)" fill={AF_COLOR[af]} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>Deferrals by cause</h3>
        <p className="caption">
          Occurrence-weighted like the root-cause Pareto: a request deferred three times counts three. This
          is the chart that turns "operator shortage vs pilot shortage" into a number — and the check under it
          says whether the logged reason survives contact with the roster.
        </p>
        <div className="filters">
          <select value={afFilter} onChange={(e) => setAfFilter(e.target.value)} aria-label="Airframe">
            <option value="all">All airframes</option>
            {airframes.map((af) => <option key={af}>{af}</option>)}
          </select>
        </div>
        {pareto.length === 0 ? <div className="empty-hint">No deferrals in this period.</div> : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={pareto} margin={{ top: 8, right: 12, left: -12, bottom: 40 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={{ ...AXIS }} interval={0} angle={-22} textAnchor="end" height={70} />
              <YAxis yAxisId="count" tick={AXIS} allowDecimals={false} />
              <YAxis yAxisId="cum" orientation="right" tick={AXIS} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip {...TIP} />
              <Bar yAxisId="count" dataKey="count" name="Deferrals" fill={ACCENT} radius={[3, 3, 0, 0]} />
              <Line yAxisId="cum" dataKey="cumulative" name="Cumulative %" stroke={AMBER} strokeWidth={2} dot={{ r: 3, fill: AMBER }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
        {tell.total > 0 && (
          <div className={`tell ${tell.refuted ? 'hot' : ''}`}>
            <div className="sect-label">The tell</div>
            <strong>{tell.refuted} of {tell.total}</strong> deferrals logged as <em>No rated operator</em> happened on a day when a
            rated operator sat idle in a window the request asked for — and in <strong>{tell.pilotsShort}</strong> of them no rated
            pilot was free. {tell.refuted / tell.total > 0.5
              ? 'The shortage the log describes is not the shortage the roster shows: it was pilots.'
              : 'The log and the roster mostly agree.'}
            {' '}The rating matrix below says why.
          </div>
        )}
      </div>

      <div className="panel">
        <h3>The rider desk — load per coverer, against the ratio</h3>
        <p className="caption">
          Rider experience is the product. A rider operator holds at most {db.desk.ratio} rider-facing sorties at once, and a
          rider-facing sortie with nobody on the line is not a flight (R10) — structural rules, not settings. Load is
          rider-facing sorties per coverer, per window; the dashed line is the ceiling. The showcase week in June is where it
          cost a P0, and the fix was cross-training, not a waiver.
        </p>
        <div className="kpis">
          <Kpi k="Desk load" v={desk.load == null ? '—' : `${desk.load} / ${db.desk.ratio}`}
            sub={desk.peak ? `peak ${desk.peak.day} (${desk.peak.peak.toFixed(1)} per coverer)` : 'rider-facing sorties per coverer'}
            tone={desk.peak && desk.peak.peak >= db.desk.ratio ? 'warn' : ''} />
          <Kpi k="Windows at ratio" v={desk.atRatio} sub={`of ${desk.windows} windows with riders or a desk`} tone={desk.atRatio ? 'warn' : ''} />
          <Kpi k="Rider-facing fulfillment" v={pct(riders.riders)} sub={`everything else ${pct(riders.rest)} · n=${riders.riders.den}`}
            tone={riders.riders.pct != null && riders.rest.pct != null && riders.riders.pct < riders.rest.pct ? 'warn' : ''} />
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={desk.days} margin={{ top: 8, right: 16, left: -12, bottom: 4 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="day" tick={AXIS} interval={Math.max(0, Math.floor(desk.days.length / 8))} />
            <YAxis tick={AXIS} allowDecimals />
            <Tooltip {...TIP} formatter={(v, name) => (v == null ? '—' : /load/.test(name) ? Number(v).toFixed(1) : v)} />
            <Legend wrapperStyle={{ fontFamily: MONO, fontSize: 12 }} />
            <ReferenceLine y={db.desk.ratio} stroke={AMBER} strokeDasharray="4 4"
              label={{ value: `ratio ${db.desk.ratio}`, fill: AMBER, fontSize: 11, fontFamily: MONO, position: 'insideTopRight' }} />
            <Bar dataKey="riders" name="Rider-facing sorties" fill={INK} fillOpacity={0.18} />
            <Line dataKey="AM load" name="AM load" stroke={GREEN} strokeWidth={1.5} dot={false} connectNulls />
            <Line dataKey="PM load" name="PM load" stroke={ACCENT} strokeWidth={2} dot={false} connectNulls />
            <Line dataKey="NIGHT load" name="NIGHT load" stroke={AMBER} strokeWidth={1.5} dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="panel">
        <h3>Utilization trend by airframe</h3>
        <p className="caption">
          Weekly. Asset-window utilization is sorties over available asset-windows; tail-day saturation is the
          share of available tails that flew at all. In the grounding week the four remaining Levants flew every
          day while their window utilization barely moved — the two numbers tell different stories, and the
          coordinator lives in the second one.
        </p>
        <div className="filters">
          <select value={utilMetric} onChange={(e) => setUtilMetric(e.target.value)} aria-label="Utilization metric">
            <option value="windows">Asset-window utilization</option>
            <option value="tails">Tail-day saturation</option>
          </select>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={weekly} margin={{ top: 8, right: 16, left: -12, bottom: 4 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="week" tick={AXIS} />
            <YAxis tick={AXIS} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <Tooltip {...TIP} formatter={(v) => (v == null ? '—' : `${v}%`)} />
            <Legend wrapperStyle={{ fontFamily: MONO, fontSize: 12 }} />
            {airframes.map((af) => (
              <Line key={af} dataKey={utilMetric === 'tails' ? `${af} tails` : af} name={af} stroke={AF_COLOR[af]} strokeWidth={2} dot={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="panel">
        <h3>Lead time and plan churn</h3>
        <p className="caption">
          Lead time is submitted → executed; p90 is what the requester remembers. Churn is scrubs plus same-day
          reassignments after the plan was set — the cost of a surprise, per day.
        </p>
        <div className="split-2">
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Program</th><th>n</th><th>p50</th><th>p90</th></tr></thead>
              <tbody>
                {db.programs.filter((p) => lead[p.program_id]).map((p) => (
                  <tr key={p.program_id}>
                    <td className="mono">{p.code}</td>
                    <td className="mono dim">{lead[p.program_id].n}</td>
                    <td className="mono">{lead[p.program_id].p50}d</td>
                    <td className={`mono ${lead[p.program_id].p90 >= 3 ? 'age-hot' : ''}`}>{lead[p.program_id].p90}d</td>
                  </tr>
                ))}
                {lead.all && (
                  <tr><td className="mono">all</td><td className="mono dim">{lead.all.n}</td><td className="mono">{lead.all.p50}d</td><td className="mono">{lead.all.p90}d</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={churn} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="day" tick={AXIS} interval={Math.max(0, Math.floor(churn.length / 8))} />
              <YAxis tick={AXIS} allowDecimals={false} />
              <Tooltip {...TIP} cursor={{ fill: CURSOR }} />
              <Legend wrapperStyle={{ fontFamily: MONO, fontSize: 12 }} />
              <Bar dataKey="scrubs" name="Scrubs" stackId="c" fill={AMBER} />
              <Bar dataKey="reassignments" name="Reassignments" stackId="c" fill={ACCENT} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel">
        <h3>Rating matrix — who can fly what, and who covers the desk</h3>
        <p className="caption">
          People × airframe, plus the rider desk. This is the tell that exposes a phantom shortage: count the rated pilots per
          airframe, then look at which reason the deferral log used. The trainer grants here, effective-dated — the board
          re-evaluates R1 and R10 from that day — and never to themself (I2).
        </p>
        <div className="filters">
          <select value={asOf} onChange={(e) => setAsOf(e.target.value)} aria-label="As of date">
            <option value="2026-05-15">As of May 15 · before the cross-rating flights</option>
            <option value="2026-06-14">As of Jun 14 · before the desk qualification</option>
            <option value={today}>As of {fmtDate(today)} · today</option>
            <option value={meta.tomorrow}>As of {fmtDate(meta.tomorrow)} · tomorrow</option>
          </select>
          <button className={`btn ghost small ${editing ? 'on' : ''}`} disabled={!trainOk.ok} title={trainOk.ok ? 'Grant or revoke, effective-dated' : trainOk.message}
            onClick={() => { setEditing((v) => !v); setRefusal(null); }}>
            {editing ? 'Done editing' : 'Edit ratings…'}
          </button>
        </div>
        {refusal && <ul className="rule-list"><li className="block"><strong>R9</strong> {refusal.replace(/^R9 · /, '')}</li></ul>}
        <div className="tbl-wrap">
          <table className="matrix">
            <thead>
              <tr><th>Person</th><th>Roles</th>{airframes.map((af) => <th key={af}>{af}</th>)}<th>Rider desk</th></tr>
            </thead>
            <tbody>
              {matrix.rows.map(({ person, cells }) => {
                const gOk = allowed('rating.grant', person);
                const qOk = allowed('qualification.grant', person);
                const eff = person.qualifications?.rider_ops;
                const deskState = !eff ? 'none' : eff > asOf ? 'pending' : 'rated';
                const label = (c) => (c.state === 'rated' ? (c.since ? `since ${fmtDate(c.since)}` : 'rated') : c.state === 'pending' ? `from ${fmtDate(c.since)}` : '·');
                return (
                  <tr key={person.person_id}>
                    <td>{person.name}{person.self_pilot && <span className="flag" title="Can fly as lone operator">self-pilot</span>}</td>
                    <td className="mono dim">{person.roles.join(' · ')}</td>
                    {airframes.map((af) => (
                      <td key={af} className={`mx ${cells[af].state}`}>
                        {editing ? (
                          cells[af].state === 'none'
                            ? <button className="linkish small" disabled={!gOk.ok} title={gOk.ok ? `Grant ${af} to ${person.name}` : gOk.message} onClick={() => setGrant({ person, kind: af })}>grant…</button>
                            : <button className="linkish small" disabled={!gOk.ok} title={gOk.ok ? `Revoke ${af} from ${person.name}` : gOk.message} onClick={() => setRevoke({ person, kind: af })}>{label(cells[af])} · revoke</button>
                        ) : label(cells[af])}
                      </td>
                    ))}
                    <td className={`mx ${deskState}`}>
                      {editing && deskState === 'none'
                        ? <button className="linkish small" disabled={!qOk.ok} title={qOk.ok ? `Qualify ${person.name} on the rider desk` : qOk.message} onClick={() => setGrant({ person, kind: 'rider_ops' })}>qualify…</button>
                        : deskState === 'rated' ? `since ${fmtDate(eff)}` : deskState === 'pending' ? `from ${fmtDate(eff)}` : '·'}
                    </td>
                  </tr>
                );
              })}
              <tr className="mx-total">
                <td className="mono">rated pilots</td><td />
                {airframes.map((af) => <td key={af} className={`mono ${matrix.totals[af].pilots <= 2 ? 'age-hot' : ''}`}>{matrix.totals[af].pilots}</td>)}
                <td className="mono">{db.persons.filter((p) => qualifiedOn(p, asOf)).length} qualified</td>
              </tr>
              <tr className="mx-total">
                <td className="mono">rated operators</td><td />
                {airframes.map((af) => <td key={af} className="mono">{matrix.totals[af].operators}</td>)}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>Actions by role — who did what</h3>
        <p className="caption">
          Every timeline event carries its actor (R9), the desk roster its builder, and the session's edits their persona.
          Coordinators plan and cover; authority sets priority and targets; the trainer grants. Nobody assigns their own
          request (I1) and nobody grants their own rating (I2). "Filed" counts intake, late flag included; "assigned" counts
          scheduling, reassignment and execution; "set" is priority, targets and the desk's settings.
        </p>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr><th>Persona</th><th>Role</th>{ACTION_COLUMNS.map((c) => <th key={c}>{c}</th>)}<th>Total</th></tr>
            </thead>
            <tbody>
              {actions.map((row) => (
                <tr key={row.user.user_id}>
                  <td>{row.user.name} <span className="dim">· {row.user.title}</span></td>
                  <td className="mono dim">{row.user.role}</td>
                  {ACTION_COLUMNS.map((c) => <td key={c} className="mono">{row[c] || '·'}</td>)}
                  <td className="mono">{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {grant && (
        <GrantDialog
          person={grant.person} kind={grant.kind} defaultDate={meta.tomorrow}
          onCancel={() => setGrant(null)}
          onConfirm={(effective) => { const msg = onGrant?.(grant.person.person_id, grant.kind, effective); if (msg) return msg; setGrant(null); return null; }}
        />
      )}
      {revoke && (
        <ConfirmDialog
          title={`Revoke ${revoke.kind} from ${revoke.person.name}?`}
          body="The rating leaves the matrix now; sorties already planned on it will show an R1 block on the board."
          confirmLabel="Revoke" cancelLabel="Keep it" danger
          onConfirm={() => { const msg = onRevoke?.(revoke.person.person_id, revoke.kind); setRevoke(null); setRefusal(msg); }}
          onCancel={() => setRevoke(null)}
        />
      )}
    </section>
  );
}

// An effective-dated grant: the day it takes effect is the only field.
function GrantDialog({ person, kind, defaultDate, onCancel, onConfirm }) {
  const [effective, setEffective] = useState(defaultDate);
  const [error, setError] = useState(null);
  const what = kind === 'rider_ops' ? 'the rider desk qualification' : `the ${kind} rating`;
  return (
    <Modal label="Grant" onClose={onCancel}>
        <div className="sect-label">{kind === 'rider_ops' ? 'Qualification · trainer' : 'Rating · trainer'}</div>
        <h2>Grant {what} to {person.name}</h2>
        <p className="caption">Effective from the date below. The board re-evaluates {kind === 'rider_ops' ? 'R10 (the desk)' : 'R1 (type rating)'} from that day.</p>
        <label className="seat"><span className="k">Effective from</span>
          <input type="date" autoFocus aria-label="Effective from" value={effective} onChange={(e) => setEffective(e.target.value)} />
        </label>
        <ul className="rule-list" aria-live="polite">
          {error && <li className="block"><strong>R9</strong> {error.replace(/^R9 · /, '')}</li>}
        </ul>
        <div className="stepper">
          <button className="btn" disabled={!effective} onClick={() => { const msg = onConfirm(effective); if (msg) setError(msg); }}>Grant</button>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
        </div>
    </Modal>
  );
}

function Kpi({ k, v, sub, tone = '' }) {
  return (
    <div className="kpi">
      <div className="k">{k}</div>
      <div className={`v ${tone}`}>{v}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}
