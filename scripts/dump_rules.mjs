// Dump what docs/ renders from the code: the data exports of src/lib/auth.js
// and src/lib/rules.js, the refusal messages can() actually produces, and the
// export inventory of both modules — as one JSON document on stdout, read by
// scripts/render_docs.py. The modules are imported and executed, never
// parsed, so a renamed constant or a reworded message changes the output.
//
//   node scripts/dump_rules.mjs            (run from the project root)
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

register('./esm_extensionless.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const auth = await load('src/lib/auth.js');
const rules = await load('src/lib/rules.js');

const { ROLES, ROLE_LABELS, PERMISSIONS, ACTIONS, EVENT_ACTION, eventAction, can } = auth;

// A persona per role, shaped like src/data/users.json: an authority with a
// one-program scope (so 'scope' and 'desk' can be refused), a person on the
// roster for crew and the trainer (so 'own' seats and 'not-self' can be).
function persona(role) {
  return {
    user_id: 'U-you', name: 'You', title: ROLE_LABELS[role], role,
    scope: role === 'authority' ? ['PRG-01'] : null,
    person_id: role === 'crew' || role === 'trainer' ? 'P-you' : null,
  };
}

// The target that fails each predicate, so the rendered refusal is the one
// the UI shows when the predicate does not hold.
function failingTarget(action, grant, actor) {
  switch (grant) {
    case 'own': return action === 'sortie.ack' ? { person_id: 'P-someone-else' } : { requester_id: 'U-someone-else' };
    case 'not-own': return { requester_id: actor.user_id };
    case 'scope': return { program_id: 'PRG-02', code: 'PN' };   // a coded program outside the one-program scope, as the views pass it
    case 'desk': return null;                     // the actor's scope decides
    case 'not-self': return { person_id: actor.person_id };
    default: return null;
  }
}

const matrix = ACTIONS.map((action) => {
  const roles = {};
  for (const role of ROLES) {
    const actor = persona(role);
    const grant = PERMISSIONS[action][role] ?? null;
    let refused = null;
    if (!grant) refused = can(actor, action).message;
    else if (grant !== 'yes') refused = can(actor, action, failingTarget(action, grant, actor)).message;
    roles[role] = { grant, refused };
  }
  return { action, roles, nobody: can(null, action).message };
});

const inventory = (mod) => Object.entries(mod)
  .map(([name, value]) => ({ name, kind: typeof value === 'function' ? 'function' : 'constant' }))
  .sort((a, b) => a.name.localeCompare(b.name));

const out = {
  auth: {
    ROLES, ROLE_LABELS, PERMISSIONS, ACTIONS, EVENT_ACTION,
    grants: [...new Set(Object.values(PERMISSIONS).flatMap((g) => Object.values(g)))].sort(),
    late_intake_event_action: eventAction({ event: 'deferred', reason: 'late_intake' }),
    unknown_action_message: can(persona('coordinator'), 'no.such.action').message,
    matrix,
    exports: inventory(auth),
  },
  rules: {
    WINDOWS: rules.WINDOWS, PRIORITY_RANK: rules.PRIORITY_RANK,
    DEFERRAL_REASONS: rules.DEFERRAL_REASONS, SCRUB_REASONS: rules.SCRUB_REASONS, REASON_LABELS: rules.REASON_LABELS,
    CREW_KINDS: rules.CREW_KINDS, CREW_LABELS: rules.CREW_LABELS, BUILD_STAGES: rules.BUILD_STAGES,
    TRIAGE_STEPS: rules.TRIAGE_STEPS, DEFAULT_DESK: rules.DEFAULT_DESK, DESK_BOUNDS: rules.DESK_BOUNDS,
    r8_deferral_message: rules.validateReason('not-a-reason').message,
    r8_scrub_message: rules.validateReason('not-a-reason', rules.SCRUB_REASONS).message,
    exports: inventory(rules),
  },
};
process.stdout.write(JSON.stringify(out, null, 1));
