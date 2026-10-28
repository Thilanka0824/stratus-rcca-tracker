# Rules

The explanatory half of this page is being written. The reference below is
rendered from `src/lib/rules.js` by `npm run docs` and checked by
`npm run docs:check`; the rules themselves are introduced in the
[README](../README.md#the-rules) and the permission matrix is rendered in
[permissions.md](permissions.md).

## Reference

<!-- rendered:begin rules-reference (scripts/render_docs.py) -->
### Vocabulary

**Windows** (`WINDOWS`): `AM` · `PM` · `NIGHT`

**Priorities** (`PRIORITY_RANK`, lower sorts first):

| priority | rank |
|---|---|
| `P0` | 0 |
| `P1` | 1 |
| `P2` | 2 |
| `P3` | 3 |

**Deferral reasons** (`DEFERRAL_REASONS`, labels from `REASON_LABELS`) — the only values R8 accepts for a deferral:

| reason | label |
|---|---|
| `no_rated_operator` | No rated operator |
| `no_rated_pilot` | No rated pilot |
| `no_asset` | No tail available |
| `asset_grounded` | Tail grounded |
| `program_over_max` | Program at tail cap |
| `build_not_ready` | Build not ready |
| `late_intake` | Late intake |
| `requester_withdrew` | Requester withdrew |
| `no_rider_ops` | No rider operator |

**Scrub reasons** (`SCRUB_REASONS`): every deferral reason plus `weather` (Weather).

**Crew requirements** (`CREW_KINDS`, labels from `CREW_LABELS`) — what R4 matches a sortie's seats against:

| kind | label |
|---|---|
| `none` | No crew |
| `pilot_only` | Safety pilot only |
| `operator_pilot` | Operator + safety pilot |
| `lone_operator` | Lone operator (self-pilot) |

**Build stages** (`BUILD_STAGES`): `engineering` · `release_candidate`

**Triage ladder** (`TRIAGE_STEPS`): `Open` → `Investigating` → `Corrective Action` → `Verified`

**The desk** — `DEFAULT_DESK` when the seed does not say (`meta.rider_desk` does), and `DESK_BOUNDS`, the only two settings that exist:

| setting | default | bounds |
|---|---|---|
| `min_per_window` | 1 | 1–4 |
| `ratio` | 2 | 1–4 |

### R8, as `validateReason()` says it

- deferral: `A deferral needs a reason: no_rated_operator · no_rated_pilot · no_asset · asset_grounded · program_over_max · build_not_ready · late_intake · requester_withdrew · no_rider_ops.`
- scrub: `A scrub needs a reason: no_rated_operator · no_rated_pilot · no_asset · asset_grounded · program_over_max · build_not_ready · late_intake · requester_withdrew · no_rider_ops · weather.`

### Functions

Every function in `src/lib/rules.js`, in file order, with the literals written inside it: the R9 action it passes to `authorize()`, the `rule`/`severity` pairs it can return (`(no severity)` marks a result object without a severity field — the desk row's level in `checkCoverage()`, the ok/message pair of `validateReason()`), the reason list it asserts (R8), and whether it throws. Exported names are what views, `App.jsx` and the tests may import.

| function | exported | authorizes (R9) | raises | asserts reason (R8) | throws |
|---|---|---|---|---|---|
| `makeDb` | yes | · | · | · | · |
| `addDays` | yes | · | · | · | · |
| `isWeekend` | yes | · | · | · | · |
| `ratedOn` | yes | · | · | · | · |
| `availableOn` | yes | · | · | · | · |
| `qualifiedOn` | yes | · | · | · | · |
| `deskCoverers` | yes | · | · | · | · |
| `riderLoad` | yes | · | · | · | · |
| `checkCoverage` | yes | · | R10 (no severity) | · | · |
| `checkUncover` | yes | · | R2·block, R10·block | · | · |
| `checkCover` | yes | · | R10·block, R2·block, AV·warn | · | · |
| `assetStatusOn` | yes | · | · | · | · |
| `isOperatingDay` | yes | · | · | · | · |
| `isLate` | yes | · | · | · | · |
| `defaultPlanDate` | yes | · | · | · | · |
| `lateWarning` | yes | · | R7·warn | · | · |
| `validateReason` | yes | · | R8 (no severity) | · | · |
| `assertReason` | no | · | · | · | yes |
| `personName` | no | · | · | · | · |
| `checkAssignment` | yes | · | R3·block, R2·block, R1·block, AV·warn, R10·block, R4·block, R5·warn | · | · |
| `hasBlock` | yes | · | · | · | · |
| `programTails` | yes | · | · | · | · |
| `queuedFor` | yes | · | · | · | · |
| `dayWarnings` | yes | · | R5·warn, R6·warn | · | · |
| `validateRequest` | yes | · | · | · | · |
| `operatingWindows` | yes | · | · | · | · |
| `pruneWindows` | yes | · | · | · | · |
| `newRequest` | yes | `request.create` | · | · | · |
| `nextAssignmentId` | yes | · | · | · | · |
| `newAssignment` | yes | `plan.assign` | · | · | · |
| `scheduleRequest` | yes | `plan.assign` | · | · | · |
| `deferRequest` | yes | `plan.defer` | · | `DEFERRAL_REASONS` | · |
| `scrubAssignment` | yes | `plan.scrub` | · | `SCRUB_REASONS` | · |
| `scrubRequest` | yes | `plan.scrub` | · | `SCRUB_REASONS` | · |
| `triageFailure` | yes | `triage.edit` | · | · | yes |
| `withdrawRequest` | yes | `request.withdraw` | · | · | yes |
| `coverWindow` | yes | `desk.cover` | · | · | · |
| `uncoverWindow` | yes | `desk.cover` | · | · | · |
| `acknowledge` | yes | `sortie.ack` | · | · | · |
| `assertGrantDate` | no | · | · | · | yes |
| `grantRating` | yes | `rating.grant` | · | · | · |
| `revokeRating` | yes | `rating.revoke` | · | · | · |
| `grantQualification` | yes | `qualification.grant` | · | · | · |
| `setProgramPriority` | yes | `program.priority` | · | · | yes |
| `setProgramTargets` | yes | `program.targets` | · | · | yes |
| `editProgram` | yes | · | · | · | · |
| `setDeskSettings` | yes | `desk.settings` | · | · | yes |

### Exports of `src/lib/rules.js`

| name | kind |
|---|---|
| `acknowledge` | function |
| `addDays` | function |
| `assetStatusOn` | function |
| `availableOn` | function |
| `BUILD_STAGES` | constant |
| `checkAssignment` | function |
| `checkCover` | function |
| `checkCoverage` | function |
| `checkUncover` | function |
| `coverWindow` | function |
| `CREW_KINDS` | constant |
| `CREW_LABELS` | constant |
| `dayWarnings` | function |
| `DEFAULT_DESK` | constant |
| `defaultPlanDate` | function |
| `DEFERRAL_REASONS` | constant |
| `deferRequest` | function |
| `DESK_BOUNDS` | constant |
| `deskCoverers` | function |
| `editProgram` | function |
| `grantQualification` | function |
| `grantRating` | function |
| `hasBlock` | function |
| `isLate` | function |
| `isOperatingDay` | function |
| `isWeekend` | function |
| `lateWarning` | function |
| `makeDb` | function |
| `newAssignment` | function |
| `newRequest` | function |
| `nextAssignmentId` | function |
| `operatingWindows` | function |
| `PRIORITY_RANK` | constant |
| `programTails` | function |
| `pruneWindows` | function |
| `qualifiedOn` | function |
| `queuedFor` | function |
| `ratedOn` | function |
| `REASON_LABELS` | constant |
| `revokeRating` | function |
| `riderLoad` | function |
| `scheduleRequest` | function |
| `SCRUB_REASONS` | constant |
| `scrubAssignment` | function |
| `scrubRequest` | function |
| `setDeskSettings` | function |
| `setProgramPriority` | function |
| `setProgramTargets` | function |
| `TRIAGE_STEPS` | constant |
| `triageFailure` | function |
| `uncoverWindow` | function |
| `validateReason` | function |
| `validateRequest` | function |
| `WINDOWS` | constant |
| `withdrawRequest` | function |
<!-- rendered:end rules-reference -->
