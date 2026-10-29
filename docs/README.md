# Stratus technical documentation

The reference for maintainers and reviewers. The root [README](../README.md)
tells the story — the problem, the principle, the seven arcs, the demo; the
contributor brief in [CLAUDE.md](../CLAUDE.md) states the rules a change must
keep. These pages say how the thing is built, where each piece lives, which
invariants hold, and how to change it without breaking the demo.

## Pages

| page | what it answers | how it is kept true |
|---|---|---|
| [architecture.md](architecture.md) | How the app is shaped: one-way build-time data, the state `App.jsx` owns and who edits it, the modules, the views and their callbacks, the dialog contract, the theme | hand-written, verified against the code |
| [data-model.md](data-model.md) | Every entity's JSON shape as the generator writes it and how it flattens into the schema; the relationships; the invariants and where each is enforced; the change recipe; every table, column, key and reference | prose hand-written; the *Schema* block rendered from `sql/schema.sql` |
| [rules.md](rules.md) | How a rule is shaped, R1–R10 one by one, the rider desk, intake, every transition, the invariants I1–I5, where the 173 tests come from | prose hand-written; the *Reference* block rendered from `src/lib/rules.js` |
| [permissions.md](permissions.md) | Who may do what: the matrix and its I3 shape, every refusal message as `can()` produces it, the actions carried ahead of their controls, the event-to-action map | rendered whole by `scripts/render_docs.py`: `src/lib/auth.js` executed, plus a scan of `src/lib/rules.js` and a search of `src/App.jsx` and `src/views/*.jsx` for the table of actions carried ahead of their controls |
| [seed-and-arcs.md](seed-and-arcs.md) | `generate_data.py`: the three RNG streams, what each half produces, the seven arcs with their constants, what `check_rules()` and the sanity report assert, what must not move | hand-written, verified against the generator and its report |
| [runbook.md](runbook.md) | Setup, every command, the dev loop, regenerating the seed, keeping the docs honest, recipes for the common changes, the pre-PR checklist | hand-written |
| [glossary.md](glossary.md) | The vocabulary and the identifiers, with the meaning the code gives each and where it is defined | hand-written |
| [analytics.md](analytics.md) | The dispatch metrics as SQL, with results against the seed database | rendered by `scripts/render_analytics.py` (`npm run analytics`) |
| [specs/](specs/README.md) | Where each design specification stands, and what to strip before committing one | hand-written |

## Rendered, not written

Four parts of these pages are generated from the code and must not be edited
by hand. Three come from `scripts/render_docs.py`: `permissions.md` as a whole,
the block under *Reference* in `rules.md`, and the block under *Schema* in
`data-model.md`. `npm run docs` regenerates them; `npm run docs:check` exits
non-zero when what is on disk differs from what the code says. Nothing runs
either automatically, so the check is a step on the pre-PR list in
`runbook.md` for any change to `src/lib/auth.js`, `src/lib/rules.js` or
`sql/schema.sql`, and for any change to `src/App.jsx` or `src/views/*.jsx`
that adds or removes the quoted name of a matrix action — the *asked by*
column of `permissions.md` is a search of those files. The fourth is
`analytics.md`, rendered whole by `scripts/render_analytics.py` from
`sql/analytics/*.sql` and `data/stratus.sqlite`; `npm run data` and
`npm run analytics` rewrite it, `docs:check` does not cover it, and its check
is the pre-PR list's `git status --short -- src/data docs/analytics.md` after
`npm run data`.

The renderer, `scripts/render_docs.py`, gets its data three ways. It executes
`src/lib/auth.js` and `src/lib/rules.js` under Node through
`scripts/dump_rules.mjs`, so the matrix, the refusal messages, the enums,
labels and bounds are the modules' own values. It loads `sql/schema.sql` into
SQLite and reads the tables back through SQLite's pragmas, so the columns, keys
and references are what the engine enforces. Two tables are scans of source
text rather than executions. The *Functions* table in `rules.md` scans
`src/lib/rules.js` for the `rule`/`severity`, `authorize(actor, '…')` and
`assertReason(reason, …)` literals the house style writes and for the text
`throw new Error`; it says so and names what the scan would miss. The table of
actions carried ahead of their controls in `permissions.md` takes the
authorized actions from that same scan and, for the rest, searches
`src/App.jsx` and `src/views/*.jsx` for the quoted action name to say which
control asks for it; it does not say it is a scan. The rendered blocks sit
between `<!-- rendered:begin … -->` and `<!-- rendered:end … -->` markers;
the prose around them is the explanation.

## Reading order

New to the code: `architecture.md`, then `rules.md` with `permissions.md`
beside it, then `data-model.md`. Changing the seed, or a caption that depends
on it: `seed-and-arcs.md` first. Making any change: `runbook.md` has the
recipe and the checklist. Unsure what a word means: `glossary.md`.
