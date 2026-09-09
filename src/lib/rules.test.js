import { describe, it, expect } from 'vitest';
import {
  makeDb, checkAssignment, hasBlock, dayWarnings, queuedFor, isLate, defaultPlanDate,
  lateWarning, validateReason, deferRequest, scrubAssignment, ratedOn, assetStatusOn,
  validateRequest, newRequest, pruneWindows, operatingWindows, DEFERRAL_REASONS, SCRUB_REASONS,
} from './rules';
import programs from '../data/programs.json';
import assets from '../data/assets.json';
import persons from '../data/persons.json';
import requests from '../data/requests.json';
import assignments from '../data/assignments.json';
import meta from '../data/meta.json';

// ---------------------------------------------------------------- fixture
const D = '2026-07-01';
const allDay = { [D]: ['AM', 'PM', 'NIGHT'] };
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
    { asset_id: 'LV-03', airframe: 'Levant', windows: ['AM', 'PM', 'NIGHT'], status_history: [
      { status: 'grounded', date_from: '2026-06-10', date_to: null, note: 'pending v2.15.2', failure_id: 'F-0011' }] },
    { asset_id: 'SR-01', airframe: 'Sirocco', windows: ['AM', 'PM'], status_history: [] },
  ],
  persons: [
    { person_id: 'P-HP', name: 'Rated Pilot', roles: ['pilot'], ratings: ['Levant', 'Harmattan'], self_pilot: false, ratings_effective: {}, availability: allDay },
    { person_id: 'P-LP', name: 'Levant Pilot', roles: ['pilot'], ratings: ['Levant'], self_pilot: false, ratings_effective: {}, availability: allDay },
    { person_id: 'P-OP', name: 'Rated Operator', roles: ['operator'], ratings: ['Levant', 'Harmattan'], self_pilot: false, ratings_effective: {}, availability: allDay },
    { person_id: 'P-SOLO', name: 'Solo Operator', roles: ['operator', 'pilot'], ratings: ['Levant', 'Sirocco'], self_pilot: true, ratings_effective: {}, availability: allDay },
    { person_id: 'P-NOSOLO', name: 'Plain Operator', roles: ['operator'], ratings: ['Sirocco'], self_pilot: false, ratings_effective: {}, availability: allDay },
    { person_id: 'P-LATE', name: 'Newly Rated', roles: ['pilot'], ratings: ['Harmattan'], self_pilot: false, ratings_effective: { Harmattan: '2026-07-15' }, availability: allDay },
    { person_id: 'P-OFF', name: 'Off Today', roles: ['pilot'], ratings: ['Levant'], self_pilot: false, ratings_effective: {}, availability: {} },
  ],
  requests: [
    req('RQ-A1', 'PRG-A', 'Harmattan', 'operator_pilot', 'P0', ['AM']),
    req('RQ-A2', 'PRG-A', 'Harmattan', 'operator_pilot', 'P0', ['AM']),
    req('RQ-B1', 'PRG-B', 'Levant', 'pilot_only', 'P1', ['PM', 'NIGHT']),
    req('RQ-B2', 'PRG-B', 'Levant', 'pilot_only', 'P1', ['NIGHT']),
    req('RQ-C1', 'PRG-C', 'Sirocco', 'lone_operator', 'P0', ['AM']),
    req('RQ-C2', 'PRG-C', 'Sirocco', 'operator_pilot', 'P0', ['PM']),
  ],
  assignments: [
    { assignment_id: 'AS-1', date: D, window: 'AM', request_id: 'RQ-A1', asset_id: 'HM-01', operator_id: 'P-OP', pilot_id: 'P-HP', status: 'planned' },
    { assignment_id: 'AS-2', date: D, window: 'PM', request_id: 'RQ-B1', asset_id: 'LV-01', operator_id: null, pilot_id: 'P-LP', status: 'planned' },
  ],
});

function req(id, program_id, airframe, crew, priority, windows) {
  return {
    request_id: id, program_id, airframe, crew, priority, windows, status: 'submitted', late: false,
    submitted_at: '2026-06-30T10:00', needed_by: D, plan_date: D, deferral_reason: null, timeline: [],
  };
}

