import { useMemo, useState } from 'react';
import {
  ComposedChart, BarChart, LineChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { chartTheme, fmtDate } from '../lib/helpers';
import { addDays, REASON_LABELS } from '../lib/rules';
import {
  onWindowFulfillment, assetUtilization, crewUtilization, leadTimes, churnByDay, groundingDays,
  deferralPareto, misattribution, utilizationByWeek, ratingMatrix, demandVsSupply,
} from '../lib/dispatch';

const PERIODS = { 30: 'Last 30 days', 60: 'Last 60 days', 90: 'Whole window (90 days)' };
const MONO = "'IBM Plex Mono', monospace";

// Demand vs supply, and which constraint is actually binding. Every number
// here is derived from the same requests and assignments the board edits.
export default function CapacityView({ db, meta, today, theme, failures }) {
  const { AXIS, GRID, TIP, INK, ACCENT, AMBER, GREEN, CURSOR } = chartTheme(theme);
  const AF_COLOR = { Levant: ACCENT, Harmattan: AMBER, Sirocco: GREEN };
  const airframes = Object.keys(meta.airframes);
  const prefix = (af) => db.assets.find((a) => a.airframe === af)?.asset_id.split('-')[0] ?? af;

  const [period, setPeriod] = useState('90');
  const [afFilter, setAfFilter] = useState('all');
  const [utilMetric, setUtilMetric] = useState('windows');
  const [asOf, setAsOf] = useState(today);

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
        <h3>Rating matrix — who can fly what</h3>
        <p className="caption">
          People × airframe. This is the tell that exposes a phantom shortage: count the rated pilots per
          airframe, then look at which reason the deferral log used.
        </p>
        <div className="filters">
          <select value={asOf} onChange={(e) => setAsOf(e.target.value)} aria-label="As of date">
            <option value="2026-05-15">As of May 15 · before the cross-rating flights</option>
            <option value={today}>As of {fmtDate(today)} · today</option>
          </select>
        </div>
        <div className="tbl-wrap">
          <table className="matrix">
            <thead>
              <tr><th>Person</th><th>Roles</th>{airframes.map((af) => <th key={af}>{af}</th>)}</tr>
            </thead>
            <tbody>
              {matrix.rows.map(({ person, cells }) => (
                <tr key={person.person_id}>
                  <td>{person.name}{person.self_pilot && <span className="flag" title="Can fly as lone operator">self-pilot</span>}</td>
                  <td className="mono dim">{person.roles.join(' · ')}</td>
                  {airframes.map((af) => (
                    <td key={af} className={`mx ${cells[af].state}`}>
                      {cells[af].state === 'rated' && (cells[af].since ? `since ${fmtDate(cells[af].since)}` : 'rated')}
                      {cells[af].state === 'pending' && `from ${fmtDate(cells[af].since)}`}
                      {cells[af].state === 'none' && '·'}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="mx-total">
                <td className="mono">rated pilots</td><td />
                {airframes.map((af) => <td key={af} className={`mono ${matrix.totals[af].pilots <= 2 ? 'age-hot' : ''}`}>{matrix.totals[af].pilots}</td>)}
              </tr>
              <tr className="mx-total">
                <td className="mono">rated operators</td><td />
                {airframes.map((af) => <td key={af} className="mono">{matrix.totals[af].operators}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
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
