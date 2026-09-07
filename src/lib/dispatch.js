// Dispatch-side derivations shared by the Plan views (Requests, Dispatch,
// Capacity) and by the loop back into the Execute views. Rules live in
// rules.js; this file is arithmetic over the same data and mutates nothing.
import { addDays, assetStatusOn, availableOn, ratedOn, isOperatingDay, queuedFor } from './rules';
import { daysBetween, fmtDate } from './helpers';

export const STATUS_ORDER = { submitted: 0, deferred: 1, scheduled: 2, executed: 3, withdrawn: 4 };

// "2026-06-30T14:10" → "Jun 30 14:10"
export function fmtStamp(ts) {
  const [d, t] = ts.split('T');
  return `${fmtDate(d)} ${t}`;
}

export function requestAge(r, today) {
  return daysBetween(r.submitted_at.slice(0, 10), today);
}

export function isQueued(r) {
  return r.status === 'submitted' || r.status === 'deferred';
}

export function programCode(db, r) {
  return db.program.get(r.program_id)?.code ?? r.program_id;
}

// The sortie a request currently rides on (planned or flown); a scrubbed
// one only if nothing replaced it.
export function latestAssignment(db, requestId) {
  const list = db.assignments.filter((a) => a.request_id === requestId);
  return list.find((a) => a.status !== 'scrubbed') || list.at(-1) || null;
}

export function personName(db, id) {
  return id ? db.person.get(id)?.name ?? id : '—';
}

// ---------------------------------------------------------------- deferrals

// Every deferral event in the window, with its request. A request deferred
// twice appears twice — that is the occurrence weighting.
export function deferralEvents(requests, { airframe = null, from = null, to = null, program = null } = {}) {
  const out = [];
  for (const r of requests) {
    if (airframe && r.airframe !== airframe) continue;
    if (program && r.program_id !== program) continue;
    for (const e of r.timeline) {
      if (e.event !== 'deferred') continue;
      if (from && e.day < from) continue;
      if (to && e.day > to) continue;
      out.push({ request: r, event: e });
    }
  }
  return out;
}

export function deferralPareto(requests, opts) {
  const counts = new Map();
  for (const { event } of deferralEvents(requests, opts)) {
    counts.set(event.reason, (counts.get(event.reason) || 0) + 1);
  }
  const rows = [...counts].map(([cause, count]) => ({ cause, count })).sort((a, b) => b.count - a.count);
  const total = rows.reduce((s, r) => s + r.count, 0);
  let run = 0;
  return rows.map((r) => {
    run += r.count;
    return { ...r, cumulative: total ? Math.round((run / total) * 100) : 0 };
  });
}

function busyPeople(db, date) {
  const s = new Set();
  for (const a of db.assignments) {
    if (a.date !== date || a.status === 'scrubbed') continue;
    for (const pid of [a.operator_id, a.pilot_id]) if (pid) s.add(`${pid}:${a.window}`);
  }
  return s;
}

// Rated, rostered in one of the windows, and on no sortie in that window.
export function idleRated(db, airframe, date, windows, role) {
  const busy = busyPeople(db, date);
  return db.persons.filter((p) =>
    p.roles.includes(role) && ratedOn(p, airframe, date)
      && windows.some((w) => availableOn(p, date, w) && !busy.has(`${p.person_id}:${w}`)));
}

// The tell that exposes a phantom shortage: a deferral logged as an operator
// shortage on a day when a rated operator sat idle in a window the request
// asked for — and no rated pilot did.
export function misattribution(db, opts) {
  const evs = deferralEvents(db.requests, opts).filter(({ event }) => event.reason === 'no_rated_operator');
  let refuted = 0;
  let pilotsShort = 0;
  for (const { request: r, event: e } of evs) {
    if (idleRated(db, r.airframe, e.day, r.windows, 'operator').length) refuted += 1;
    if (!idleRated(db, r.airframe, e.day, r.windows, 'pilot').length) pilotsShort += 1;
  }
  return { total: evs.length, refuted, pilotsShort };
}

// ---------------------------------------------------------------- north star

// Requests executed within a requested window, on or before needed_by,
// over requests submitted before cutoff whose date has passed. By priority.
export function onWindowFulfillment(db, today) {
  const out = {};
  const bump = (k, hit) => {
    out[k] ??= { num: 0, den: 0 };
    out[k].den += 1;
    if (hit) out[k].num += 1;
  };
  for (const r of db.requests) {
    if (r.late || r.status === 'withdrawn' || r.needed_by > today) continue;
    let hit = false;
    if (r.status === 'executed') {
      const a = latestAssignment(db, r.request_id);
      hit = Boolean(a && a.date <= r.needed_by && r.windows.includes(a.window));
    }
    bump(r.priority, hit);
    bump('all', hit);
  }
  for (const k of Object.keys(out)) out[k].pct = out[k].den ? Math.round((out[k].num / out[k].den) * 100) : null;
  return out;
}

