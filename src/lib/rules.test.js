import { describe, it, expect } from 'vitest';
import {
  makeDb, checkAssignment, hasBlock, dayWarnings, queuedFor, isLate, defaultPlanDate,
  lateWarning, validateReason, deferRequest, scrubAssignment, scrubRequest, scheduleRequest, newAssignment,
  withdrawRequest, ratedOn, qualifiedOn, assetStatusOn, validateRequest, newRequest, pruneWindows, operatingWindows,
  deskCoverers, riderLoad, checkCoverage, checkCover, checkUncover, coverWindow, uncoverWindow, acknowledge,
  grantRating, revokeRating, grantQualification, setProgramPriority, setProgramTargets, setDeskSettings,
  editProgram, triageFailure, TRIAGE_STEPS, DEFERRAL_REASONS, SCRUB_REASONS, DEFAULT_DESK,
} from './rules';
import { can, authorize, PERMISSIONS, ACTIONS, ROLES, eventAction } from './auth';
import programs from '../data/programs.json';
import assets from '../data/assets.json';
import persons from '../data/persons.json';
import requests from '../data/requests.json';
import assignments from '../data/assignments.json';
import users from '../data/users.json';
import coverage from '../data/coverage.json';
import meta from '../data/meta.json';

// ---------------------------------------------------------------- fixture
const D = '2026-07-01';
const AT = '2026-06-30T18:00';
const allDay = { [D]: ['AM', 'PM', 'NIGHT'] };

// One persona per role, plus the two authority scopes the matrix distinguishes.
const U = {
  requester:   { user_id: 'U-R',  name: 'L. Req',     title: 'Test Engineer',      role: 'requester',   scope: null,      person_id: null },
  coordinator: { user_id: 'U-C',  name: 'P. Coord',   title: 'Test Coordinator',   role: 'coordinator', scope: null,      person_id: null },
  lead:        { user_id: 'U-L',  name: 'S. Lead',    title: 'Program Lead, PLC',  role: 'authority',   scope: ['PRG-A'], person_id: null },
  pm:          { user_id: 'U-PM', name: 'R. Pm',      title: 'PM',                 role: 'authority',   scope: 'all',     person_id: null },
  deskLead:    { user_id: 'U-D',  name: 'N. Desk',    title: 'Rider Ops Lead',     role: 'authority',   scope: ['desk'],  person_id: null },
  trainer:     { user_id: 'U-T',  name: 'E. Trainer', title: 'Trainer',            role: 'trainer',     scope: null,      person_id: 'P-HP' },
  crew:        { user_id: 'U-K',  name: 'D. Crew',    title: 'Operator',           role: 'crew',        scope: null,      person_id: 'P-OP' },
  observer:    { user_id: 'U-O',  name: 'G. Obs',     title: 'Manager',            role: 'observer',    scope: null,      person_id: null },
};
const ACTOR = { requester: U.requester, coordinator: U.coordinator, authority: U.lead, trainer: U.trainer, crew: U.crew, observer: U.observer };

const fx = () => makeDb({
  programs: [
    { program_id: 'PRG-A', code: 'PLC', standing: true, airframes: ['Harmattan'], asset_min: 2, asset_max: 3, priority_default: 'P0' },
    { program_id: 'PRG-B', code: 'PN', standing: true, airframes: ['Levant'], asset_min: 3, asset_max: 4, priority_default: 'P1' },
    { program_id: 'PRG-C', code: 'SBU', standing: false, airframes: ['Sirocco'], asset_min: 1, asset_max: 2, priority_default: 'P0' },
  ],
  assets: [
    { asset_id: 'HM-01', airframe: 'Harmattan', windows: ['AM', 'PM'], status_history: [] },
    { asset_id: 'HM-02', airframe: 'Harmattan', windows: ['AM', 'PM'], status_history: [] },
    { asset_id: 'HM-03', airframe: 'Harmattan', windows: ['AM', 'PM'], status_history: [
      { status: 'reserved', date_from: '2026-06-28', date_to: '2026-07-03', reserved_by: 'PRG-A', note: 'cert push' }] },
    { asset_id: 'LV-01', airframe: 'Levant', windows: ['AM', 'PM', 'NIGHT'], status_history: [] },
    { asset_id: 'LV-02', airframe: 'Levant', windows: ['AM', 'PM', 'NIGHT'], status_history: [] },
    { asset_id: 'LV-03', airframe: 'Levant', windows: ['AM', 'PM', 'NIGHT'], status_history: [
      { status: 'grounded', date_from: '2026-06-10', date_to: null, note: 'pending v2.15.2', failure_id: 'F-0011' }] },
    { asset_id: 'LV-04', airframe: 'Levant', windows: ['AM', 'PM', 'NIGHT'], status_history: [] },
    { asset_id: 'LV-06', airframe: 'Levant', windows: ['AM', 'PM', 'NIGHT'], status_history: [] },
    { asset_id: 'SR-01', airframe: 'Sirocco', windows: ['AM', 'PM'], status_history: [] },
  ],
  persons: [
    person('P-HP', 'Rated Pilot', ['pilot'], ['Levant', 'Harmattan']),
    person('P-LP', 'Levant Pilot', ['pilot'], ['Levant']),
    person('P-OP', 'Rated Operator', ['operator'], ['Levant', 'Harmattan']),
    person('P-SOLO', 'Solo Operator', ['operator', 'pilot'], ['Levant', 'Sirocco'], { self_pilot: true }),
    person('P-NOSOLO', 'Plain Operator', ['operator'], ['Sirocco']),
    person('P-LATE', 'Newly Rated', ['pilot'], ['Harmattan'], { ratings_effective: { Harmattan: '2026-07-15' } }),
    person('P-OFF', 'Off Today', ['pilot'], ['Levant'], { availability: {} }),
    person('P-RO', 'Desk One', ['rider_ops'], [], { qualifications: { rider_ops: '2026-04-01' } }),
    person('P-RO2', 'Desk Soon', ['rider_ops'], [], { qualifications: { rider_ops: '2026-07-15' } }),
    person('P-DUAL', 'Pilot And Desk', ['pilot', 'rider_ops'], ['Levant'], { qualifications: { rider_ops: '2026-04-01' } }),
  ],
  requests: [
    req('RQ-A1', 'PRG-A', 'Harmattan', 'operator_pilot', 'P0', ['AM']),
    req('RQ-A2', 'PRG-A', 'Harmattan', 'operator_pilot', 'P0', ['AM']),
    req('RQ-B1', 'PRG-B', 'Levant', 'pilot_only', 'P1', ['PM', 'NIGHT']),
    req('RQ-B2', 'PRG-B', 'Levant', 'pilot_only', 'P1', ['NIGHT']),
    req('RQ-C1', 'PRG-C', 'Sirocco', 'lone_operator', 'P0', ['AM']),
    req('RQ-C2', 'PRG-C', 'Sirocco', 'operator_pilot', 'P0', ['PM']),
    req('RQ-R1', 'PRG-B', 'Levant', 'pilot_only', 'P1', ['PM'], { rider_facing: true }),
    req('RQ-R2', 'PRG-B', 'Levant', 'pilot_only', 'P1', ['PM'], { rider_facing: true }),
    req('RQ-R3', 'PRG-B', 'Levant', 'pilot_only', 'P1', ['PM'], { rider_facing: true }),
    req('RQ-OWN', 'PRG-A', 'Harmattan', 'operator_pilot', 'P0', ['PM'], { requester_id: 'U-C' }),   // filed by the coordinator
  ],
  assignments: [
    { assignment_id: 'AS-1', date: D, window: 'AM', request_id: 'RQ-A1', asset_id: 'HM-01', operator_id: 'P-OP', pilot_id: 'P-HP', status: 'planned', assigned_by: 'U-C', acked: false },
    { assignment_id: 'AS-2', date: D, window: 'PM', request_id: 'RQ-B1', asset_id: 'LV-01', operator_id: null, pilot_id: 'P-LP', status: 'planned', assigned_by: 'U-C', acked: false },
  ],
  users: Object.values(U),
  coverage: [{ date: D, window: 'PM', person_id: 'P-RO', assigned_by: 'U-C', acked: true }],
  desk: { ratio: 2, min_per_window: 1 },
});

