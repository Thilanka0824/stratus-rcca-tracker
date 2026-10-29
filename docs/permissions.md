# Permissions

<!-- Rendered by scripts/render_docs.py from src/lib/auth.js, executed under Node; the table of actions no transition authorizes also scans src/lib/rules.js, src/App.jsx and src/views/*.jsx for the single-quoted action literal. Do not edit by hand: run `npm run docs`; `npm run docs:check` fails on drift. -->

Authorization without authentication (R9). The matrix `PERMISSIONS` in `src/lib/auth.js` is data: for every action it names, per app role, whether the action is allowed outright or only under a named predicate. A role absent from an action's row is refused with a message that names the roles that may do it and the role signed in, for example `R9 · coordinator only (signed in as Requester)`; the action itself is named only in the unknown-action refusal and in `can()`'s `default` branch for a grant kind that has no `case` (`R9 · <action> refused (signed in as <Role>)`), which no grant in the matrix reaches. The UI asks `can()` and renders a refused control disabled with the message as its tooltip; every transition in `src/lib/rules.js` calls `authorize()` (`editProgram()` through the two dial transitions it composes, each only when its dial changes), which throws the same message. The messages below are the ones `can()` returns, produced by executing the module. `npm run docs:check` fails when this page and the module disagree; nothing runs it automatically, so run it before committing a change to `src/lib/auth.js`, to an `authorize()` call in `src/lib/rules.js`, or to which actions `src/App.jsx` and `src/views/*.jsx` ask `allowed()` for. How the matrix is used is in [rules.md](rules.md) and [architecture.md](architecture.md).

## Roles

| role | label |
|---|---|
| `requester` | Requester |
| `coordinator` | Coordinator |
| `authority` | Authority |
| `trainer` | Trainer |
| `crew` | Crew |
| `observer` | Observer |

## Grants

A cell in the matrix holds one of these; `·` means the role is refused. The meanings are `LEGEND` in `scripts/render_docs.py`, kept by hand in step with the comment block at the top of `src/lib/auth.js`; the render fails on a grant kind the legend lacks.

| grant | meaning |
|---|---|
| `yes` | always |
| `own` | the target request was filed by this user; for `sortie.ack`, the sortie or coverage row holds this user's own seat |
| `not-own` | allowed except on this user's own request — nobody assigns their own request, even a coordinator (I1) |
| `scope` | the target program is in the user's scope (`'all'` or a list of program ids) |
| `desk` | the user's scope is `'all'` or includes `'desk'` — the PM or the rider ops lead |
| `not-self` | the target person is not this user — nobody grants their own rating or qualification (I2) |

## The matrix

| action | requester | coordinator | authority | trainer | crew | observer |
|---|---|---|---|---|---|---|
| `request.create` | yes | yes | scope | · | · | · |
| `request.edit` | own | yes | scope | · | · | · |
| `request.withdraw` | own | yes | scope | · | · | · |
| `plan.assign` | · | not-own | · | · | · | · |
| `plan.reassign` | · | not-own | · | · | · | · |
| `plan.defer` | · | yes | · | · | · | · |
| `plan.scrub` | · | yes | · | · | · | · |
| `desk.cover` | · | yes | · | · | · | · |
| `program.priority` | · | · | scope | · | · | · |
| `program.targets` | · | · | scope | · | · | · |
| `desk.settings` | · | · | desk | · | · | · |
| `rating.grant` | · | · | · | not-self | · | · |
| `rating.revoke` | · | · | · | not-self | · | · |
| `qualification.grant` | · | · | · | not-self | · | · |
| `sortie.ack` | · | · | · | · | own | · |
| `triage.edit` | yes | · | · | · | · | · |
| `view.analytics` | yes | yes | yes | yes | · | yes |

The shape of the matrix is I3: `coordinator` holds `plan.assign`, `plan.reassign`, `plan.defer`, `plan.scrub` and none of the `program.*` actions; `authority` holds `program.priority`, `program.targets` and none of the `plan.*` actions — coordinators consume priority and cannot set it, authority sets priority and cannot assign. The render fails if that shape changes.

Actions no transition in `src/lib/rules.js` passes to `authorize()` — a read gate asked by the UI, or an action the matrix carries ahead of its control. This table is a scan, not an execution: the authorized set is the `authorize(actor, '…')` literals inside the `function name(` declarations of `rules.js` (an arrow-function transition is not scanned), and the *asked by* column names the files among `src/App.jsx` and `src/views/*.jsx` that contain the single-quoted action literal (not the control itself); an action name written any other way drops out while `docs:check` still passes, so keep writing them literally.

| action | asked by |
|---|---|
| `request.edit` | no control asks for it yet |
| `plan.reassign` | no control asks for it yet |
| `view.analytics` | `src/App.jsx` |

## By role

- **Requester** (`requester`): `request.create`, `request.edit` (own), `request.withdraw` (own), `triage.edit`, `view.analytics`
- **Coordinator** (`coordinator`): `request.create`, `request.edit`, `request.withdraw`, `plan.assign` (not-own), `plan.reassign` (not-own), `plan.defer`, `plan.scrub`, `desk.cover`, `view.analytics`
- **Authority** (`authority`): `request.create` (scope), `request.edit` (scope), `request.withdraw` (scope), `program.priority` (scope), `program.targets` (scope), `desk.settings` (desk), `view.analytics`
- **Trainer** (`trainer`): `rating.grant` (not-self), `rating.revoke` (not-self), `qualification.grant` (not-self), `view.analytics`
- **Crew** (`crew`): `sortie.ack` (own)
- **Observer** (`observer`): `view.analytics`

## Refusals, as the UI shows them

Per action: the answer `can()` gives with no actor, and per role the grant with the message `can()` returns when the role is refused or its predicate does not hold (an `own` grant with someone else's request — or, for `sortie.ack`, a seat that is not the actor's — a `not-own` grant with the actor's own request, a `scope` grant on a program outside the scope, a `desk` grant without `desk` in scope, a `not-self` grant on the actor's own person). A `scope` refusal labels the program by the target's `code`, else its `program_id`, else `that program`: the intake form and the program dials pass the program object, so those tooltips show the code; the Requests drawer's Withdraw control and `withdrawRequest()` pass the request, and `newRequest()` passes `{ program_id }`, so those show the program id. The no-actor line is `can(null, …)`: the header always holds a persona, so the app never shows it, but a transition or a test called without an actor gets this answer.

### `request.create`

No actor (`can(null, …)`): `R9 · requester, coordinator or authority only (nobody signed in)`

| role | grant | when refused |
|---|---|---|
| requester | yes | allowed |
| coordinator | yes | allowed |
| authority | scope | allowed when the predicate holds; otherwise `R9 · PN is outside your scope (signed in as Authority)` |
| trainer | · | `R9 · requester, coordinator or authority only (signed in as Trainer)` |
| crew | · | `R9 · requester, coordinator or authority only (signed in as Crew)` |
| observer | · | `R9 · requester, coordinator or authority only (signed in as Observer)` |

### `request.edit`

No actor (`can(null, …)`): `R9 · requester, coordinator or authority only (nobody signed in)`

| role | grant | when refused |
|---|---|---|
| requester | own | allowed when the predicate holds; otherwise `R9 · not your request (signed in as Requester)` |
| coordinator | yes | allowed |
| authority | scope | allowed when the predicate holds; otherwise `R9 · PN is outside your scope (signed in as Authority)` |
| trainer | · | `R9 · requester, coordinator or authority only (signed in as Trainer)` |
| crew | · | `R9 · requester, coordinator or authority only (signed in as Crew)` |
| observer | · | `R9 · requester, coordinator or authority only (signed in as Observer)` |

### `request.withdraw`

No actor (`can(null, …)`): `R9 · requester, coordinator or authority only (nobody signed in)`

| role | grant | when refused |
|---|---|---|
| requester | own | allowed when the predicate holds; otherwise `R9 · not your request (signed in as Requester)` |
| coordinator | yes | allowed |
| authority | scope | allowed when the predicate holds; otherwise `R9 · PN is outside your scope (signed in as Authority)` |
| trainer | · | `R9 · requester, coordinator or authority only (signed in as Trainer)` |
| crew | · | `R9 · requester, coordinator or authority only (signed in as Crew)` |
| observer | · | `R9 · requester, coordinator or authority only (signed in as Observer)` |

### `plan.assign`

No actor (`can(null, …)`): `R9 · coordinator only (nobody signed in)`

| role | grant | when refused |
|---|---|---|
| requester | · | `R9 · coordinator only (signed in as Requester)` |
| coordinator | not-own | allowed when the predicate holds; otherwise `R9 · you can't assign your own request` |
| authority | · | `R9 · coordinator only (signed in as Authority)` |
| trainer | · | `R9 · coordinator only (signed in as Trainer)` |
| crew | · | `R9 · coordinator only (signed in as Crew)` |
| observer | · | `R9 · coordinator only (signed in as Observer)` |

### `plan.reassign`

No actor (`can(null, …)`): `R9 · coordinator only (nobody signed in)`

| role | grant | when refused |
|---|---|---|
| requester | · | `R9 · coordinator only (signed in as Requester)` |
| coordinator | not-own | allowed when the predicate holds; otherwise `R9 · you can't assign your own request` |
| authority | · | `R9 · coordinator only (signed in as Authority)` |
| trainer | · | `R9 · coordinator only (signed in as Trainer)` |
| crew | · | `R9 · coordinator only (signed in as Crew)` |
| observer | · | `R9 · coordinator only (signed in as Observer)` |

### `plan.defer`

No actor (`can(null, …)`): `R9 · coordinator only (nobody signed in)`

| role | grant | when refused |
|---|---|---|
| requester | · | `R9 · coordinator only (signed in as Requester)` |
| coordinator | yes | allowed |
| authority | · | `R9 · coordinator only (signed in as Authority)` |
| trainer | · | `R9 · coordinator only (signed in as Trainer)` |
| crew | · | `R9 · coordinator only (signed in as Crew)` |
| observer | · | `R9 · coordinator only (signed in as Observer)` |

### `plan.scrub`

No actor (`can(null, …)`): `R9 · coordinator only (nobody signed in)`

| role | grant | when refused |
|---|---|---|
| requester | · | `R9 · coordinator only (signed in as Requester)` |
| coordinator | yes | allowed |
| authority | · | `R9 · coordinator only (signed in as Authority)` |
| trainer | · | `R9 · coordinator only (signed in as Trainer)` |
| crew | · | `R9 · coordinator only (signed in as Crew)` |
| observer | · | `R9 · coordinator only (signed in as Observer)` |

### `desk.cover`

No actor (`can(null, …)`): `R9 · coordinator only (nobody signed in)`

| role | grant | when refused |
|---|---|---|
| requester | · | `R9 · coordinator only (signed in as Requester)` |
| coordinator | yes | allowed |
| authority | · | `R9 · coordinator only (signed in as Authority)` |
| trainer | · | `R9 · coordinator only (signed in as Trainer)` |
| crew | · | `R9 · coordinator only (signed in as Crew)` |
| observer | · | `R9 · coordinator only (signed in as Observer)` |

### `program.priority`

No actor (`can(null, …)`): `R9 · authority only (nobody signed in)`

| role | grant | when refused |
|---|---|---|
| requester | · | `R9 · authority only (signed in as Requester)` |
| coordinator | · | `R9 · authority only (signed in as Coordinator)` |
| authority | scope | allowed when the predicate holds; otherwise `R9 · PN is outside your scope (signed in as Authority)` |
| trainer | · | `R9 · authority only (signed in as Trainer)` |
| crew | · | `R9 · authority only (signed in as Crew)` |
| observer | · | `R9 · authority only (signed in as Observer)` |

### `program.targets`

No actor (`can(null, …)`): `R9 · authority only (nobody signed in)`

| role | grant | when refused |
|---|---|---|
| requester | · | `R9 · authority only (signed in as Requester)` |
| coordinator | · | `R9 · authority only (signed in as Coordinator)` |
| authority | scope | allowed when the predicate holds; otherwise `R9 · PN is outside your scope (signed in as Authority)` |
| trainer | · | `R9 · authority only (signed in as Trainer)` |
| crew | · | `R9 · authority only (signed in as Crew)` |
| observer | · | `R9 · authority only (signed in as Observer)` |

### `desk.settings`

No actor (`can(null, …)`): `R9 · authority only (nobody signed in)`

| role | grant | when refused |
|---|---|---|
| requester | · | `R9 · authority only (signed in as Requester)` |
| coordinator | · | `R9 · authority only (signed in as Coordinator)` |
| authority | desk | allowed when the predicate holds; otherwise `R9 · PM or rider ops lead only (signed in as Authority)` |
| trainer | · | `R9 · authority only (signed in as Trainer)` |
| crew | · | `R9 · authority only (signed in as Crew)` |
| observer | · | `R9 · authority only (signed in as Observer)` |

### `rating.grant`

No actor (`can(null, …)`): `R9 · trainer only (nobody signed in)`

| role | grant | when refused |
|---|---|---|
| requester | · | `R9 · trainer only (signed in as Requester)` |
| coordinator | · | `R9 · trainer only (signed in as Coordinator)` |
| authority | · | `R9 · trainer only (signed in as Authority)` |
| trainer | not-self | allowed when the predicate holds; otherwise `R9 · you can't grant your own rating or qualification` |
| crew | · | `R9 · trainer only (signed in as Crew)` |
| observer | · | `R9 · trainer only (signed in as Observer)` |

### `rating.revoke`

No actor (`can(null, …)`): `R9 · trainer only (nobody signed in)`

| role | grant | when refused |
|---|---|---|
| requester | · | `R9 · trainer only (signed in as Requester)` |
| coordinator | · | `R9 · trainer only (signed in as Coordinator)` |
| authority | · | `R9 · trainer only (signed in as Authority)` |
| trainer | not-self | allowed when the predicate holds; otherwise `R9 · you can't grant your own rating or qualification` |
| crew | · | `R9 · trainer only (signed in as Crew)` |
| observer | · | `R9 · trainer only (signed in as Observer)` |

### `qualification.grant`

No actor (`can(null, …)`): `R9 · trainer only (nobody signed in)`

| role | grant | when refused |
|---|---|---|
| requester | · | `R9 · trainer only (signed in as Requester)` |
| coordinator | · | `R9 · trainer only (signed in as Coordinator)` |
| authority | · | `R9 · trainer only (signed in as Authority)` |
| trainer | not-self | allowed when the predicate holds; otherwise `R9 · you can't grant your own rating or qualification` |
| crew | · | `R9 · trainer only (signed in as Crew)` |
| observer | · | `R9 · trainer only (signed in as Observer)` |

### `sortie.ack`

No actor (`can(null, …)`): `R9 · crew only (nobody signed in)`

| role | grant | when refused |
|---|---|---|
| requester | · | `R9 · crew only (signed in as Requester)` |
| coordinator | · | `R9 · crew only (signed in as Coordinator)` |
| authority | · | `R9 · crew only (signed in as Authority)` |
| trainer | · | `R9 · crew only (signed in as Trainer)` |
| crew | own | allowed when the predicate holds; otherwise `R9 · not your sortie (signed in as Crew)` |
| observer | · | `R9 · crew only (signed in as Observer)` |

### `triage.edit`

No actor (`can(null, …)`): `R9 · requester only (nobody signed in)`

| role | grant | when refused |
|---|---|---|
| requester | yes | allowed |
| coordinator | · | `R9 · requester only (signed in as Coordinator)` |
| authority | · | `R9 · requester only (signed in as Authority)` |
| trainer | · | `R9 · requester only (signed in as Trainer)` |
| crew | · | `R9 · requester only (signed in as Crew)` |
| observer | · | `R9 · requester only (signed in as Observer)` |

### `view.analytics`

No actor (`can(null, …)`): `R9 · requester, coordinator, authority, trainer or observer only (nobody signed in)`

| role | grant | when refused |
|---|---|---|
| requester | yes | allowed |
| coordinator | yes | allowed |
| authority | yes | allowed |
| trainer | yes | allowed |
| crew | · | `R9 · requester, coordinator, authority, trainer or observer only (signed in as Crew)` |
| observer | yes | allowed |

An unknown action is refused for everyone: `R9 · unknown action no.such.action`.

## Timeline events and the actions they are

`EVENT_ACTION` maps each request-timeline event to the action its actor needed, so the seed's actors can be checked (I4); `actionsByRole()` in `src/lib/dispatch.js` asks `eventAction()` only to count the late-intake deferral as a filing, its other columns key on the event name. `eventAction()` makes one exception: a `deferred` event with reason `late_intake` is `request.create` — the late-intake deferral is stamped at intake by the filer, not a plan decision.

| event | action |
|---|---|
| `submitted` | `request.create` |
| `withdrawn` | `request.withdraw` |
| `deferred` | `plan.defer` |
| `rescheduled` | `plan.defer` |
| `scrubbed` | `plan.scrub` |
| `scheduled` | `plan.assign` |
| `reassigned` | `plan.reassign` |
| `executed` | `plan.assign` |

## Exports of `src/lib/auth.js`

| name | kind |
|---|---|
| `ACTIONS` | constant |
| `authorize` | function |
| `can` | function |
| `deskScope` | function |
| `EVENT_ACTION` | constant |
| `eventAction` | function |
| `inScope` | function |
| `isSelf` | function |
| `ownSeat` | function |
| `ownsRequest` | function |
| `PERMISSIONS` | constant |
| `ROLE_LABELS` | constant |
| `ROLES` | constant |
| `rolesFor` | function |
