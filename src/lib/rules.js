// Dispatch rules R1–R10 as pure functions over plain data. The board calls
// these before it saves anything; the same functions are run over the seed
// in rules.test.js, so the data and the app can never disagree about what is
// allowed. Probabilistic judgment stays in the coordinator's head; this file
// is the deterministic shell around it.
//
// Severity: 'block' rejects the edit; 'warn' renders inline and in the day
// summary; R8 is structural (a deferral without a reason cannot be built).
// R9 is authorization: every mutating transition takes the actor first and
// calls authorize() before it touches anything — the matrix is data in
// src/lib/auth.js. R10 is the rider desk: a rider-facing sortie needs a
// qualified rider operator covering its window, at or under the desk ratio.
import { authorize } from './auth';
import { fmtDate } from './helpers';

export const WINDOWS = ['AM', 'PM', 'NIGHT'];
export const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };

export const DEFERRAL_REASONS = [
  'no_rated_operator', 'no_rated_pilot', 'no_asset', 'asset_grounded',
  'program_over_max', 'build_not_ready', 'late_intake', 'requester_withdrew',
  'no_rider_ops',
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
  no_rider_ops: 'No rider operator',
  weather: 'Weather',
};

export const CREW_LABELS = {
  none: 'No crew',
  pilot_only: 'Safety pilot only',
  operator_pilot: 'Operator + safety pilot',
  lone_operator: 'Lone operator (self-pilot)',
};

// ---------------------------------------------------------------- lookups

// The desk's settings when the seed does not say (meta.rider_desk does).
export const DEFAULT_DESK = { ratio: 2, min_per_window: 1 };