function person(person_id, name, roles, ratings, over = {}) {
  return { person_id, name, roles, ratings, self_pilot: false, ratings_effective: {}, qualifications: {}, granted_by: {}, availability: allDay, ...over };
}

function req(id, program_id, airframe, crew, priority, windows, over = {}) {
  return {
    request_id: id, program_id, airframe, crew, priority, windows, status: 'submitted', late: false,
    submitted_at: '2026-06-30T10:00', needed_by: D, plan_date: D, deferral_reason: null, timeline: [],
    rider_facing: false, requester_id: 'U-X', ...over,
  };
}

const cand = (over) => ({ date: D, window: 'AM', request_id: 'RQ-A2', asset_id: 'HM-02', operator_id: 'P-OP', pilot_id: 'P-HP', ...over });
const rider = (id, tail, over = {}) => ({ date: D, window: 'PM', request_id: id, asset_id: tail, operator_id: null, pilot_id: 'P-HP', ...over });
const rules = (vs) => vs.filter((v) => v.severity === 'block').map((v) => v.rule);

// ---------------------------------------------------------------- R1
describe('R1 · type rating', () => {
  it('blocks a pilot without the rating', () => {
    const vs = checkAssignment(cand({ window: 'PM', pilot_id: 'P-LP', operator_id: 'P-OP' }), fx());
    expect(rules(vs)).toContain('R1');
    expect(vs.find((v) => v.rule === 'R1').message).toMatch(/Levant Pilot is not rated on Harmattan/);
  });
  it('blocks a rating that is not yet effective, and passes once it is', () => {
    const db = fx();
    expect(rules(checkAssignment(cand({ window: 'PM', pilot_id: 'P-LATE' }), db))).toContain('R1');
    expect(ratedOn(db.person.get('P-LATE'), 'Harmattan', '2026-07-15')).toBe(true);
    expect(ratedOn(db.person.get('P-LATE'), 'Harmattan', '2026-07-14')).toBe(false);
  });
});

// ---------------------------------------------------------------- R2
describe('R2 · double booking', () => {
  it('blocks a tail already flying in that window', () => {
    const vs = checkAssignment(cand({ asset_id: 'HM-01', operator_id: 'P-OP', pilot_id: 'P-HP', window: 'AM' }), fx());
    expect(vs.some((v) => v.rule === 'R2' && /HM-01 is already assigned/.test(v.message))).toBe(true);
  });
  it('blocks a person already flying in that window, on either seat', () => {
    const vs = checkAssignment(cand({ window: 'AM', asset_id: 'HM-02' }), fx());   // P-OP and P-HP are on AS-1 in AM
    expect(vs.filter((v) => v.rule === 'R2')).toHaveLength(2);
  });
  it('does not collide with itself when editing', () => {
    const vs = checkAssignment({ assignment_id: 'AS-1', date: D, window: 'AM', request_id: 'RQ-A1', asset_id: 'HM-01', operator_id: 'P-OP', pilot_id: 'P-HP' }, fx());
    expect(rules(vs)).not.toContain('R2');
  });
  it('a scrubbed sortie frees its crew but still owns its slot', () => {
    const db = fx();
    db.assignments[0].status = 'scrubbed';                       // AS-1: HM-01 AM with P-OP / P-HP
    const sameSlot = checkAssignment(cand({ window: 'AM', asset_id: 'HM-01', operator_id: null, pilot_id: null }), db);
    expect(sameSlot.filter((v) => v.rule === 'R2').map((v) => v.message)).toEqual(['HM-01 is already used (scrubbed sortie) in AM on 2026-07-01.']);
    const sameCrew = checkAssignment(cand({ window: 'AM', asset_id: 'HM-02' }), db);
    expect(rules(sameCrew)).not.toContain('R2');
  });
  it('extends to the desk: a person covering a window cannot fly in it', () => {
    const db = fx();
    db.coverage.push({ date: D, window: 'PM', person_id: 'P-DUAL', assigned_by: 'U-C', acked: true });
    const vs = checkAssignment(rider('RQ-R1', 'LV-02', { pilot_id: 'P-DUAL' }), db);
    expect(vs.find((v) => v.rule === 'R2').message).toBe('Pilot And Desk is covering the rider desk in PM on Jul 1.');
  });
  it('extends to the desk: nobody covers a window twice, or one they are flying in', () => {
    const db = fx();
    expect(checkCover({ date: D, window: 'PM', person_id: 'P-RO' }, db).find((v) => v.rule === 'R2').message).toMatch(/already covering PM on Jul 1/);
    db.assignments.push({ assignment_id: 'AS-x', date: D, window: 'NIGHT', request_id: 'RQ-B2', asset_id: 'LV-02', operator_id: null, pilot_id: 'P-DUAL', status: 'planned' });
    expect(checkCover({ date: D, window: 'NIGHT', person_id: 'P-DUAL' }, db).find((v) => v.rule === 'R2').message).toMatch(/is flying RQ-B2 \(LV-02\) in NIGHT/);
    expect(hasBlock(checkCover({ date: D, window: 'AM', person_id: 'P-DUAL' }, db))).toBe(false);
  });
});

// ---------------------------------------------------------------- R3
describe('R3 · asset status', () => {
  it('blocks a grounded tail and says why', () => {
    const vs = checkAssignment({ date: D, window: 'NIGHT', request_id: 'RQ-B2', asset_id: 'LV-03', operator_id: null, pilot_id: 'P-LP' }, fx());
    expect(vs.find((v) => v.rule === 'R3').message).toMatch(/LV-03 is grounded on 2026-07-01 — pending v2.15.2/);
  });
  it('blocks a tail reserved by another program but allows the reserving one', () => {
    const db = fx();
    const other = checkAssignment({ date: D, window: 'PM', request_id: 'RQ-B2', asset_id: 'HM-03', operator_id: null, pilot_id: 'P-HP' }, db);
    expect(other.some((v) => v.rule === 'R3' && /reserved by PLC/.test(v.message))).toBe(true);
    const own = checkAssignment(cand({ window: 'PM', asset_id: 'HM-03' }), db);
    expect(rules(own)).not.toContain('R3');
  });
  it('blocks the wrong airframe and a window the tail does not operate', () => {
    expect(rules(checkAssignment(cand({ asset_id: 'LV-01', window: 'PM' }), fx()))).toContain('R3');
    expect(rules(checkAssignment(cand({ window: 'NIGHT' }), fx()))).toContain('R3');
  });
  it('reads status from history by date', () => {
    const lv3 = fx().asset.get('LV-03');
    expect(assetStatusOn(lv3, '2026-06-09').status).toBe('available');
    expect(assetStatusOn(lv3, '2026-06-10').failure_id).toBe('F-0011');
  });
});

