// Authorization without authentication (R9). A persona (src/data/users.json)
// is a user record the header switches between: the title is display, the
// role is behaviour, and this file is the only place that decides what a
// role can do. PERMISSIONS is data — every mutating action names, per app
// role, whether it is allowed outright or only under a named predicate;
// anything absent is refused with the role and the action named. Ownership
// and scope are functions here, never string parsing in a view.
//
//   yes       always
//   own       the target request was filed by this user; for sortie.ack,
//             the sortie or coverage row holds this user's own seat
//   not-own   allowed except on this user's own request — nobody assigns
//             their own request, even a coordinator (I1)
//   scope     the target program is in the user's scope ('all' or a list)
//   desk      the user's scope is 'all' or includes 'desk' — the PM or the
//             rider ops lead
//   not-self  the target person is not this user — nobody grants their own
//             rating or qualification (I2)
//
// I3 is the shape of the matrix itself: coordinators consume priority and
// cannot set it; authority sets priority and cannot assign.

export const ROLES = ['requester', 'coordinator', 'authority', 'trainer', 'crew', 'observer'];

export const ROLE_LABELS = {
  requester: 'Requester', coordinator: 'Coordinator', authority: 'Authority',
  trainer: 'Trainer', crew: 'Crew', observer: 'Observer',
};

export const PERMISSIONS = {
  'request.create':      { requester: 'yes', coordinator: 'yes', authority: 'scope' },
  'request.edit':        { requester: 'own', coordinator: 'yes', authority: 'scope' },
  'request.withdraw':    { requester: 'own', coordinator: 'yes', authority: 'scope' },
  'plan.assign':         { coordinator: 'not-own' },
  'plan.reassign':       { coordinator: 'not-own' },
  'plan.defer':          { coordinator: 'yes' },
  'plan.scrub':          { coordinator: 'yes' },
  'desk.cover':          { coordinator: 'yes' },
  'program.priority':    { authority: 'scope' },
  'program.targets':     { authority: 'scope' },
  'desk.settings':       { authority: 'desk' },
  'rating.grant':        { trainer: 'not-self' },
  'rating.revoke':       { trainer: 'not-self' },
  'qualification.grant': { trainer: 'not-self' },
  'sortie.ack':          { crew: 'own' },
  'triage.edit':         { requester: 'yes' },
  // Capacity, Reports and the RCCA analytics: everyone but crew. A requester
  // lands on their own program's numbers; that is a filter, not a permission.
  'view.analytics':      { requester: 'yes', coordinator: 'yes', authority: 'yes', trainer: 'yes', observer: 'yes' },
};
export const ACTIONS = Object.keys(PERMISSIONS);

// Which action a timeline event is, so the seed's actors can be checked (I4).
// The late-intake deferral is stamped at intake by the filer: it is part of
// request.create, not a plan decision.
export const EVENT_ACTION = {
  submitted: 'request.create', withdrawn: 'request.withdraw', deferred: 'plan.defer',
  rescheduled: 'plan.defer', scrubbed: 'plan.scrub', scheduled: 'plan.assign',
  reassigned: 'plan.assign', executed: 'plan.assign',
};
export function eventAction(e) {
  return e.event === 'deferred' && e.reason === 'late_intake' ? 'request.create' : EVENT_ACTION[e.event];
}

// ---------------------------------------------------------------- predicates

export function inScope(actor, programId) {
  return actor.scope === 'all' || (Array.isArray(actor.scope) && actor.scope.includes(programId));
}

export function deskScope(actor) {
  return actor.scope === 'all' || (Array.isArray(actor.scope) && actor.scope.includes('desk'));
}

export function ownsRequest(actor, request) {
  return Boolean(request) && request.requester_id === actor.user_id;
}

// A sortie or a coverage row is the actor's own when one of its seats is
// the actor's person.
export function ownSeat(actor, target) {
  if (!actor.person_id || !target) return false;
  return [target.person_id, target.operator_id, target.pilot_id].includes(actor.person_id);
}

export function isSelf(actor, person) {
  return Boolean(actor.person_id) && Boolean(person) && person.person_id === actor.person_id;
}

// ---------------------------------------------------------------- can · authorize

export function rolesFor(action) {
  return Object.keys(PERMISSIONS[action] || {});
}

function list(roles) {
  const names = roles.map((r) => ROLE_LABELS[r].toLowerCase());
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
}

// The UI's question: { ok } or { ok: false, message }. The message is the
// tooltip on a disabled control, in the house style — the role and the
// action named, never a bare "not allowed".
export function can(actor, action, target = null) {
  if (!PERMISSIONS[action]) return { ok: false, message: `R9 · unknown action ${action}` };
  if (!actor) return { ok: false, message: `R9 · ${list(rolesFor(action))} only (nobody signed in)` };
  const grant = PERMISSIONS[action][actor.role];
  const who = `(signed in as ${ROLE_LABELS[actor.role] ?? actor.role})`;
  if (!grant) return { ok: false, message: `R9 · ${list(rolesFor(action))} only ${who}` };
  switch (grant) {
    case 'yes':
      return { ok: true };
    case 'own':
      if (action === 'sortie.ack') {
        return ownSeat(actor, target) ? { ok: true } : { ok: false, message: `R9 · not your sortie ${who}` };
      }
      return ownsRequest(actor, target) ? { ok: true } : { ok: false, message: `R9 · not your request ${who}` };
    case 'not-own':
      return ownsRequest(actor, target)
        ? { ok: false, message: "R9 · you can't assign your own request" }
        : { ok: true };
    case 'scope': {
      const pid = target?.program_id ?? null;
      const label = target?.code ?? pid ?? 'that program';
      return inScope(actor, pid) ? { ok: true } : { ok: false, message: `R9 · ${label} is outside your scope ${who}` };
    }
    case 'desk':
      return deskScope(actor) ? { ok: true } : { ok: false, message: `R9 · PM or rider ops lead only ${who}` };
    case 'not-self':
      return isSelf(actor, target)
        ? { ok: false, message: "R9 · you can't grant your own rating or qualification" }
        : { ok: true };
    default:
      return { ok: false, message: `R9 · ${action} refused ${who}` };
  }
}

// The rules' question: returns true, or throws the R9 violation. Every
// mutating transition in rules.js calls this before it touches anything.
export function authorize(actor, action, target = null) {
  const v = can(actor, action, target);
  if (!v.ok) throw new Error(v.message);
  return true;
}