// Index the seed once; views pass the result around instead of re-finding.
export function makeDb({ programs, assets, persons, requests, assignments, users = [], coverage = [], desk = DEFAULT_DESK }) {
  return {
    programs, assets, persons, requests, assignments, users, coverage, desk,
    program: new Map(programs.map((p) => [p.program_id, p])),
    asset: new Map(assets.map((a) => [a.asset_id, a])),
    person: new Map(persons.map((p) => [p.person_id, p])),
    request: new Map(requests.map((r) => [r.request_id, r])),
    user: new Map(users.map((u) => [u.user_id, u])),
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

// A desk qualification is effective-dated exactly like a rating.
export function qualifiedOn(person, date) {
  const eff = person?.qualifications?.rider_ops;
  return Boolean(eff) && eff <= date;
}

// ---------------------------------------------------------------- the rider desk

// Who is on the desk for a window: the roster rows whose person is qualified
// that day. The roster is the coordinator's; the date check is belt and
// braces for a grant that was later moved.
export function deskCoverers(db, date, window) {
  return (db.coverage || [])
    .filter((c) => c.date === date && c.window === window)
    .map((c) => db.person.get(c.person_id))
    .filter((p) => p && qualifiedOn(p, date));
}

// Rider-facing sorties live in a window; a scrubbed one has no riders aboard.
export function riderLoad(db, date, window, excludeAssignmentId = null) {
  let n = 0;
  for (const a of db.assignments) {
    if (a.date !== date || a.window !== window || a.status === 'scrubbed') continue;
    if (excludeAssignmentId && a.assignment_id === excludeAssignmentId) continue;
    if (db.request.get(a.request_id)?.rider_facing) n += 1;
  }
  return n;
}

// The desk row on the board. red = the next rider-facing sortie would be
// refused (R10); amber = at ratio; green = room; quiet = nobody rostered on
// a day with no operations. The message is what the row says.
export function checkCoverage(date, window, db) {
  const desk = db.desk || DEFAULT_DESK;
  const coverers = deskCoverers(db, date, window);
  const demand = riderLoad(db, date, window);
  const capacity = desk.ratio * coverers.length;
  let level = 'green';
  if (coverers.length < desk.min_per_window) level = demand > 0 || isOperatingDay(date, db) ? 'red' : 'quiet';
  else if (demand > capacity) level = 'red';
  else if (demand === capacity) level = 'amber';
  const message = coverers.length < desk.min_per_window
    ? `no rider operator covering ${window} on ${fmtDate(date)}`
    : `${coverers.length} covering · ${demand} rider-facing · ratio ${desk.ratio}`;
  return { rule: 'R10', date, window, coverers, demand, capacity, ratio: desk.ratio, min: desk.min_per_window, level, message };
}

// Rostering a person onto the desk for a window: {date, window, person_id}.
// R10 wants a qualified rider operator; R2, extended, says nobody covers a
// window twice or covers one they are flying in.
export function checkCover(cand, db) {
  const p = db.person.get(cand.person_id);
  if (!p) return [{ rule: 'R10', severity: 'block', message: 'Unknown person.' }];
  const out = [];
  if (!p.roles.includes('rider_ops') || !qualifiedOn(p, cand.date)) {
    const eff = p.qualifications?.rider_ops;
    out.push({ rule: 'R10', severity: 'block', message: `${p.name} is not qualified on the rider desk${eff ? ` until ${fmtDate(eff)}` : ''}.` });
  }
  if ((db.coverage || []).some((c) => c.date === cand.date && c.window === cand.window && c.person_id === cand.person_id)) {
    out.push({ rule: 'R2', severity: 'block', message: `${p.name} is already covering ${cand.window} on ${fmtDate(cand.date)}.` });
  }
  const flying = db.assignments.find((a) => a.date === cand.date && a.window === cand.window && a.status !== 'scrubbed'
    && (a.operator_id === cand.person_id || a.pilot_id === cand.person_id));
  if (flying) {
    out.push({ rule: 'R2', severity: 'block', message: `${p.name} is flying ${flying.request_id} (${flying.asset_id}) in ${cand.window} on ${fmtDate(cand.date)}.` });
  }
  if (!availableOn(p, cand.date, cand.window)) {
    out.push({ rule: 'AV', severity: 'warn', message: `${p.name} is not rostered for ${cand.window} on ${fmtDate(cand.date)}.` });
  }
  return out;
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

  // R2, extended to the desk — a person covering a window can't fly in it
  for (const pid of crew) {
    if (deskCoverers(db, cand.date, cand.window).some((p) => p.person_id === pid)) {
      out.push({ rule: 'R2', severity: 'block', message: `${personName(db, pid)} is covering the rider desk in ${cand.window} on ${fmtDate(cand.date)}.` });
    }
  }

  // R10 — riders aboard need a rider operator on the line, at or under ratio.
  // A structural rule, not a setting: there is no waiver, only coverage.
  if (request.rider_facing) {
    const desk = db.desk || DEFAULT_DESK;
    const coverers = deskCoverers(db, cand.date, cand.window);
    if (coverers.length < desk.min_per_window) {
      out.push({ rule: 'R10', severity: 'block', message: `no rider operator covering ${cand.window} on ${fmtDate(cand.date)}` });
    } else {
      const load = riderLoad(db, cand.date, cand.window, cand.assignment_id) + 1;
      if (load > desk.ratio * coverers.length) {
        out.push({ rule: 'R10', severity: 'block', message: `desk at ${load}:${coverers.length}, ratio is ${desk.ratio}` });
      }
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


// ---------------------------------------------------------------- intake

export const CREW_KINDS = ['none', 'pilot_only', 'operator_pilot', 'lone_operator'];
export const BUILD_STAGES = ['engineering', 'release_candidate'];

// What intake refuses to accept. Every message names the field.
export function validateRequest(f, db, { tomorrow }) {
  const out = [];
  const program = db.program.get(f.program_id);
  if (!program) out.push({ field: 'program_id', message: 'Pick a program.' });
  if (!f.title || f.title.trim().length < 4) out.push({ field: 'title', message: 'Give the sortie a title (4+ characters).' });
  if (!f.build) out.push({ field: 'build', message: 'Name the build.' });
  if (!BUILD_STAGES.includes(f.build_stage)) out.push({ field: 'build_stage', message: 'Build stage must be engineering or release candidate.' });
  if (!CREW_KINDS.includes(f.crew)) out.push({ field: 'crew', message: 'Pick a crew requirement.' });
  if (!PRIORITY_RANK.hasOwnProperty(f.priority)) out.push({ field: 'priority', message: 'Pick a priority.' });
  if (program && !program.airframes.includes(f.airframe)) {
    out.push({ field: 'airframe', message: `${program.code} flies ${program.airframes.join(' or ')}, not ${f.airframe || 'nothing'}.` });
  }
  const operating = new Set(db.assets.filter((a) => a.airframe === f.airframe).flatMap((a) => a.windows));
  if (!f.windows?.length) out.push({ field: 'windows', message: 'Ask for at least one window.' });
  for (const w of f.windows || []) {
    if (!operating.has(w)) out.push({ field: 'windows', message: `${f.airframe} does not fly in the ${w} window.` });
  }
  if (!f.needed_by || f.needed_by < tomorrow) out.push({ field: 'needed_by', message: `Needed-by must be ${tomorrow} or later — today's plan is set.` });
  if (!f.requester || !f.requester.trim()) out.push({ field: 'requester', message: 'Who is asking?' });
  return out;
}

// Windows an airframe operates, in board order — and a picked set pruned to
// them, so a program switch never leaves a checked box that cannot be
// un-checked. Falls back to the airframe's first window when nothing survives.
export function operatingWindows(db, airframe) {
  const set = new Set(db.assets.filter((a) => a.airframe === airframe).flatMap((a) => a.windows));
  return WINDOWS.filter((w) => set.has(w));
}

export function pruneWindows(windows, db, airframe) {
  const ok = operatingWindows(db, airframe);
  const kept = windows.filter((w) => ok.includes(w));
  return kept.length ? kept : ok.slice(0, 1);
}

// Build a request the way intake would. The late flag and the plan day are
// derived from the submission time (R7), never typed in; the filer is the
// actor (R9), never typed in either.
export function newRequest(actor, f, { id, submittedAt, cutoff = '15:00', isOpen = () => true }) {
  authorize(actor, 'request.create', { program_id: f.program_id });
  const late = isLate(submittedAt, f.needed_by, cutoff);
  const plan_date = defaultPlanDate({ submitted_at: submittedAt, needed_by: f.needed_by }, { cutoff, isOpen });
  const timeline = [{ at: submittedAt, day: null, event: 'submitted', reason: null,
    note: late ? `submitted after the ${cutoff} cutoff` : '', by: actor.user_id }];
  if (late) {
    timeline.push({ at: submittedAt, day: f.needed_by, event: 'deferred', reason: 'late_intake',
      note: `flagged at intake: after the ${cutoff} cutoff — moved to ${plan_date}`, by: actor.user_id });
  }
  return {
    request_id: id, program_id: f.program_id, requester: f.requester.trim(), title: f.title.trim(),
    build: f.build, build_stage: f.build_stage, crew: f.crew, windows: [...f.windows], airframe: f.airframe,
    priority: f.priority, supporting_team: f.supporting_team || null,
    submitted_at: submittedAt, needed_by: f.needed_by, plan_date,
    status: late ? 'deferred' : 'submitted', late, deferral_reason: late ? 'late_intake' : null, timeline,
    rider_facing: Boolean(f.rider_facing), requester_id: actor.user_id,
  };
}

// ---------------------------------------------------------------- transitions (immutable)
// Every one takes the actor first and calls authorize() before anything
// else (R9). The rule checks themselves (checkAssignment, checkCover) are
// the caller's job, because a block is shown on the board, not thrown.

let localSeq = 0;
export function nextAssignmentId() {
  localSeq += 1;
  return `AS-2026-L${String(localSeq).padStart(3, '0')}`;
}

// A sortie built on the board. plan.assign refuses the actor's own request
// (I1) even for a coordinator.
export function newAssignment(actor, request, cand, id = nextAssignmentId()) {
  authorize(actor, 'plan.assign', request);
  return {
    assignment_id: id, ...cand, status: 'planned', scrub_reason: null, run_id: null,
    notes: 'assigned on the board', assigned_by: actor.user_id, acked: false,
  };
}

export function scheduleRequest(actor, request, assignment, at) {
  authorize(actor, 'plan.assign', request);
  return {
    ...request, status: 'scheduled', plan_date: assignment.date, deferral_reason: null,
    timeline: [...request.timeline, { at, day: assignment.date, event: 'scheduled', reason: null,
      note: `${assignment.asset_id} ${assignment.window} (board)`, by: actor.user_id }],
  };
}

// R8: no reason, no deferral — this throws rather than returning a request.
export function deferRequest(actor, request, { reason, day, at, note = '' }) {
  authorize(actor, 'plan.defer', request);
  assertReason(reason, DEFERRAL_REASONS);
  const withdrawn = reason === 'requester_withdrew';
  return {
    ...request, status: withdrawn ? 'withdrawn' : 'deferred', deferral_reason: reason,
    plan_date: withdrawn ? request.plan_date : addDays(day, 1),
    timeline: [...request.timeline, { at, day, event: withdrawn ? 'withdrawn' : 'deferred', reason, note, by: actor.user_id }],
  };
}

export function scrubAssignment(actor, assignment, { reason }) {
  authorize(actor, 'plan.scrub', assignment);
  assertReason(reason, SCRUB_REASONS);
  return { ...assignment, status: 'scrubbed', scrub_reason: reason };
}

// A scrubbed sortie puts its request back on the same day's rail, so the
// coordinator can reassign it before deciding to defer.
export function scrubRequest(actor, request, assignment, { reason, at }) {
  authorize(actor, 'plan.scrub', request);
  assertReason(reason, SCRUB_REASONS);
  return {
    ...request, status: 'deferred', plan_date: assignment.date,
    timeline: [...request.timeline, { at, day: assignment.date, event: 'scrubbed', reason,
      note: `${assignment.asset_id} ${assignment.window} scrubbed (board)`, by: actor.user_id }],
  };
}

// A requester takes back their own request; a coordinator or the program's
// lead can too. Only before it is on the board — after that it is a scrub.
export function withdrawRequest(actor, request, { at, note = '' }) {
  authorize(actor, 'request.withdraw', request);
  if (request.status !== 'submitted' && request.status !== 'deferred') {
    throw new Error(`${request.request_id} is ${request.status}; a request can only be withdrawn before it is scheduled.`);
  }
  return {
    ...request, status: 'withdrawn', deferral_reason: 'requester_withdrew',
    timeline: [...request.timeline, { at, day: request.plan_date, event: 'withdrawn', reason: 'requester_withdrew', note, by: actor.user_id }],
  };
}

// ---------------------------------------------------------------- the desk · acknowledgements

export function coverWindow(actor, coverage, cand, { at }) {
  authorize(actor, 'desk.cover');
  return [...coverage, { date: cand.date, window: cand.window, person_id: cand.person_id, assigned_by: actor.user_id, acked: false, at }];
}

export function uncoverWindow(actor, coverage, cand) {
  authorize(actor, 'desk.cover');
  return coverage.filter((c) => !(c.date === cand.date && c.window === cand.window && c.person_id === cand.person_id));
}

// Crew acknowledge their own seat: a sortie (either seat) or a coverage row.
export function acknowledge(actor, target) {
  authorize(actor, 'sortie.ack', target);
  return { ...target, acked: true };
}

// ---------------------------------------------------------------- ratings · qualifications (the trainer)
// Effective-dated: the board re-evaluates R1 and R10 from that day. Never
// to oneself (I2).

export function grantRating(actor, person, airframe, { effective }) {
  authorize(actor, 'rating.grant', person);
  return {
    ...person,
    ratings: person.ratings.includes(airframe) ? person.ratings : [...person.ratings, airframe],
    ratings_effective: { ...person.ratings_effective, [airframe]: effective },
    granted_by: { ...person.granted_by, [airframe]: actor.user_id },
  };
}

export function revokeRating(actor, person, airframe) {
  authorize(actor, 'rating.revoke', person);
  const { [airframe]: _eff, ...ratings_effective } = person.ratings_effective || {};
  const { [airframe]: _by, ...granted_by } = person.granted_by || {};
  return { ...person, ratings: person.ratings.filter((a) => a !== airframe), ratings_effective, granted_by };
}

export function grantQualification(actor, person, { effective }) {
  authorize(actor, 'qualification.grant', person);
  return {
    ...person,
    roles: person.roles.includes('rider_ops') ? person.roles : [...person.roles, 'rider_ops'],
    qualifications: { ...person.qualifications, rider_ops: effective },
    granted_by: { ...person.granted_by, rider_ops: actor.user_id },
  };
}

// ---------------------------------------------------------------- programs · the desk's settings (authority)

export function setProgramPriority(actor, program, priority) {
  authorize(actor, 'program.priority', program);
  if (!Object.hasOwn(PRIORITY_RANK, priority)) throw new Error(`Priority must be one of ${Object.keys(PRIORITY_RANK).join(' · ')}.`);
  return { ...program, priority_default: priority };
}

export function setProgramTargets(actor, program, { asset_min, asset_max }) {
  authorize(actor, 'program.targets', program);
  if (!(Number.isInteger(asset_min) && Number.isInteger(asset_max) && asset_min >= 0 && asset_max >= asset_min)) {
    throw new Error('Tail targets must be whole numbers with min ≤ max.');
  }
  return { ...program, asset_min, asset_max };
}

// Never below one coverer, never above ratio 4: the principle has a floor
// and the desk has a ceiling. A waiver is not among the settings.
export const DESK_BOUNDS = { min_per_window: [1, 4], ratio: [1, 4] };

export function setDeskSettings(actor, desk, patch) {
  authorize(actor, 'desk.settings');
  const next = { ...desk, ...patch };
  for (const [k, [lo, hi]] of Object.entries(DESK_BOUNDS)) {
    if (!(Number.isInteger(next[k]) && next[k] >= lo && next[k] <= hi)) {
      throw new Error(`${k === 'ratio' ? 'The ratio' : 'Coverers per window'} must be a whole number between ${lo} and ${hi}.`);
    }
  }
  return next;
}