// ---------------------------------------------------------------- utilization

// Per airframe on one day: tails and asset-windows available (grounded and
// maintenance tails leave the denominator), and what the plan used.
export function dailyCapacity(db, date) {
  const per = {};
  for (const a of db.assets) {
    const row = (per[a.airframe] ??= { tails: 0, windows: 0, usedWindows: 0, usedTails: new Set() });
    const st = assetStatusOn(a, date).status;
    if (st === 'grounded' || st === 'maintenance') continue;
    row.tails += 1;
    row.windows += a.windows.length;
  }
  for (const x of db.assignments) {
    if (x.date !== date || x.status === 'scrubbed') continue;
    const af = db.asset.get(x.asset_id)?.airframe;
    if (!af || !per[af]) continue;
    per[af].usedWindows += 1;
    per[af].usedTails.add(x.asset_id);
  }
  return per;
}

function mondayOf(iso) {
  const day = new Date(iso + 'T00:00:00Z').getUTCDay();
  return addDays(iso, -((day + 6) % 7));
}

function pct(a, b) {
  return b ? Math.round((a / b) * 100) : null;
}

// Weekly asset-window utilization per airframe, plus tail-day saturation
// (share of available tails that flew at all) as "<airframe> tails".
export function utilizationByWeek(db, from, to) {
  const weeks = new Map();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!isOperatingDay(d, db)) continue;
    const key = mondayOf(d);
    if (!weeks.has(key)) weeks.set(key, { key, per: {} });
    const w = weeks.get(key);
    for (const [af, c] of Object.entries(dailyCapacity(db, d))) {
      const p = (w.per[af] ??= { windows: 0, used: 0, tails: 0, usedTails: 0 });
      p.windows += c.windows;
      p.used += c.usedWindows;
      p.tails += c.tails;
      p.usedTails += c.usedTails.size;
    }
  }
  return [...weeks.values()].sort((a, b) => a.key.localeCompare(b.key)).map((w) => {
    const row = { week: fmtDate(w.key) };
    for (const [af, p] of Object.entries(w.per)) {
      row[af] = pct(p.used, p.windows);
      row[`${af} tails`] = pct(p.usedTails, p.tails);
    }
    return row;
  });
}

export function assetUtilization(db, from, to) {
  const tot = { used: 0, avail: 0 };
  const per = {};
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!isOperatingDay(d, db)) continue;
    for (const [af, c] of Object.entries(dailyCapacity(db, d))) {
      const p = (per[af] ??= { used: 0, avail: 0 });
      p.used += c.usedWindows;
      p.avail += c.windows;
      tot.used += c.usedWindows;
      tot.avail += c.windows;
    }
  }
  for (const p of [tot, ...Object.values(per)]) p.pct = pct(p.used, p.avail);
  return { ...tot, per };
}

// Seats filled over person-windows rostered, per role and overall.
export function crewUtilization(db, from, to) {
  const roles = { operator: { used: 0, avail: 0 }, pilot: { used: 0, avail: 0 } };
  for (const p of db.persons) {
    for (const [d, ws] of Object.entries(p.availability)) {
      if (d < from || d > to) continue;
      for (const role of p.roles) roles[role].avail += ws.length;
    }
  }
  for (const a of db.assignments) {
    if (a.date < from || a.date > to || a.status === 'scrubbed') continue;
    if (a.operator_id) roles.operator.used += 1;
    if (a.pilot_id) roles.pilot.used += 1;
  }
  const all = { used: roles.operator.used + roles.pilot.used, avail: roles.operator.avail + roles.pilot.avail };
  for (const p of [all, roles.operator, roles.pilot]) p.pct = pct(p.used, p.avail);
  return { ...all, ...roles };
}

// ---------------------------------------------------------------- lead time · churn

function percentile(sorted, q) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

// Submitted → executed, in days, p50/p90 per program and overall.
export function leadTimes(db, from = null, to = null) {
  const by = {};
  for (const r of db.requests) {
    const ex = r.timeline.find((e) => e.event === 'executed');
    if (!ex) continue;
    if (from && ex.day < from) continue;
    if (to && ex.day > to) continue;
    const days = daysBetween(r.submitted_at.slice(0, 10), ex.day);
    (by[r.program_id] ??= []).push(days);
    (by.all ??= []).push(days);
  }
  const out = {};
  for (const [k, xs] of Object.entries(by)) {
    xs.sort((a, b) => a - b);
    out[k] = { n: xs.length, p50: percentile(xs, 0.5), p90: percentile(xs, 0.9) };
  }
  return out;
}

