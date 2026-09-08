// Dispatch rules R1–R8 as pure functions over plain data. The board calls
// these before it saves anything; the same functions are run over the seed
// in rules.test.js, so the data and the app can never disagree about what is
// allowed. Probabilistic judgment stays in the coordinator's head; this file
// is the deterministic shell around it.
//
// Severity: 'block' rejects the edit; 'warn' renders inline and in the day
// summary; R8 is structural (a deferral without a reason cannot be built).

export const WINDOWS = ['AM', 'PM', 'NIGHT'];
export const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };

export const DEFERRAL_REASONS = [
  'no_rated_operator', 'no_rated_pilot', 'no_asset', 'asset_grounded',
  'program_over_max', 'build_not_ready', 'late_intake', 'requester_withdrew',
];
export const SCRUB_REASONS = [...DEFERRAL_REASONS, 'weather'];

export const REASON_LABELS = {
  no_rated_operator: 'No rated operator',
  no_rated_pilot: 'No rated pilot',
  no_asset: 'No tail available',
  asset_grounded: 'Tail grounded',
  program_over_max: 'Program at tail cap',
  build_not_ready: 'Build not ready',
  late_intake: 'Late intake',
  requester_withdrew: 'Requester withdrew',
  weather: 'Weather',
};

export const CREW_LABELS = {
  none: 'No crew',
  pilot_only: 'Safety pilot only',
  operator_pilot: 'Operator + safety pilot',
  lone_operator: 'Lone operator (self-pilot)',
};

// ---------------------------------------------------------------- lookups

// Index the seed once; views pass the result around instead of re-finding.
export function makeDb({ programs, assets, persons, requests, assignments }) {
  return {
    programs, assets, persons, requests, assignments,
    program: new Map(programs.map((p) => [p.program_id, p])),
    asset: new Map(assets.map((a) => [a.asset_id, a])),
    person: new Map(persons.map((p) => [p.person_id, p])),
    request: new Map(requests.map((r) => [r.request_id, r])),
  };
}

// ISO date arithmetic without timezone drift.
export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isWeekend(iso) {
  const day = new Date(iso + 'T00:00:00Z').getUTCDay();
  return day === 0 || day === 6;
}

// A type rating counts from its effective date; no date means "always had it".
export function ratedOn(person, airframe, date) {
  if (!person || !person.ratings.includes(airframe)) return false;
  const eff = person.ratings_effective?.[airframe];
  return !eff || eff <= date;
}

export function availableOn(person, date, window) {
  return Boolean(person?.availability?.[date]?.includes(window));
}

// Status of a tail on a given day, from its history; the snapshot fields on
// the asset are only "today".
export function assetStatusOn(asset, date) {
  for (const h of asset.status_history || []) {
    if (h.date_from <= date && (!h.date_to || date <= h.date_to)) {
      return { status: h.status, reserved_by: h.reserved_by || null, note: h.note || '', failure_id: h.failure_id || null };
    }
  }
  return { status: 'available', reserved_by: null, note: '', failure_id: null };
}

// A day counts as operating when anyone is rostered — weekends without crew
// are not capacity, and a standing program is not "under target" on them.
export function isOperatingDay(date, db) {
  return db.persons.some((p) => p.availability[date]?.length);
}

// ---------------------------------------------------------------- R7 · intake cutoff

// Submitted after the cutoff for the day before needed_by (or on/after the
// day itself) is late.
export function isLate(submittedAt, neededBy, cutoff = '15:00') {
  const [d, t] = submittedAt.split('T');
  const cutoffDay = addDays(neededBy, -1);
  return d > cutoffDay || (d === cutoffDay && t >= cutoff);
}

// Late intake defaults to the next open day; on time keeps its date.
export function defaultPlanDate(request, { cutoff = '15:00', isOpen = () => true } = {}) {
  let d = isLate(request.submitted_at, request.needed_by, cutoff) ? addDays(request.needed_by, 1) : request.needed_by;
  for (let i = 0; i < 14 && !isOpen(d); i++) d = addDays(d, 1);
  return d;
}

