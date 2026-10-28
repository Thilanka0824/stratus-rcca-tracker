# Specs

Design specifications for Stratus, one per layer, to be kept next to the code
they describe so a reader can hold the spec and the implementation side by
side. A spec says what was decided and why; the code and `src/lib/rules.test.js`
say what is true today. When they disagree, the code wins and the spec gets a
dated note, not a silent edit. None is committed yet; the table says where each
stands.

## What belongs here

| spec | layer | status |
|---|---|---|
| Field Ops spec, v2 | the real-drone loop: two deployments of one codebase, flight and static tickets, R11–R13 and V1, the Field page, the narrow backend | ratified Oct 28, 2026; kept with the project's planning notes outside git. **Lands at step A0 of PR A `feat/live-data`**, superseding v1, which is not kept. The root `README.md` and `CLAUDE.md` describe the app as it is and do not mention it yet |
| Dispatch layer spec, v2 | requests → prioritize → dispatch: R1–R8, the planner, arcs D1–D3 | shipped (PR #2); kept outside git until stripped, see below |
| Roles layer spec, v1 | personas, R9, R10, I1–I5, the rider desk, arc D4 | shipped (PR #4); kept outside git until stripped, see below |

Numbering is per spec, not global: a new layer starts at v1, and a revision
that changes a decision bumps the number. A revision opens with a change table
against the version it replaces, so nothing is lost when the old file goes.
Name a file `stratus-<layer>-spec-v<N>.md`.

## Before committing a spec

The confidentiality rule in `CLAUDE.md` applies to specs as much as to code:
nothing from any real workplace enters the repo. The two shipped specs were
written with working notes in them, which is why they are not here yet. Strip,
before adding either:

- colleague names, and interview notes or quotations of any kind;
- real vehicle ids, program names, team names, tool names, channel names and
  certification codes — the fiction is Stratus Aerial, the Windz fleet, and
  the names in `generate_data.py`;
- absolute coordinates, site names and addresses (the Field Ops spec's privacy
  rule: offsets from takeoff only, sites have no location);
- anything the spec cites from a document that is not itself public.

Then grep the file for the terms you removed, read it once more as a stranger
would, and commit it by explicit path.

## Where specs are referenced

[`docs/README.md`](../README.md) indexes this directory. The build order for
the Field Ops work (PR A `feat/live-data`, then PR B `feat/field-ops`) is
defined in the v2 spec.