// ---------------------------------------------------------------- R4
describe('R4 · crew requirement', () => {
  it('lone operator needs self-pilot', () => {
    const bad = checkAssignment({ date: D, window: 'AM', request_id: 'RQ-C1', asset_id: 'SR-01', operator_id: 'P-NOSOLO', pilot_id: null }, fx());
    expect(rules(bad)).toContain('R4');
    const good = checkAssignment({ date: D, window: 'AM', request_id: 'RQ-C1', asset_id: 'SR-01', operator_id: 'P-SOLO', pilot_id: null }, fx());
    expect(hasBlock(good)).toBe(false);
  });
  it('operator + pilot must be two different rated people', () => {
    const db = fx();
    expect(rules(checkAssignment(cand({ window: 'PM', operator_id: 'P-OP', pilot_id: null }), db))).toContain('R4');
    const same = checkAssignment({ date: D, window: 'PM', request_id: 'RQ-C2', asset_id: 'SR-01', operator_id: 'P-SOLO', pilot_id: 'P-SOLO' }, db);
    expect(same.find((v) => v.rule === 'R4').message).toMatch(/cannot be both/);
  });
  it('pilot-only takes no operator', () => {
    const vs = checkAssignment({ date: D, window: 'NIGHT', request_id: 'RQ-B2', asset_id: 'LV-01', operator_id: 'P-OP', pilot_id: 'P-LP' }, fx());
    expect(rules(vs)).toContain('R4');
  });
  it('a clean sortie has no blocks', () => {
    expect(hasBlock(checkAssignment(cand({ window: 'PM' }), fx()))).toBe(false);
  });
  it('warns, not blocks, when a person is not rostered', () => {
    const vs = checkAssignment({ date: D, window: 'NIGHT', request_id: 'RQ-B2', asset_id: 'LV-01', operator_id: null, pilot_id: 'P-OFF' }, fx());
    expect(vs.find((v) => v.rule === 'AV').severity).toBe('warn');
    expect(hasBlock(vs)).toBe(false);
  });
});

// ---------------------------------------------------------------- R5
describe('R5 · program tail target', () => {
  it('flags a standing program under its minimum', () => {
    const w = dayWarnings(D, fx());
    const plc = w.find((v) => v.rule === 'R5' && v.program_id === 'PRG-A');
    expect(plc.level).toBe('under');
    expect(plc.message).toMatch(/PLC: 1 of 2–3 tails/);
  });
  it('flags a program over its cap', () => {
    const db = fx();
    for (const [i, tail] of ['HM-02', 'HM-03'].entries()) {
      db.assignments.push({ assignment_id: `AS-x${i}`, date: D, window: 'PM', request_id: 'RQ-A2', asset_id: tail, operator_id: 'P-OP', pilot_id: 'P-HP', status: 'planned' });
    }
    db.assignments.push({ assignment_id: 'AS-x9', date: D, window: 'PM', request_id: 'RQ-A2', asset_id: 'HM-01', operator_id: null, pilot_id: null, status: 'planned' });
    db.assets.push({ asset_id: 'HM-09', airframe: 'Harmattan', windows: ['AM', 'PM'], status_history: [] });
    db.asset.set('HM-09', db.assets.at(-1));
    db.assignments.push({ assignment_id: 'AS-x10', date: D, window: 'AM', request_id: 'RQ-A2', asset_id: 'HM-09', operator_id: null, pilot_id: null, status: 'planned' });
    const over = dayWarnings(D, db).find((v) => v.rule === 'R5' && v.program_id === 'PRG-A');
    expect(over.level).toBe('over');
    expect(over.count).toBe(4);
  });
  it('expects a standing program on weekdays only; a weekend with no demand is not under target', () => {
    const db = fx();
    db.requests = [];                                     // nothing asked for, nothing overdue
    db.request = new Map();
    db.assignments = [];
    const fri = '2026-07-03';
    const sat = '2026-07-04';
    db.persons[0].availability = { ...db.persons[0].availability, [fri]: ['AM'], [sat]: ['AM'] };   // someone is rostered, so both days are operating
    expect(dayWarnings(fri, db).filter((v) => v.rule === 'R5' && v.level === 'under').map((v) => v.program_id)).toEqual(['PRG-A', 'PRG-B']);
    expect(dayWarnings(sat, db).filter((v) => v.rule === 'R5' && v.level === 'under')).toEqual([]);
  });
  it('does not flag a non-standing program with no demand, but does when it has a queued request', () => {
    const db = fx();
    expect(dayWarnings(D, db).find((v) => v.rule === 'R5' && v.program_id === 'PRG-C')).toBeTruthy();   // RQ-C1/C2 queued
    db.requests = db.requests.filter((r) => r.program_id !== 'PRG-C');
    expect(dayWarnings(D, db).find((v) => v.rule === 'R5' && v.program_id === 'PRG-C')).toBeUndefined();
  });
  it('warns at edit time when a new tail would pass the cap', () => {
    const db = fx();
    db.assignments.push({ assignment_id: 'AS-y1', date: D, window: 'PM', request_id: 'RQ-A2', asset_id: 'HM-02', operator_id: null, pilot_id: null, status: 'planned' });
    db.assignments.push({ assignment_id: 'AS-y2', date: D, window: 'PM', request_id: 'RQ-A2', asset_id: 'HM-03', operator_id: null, pilot_id: null, status: 'planned' });
    db.assets.push({ asset_id: 'HM-09', airframe: 'Harmattan', windows: ['AM', 'PM'], status_history: [] });
    db.asset.set('HM-09', db.assets.at(-1));
    const vs = checkAssignment(cand({ window: 'PM', asset_id: 'HM-09', operator_id: null, pilot_id: null }), db);
    expect(vs.find((v) => v.rule === 'R5').severity).toBe('warn');
  });
});

// ---------------------------------------------------------------- R6
describe('R6 · P0 starvation', () => {
  it('warns when an unscheduled P0 waits while a lower priority holds a compatible tail', () => {
    const db = fx();
    db.requests.push(req('RQ-SF', 'PRG-C', 'Levant', 'operator_pilot', 'P0', ['PM']));   // wants a Levant in PM; RQ-B1 (P1) holds LV-01 PM
    const w = dayWarnings(D, db).find((v) => v.rule === 'R6');
    expect(w.request_id).toBe('RQ-SF');
    expect(w.message).toMatch(/RQ-B1 \(P1\) holds LV-01 in PM/);
  });
  it('stays quiet when the holder is not compatible (window or airframe)', () => {
    const db = fx();
    db.requests.push(req('RQ-SF', 'PRG-C', 'Levant', 'operator_pilot', 'P0', ['AM']));
    expect(dayWarnings(D, db).find((v) => v.rule === 'R6')).toBeUndefined();
  });
});