export function lateWarning(request, cutoff = '15:00') {
  if (!isLate(request.submitted_at, request.needed_by, cutoff)) return null;
  return {
    rule: 'R7', severity: 'warn', request_id: request.request_id,
    message: `${request.request_id} was submitted after the ${cutoff} cutoff for ${request.needed_by}; it defaults to the next open day.`,
  };
}

// ---------------------------------------------------------------- R8 · deferral needs a reason

export function validateReason(reason, allowed = DEFERRAL_REASONS) {
  if (allowed.includes(reason)) return { ok: true };
  return { ok: false, rule: 'R8', message: `A ${allowed === SCRUB_REASONS ? 'scrub' : 'deferral'} needs a reason: ${allowed.join(' · ')}.` };
}

function assertReason(reason, allowed) {
  const v = validateReason(reason, allowed);
  if (!v.ok) throw new Error(`R8: ${v.message}`);
}

// ---------------------------------------------------------------- R1–R4 · one assignment

function personName(db, id) {
  return db.person.get(id)?.name ?? id;
}

// Violations for a candidate assignment {date, window, request_id, asset_id,
// operator_id, pilot_id, assignment_id?}. Editing an existing assignment
// passes its assignment_id so R2 does not collide with itself.
export function checkAssignment(cand, db) {
  const out = [];
  const request = db.request.get(cand.request_id);
  const asset = db.asset.get(cand.asset_id);
  if (!request || !asset) {
    return [{ rule: 'R3', severity: 'block', message: 'Unknown request or tail.' }];
  }
  const program = db.program.get(request.program_id);
  const airframe = asset.airframe;

  // R3 — the tail must be assignable to this program on this day
  if (airframe !== request.airframe) {
    out.push({ rule: 'R3', severity: 'block', message: `${asset.asset_id} is a ${airframe}; ${request.request_id} needs a ${request.airframe}.` });
  }
  if (!asset.windows.includes(cand.window)) {
    out.push({ rule: 'R3', severity: 'block', message: `${asset.asset_id} does not operate in the ${cand.window} window.` });
  }
  const st = assetStatusOn(asset, cand.date);
  if (st.status === 'grounded' || st.status === 'maintenance') {
    out.push({ rule: 'R3', severity: 'block', message: `${asset.asset_id} is ${st.status} on ${cand.date}${st.note ? ` — ${st.note}` : ''}.` });
  } else if (st.status === 'reserved' && st.reserved_by !== request.program_id) {
    const holder = db.program.get(st.reserved_by)?.code ?? st.reserved_by;
    out.push({ rule: 'R3', severity: 'block', message: `${asset.asset_id} is reserved by ${holder} on ${cand.date}.` });
  }

  // R2 — no tail and no person in two sorties in the same date + window.
  // A scrubbed sortie frees its crew but not its slot: one assignment per
  // (date, asset, window), ever — the schema says the same.
  const crew = [cand.operator_id, cand.pilot_id].filter(Boolean);
  for (const a of db.assignments) {
    if (a.date !== cand.date || a.window !== cand.window) continue;
    if (cand.assignment_id && a.assignment_id === cand.assignment_id) continue;
    if (a.asset_id === cand.asset_id) {
      out.push({ rule: 'R2', severity: 'block', message: `${asset.asset_id} is already ${a.status === 'scrubbed' ? 'used (scrubbed sortie)' : `assigned to ${a.request_id}`} in ${cand.window} on ${cand.date}.` });
    }
    if (a.status === 'scrubbed') continue;
    for (const pid of crew) {
      if (a.operator_id === pid || a.pilot_id === pid) {
        out.push({ rule: 'R2', severity: 'block', message: `${personName(db, pid)} is already on ${a.request_id} (${a.asset_id}) in ${cand.window} on ${cand.date}.` });
      }
    }
  }

  // R1 — type rating for the airframe, as of the day
  for (const pid of crew) {
    const p = db.person.get(pid);
    if (!ratedOn(p, airframe, cand.date)) {
      out.push({ rule: 'R1', severity: 'block', message: `${personName(db, pid)} is not rated on ${airframe}${p?.ratings_effective?.[airframe] ? ` until ${p.ratings_effective[airframe]}` : ''}.` });
    }
    if (p && !availableOn(p, cand.date, cand.window)) {
      out.push({ rule: 'AV', severity: 'warn', message: `${p.name} is not rostered for ${cand.window} on ${cand.date}.` });
    }
  }

  // R4 — crew shape must match the request
  const op = db.person.get(cand.operator_id);
  const pi = db.person.get(cand.pilot_id);
  const need = request.crew;
  if (need === 'operator_pilot') {
    if (!op || !pi) out.push({ rule: 'R4', severity: 'block', message: `${request.request_id} needs an operator and a safety pilot.` });
    else if (op.person_id === pi.person_id) out.push({ rule: 'R4', severity: 'block', message: `${op.name} cannot be both operator and safety pilot on one sortie.` });
    if (op && !op.roles.includes('operator')) out.push({ rule: 'R4', severity: 'block', message: `${op.name} is not an operator.` });
    if (pi && !pi.roles.includes('pilot')) out.push({ rule: 'R4', severity: 'block', message: `${pi.name} is not a safety pilot.` });
  } else if (need === 'pilot_only') {
    if (!pi) out.push({ rule: 'R4', severity: 'block', message: `${request.request_id} needs a safety pilot.` });
    else if (!pi.roles.includes('pilot')) out.push({ rule: 'R4', severity: 'block', message: `${pi.name} is not a safety pilot.` });
    if (op) out.push({ rule: 'R4', severity: 'block', message: `${request.request_id} is safety-pilot only; no operator seat.` });
  } else if (need === 'lone_operator') {
    if (!op) out.push({ rule: 'R4', severity: 'block', message: `${request.request_id} needs a lone operator.` });
    else if (!op.roles.includes('operator') || !op.self_pilot) out.push({ rule: 'R4', severity: 'block', message: `${op.name} cannot fly as a lone operator (needs the operator role and self-pilot).` });
    if (pi) out.push({ rule: 'R4', severity: 'block', message: `${request.request_id} is a lone-operator sortie; no pilot seat.` });
  } else if (need === 'none') {
    if (op || pi) out.push({ rule: 'R4', severity: 'block', message: `${request.request_id} takes no crew.` });
  }

  // R5 is a day-level warning, but say so at edit time when this sortie would
  // push the program past its cap with a new tail.
  if (program) {
    const tails = programTails(cand.date, program.program_id, db, cand.assignment_id);
    if (!tails.has(cand.asset_id) && tails.size >= program.asset_max) {
      out.push({ rule: 'R5', severity: 'warn', message: `${program.code} would be at ${tails.size + 1} tails today; target is ${program.asset_min}–${program.asset_max}.` });
    }
  }
  return out;
}

