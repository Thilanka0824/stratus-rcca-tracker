import { useMemo, useState } from 'react';
import { failureAge, isAging, isUnresolved, fmtDate } from '../lib/helpers';

const STEPS = ['Open', 'Investigating', 'Corrective Action', 'Verified'];

export default function TriageView({ failures, setFailures, today }) {
  const [selId, setSelId] = useState(null);

  // Unresolved first, then severity, then age (oldest first) — triage order,
  // not chronological order. The queue should read like a to-do list.
  const sorted = useMemo(() => {
    const sevRank = { P0: 0, P1: 1, P2: 2, P3: 3 };
    return failures.slice().sort((a, b) => {
      const ua = isUnresolved(a) ? 0 : 1;
      const ub = isUnresolved(b) ? 0 : 1;
      if (ua !== ub) return ua - ub;
      if (sevRank[a.severity] !== sevRank[b.severity]) {
        return sevRank[a.severity] - sevRank[b.severity];
      }
      return failureAge(b, today) - failureAge(a, today);
    });
  }, [failures, today]);

  const sel = failures.find((f) => f.failure_id === selId) || sorted[0];

  function setStatus(id, status) {
    setFailures((prev) =>
      prev.map((f) =>
        f.failure_id === id
          ? {
              ...f,
              triage_status: status,
              resolved: status === 'Verified' ? today : null,
            }
          : f,
      ),
    );
  }

  return (
    <section className="triage">
      <div className="fl-list" role="list">
        {sorted.map((f) => {
          const age = failureAge(f, today);
          const aging = isAging(f, today);
          return (
            <button
              key={f.failure_id}
              className={`fl-card ${sel?.failure_id === f.failure_id ? 'sel' : ''} ${aging ? 'aging' : ''}`}
              onClick={() => setSelId(f.failure_id)}
            >
              <div className="fl-top">
                <span className={`sev ${f.severity}`}>{f.severity}</span>
                <span className="fl-id">{f.failure_id}</span>
                <span className="fl-id">· {f.triage_status}</span>
              </div>
              <div className="fl-title">{f.title}</div>
              <div className="fl-meta">
                <span>{f.team}</span>
                <span className={aging ? 'age-hot' : ''}>
                  {isUnresolved(f) ? `${age}d open` : `closed in ${age}d`}
                </span>
                <span>{f.occurrences.length}× seen</span>
              </div>
            </button>
          );
        })}
      </div>

      {sel ? <Detail f={sel} today={today} setStatus={setStatus} /> : (
        <div className="detail empty-hint">Select a failure to triage.</div>
      )}
    </section>
  );
}

function Detail({ f, today, setStatus }) {
  const stepIdx = STEPS.indexOf(f.triage_status);
  return (
    <div className="detail">
      <div className="fl-top">
        <span className={`sev ${f.severity}`}>{f.severity}</span>
        <span className="fl-id">{f.failure_id}</span>
      </div>
      <h2>{f.title}</h2>

      <div className="meta-grid">
        <div>
          <div className="k">Team</div>
          <div className="v">{f.team}</div>
        </div>
        <div>
          <div className="k">Opened</div>
          <div className="v">{fmtDate(f.opened)}</div>
        </div>
        <div>
          <div className="k">{f.resolved ? 'Resolved' : 'Age'}</div>
          <div className="v">
            {f.resolved ? fmtDate(f.resolved) : `${failureAge(f, today)} days`}
          </div>
        </div>
        <div>
          <div className="k">Root cause</div>
          <div className="v">{f.root_cause || '— undetermined'}</div>
        </div>
      </div>

      <div className="sect-label">Triage status</div>
      <div className="stepper" role="group" aria-label="Advance triage status">
        {STEPS.map((s, i) => (
          <button
            key={s}
            className={`step ${i < stepIdx ? 'done' : ''} ${i === stepIdx ? 'now' : ''}`}
            onClick={() => setStatus(f.failure_id, s)}
            title={`Set status: ${s}`}
          >
            {s}
          </button>
        ))}
      </div>

      {f.five_whys.length > 0 && (
        <>
          <div className="sect-label">5-Whys analysis</div>
          <ol className="whys">
            {f.five_whys.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ol>
        </>
      )}

      {f.corrective_action && (
        <>
          <div className="sect-label">Corrective action</div>
          <div className="corrective">{f.corrective_action}</div>
        </>
      )}

      <div className="sect-label">Linked runs ({f.occurrences.length})</div>
      <div className="runchips">
        {f.occurrences.slice(0, 14).map((id) => (
          <span key={id} className="runchip">
            {id}
          </span>
        ))}
        {f.occurrences.length > 14 && (
          <span className="runchip">+{f.occurrences.length - 14} more</span>
        )}
      </div>
    </div>
  );
}
