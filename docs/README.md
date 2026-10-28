# Stratus technical documentation

The reference for maintainers and reviewers. The root [README](../README.md)
tells the story — the problem, the principle, the seven arcs, the demo; the
contributor brief in [CLAUDE.md](../CLAUDE.md) states the rules a change must
keep. These pages say how the thing is built, where each piece lives, which
invariants hold, and how to change it without breaking the demo.

## Pages

| page | what it answers | how it is kept true |
|---|---|---|
| [architecture.md](architecture.md) | How the app is shaped: one-way build-time data, the state `App.jsx` owns, the modules, the views, the dialog contract, the theme | hand-written, verified against the code |
| [data-model.md](data-model.md) | Every entity's JSON shape and the SQLite schema the generator also writes; the invariants the data must keep; how to change a shape | prose hand-written; the schema block rendered from `sql/schema.sql` |
| [rules.md](rules.md) | R1–R10, the rider desk, intake, the transitions, the separation-of-duties invariants I1–I5, where the tests come from | prose hand-written; the reference block rendered from `src/lib/rules.js` |
| [permissions.md](permissions.md) | Who may do what: the matrix, every refusal message, the event-to-action map | rendered whole from `src/lib/auth.js` |
| [seed-and-arcs.md](seed-and-arcs.md) | `generate_data.py`: the RNG streams, what each half produces, the seven arcs, what the sanity report asserts, what must not move | hand-written, verified against the generator and its report |
| [runbook.md](runbook.md) | Setup, commands, the dev loop, regenerating the seed, keeping the docs honest, recipes for common changes, the pre-PR checklist | hand-written |
| [glossary.md](glossary.md) | The vocabulary, with the meaning the code gives each term and where it is defined | hand-written |
| [analytics.md](analytics.md) | The dispatch metrics as SQL, with results against the seed database | rendered by `scripts/render_analytics.py` (`npm run analytics`) |
| [specs/](specs/README.md) | Design specifications, one per layer, and what to strip before committing one | hand-written |

## Rendered, not written

Three parts of these pages are generated from the code and must not be edited
by hand: `permissions.md` as a whole, the block under *Reference* in
`rules.md`, and the block under *Schema* in `data-model.md`. `npm run docs`
regenerates them; `npm run docs:check` exits non-zero when what is on disk
differs from what the code says, and is the gate for any change to
`src/lib/auth.js`, `src/lib/rules.js` or `sql/schema.sql`. The renderer,
`scripts/render_docs.py`, executes the two JavaScript modules under Node
(through `scripts/dump_rules.mjs`) and loads the schema into SQLite, so the
matrix, the refusal messages, the enums and the tables are the engine's own,
not a transcription. The rendered blocks sit between
`<!-- rendered:begin … -->` and `<!-- rendered:end … -->` markers; the prose
around them is the explanation.

## Reading order

New to the code: `architecture.md`, then `rules.md` with `permissions.md`
beside it, then `data-model.md`. Changing the seed or a caption that depends
on it: `seed-and-arcs.md` first. Making any change: `runbook.md` has the
recipe and the checklist. Unsure what a word means: `glossary.md`.