export function hasBlock(violations) {
  return violations.some((v) => v.severity === 'block');
}

// ---------------------------------------------------------------- day-level

// Distinct tails flying for a program on a day (non-scrubbed sorties).
export function programTails(date, programId, db, excludeAssignmentId = null) {
  const tails = new Set();
  for (const a of db.assignments) {
    if (a.status === 'scrubbed' || a.date !== date) continue;
    if (excludeAssignmentId && a.assignment_id === excludeAssignmentId) continue;
    if (db.request.get(a.request_id)?.program_id === programId) tails.add(a.asset_id);
  }
  return tails;
}

// The rail for a day: what is still queued for it (live), plus what was
// deferred from it (history) — so past days read as they were argued.
export function queuedFor(date, db) {
  const seen = new Set();
  const out = [];
  for (const r of db.requests) {
    const live = (r.status === 'submitted' || r.status === 'deferred') && r.plan_date && r.plan_date <= date;
    const deferredThatDay = r.timeline.some((e) => e.event === 'deferred' && e.day === date);
    if ((live || deferredThatDay) && !seen.has(r.request_id)) {
      seen.add(r.request_id);
      out.push(r);
    }
  }
  return out.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.submitted_at.localeCompare(b.submitted_at));
}

// R5 (targets) and R6 (P0 starvation) for one day.
export function dayWarnings(date, db) {
  const out = [];
  const queued = queuedFor(date, db);
  const operating = isOperatingDay(date, db);

  for (const p of db.programs) {
    const n = programTails(date, p.program_id, db).size;
    // A standing program is expected every weekday; anyone else only when
    // it actually asked for tails that day.
    const demand = queued.some((r) => r.program_id === p.program_id) || n > 0 || (p.standing && !isWeekend(date));
    if (operating && demand && n < p.asset_min) {
      out.push({ rule: 'R5', severity: 'warn', level: 'under', program_id: p.program_id, count: n,
        message: `${p.code}: ${n} of ${p.asset_min}–${p.asset_max} tails — under target.` });
    } else if (n > p.asset_max) {
      out.push({ rule: 'R5', severity: 'warn', level: 'over', program_id: p.program_id, count: n,
        message: `${p.code}: ${n} tails — over the ${p.asset_max} cap.` });
    }
  }

  const unscheduledP0 = queued.filter((r) => r.priority === 'P0' && (r.status === 'submitted' || r.status === 'deferred'));
  for (const r of unscheduledP0) {
    const holder = db.assignments.find((a) => {
      if (a.status === 'scrubbed' || a.date !== date) return false;
      const hr = db.request.get(a.request_id);
      const asset = db.asset.get(a.asset_id);
      return hr && asset && PRIORITY_RANK[hr.priority] > PRIORITY_RANK[r.priority]
        && asset.airframe === r.airframe && r.windows.includes(a.window);
    });
    if (holder) {
      const hr = db.request.get(holder.request_id);
      out.push({ rule: 'R6', severity: 'warn', request_id: r.request_id, holder: holder.assignment_id,
        message: `${r.request_id} (P0) is unscheduled while ${hr.request_id} (${hr.priority}) holds ${holder.asset_id} in ${holder.window}.` });
    }
  }
  return out;
}

