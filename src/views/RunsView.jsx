import { useMemo, useState } from 'react';
import { fmtDate, missingArtifacts } from '../lib/helpers';

const RANGES = { '7': 7, '30': 30, '90': 90, all: Infinity };

export default function RunsView({ runs }) {
  const [pipeline, setPipeline] = useState('all');
  const [status, setStatus] = useState('all');
  const [build, setBuild] = useState('all');
  const [range, setRange] = useState('30');
  const [q, setQ] = useState('');

  const builds = useMemo(
    () => [...new Set(runs.map((r) => r.build))].sort(),
    [runs],
  );

  const latest = runs[runs.length - 1].date;

  const filtered = useMemo(() => {
    const cutoffDays = RANGES[range];
    const cutoff = new Date(new Date(latest) - cutoffDays * 86400000);
    return runs
      .filter((r) => (pipeline === 'all' ? true : r.pipeline === pipeline))
      .filter((r) => (status === 'all' ? true : r.status === status))
      .filter((r) => (build === 'all' ? true : r.build === build))
      .filter((r) => (range === 'all' ? true : new Date(r.date) >= cutoff))
      .filter((r) =>
        q.trim() === ''
          ? true
          : (r.scenario + ' ' + r.run_id + ' ' + r.owner).toLowerCase().includes(q.toLowerCase()),
      )
      .slice()
      .reverse(); // newest first — this is a log, not a ledger
  }, [runs, pipeline, status, build, range, q, latest]);

  return (
    <section>
      <div className="filters">
        <select value={pipeline} onChange={(e) => setPipeline(e.target.value)} aria-label="Pipeline">
          <option value="all">All pipelines</option>
          <option>Simulation</option>
          <option>HIL Bench</option>
          <option>Flight</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="all">All statuses</option>
          <option value="pass">Pass</option>
          <option value="fail">Fail</option>
          <option value="blocked">Blocked</option>
        </select>
        <select value={build} onChange={(e) => setBuild(e.target.value)} aria-label="Build">
          <option value="all">All builds</option>
          {builds.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Date range">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="all">All time</option>
        </select>
        <input
          placeholder="Search scenario, run ID, owner…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search runs"
        />
      </div>

      <p className="count-note">
        Showing {filtered.length} of {runs.length} runs
      </p>

      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Run</th>
              <th>Date</th>
              <th>Pipeline</th>
              <th>Scenario</th>
              <th>Build</th>
              <th>Status</th>
              <th>Dur</th>
              <th>Owner</th>
              <th title="Artifacts: logs · telemetry · video">Art</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.run_id}>
                <td className="mono">{r.run_id}</td>
                <td className="mono dim">{fmtDate(r.date)}</td>
                <td className="dim">{r.pipeline}</td>
                <td className="scenario">{r.scenario}</td>
                <td className="mono dim">{r.build}</td>
                <td>
                  <span className={`pill ${r.status}`}>{r.status}</span>
                </td>
                <td className="mono dim">{r.duration_min}m</td>
                <td className="dim">{r.owner}</td>
                <td>
                  <ArtifactDots run={r} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Three dots: logs · telemetry · video. Filled = present, outlined red =
// missing, faint = not applicable (video for Simulation runs).
function ArtifactDots({ run }) {
  const miss = missingArtifacts(run);
  const dot = (name, val) => {
    if (val === null) return <span key={name} className="dot na" title={`${name}: n/a`} />;
    return (
      <span
        key={name}
        className={`dot ${miss.includes(name) ? 'miss' : 'ok'}`}
        title={`${name}: ${miss.includes(name) ? 'MISSING' : 'ok'}`}
      />
    );
  };
  return (
    <span className="art">
      {dot('logs', run.artifacts.logs)}
      {dot('telemetry', run.artifacts.telemetry)}
      {dot('video', run.artifacts.video)}
    </span>
  );
}
