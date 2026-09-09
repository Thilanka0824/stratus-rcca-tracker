import { useEffect, useMemo, useRef, useState } from 'react';
import { failureAge, isAging, isUnresolved, fmtDate, daysBetween } from '../lib/helpers';
import { tailsAgainst } from '../lib/dispatch';

const STEPS = ['Open', 'Investigating', 'Corrective Action', 'Verified'];

export default function TriageView({ failures, setFailures, runs, today, db, focusId = null, onOpenBoard }) {
  const [selId, setSelId] = useState(focusId);   // arriving from a grounded tail on the board

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

  // Every status change is reversible for a few seconds. A mis-click on
  // "Verified" would otherwise silently close a failure and sink it in the
  // queue — the kind of ending a triager remembers (Peak-End rule).
  // The timer pauses while the toast is hovered or focused, and closing it
  // hands keyboard focus back to the stepper instead of dropping it on body.
  const [toast, setToast] = useState(null);
  const [paused, setPaused] = useState(false);
  const undoRef = useRef(null);
  const stepperRef = useRef(null);
  useEffect(() => {
    if (!toast || paused) return;
    const t = setTimeout(() => dismissToast(), 6000);
    return () => clearTimeout(t);
  }, [toast, paused]);

  function dismissToast(returnFocus = false) {
    const hadFocus = document.activeElement === undoRef.current;
    setToast(null);
    setPaused(false);
    if (returnFocus || hadFocus) {
      // after React has removed the toast (a timeout, not rAF: rAF stalls in a background tab)
      setTimeout(() => stepperRef.current?.querySelector('[aria-current="step"]')?.focus(), 0);
    }
  }

  function applyStatus(id, status, resolved) {
    setFailures((prev) =>
      prev.map((f) => (f.failure_id === id ? { ...f, triage_status: status, resolved } : f)),
    );
  }

  function setStatus(id, status) {
    const before = failures.find((f) => f.failure_id === id);
    if (!before || before.triage_status === status) return;
    setSelId(id); // keep the changed card selected even as the queue re-sorts
    applyStatus(id, status, status === 'Verified' ? today : null);
    const verb =
      status === 'Verified'
        ? `verified · closed in ${failureAge({ ...before, resolved: today }, today)}d`
        : `→ ${status}`;
    setToast({
      text: `${id} ${verb}`,
      undo: () => applyStatus(id, before.triage_status, before.resolved),
    });
  }

  return (
    <section className="triage">
      <div className="fl-list">
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

      {sel ? <Detail f={sel} today={today} setStatus={setStatus} runs={runs} db={db} onOpenBoard={onOpenBoard} stepperRef={stepperRef} /> : (
        <div className="detail empty-hint">Select a failure to triage.</div>
      )}

      {/* The live region is always mounted so screen readers announce the
          toast when its text arrives, not just when the node does. */}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div
            className="toast"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
          >
            <span className="mono">{toast.text}</span>
            <button ref={undoRef} className="btn ghost" onClick={() => { toast.undo(); dismissToast(true); }}>
              Undo
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function Detail({ f, today, setStatus, runs, db, onOpenBoard, stepperRef }) {
  const stepIdx = STEPS.indexOf(f.triage_status);
  // The loop, both directions: which programs this failure hit (through the
  // sorties its runs came from) and which tails are grounded against it.
  const programs = useMemo(() => {
    const counts = new Map();
    for (const id of f.occurrences) {
      const run = runs.find((r) => r.run_id === id);
      const code = run?.request_id ? db.program.get(db.request.get(run.request_id)?.program_id)?.code : null;
      if (code) counts.set(code, (counts.get(code) || 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [f, runs, db]);
  const grounded = useMemo(() => tailsAgainst(db, f.failure_id), [db, f.failure_id]);
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
      <div className="stepper" role="group" aria-label="Advance triage status" ref={stepperRef}>
        {STEPS.map((s, i) => (
          <button
            key={s}
            className={`step ${i < stepIdx ? 'done' : ''} ${i === stepIdx ? 'now' : ''}`}
            onClick={() => setStatus(f.failure_id, s)}
            aria-current={i === stepIdx ? 'step' : undefined}
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

      {(programs.length > 0 || grounded.length > 0) && (
        <>
          <div className="sect-label">Dispatch impact</div>
          <div className="corrective">
            {programs.length > 0 && (
              <div>Programs hit through their sorties: {programs.map(([code, n]) => `${code} (${n})`).join(' · ')}</div>
            )}
            {grounded.map((g) => (
              <div key={g.asset.asset_id + g.date_from} className="grounding">
                <strong className="mono">{g.asset.asset_id}</strong> {g.status} {fmtDate(g.date_from)} – {g.date_to ? fmtDate(g.date_to) : 'open'}
                {' '}({daysBetween(g.date_from, g.date_to || today) + 1} days) · {g.note}
                {onOpenBoard && <button className="linkish small" onClick={() => onOpenBoard(g.date_from)}>board →</button>}
              </div>
            ))}
            {grounded.length === 0 && programs.length > 0 && <div className="dim-note">No tails grounded against this failure.</div>}
          </div>
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