// ---------------------------------------------------------------- transitions (immutable)

let localSeq = 0;
export function nextAssignmentId() {
  localSeq += 1;
  return `AS-2026-L${String(localSeq).padStart(3, '0')}`;
}

export function scheduleRequest(request, assignment, at) {
  return {
    ...request, status: 'scheduled', plan_date: assignment.date, deferral_reason: null,
    timeline: [...request.timeline, { at, day: assignment.date, event: 'scheduled', reason: null,
      note: `${assignment.asset_id} ${assignment.window} (board)` }],
  };
}

// R8: no reason, no deferral — this throws rather than returning a request.
export function deferRequest(request, { reason, day, at, note = '' }) {
  assertReason(reason, DEFERRAL_REASONS);
  const withdrawn = reason === 'requester_withdrew';
  return {
    ...request, status: withdrawn ? 'withdrawn' : 'deferred', deferral_reason: reason,
    plan_date: withdrawn ? request.plan_date : addDays(day, 1),
    timeline: [...request.timeline, { at, day, event: withdrawn ? 'withdrawn' : 'deferred', reason, note }],
  };
}

export function scrubAssignment(assignment, { reason }) {
  assertReason(reason, SCRUB_REASONS);
  return { ...assignment, status: 'scrubbed', scrub_reason: reason };
}

// A scrubbed sortie puts its request back on the same day's rail, so the
// coordinator can reassign it before deciding to defer.
export function scrubRequest(request, assignment, { reason, at }) {
  assertReason(reason, SCRUB_REASONS);
  return {
    ...request, status: 'deferred', plan_date: assignment.date,
    timeline: [...request.timeline, { at, day: assignment.date, event: 'scrubbed', reason,
      note: `${assignment.asset_id} ${assignment.window} scrubbed (board)` }],
  };
}