const cand = (over) => ({ date: D, window: 'AM', request_id: 'RQ-A2', asset_id: 'HM-02', operator_id: 'P-OP', pilot_id: 'P-HP', ...over });
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
    db.persons[0].availability[fri] = ['AM'];
    db.persons[0].availability[sat] = ['AM'];            // someone is rostered, so both days are operating
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
    expect(() => deferRequest(r, { day: D, at: '2026-06-30T15:30' })).toThrow(/R8/);
    expect(() => deferRequest(r, { reason: 'because', day: D, at: '2026-06-30T15:30' })).toThrow(/R8/);
    expect(validateReason('weather').ok).toBe(false);                       // weather is a scrub reason, not a deferral
    expect(validateReason('weather', SCRUB_REASONS).ok).toBe(true);
    for (const reason of DEFERRAL_REASONS) expect(validateReason(reason).ok).toBe(true);
  });
  it('a valid deferral re-queues for the next day and keeps the timeline', () => {
    const d = deferRequest(r, { reason: 'no_rated_pilot', day: D, at: '2026-06-30T15:30' });
    expect(d.status).toBe('deferred');
    expect(d.plan_date).toBe('2026-07-02');
    expect(d.timeline.at(-1)).toMatchObject({ event: 'deferred', reason: 'no_rated_pilot', day: D });
    expect(r.status).toBe('submitted');                                       // immutable
  });
  it('scrubs need a reason too, and weather is allowed there', () => {
    const a = { assignment_id: 'AS-1', status: 'planned' };
    expect(() => scrubAssignment(a, {})).toThrow(/R8/);
    expect(scrubAssignment(a, { reason: 'weather' }).status).toBe('scrubbed');
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
  it('refuses a window the airframe does not fly, a foreign airframe, and a date already planned', () => {
    const db = fx();
    const night = validateRequest({ ...fields, windows: ['NIGHT'] }, db, opts);           // Sirocco flies AM/PM only
    expect(night.map((e) => e.message)).toEqual(['Sirocco does not fly in the NIGHT window.']);
    const bad = validateRequest({ ...fields, airframe: 'Levant', needed_by: '2026-06-30' }, db, opts);
    expect(bad.map((e) => e.field).sort()).toEqual(['airframe', 'needed_by']);
    expect(bad.find((e) => e.field === 'airframe').message).toMatch(/SBU flies Sirocco, not Levant/);
  });
  it('derives the R7 flag and plan day from the submission time', () => {
    const late = newRequest({ ...fields, needed_by: '2026-07-01' }, { id: 'RQ-L001', submittedAt: '2026-06-30T18:05' });
    expect(late).toMatchObject({ late: true, status: 'deferred', deferral_reason: 'late_intake', plan_date: '2026-07-02' });
    expect(late.timeline.map((e) => e.event)).toEqual(['submitted', 'deferred']);
    expect(late.timeline[1]).toMatchObject({ reason: 'late_intake', day: '2026-07-01' });
    const onTime = newRequest(fields, { id: 'RQ-L002', submittedAt: '2026-06-30T18:05' });
    expect(onTime).toMatchObject({ late: false, status: 'submitted', plan_date: '2026-07-02', deferral_reason: null });
    expect(onTime.timeline).toHaveLength(1);
  });
  it('prunes picked windows to what the new airframe flies, never to nothing', () => {
    const db = fx();
    expect(operatingWindows(db, 'Sirocco')).toEqual(['AM', 'PM']);
    expect(pruneWindows(['PM', 'NIGHT'], db, 'Sirocco')).toEqual(['PM']);
    expect(pruneWindows(['NIGHT'], db, 'Harmattan')).toEqual(['AM']);
    expect(pruneWindows(['NIGHT', 'AM'], db, 'Levant')).toEqual(['NIGHT', 'AM']);
  });
  it('skips closed days when defaulting a late request', () => {
    const r = newRequest({ ...fields, needed_by: '2026-07-01' }, { id: 'RQ-L003', submittedAt: '2026-06-30T18:05', isOpen: (d) => d !== '2026-07-02' });
    expect(r.plan_date).toBe('2026-07-03');
  });
});

// ---------------------------------------------------------------- the seed obeys its own rules
describe('seed data', () => {
  const db = makeDb({ programs, assets, persons, requests, assignments });
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
});