// ---------------------------------------------------------------- R7
describe('R7 · intake cutoff', () => {
  it('flags submissions after 15:00 the day before, and on the day', () => {
    expect(isLate('2026-06-30T14:59', '2026-07-01')).toBe(false);
    expect(isLate('2026-06-30T15:00', '2026-07-01')).toBe(true);
    expect(isLate('2026-07-01T08:00', '2026-07-01')).toBe(true);
    expect(isLate('2026-06-29T17:00', '2026-07-01')).toBe(false);
  });
  it('defaults a late request to the next open day', () => {
    const late = { submitted_at: '2026-06-30T16:40', needed_by: '2026-07-01' };
    expect(defaultPlanDate(late)).toBe('2026-07-02');
    expect(defaultPlanDate(late, { isOpen: (d) => d !== '2026-07-02' })).toBe('2026-07-03');
    expect(defaultPlanDate({ submitted_at: '2026-06-30T10:00', needed_by: '2026-07-01' })).toBe('2026-07-01');
    expect(lateWarning({ ...late, request_id: 'RQ-9' }).rule).toBe('R7');
    expect(lateWarning({ submitted_at: '2026-06-30T10:00', needed_by: '2026-07-01' })).toBeNull();
  });
});

// ---------------------------------------------------------------- R8
describe('R8 · deferral needs a reason', () => {
  const r = req('RQ-Z', 'PRG-B', 'Levant', 'pilot_only', 'P1', ['NIGHT']);
  it('cannot build a deferral without a reason from the enum', () => {
    expect(() => deferRequest(U.coordinator, r, { day: D, at: '2026-06-30T15:30' })).toThrow(/R8/);
    expect(() => deferRequest(U.coordinator, r, { reason: 'because', day: D, at: '2026-06-30T15:30' })).toThrow(/R8/);
    expect(validateReason('weather').ok).toBe(false);                       // weather is a scrub reason, not a deferral
    expect(validateReason('weather', SCRUB_REASONS).ok).toBe(true);
    for (const reason of DEFERRAL_REASONS) expect(validateReason(reason).ok).toBe(true);
    expect(DEFERRAL_REASONS).toContain('no_rider_ops');
  });
  it('a valid deferral re-queues for the next day, keeps the timeline and names the actor', () => {
    const d = deferRequest(U.coordinator, r, { reason: 'no_rated_pilot', day: D, at: '2026-06-30T15:30' });
    expect(d.status).toBe('deferred');
    expect(d.plan_date).toBe('2026-07-02');
    expect(d.timeline.at(-1)).toMatchObject({ event: 'deferred', reason: 'no_rated_pilot', day: D, by: 'U-C' });
    expect(r.status).toBe('submitted');                                       // immutable
  });
  it('scrubs need a reason too, and weather is allowed there', () => {
    const a = { assignment_id: 'AS-1', status: 'planned' };
    expect(() => scrubAssignment(U.coordinator, a, {})).toThrow(/R8/);
    expect(scrubAssignment(U.coordinator, a, { reason: 'weather' }).status).toBe('scrubbed');
  });
});

// ---------------------------------------------------------------- R9 · the matrix
// Every role × every action, generated from PERMISSIONS itself: a grant in
// the data is a passing case, its absence a refusal that names the roles.
function actorFor(role, action) {
  return role === 'authority' && action === 'desk.settings' ? U.pm : ACTOR[role];
}
function friendly(action, actor) {
  if (action.startsWith('request.') || action === 'plan.defer' || action === 'plan.scrub') {
    return req('RQ-T', 'PRG-A', 'Harmattan', 'operator_pilot', 'P0', ['AM'], { requester_id: actor.role === 'requester' ? actor.user_id : 'U-X' });
  }
  if (action.startsWith('plan.')) return req('RQ-T', 'PRG-A', 'Harmattan', 'operator_pilot', 'P0', ['AM']);
  if (action.startsWith('program.')) return { program_id: 'PRG-A', code: 'PLC' };
  if (action === 'rating.grant' || action === 'rating.revoke' || action === 'qualification.grant') return { person_id: 'P-LP' };
  if (action === 'sortie.ack') return { person_id: actor.person_id, operator_id: null, pilot_id: null };
  return null;
}