// Scrubs + same-day reassignments per day, zero-filled across the window.
export function churnByDay(db, from, to) {
  const days = new Map();
  for (let d = from; d <= to; d = addDays(d, 1)) days.set(d, { date: d, day: fmtDate(d), scrubs: 0, reassignments: 0 });
  for (const r of db.requests) {
    for (const e of r.timeline) {
      const row = e.day && days.get(e.day);
      if (!row) continue;
      if (e.event === 'scrubbed') row.scrubs += 1;
      if (e.event === 'reassigned') row.reassignments += 1;
    }
  }
  return [...days.values()].map((r) => ({ ...r, total: r.scrubs + r.reassignments }));
}

// ---------------------------------------------------------------- ratings · demand

// People × airframe. 'rated' | 'pending' (effective after asOf) | 'none'.
export function ratingMatrix(db, airframes, asOf) {
  const rows = db.persons.map((p) => ({
    person: p,
    cells: Object.fromEntries(airframes.map((af) => {
      if (!p.ratings.includes(af)) return [af, { state: 'none' }];
      const since = p.ratings_effective?.[af] || null;
      return [af, { state: since && since > asOf ? 'pending' : 'rated', since }];
    })),
  }));
  const totals = Object.fromEntries(airframes.map((af) => [af, {
    pilots: db.persons.filter((p) => p.roles.includes('pilot') && ratedOn(p, af, asOf)).length,
    operators: db.persons.filter((p) => p.roles.includes('operator') && ratedOn(p, af, asOf)).length,
  }]));
  return { rows, totals };
}

// Demand (requests by first-choice window) vs supply (asset-windows on
// operating days, grounded tails excluded) per airframe.
export function demandVsSupply(db, from, to) {
  const per = {};
  for (const a of db.assets) {
    const row = (per[a.airframe] ??= {});
    for (const w of a.windows) row[w] ??= { window: w, demand: 0, supply: 0, flexible: 0 };
  }
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!isOperatingDay(d, db)) continue;
    for (const a of db.assets) {
      const st = assetStatusOn(a, d).status;
      if (st === 'grounded' || st === 'maintenance') continue;
      for (const w of a.windows) per[a.airframe][w].supply += 1;
    }
  }
  for (const r of db.requests) {
    if (r.status === 'withdrawn' || r.needed_by < from || r.needed_by > to) continue;
    const cell = per[r.airframe]?.[r.windows[0]];
    if (!cell) continue;
    cell.demand += 1;
    if (r.windows.length > 1) cell.flexible += 1;
  }
  return Object.fromEntries(Object.entries(per).map(([af, ws]) => [af, Object.values(ws)]));
}

// ---------------------------------------------------------------- the loop

// Grounding days attributable to RCCA items: per failure, total days and the
// days while the failure was still open (before its resolved date).
export function groundingDays(db, failures, today) {
  const byFailure = new Map();
  for (const a of db.assets) {
    for (const h of a.status_history) {
      if (h.status !== 'grounded' || !h.failure_id) continue;
      const end = h.date_to || today;
      const f = failures.find((x) => x.failure_id === h.failure_id);
      const row = byFailure.get(h.failure_id) || { failure_id: h.failure_id, title: f?.title, status: f?.triage_status, days: 0, openDays: 0, tails: [] };
      let d = h.date_from;
      while (d <= end) {
        row.days += 1;
        if (!f?.resolved || d <= f.resolved) row.openDays += 1;
        d = addDays(d, 1);
      }
      row.tails.push({ asset_id: a.asset_id, from: h.date_from, to: h.date_to });
      byFailure.set(h.failure_id, row);
    }
  }
  const rows = [...byFailure.values()];
  return { rows, days: rows.reduce((s, r) => s + r.days, 0), openDays: rows.reduce((s, r) => s + r.openDays, 0) };
}

// Tails grounded/held against a failure — for the failure's detail panel.
export function tailsAgainst(db, failureId) {
  const out = [];
  for (const a of db.assets) {
    for (const h of a.status_history) {
      if (h.failure_id === failureId) out.push({ asset: a, ...h });
    }
  }
  return out;
}

// One day's plan in numbers — header stat, board footer, EOD report.
export function daySummary(db, date) {
  const sorties = db.assignments.filter((a) => a.date === date && a.status !== 'scrubbed');
  const rail = queuedFor(date, db);
  const unscheduled = rail.filter((r) => isQueued(r) && r.plan_date <= date);
  return {
    date,
    sorties: sorties.length,
    unscheduled: unscheduled.length,
    p0: unscheduled.filter((r) => r.priority === 'P0').length,
    late: unscheduled.filter((r) => r.late).length,
    byCause: deferralPareto(db.requests, { from: date, to: date }),
  };
}