describe('R9 · the permission matrix, every role × every action', () => {
  expect(ACTIONS.length).toBeGreaterThanOrEqual(16);
  for (const action of ACTIONS) {
    for (const role of ROLES) {
      const expected = Boolean(PERMISSIONS[action][role]);
      it(`${action} · ${role} → ${expected ? 'allowed' : 'refused'}`, () => {
        const actor = actorFor(role, action);
        const v = can(actor, action, friendly(action, actor));
        expect(v.ok).toBe(expected);
        if (!expected) expect(v.message).toMatch(/^R9 · .+ only \(signed in as /);
      });
    }
  }
});

describe('R9 · ownership, scope and the separation-of-duties invariants', () => {
  const other = req('RQ-T', 'PRG-A', 'Harmattan', 'operator_pilot', 'P0', ['AM']);
  const mine = req('RQ-M', 'PRG-A', 'Harmattan', 'operator_pilot', 'P0', ['AM'], { requester_id: 'U-R' });
  it('a requester withdraws their own request, not somebody else\'s', () => {
    expect(can(U.requester, 'request.withdraw', mine).ok).toBe(true);
    expect(can(U.requester, 'request.withdraw', other).message).toBe('R9 · not your request (signed in as Requester)');
  });
  it('I1 · nobody assigns their own request, even a coordinator', () => {
    const own = req('RQ-C', 'PRG-A', 'Harmattan', 'operator_pilot', 'P0', ['AM'], { requester_id: 'U-C' });
    expect(can(U.coordinator, 'plan.assign', own).message).toBe("R9 · you can't assign your own request");
    expect(can(U.coordinator, 'plan.assign', other).ok).toBe(true);
    expect(() => newAssignment(U.coordinator, own, cand())).toThrow(/your own request/);
    expect(() => scheduleRequest(U.coordinator, own, { date: D, window: 'AM', asset_id: 'HM-02' }, AT)).toThrow(/your own request/);
  });
  it('I2 · the trainer never grants their own rating or qualification', () => {
    expect(can(U.trainer, 'rating.grant', { person_id: 'P-HP' }).message).toBe("R9 · you can't grant your own rating or qualification");
    expect(can(U.trainer, 'qualification.grant', { person_id: 'P-HP' }).ok).toBe(false);
    expect(can(U.trainer, 'rating.grant', { person_id: 'P-LP' }).ok).toBe(true);
  });
  it('I3 · coordinators consume priority and cannot set it; authority sets it and cannot assign', () => {
    expect(can(U.coordinator, 'program.priority', { program_id: 'PRG-A' }).message).toBe('R9 · authority only (signed in as Coordinator)');
    expect(can(U.lead, 'plan.assign', other).message).toBe('R9 · coordinator only (signed in as Authority)');
    expect(can(U.observer, 'plan.assign', other).message).toBe('R9 · coordinator only (signed in as Observer)');
  });
  it('scope · a lead acts on their programs, the PM on all, the rider ops lead on the desk', () => {
    expect(can(U.lead, 'program.targets', { program_id: 'PRG-A', code: 'PLC' }).ok).toBe(true);
    expect(can(U.lead, 'program.targets', { program_id: 'PRG-B', code: 'PN' }).message).toBe('R9 · PN is outside your scope (signed in as Authority)');
    expect(can(U.pm, 'program.targets', { program_id: 'PRG-B', code: 'PN' }).ok).toBe(true);
    expect(can(U.lead, 'desk.settings').message).toBe('R9 · PM or rider ops lead only (signed in as Authority)');
    expect(can(U.deskLead, 'desk.settings').ok).toBe(true);
    expect(can(U.pm, 'desk.settings').ok).toBe(true);
    expect(can(U.deskLead, 'program.targets', { program_id: 'PRG-A', code: 'PLC' }).ok).toBe(false);
  });
  it('crew acknowledge their own seat only, and only crew can', () => {
    const sortie = { assignment_id: 'AS-1', operator_id: 'P-OP', pilot_id: 'P-HP', acked: false };
    expect(acknowledge(U.crew, sortie).acked).toBe(true);
    expect(() => acknowledge(U.crew, { person_id: 'P-RO', acked: false })).toThrow(/not your sortie/);
    expect(() => acknowledge(U.observer, sortie)).toThrow(/crew only/);
    expect(sortie.acked).toBe(false);                                         // immutable
  });
  it('authorize throws exactly what can() says', () => {
    expect(() => authorize(U.observer, 'plan.defer', other)).toThrow('R9 · coordinator only (signed in as Observer)');
    expect(authorize(U.coordinator, 'plan.defer', other)).toBe(true);
  });
  it('maps timeline events to actions, with the late-intake deferral as part of intake', () => {
    expect(eventAction({ event: 'deferred', reason: 'late_intake' })).toBe('request.create');
    expect(eventAction({ event: 'deferred', reason: 'no_asset' })).toBe('plan.defer');
    expect(eventAction({ event: 'scheduled' })).toBe('plan.assign');
  });
});

// ---------------------------------------------------------------- R10 · the rider desk
describe('R10 · the rider desk', () => {
  it('blocks a rider-facing sortie in a window nobody covers, and names it', () => {
    const vs = checkAssignment(rider('RQ-R1', 'LV-02', { window: 'NIGHT' }), fx());
    expect(vs.find((v) => v.rule === 'R10').message).toBe('no rider operator covering NIGHT on Jul 1');
  });
  it('leaves a sortie without riders alone', () => {
    const vs = checkAssignment({ date: D, window: 'NIGHT', request_id: 'RQ-B2', asset_id: 'LV-02', operator_id: null, pilot_id: 'P-HP' }, fx());
    expect(rules(vs)).not.toContain('R10');
  });
  it('allows up to the ratio, refuses the one over it, and a scrub frees the desk', () => {
    const db = fx();                                                          // PM: one coverer, ratio 2
    expect(rules(checkAssignment(rider('RQ-R1', 'LV-02'), db))).not.toContain('R10');
    db.assignments.push({ assignment_id: 'AS-r1', ...rider('RQ-R1', 'LV-02'), status: 'planned' });
    expect(rules(checkAssignment(rider('RQ-R2', 'LV-04', { pilot_id: 'P-SOLO' }), db))).not.toContain('R10');   // 2:1, at ratio
    db.assignments.push({ assignment_id: 'AS-r2', ...rider('RQ-R2', 'LV-04', { pilot_id: 'P-SOLO' }), status: 'planned' });
    const third = rider('RQ-R3', 'LV-06', { pilot_id: 'P-DUAL' });
    expect(checkAssignment(third, db).find((v) => v.rule === 'R10').message).toBe('desk at 3:1, ratio is 2');
    db.assignments.at(-1).status = 'scrubbed';
    expect(rules(checkAssignment(third, db))).not.toContain('R10');
    expect(riderLoad(db, D, 'PM')).toBe(1);
  });
  it('editing a rider-facing sortie does not count itself', () => {
    const db = fx();
    db.assignments.push({ assignment_id: 'AS-r1', ...rider('RQ-R1', 'LV-02'), status: 'planned' });
    db.assignments.push({ assignment_id: 'AS-r2', ...rider('RQ-R2', 'LV-04', { pilot_id: 'P-SOLO' }), status: 'planned' });
    expect(rules(checkAssignment({ assignment_id: 'AS-r2', ...rider('RQ-R2', 'LV-06', { pilot_id: 'P-SOLO' }) }, db))).not.toContain('R10');
  });
  it('a coverer counts only from the day the qualification is effective', () => {
    const db = fx();
    db.coverage.push({ date: D, window: 'PM', person_id: 'P-RO2', assigned_by: 'U-C', acked: true });
    db.coverage.push({ date: '2026-07-15', window: 'PM', person_id: 'P-RO2', assigned_by: 'U-C', acked: true });
    expect(deskCoverers(db, D, 'PM').map((p) => p.person_id)).toEqual(['P-RO']);
    expect(deskCoverers(db, '2026-07-15', 'PM').map((p) => p.person_id)).toEqual(['P-RO2']);
    expect(qualifiedOn(db.person.get('P-RO2'), '2026-07-14')).toBe(false);
    expect(qualifiedOn(db.person.get('P-RO2'), '2026-07-15')).toBe(true);
    expect(checkCover({ date: D, window: 'AM', person_id: 'P-RO2' }, db).find((v) => v.rule === 'R10').message).toMatch(/not qualified on the rider desk until Jul 15/);
    expect(checkCover({ date: D, window: 'AM', person_id: 'P-LP' }, db).find((v) => v.rule === 'R10').message).toMatch(/not qualified on the rider desk\./);
  });
  it('the ratio is a setting: a bigger desk takes more riders', () => {
    const db = fx();
    db.desk = { ratio: 3, min_per_window: 1 };
    db.assignments.push({ assignment_id: 'AS-r1', ...rider('RQ-R1', 'LV-02'), status: 'planned' });
    db.assignments.push({ assignment_id: 'AS-r2', ...rider('RQ-R2', 'LV-04', { pilot_id: 'P-SOLO' }), status: 'planned' });
    expect(rules(checkAssignment(rider('RQ-R3', 'LV-06', { pilot_id: 'P-DUAL' }), db))).not.toContain('R10');
  });
  it('the desk row is red, amber, green — or quiet on a day with no operations', () => {
    const db = fx();
    expect(checkCoverage(D, 'NIGHT', db)).toMatchObject({ level: 'red', message: 'no rider operator covering NIGHT on Jul 1' });
    expect(checkCoverage(D, 'PM', db)).toMatchObject({ level: 'green', demand: 0, capacity: 2, message: '1 covering · 0 rider-facing · ratio 2' });
    db.assignments.push({ assignment_id: 'AS-r1', ...rider('RQ-R1', 'LV-02'), status: 'planned' });
    db.assignments.push({ assignment_id: 'AS-r2', ...rider('RQ-R2', 'LV-04', { pilot_id: 'P-SOLO' }), status: 'planned' });
    expect(checkCoverage(D, 'PM', db).level).toBe('amber');
    expect(checkCoverage('2026-07-04', 'PM', db).level).toBe('quiet');
  });
  it('the desk settings have a floor and a ceiling, and no waiver', () => {
    expect(setDeskSettings(U.deskLead, DEFAULT_DESK, { ratio: 3 })).toEqual({ ratio: 3, min_per_window: 1 });
    expect(() => setDeskSettings(U.pm, DEFAULT_DESK, { ratio: 5 })).toThrow(/between 1 and 4/);
    expect(() => setDeskSettings(U.pm, DEFAULT_DESK, { min_per_window: 0 })).toThrow(/between 1 and 4/);
    expect(() => setDeskSettings(U.lead, DEFAULT_DESK, { ratio: 3 })).toThrow(/PM or rider ops lead only/);
    expect(Object.keys(setDeskSettings(U.pm, DEFAULT_DESK, {}))).toEqual(['ratio', 'min_per_window']);
    expect(setDeskSettings(U.pm, DEFAULT_DESK, { ratio: 3, waiver: true })).toEqual({ ratio: 3, min_per_window: 1 });   // no third key, ever
  });
  it('a coverer cannot be released while riders in the window depend on them', () => {
    const db = fx();                                                          // PM: P-RO alone, ratio 2
    expect(checkUncover({ date: D, window: 'PM', person_id: 'P-RO' }, db)).toEqual([]);
    db.assignments.push({ assignment_id: 'AS-r1', ...rider('RQ-R1', 'LV-02'), status: 'planned' });
    expect(checkUncover({ date: D, window: 'PM', person_id: 'P-RO' }, db).find((v) => v.rule === 'R10').message)
      .toBe('1 rider-facing sortie in PM on Jul 1 would be left with no rider operator covering');
    db.coverage.push({ date: D, window: 'PM', person_id: 'P-DUAL', assigned_by: 'U-C', acked: true });
    expect(checkUncover({ date: D, window: 'PM', person_id: 'P-RO' }, db)).toEqual([]);            // P-DUAL still covers, 1:1
    db.assignments.push({ assignment_id: 'AS-r2', ...rider('RQ-R2', 'LV-04', { pilot_id: 'P-SOLO' }), status: 'planned' });
    db.assignments.push({ assignment_id: 'AS-r3', ...rider('RQ-R3', 'LV-06', { pilot_id: 'P-HP' }), status: 'planned' });
    expect(checkUncover({ date: D, window: 'PM', person_id: 'P-RO' }, db).find((v) => v.rule === 'R10').message).toBe('desk would be at 3:1, ratio is 2');
    expect(checkUncover({ date: D, window: 'PM', person_id: 'P-LP' }, db).find((v) => v.rule === 'R2').message).toMatch(/is not covering PM/);
    db.desk = { ratio: 4, min_per_window: 2 };
    expect(checkUncover({ date: D, window: 'PM', person_id: 'P-RO' }, db).find((v) => v.rule === 'R10').message).toMatch(/only 1 covering, below the minimum of 2/);
  });
  it('rostering the desk carries the actor; the roster is immutable', () => {
    const roster = coverWindow(U.coordinator, [], { date: D, window: 'PM', person_id: 'P-RO' }, { at: AT });
    expect(roster).toEqual([{ date: D, window: 'PM', person_id: 'P-RO', assigned_by: 'U-C', acked: false, at: AT }]);
    expect(uncoverWindow(U.coordinator, roster, { date: D, window: 'PM', person_id: 'P-RO' })).toEqual([]);
    expect(() => coverWindow(U.lead, [], { date: D, window: 'PM', person_id: 'P-RO' }, { at: AT })).toThrow(/coordinator only/);
    expect(acknowledge({ ...U.crew, person_id: 'P-RO' }, roster[0]).acked).toBe(true);
  });
});

// ---------------------------------------------------------------- transitions carry the actor
describe('transitions · the actor comes first and the timeline names them', () => {
  const other = req('RQ-T', 'PRG-A', 'Harmattan', 'operator_pilot', 'P0', ['AM']);
  it('refuses the wrong role before touching anything', () => {
    expect(() => deferRequest(U.observer, other, { reason: 'no_asset', day: D, at: AT })).toThrow('R9 · coordinator only (signed in as Observer)');
    expect(() => scrubAssignment(U.requester, { assignment_id: 'AS-1', status: 'planned' }, { reason: 'weather' })).toThrow(/R9 · coordinator only/);
    expect(() => scrubRequest(U.crew, other, { date: D, window: 'AM', asset_id: 'HM-02' }, { reason: 'weather', at: AT })).toThrow(/R9/);
    expect(() => grantRating(U.coordinator, fx().person.get('P-LP'), 'Harmattan', { effective: D })).toThrow(/R9 · trainer only/);
    expect(() => setProgramPriority(U.coordinator, { program_id: 'PRG-A', code: 'PLC' }, 'P0')).toThrow(/R9 · authority only/);
    expect(() => newAssignment(U.lead, other, cand())).toThrow(/R9 · coordinator only/);
  });
  it('a sortie built on the board is stamped with who built it and waits for its crew', () => {
    const a = newAssignment(U.coordinator, other, cand(), 'AS-L1');
    expect(a).toMatchObject({ assignment_id: 'AS-L1', status: 'planned', assigned_by: 'U-C', acked: false, asset_id: 'HM-02' });
    const s = scheduleRequest(U.coordinator, other, a, AT);
    expect(s.timeline.at(-1)).toMatchObject({ event: 'scheduled', by: 'U-C', day: D });
  });
  it('the trainer grants ratings and qualifications, effective-dated, and the rules re-evaluate from that day', () => {
    const db = fx();
    const lp = grantRating(U.trainer, db.person.get('P-LP'), 'Harmattan', { effective: '2026-07-10' });
    expect(lp.ratings).toContain('Harmattan');
    expect(lp.granted_by.Harmattan).toBe('U-T');
    expect(ratedOn(lp, 'Harmattan', '2026-07-09')).toBe(false);
    expect(ratedOn(lp, 'Harmattan', '2026-07-10')).toBe(true);
    expect(revokeRating(U.trainer, lp, 'Harmattan').ratings).not.toContain('Harmattan');
    expect(() => grantRating(U.trainer, db.person.get('P-HP'), 'Sirocco', { effective: D })).toThrow(/own rating/);
    expect(() => grantRating(U.trainer, db.person.get('P-LP'), 'Harmattan', { effective: '2026-04-01', notBefore: D })).toThrow(/from Jul 1 at the earliest/);
    expect(() => grantQualification(U.trainer, db.person.get('P-OP'), { effective: '2026-06-30', notBefore: D })).toThrow(/history is not rewritten/);
    const op = grantQualification(U.trainer, db.person.get('P-OP'), { effective: D, notBefore: D });
    expect(op.roles).toContain('rider_ops');
    expect(qualifiedOn(op, D)).toBe(true);
    expect(qualifiedOn(op, '2026-06-30')).toBe(false);
    db.persons = db.persons.map((p) => (p.person_id === 'P-OP' ? op : p));
    db.person.set('P-OP', op);
    expect(hasBlock(checkCover({ date: D, window: 'NIGHT', person_id: 'P-OP' }, db))).toBe(false);
    expect(db.person.get('P-LP').ratings).not.toContain('Harmattan');           // immutable
  });
  it('a program\'s two dials change together, each behind its own permission', () => {
    const plc = { program_id: 'PRG-A', code: 'PLC', asset_min: 2, asset_max: 3, priority_default: 'P0' };
    expect(editProgram(U.pm, plc, { priority_default: 'P1', asset_min: 1, asset_max: 3 })).toMatchObject({ priority_default: 'P1', asset_min: 1, asset_max: 3 });
    expect(editProgram(U.lead, plc, { priority_default: 'P0', asset_min: 2, asset_max: 3 })).toBe(plc);              // nothing changed: same object
    expect(() => editProgram(U.lead, { ...plc, program_id: 'PRG-B', code: 'PN' }, { priority_default: 'P1' })).toThrow(/outside your scope/);
    expect(() => editProgram(U.coordinator, plc, { asset_min: 1 })).toThrow(/authority only/);
  });
  it('program priority and targets are set by authority inside scope, with sane values', () => {
    const plc = { program_id: 'PRG-A', code: 'PLC', asset_min: 2, asset_max: 3, priority_default: 'P0' };
    expect(setProgramTargets(U.lead, plc, { asset_min: 1, asset_max: 2 })).toMatchObject({ asset_min: 1, asset_max: 2 });
    expect(() => setProgramTargets(U.lead, plc, { asset_min: 3, asset_max: 2 })).toThrow(/min ≤ max/);
    expect(() => setProgramTargets(U.lead, { ...plc, program_id: 'PRG-B', code: 'PN' }, { asset_min: 1, asset_max: 2 })).toThrow(/PN is outside your scope/);
    expect(setProgramPriority(U.pm, plc, 'P1').priority_default).toBe('P1');
    expect(() => setProgramPriority(U.lead, plc, 'P9')).toThrow(/Priority must be/);
    expect(plc.priority_default).toBe('P0');                                   // immutable
  });
  it('a scrub keeps the coordinator\'s note', () => {
    const s = scrubRequest(U.coordinator, other, { date: D, window: 'AM', asset_id: 'HM-02' }, { reason: 'weather', at: AT, note: 'fog until 10' });
    expect(s.timeline.at(-1).note).toBe('HM-02 AM scrubbed (board) — fog until 10');
    expect(s.timeline.at(-1)).toMatchObject({ event: 'scrubbed', reason: 'weather', by: 'U-C' });
  });
  it('triage is the requester\'s: the ladder, the resolved stamp, the undo, and the refusal', () => {
    const f = { failure_id: 'F-1', triage_status: 'Open', resolved: null };
    const v = triageFailure(U.requester, f, 'Verified', { today: '2026-06-30' });
    expect(v).toMatchObject({ triage_status: 'Verified', resolved: '2026-06-30' });
    expect(triageFailure(U.requester, v, 'Investigating', { today: '2026-06-30' }).resolved).toBeNull();
    expect(triageFailure(U.requester, v, 'Open', { today: '2026-06-30', resolved: null })).toMatchObject({ triage_status: 'Open', resolved: null });   // an undo passes the old stamp back
    expect(() => triageFailure(U.requester, f, 'Done', { today: '2026-06-30' })).toThrow(/Triage status must be/);
    expect(() => triageFailure(U.coordinator, f, 'Verified', { today: '2026-06-30' })).toThrow('R9 · requester only (signed in as Coordinator)');
    expect(TRIAGE_STEPS).toEqual(['Open', 'Investigating', 'Corrective Action', 'Verified']);
    expect(f.triage_status).toBe('Open');                                     // immutable
  });
  it('withdraw is the requester\'s own, and only before the plan', () => {
    const mine = req('RQ-M', 'PRG-A', 'Harmattan', 'operator_pilot', 'P0', ['AM'], { requester_id: 'U-R' });
    const w = withdrawRequest(U.requester, mine, { at: AT, note: 'no longer needed' });
    expect(w).toMatchObject({ status: 'withdrawn', deferral_reason: 'requester_withdrew' });
    expect(w.timeline.at(-1)).toMatchObject({ event: 'withdrawn', by: 'U-R', note: 'no longer needed' });
    expect(() => withdrawRequest(U.requester, other, { at: AT })).toThrow(/not your request/);
    expect(() => withdrawRequest(U.requester, { ...mine, status: 'scheduled' }, { at: AT })).toThrow(/before it is scheduled/);
    expect(withdrawRequest(U.coordinator, other, { at: AT }).status).toBe('withdrawn');
  });
});

// ---------------------------------------------------------------- intake
describe('intake · validateRequest and newRequest', () => {
  const fields = {
    program_id: 'PRG-C', title: 'Bring-up — hover envelope check', build: 'v2.16.1', build_stage: 'engineering',
    crew: 'operator_pilot', windows: ['PM'], airframe: 'Sirocco', priority: 'P0', supporting_team: 'Hardware',
    requester: 'M. Sato', needed_by: '2026-07-02',
  };
  const opts = { tomorrow: '2026-07-01' };
  it('accepts a complete request', () => {
    expect(validateRequest(fields, fx(), opts)).toEqual([]);
  });
  it('a showcase always carries guests', () => {
    const db = fx();
    db.programs.push({ program_id: 'PRG-SF', code: 'SF', standing: false, airframes: ['Levant'], asset_min: 0, asset_max: 3, priority_default: 'P0' });
    db.program.set('PRG-SF', db.programs.at(-1));
    const sf = { ...fields, program_id: 'PRG-SF', airframe: 'Levant', windows: ['PM'], rider_facing: false };
    expect(validateRequest(sf, db, opts).map((e) => e.field)).toEqual(['rider_facing']);
    expect(validateRequest({ ...sf, rider_facing: true }, db, opts)).toEqual([]);
  });
  it('refuses a window the airframe does not fly, a foreign airframe, and a date already planned', () => {
    const db = fx();
    const night = validateRequest({ ...fields, windows: ['NIGHT'] }, db, opts);           // Sirocco flies AM/PM only
    expect(night.map((e) => e.message)).toEqual(['Sirocco does not fly in the NIGHT window.']);
    const bad = validateRequest({ ...fields, airframe: 'Levant', needed_by: '2026-06-30' }, db, opts);
    expect(bad.map((e) => e.field).sort()).toEqual(['airframe', 'needed_by']);
    expect(bad.find((e) => e.field === 'airframe').message).toMatch(/SBU flies Sirocco, not Levant/);
  });
  it('derives the R7 flag and plan day from the submission time, and the filer from the actor', () => {
    const late = newRequest(U.requester, { ...fields, needed_by: '2026-07-01' }, { id: 'RQ-L001', submittedAt: '2026-06-30T18:05' });
    expect(late).toMatchObject({ late: true, status: 'deferred', deferral_reason: 'late_intake', plan_date: '2026-07-02', requester_id: 'U-R', rider_facing: false });
    expect(late.timeline.map((e) => [e.event, e.by])).toEqual([['submitted', 'U-R'], ['deferred', 'U-R']]);
    expect(late.timeline[1]).toMatchObject({ reason: 'late_intake', day: '2026-07-01' });
    const onTime = newRequest(U.requester, { ...fields, rider_facing: true }, { id: 'RQ-L002', submittedAt: '2026-06-30T18:05' });
    expect(onTime).toMatchObject({ late: false, status: 'submitted', plan_date: '2026-07-02', deferral_reason: null, rider_facing: true });
    expect(onTime.timeline).toHaveLength(1);
  });
  it('is refused for roles that cannot file, and for a lead outside their scope', () => {
    expect(() => newRequest(U.observer, fields, { id: 'RQ-L003', submittedAt: '2026-06-30T10:00' })).toThrow('R9 · requester, coordinator or authority only (signed in as Observer)');
    expect(() => newRequest(U.lead, fields, { id: 'RQ-L003', submittedAt: '2026-06-30T10:00' })).toThrow(/PRG-C is outside your scope/);
    expect(newRequest(U.pm, fields, { id: 'RQ-L003', submittedAt: '2026-06-30T10:00' }).requester_id).toBe('U-PM');
  });
  it('prunes picked windows to what the new airframe flies, never to nothing', () => {
    const db = fx();
    expect(operatingWindows(db, 'Sirocco')).toEqual(['AM', 'PM']);
    expect(pruneWindows(['PM', 'NIGHT'], db, 'Sirocco')).toEqual(['PM']);
    expect(pruneWindows(['NIGHT'], db, 'Harmattan')).toEqual(['AM']);
    expect(pruneWindows(['NIGHT', 'AM'], db, 'Levant')).toEqual(['NIGHT', 'AM']);
  });
  it('skips closed days when defaulting a late request', () => {
    const r = newRequest(U.requester, { ...fields, needed_by: '2026-07-01' }, { id: 'RQ-L003', submittedAt: '2026-06-30T18:05', isOpen: (d) => d !== '2026-07-02' });
    expect(r.plan_date).toBe('2026-07-03');
  });
});

// ---------------------------------------------------------------- the seed obeys its own rules
describe('seed data', () => {
  const db = makeDb({ programs, assets, persons, requests, assignments, users, coverage, desk: meta.rider_desk });
  it('has no blocking violation on any non-scrubbed sortie', () => {
    const bad = [];
    for (const a of assignments) {
      if (a.status === 'scrubbed') continue;
      const vs = checkAssignment(a, db).filter((v) => v.severity === 'block');
      if (vs.length) bad.push([a.assignment_id, vs.map((v) => v.message)]);
    }
    expect(bad).toEqual([]);
  });
  it('flags late intake exactly where R7 says', () => {
    for (const r of requests) expect([r.request_id, r.late]).toEqual([r.request_id, isLate(r.submitted_at, r.needed_by, meta.cutoff_local)]);
  });
  it('every deferral in every timeline carries a reason from the enum', () => {
    for (const r of requests) for (const e of r.timeline) if (e.event === 'deferred') expect(DEFERRAL_REASONS).toContain(e.reason);
  });
  it("tomorrow's rail holds two unscheduled P0 and R6 fires for the late showcase", () => {
    const rail = queuedFor(meta.tomorrow, db);
    const live = rail.filter((r) => (r.status === 'submitted' || r.status === 'deferred') && r.plan_date <= meta.tomorrow);
    expect(live.filter((r) => r.priority === 'P0')).toHaveLength(2);
    const w = dayWarnings(meta.tomorrow, db);
    expect(w.some((v) => v.rule === 'R6')).toBe(true);
    expect(w.find((v) => v.rule === 'R5' && db.program.get(v.program_id).code === 'SBU').level).toBe('under');
  });
  it('I4 · every actor on every event, sortie and coverage row is a persona whose role permits it', () => {
    const bad = [];
    for (const r of requests) {
      for (const e of r.timeline) {
        const v = can(db.user.get(e.by), eventAction(e), r);
        if (!v.ok) bad.push([r.request_id, e.event, e.by, v.message]);
      }
    }
    for (const a of assignments) {
      const v = can(db.user.get(a.assigned_by), 'plan.assign', db.request.get(a.request_id));
      if (!v.ok) bad.push([a.assignment_id, a.assigned_by, v.message]);
    }
    for (const c of coverage) if (!can(db.user.get(c.assigned_by), 'desk.cover').ok) bad.push(['coverage', c.date, c.window, c.assigned_by]);
    expect(bad).toEqual([]);
  });
  it('I1 · nobody assigned their own request; I2 · nobody granted their own rating', () => {
    for (const a of assignments) expect([a.assignment_id, a.assigned_by === db.request.get(a.request_id).requester_id]).toEqual([a.assignment_id, false]);
    for (const p of persons) {
      for (const [k, by] of Object.entries(p.granted_by || {})) {
        const u = db.user.get(by);
        expect([p.person_id, k, u?.role, u?.person_id === p.person_id]).toEqual([p.person_id, k, 'trainer', false]);
      }
    }
  });
  it('I5 · every rider-facing sortie flew with a qualified coverer in its window, at or under ratio', () => {
    const load = new Map();
    for (const a of assignments) {
      if (a.status === 'scrubbed' || !db.request.get(a.request_id).rider_facing) continue;
      const k = `${a.date}:${a.window}`;
      load.set(k, (load.get(k) || 0) + 1);
    }
    for (const [k, n] of load) {
      const [date, window] = k.split(':');
      const cov = deskCoverers(db, date, window).length;
      expect([k, cov >= meta.rider_desk.min_per_window, n <= meta.rider_desk.ratio * cov]).toEqual([k, true, true]);
    }
    expect(load.size).toBeGreaterThan(20);
  });
  it('R2, extended · nobody flew in a window they were covering', () => {
    for (const a of assignments) {
      if (a.status === 'scrubbed') continue;
      const ids = deskCoverers(db, a.date, a.window).map((p) => p.person_id);
      for (const pid of [a.operator_id, a.pilot_id]) if (pid) expect([a.assignment_id, ids.includes(pid)]).toEqual([a.assignment_id, false]);
    }
  });
  it('the desk shortage is in the seed: a showcase refused by the ratio, no waiver, then flown once a second coverer arrived', () => {
    const sf = requests.filter((r) => db.program.get(r.program_id).code === 'SF' && r.needed_by >= '2026-06-15' && r.needed_by <= '2026-06-17');
    expect(sf).toHaveLength(9);
    const deskDeferrals = sf.flatMap((r) => r.timeline.filter((e) => e.event === 'deferred' && e.reason === 'no_rider_ops'));
    expect(deskDeferrals.length).toBeGreaterThanOrEqual(2);
    expect(deskDeferrals.some((e) => e.day === '2026-06-15' && /desk at 3:1, ratio is 2 · .+ were free — asked .+ \(PM\) to waive the ratio; there is no such action/.test(e.note))).toBe(true);
    for (const e of deskDeferrals) expect(deskCoverers(db, e.day, 'PM').length).toBeGreaterThanOrEqual(1);
    expect(sf.every((r) => r.status === 'executed')).toBe(true);
    expect(deskCoverers(db, '2026-06-16', 'PM').map((p) => p.person_id)).toEqual(['P-018']);
    expect(deskCoverers(db, '2026-06-17', 'PM').map((p) => p.person_id)).toEqual(['P-018', 'P-009']);
    expect(db.person.get('P-009').qualifications.rider_ops).toBe('2026-06-17');
  });
});
