"""
Render the code-derived halves of docs/ so the reference cannot drift from
the code:

  docs/permissions.md            whole file   from src/lib/auth.js
  docs/rules.md                  one block    from src/lib/rules.js
  docs/data-model.md             one block    from sql/schema.sql

auth.js and rules.js are executed, not parsed: scripts/dump_rules.mjs imports
them under Node and prints their data exports plus the refusal messages can()
produces. The function inventory in the rules block is the one scan of source
text (the `rule: '…', severity: '…'` and `authorize(actor, '…')` literals the
house style always writes). The schema is loaded into an in-memory SQLite
database and read back through SQLite's own pragmas and sqlite_master, so the
columns, keys and foreign keys are what the engine enforces, and the DDL shown
is what SQLite stored.

Hand-written prose stays outside the markers:

  <!-- rendered:begin <id> … -->
  <!-- rendered:end <id> -->

    python3 scripts/render_docs.py          # write (npm run docs)
    python3 scripts/render_docs.py --check  # exit 1 on drift (npm run docs:check)

Run from the project root; paths are relative.
"""

import difflib
import glob
import json
import os
import re
import sqlite3
import subprocess
import sys

DUMP = ["node", "scripts/dump_rules.mjs"]
RULES_SRC = "src/lib/rules.js"
SCHEMA_SRC = "sql/schema.sql"

UI_SRC = sorted(glob.glob("src/App.jsx") + glob.glob("src/views/*.jsx"))   # where a control asks allowed()/can()

PERMISSIONS_MD = "docs/permissions.md"
RULES_MD = "docs/rules.md"
DATA_MODEL_MD = "docs/data-model.md"

RULES_BLOCK = "rules-reference"
SCHEMA_BLOCK = "schema"

# The meaning of each grant kind, as the comment block at the top of auth.js
# defines it. The render fails if the matrix uses a grant this table lacks.
LEGEND = {
    "yes": "always",
    "own": "the target request was filed by this user; for `sortie.ack`, the sortie or coverage row holds this user's own seat",
    "not-own": "allowed except on this user's own request — nobody assigns their own request, even a coordinator (I1)",
    "scope": "the target program is in the user's scope (`'all'` or a list of program ids)",
    "desk": "the user's scope is `'all'` or includes `'desk'` — the PM or the rider ops lead",
    "not-self": "the target person is not this user — nobody grants their own rating or qualification (I2)",
}


# ---------------------------------------------------------------- helpers

def cell(v):
    if v is None:
        return "·"
    return str(v).replace("|", "\\|").replace("\n", " ")


def table(cols, rows):
    out = ["| " + " | ".join(cols) + " |", "|" + "|".join("---" for _ in cols) + "|"]
    out += ["| " + " | ".join(cell(v) for v in r) + " |" for r in rows]
    return "\n".join(out)


def code(s):
    return f"`{s}`"


def link(text, target, from_dir="docs"):
    """A relative markdown link that must resolve on disk, so a dangling link fails the render."""
    path = os.path.normpath(os.path.join(from_dir, target.split("#", 1)[0]))
    if not os.path.exists(path):
        raise SystemExit(f"render_docs: link target {target} ({path}) does not exist")
    return f"[{text}]({target})"


def files_quoting(action, paths):
    """The source files that write the action as a string literal."""
    return [p for p in paths if f"'{action}'" in open(p).read()]


def dump():
    try:
        res = subprocess.run(DUMP, capture_output=True, text=True, check=True)
    except FileNotFoundError:
        raise SystemExit("node is required to render docs/ (it executes src/lib/auth.js and rules.js)")
    except subprocess.CalledProcessError as e:
        raise SystemExit(f"{' '.join(DUMP)} failed:\n{e.stderr}")
    return json.loads(res.stdout)


def rendered_notice(source):
    return (f"<!-- Rendered by scripts/render_docs.py from {source}. Do not edit by hand: "
            "run `npm run docs`; `npm run docs:check` fails on drift. -->")


# ---------------------------------------------------------------- permissions.md

def i3_sentence(a):
    """I3 is the shape of the matrix: coordinators hold plan.* and none of program.*,
    authority holds program.* and none of plan.*. Asserted, so a change to the shape
    fails the render and forces the doc to be rewritten with it."""
    plan = [m["action"] for m in a["matrix"] if m["action"].startswith("plan.")]
    prog = [m["action"] for m in a["matrix"] if m["action"].startswith("program.")]
    grant = {m["action"]: m["roles"] for m in a["matrix"]}
    bad = [x for x in plan if grant[x]["authority"]["grant"]] + [x for x in prog if grant[x]["coordinator"]["grant"]]
    if bad or not all(grant[x]["coordinator"]["grant"] for x in plan) or not all(grant[x]["authority"]["grant"] for x in prog):
        raise SystemExit(f"PERMISSIONS no longer has the I3 shape (coordinator: plan.*, authority: program.*): {bad}")
    return ("The shape of the matrix is I3: `coordinator` holds " + ", ".join(code(x) for x in plan)
            + " and none of the `program.*` actions; `authority` holds " + ", ".join(code(x) for x in prog)
            + " and none of the `plan.*` actions — coordinators consume priority and cannot set it, "
            "authority sets priority and cannot assign. The render fails if that shape changes.")


def ahead_of_controls(a):
    """Matrix actions no transition in rules.js authorizes, and whether any view or
    App.jsx asks for them: the matrix carries some actions ahead of their controls."""
    authorized = {act for f in scan_functions(open(RULES_SRC).read()) for act in f["authorizes"]}
    rows = []
    for m in a["matrix"]:
        act = m["action"]
        if act in authorized:
            continue
        asked = files_quoting(act, UI_SRC)
        rows.append((code(act), ", ".join(code(p) for p in asked) if asked else "no control asks for it yet"))
    if not rows:
        return "Every action in the matrix is authorized by a transition in `src/lib/rules.js`."
    return ("Actions no transition in `src/lib/rules.js` passes to `authorize()` — a read gate asked by "
            "the UI, or an action the matrix carries ahead of its control. This table is a scan, not an "
            "execution: the authorized set is the `authorize(actor, '…')` literals inside the `function name(` "
            "declarations of `rules.js` (an arrow-function transition is not scanned), and the "
            "*asked by* column names the files among `src/App.jsx` and `src/views/*.jsx` that contain the "
            "single-quoted action literal (not the control itself); an action name written any other way "
            "drops out while `docs:check` still passes, so keep writing them literally.\n\n"
            + table(["action", "asked by"], rows))


def render_permissions(d):
    a = d["auth"]
    roles = a["ROLES"]
    labels = a["ROLE_LABELS"]
    missing = [g for g in a["grants"] if g not in LEGEND]
    if missing:
        raise SystemExit(f"PERMISSIONS uses grant kind(s) the legend in render_docs.py does not define: {missing}")

    parts = [
        "# Permissions",
        "",
        rendered_notice("src/lib/auth.js, executed under Node; the table of actions no transition authorizes also scans "
                        "src/lib/rules.js, src/App.jsx and src/views/*.jsx for the single-quoted action literal"),
        "",
        "Authorization without authentication (R9). The matrix `PERMISSIONS` in "
        "`src/lib/auth.js` is data: for every action it names, per app role, whether the action "
        "is allowed outright or only under a named predicate. A role absent from an action's row "
        "is refused with a message that names the roles that may do it and the role signed in, for "
        "example `R9 · coordinator only (signed in as Requester)`; the action itself is named only "
        "in the unknown-action refusal and in `can()`'s `default` branch for a grant kind that has "
        "no `case` (`R9 · <action> refused (signed in as <Role>)`), which no grant in the matrix "
        "reaches. The UI asks `can()` and renders a refused control disabled with the message as its "
        "tooltip; every transition in `src/lib/rules.js` calls `authorize()` (`editProgram()` through "
        "the two dial transitions it composes, each only when its dial changes), which throws the "
        "same message. The messages below are the ones `can()` "
        "returns, produced by executing the module. `npm run docs:check` fails when this page and "
        "the module disagree; nothing runs it automatically, so run it before committing a change "
        "to `src/lib/auth.js`, to an `authorize()` call in `src/lib/rules.js`, or to which actions "
        "`src/App.jsx` and `src/views/*.jsx` ask `allowed()` for. How the matrix is used is in " + link("rules.md", "rules.md") + " and "
        + link("architecture.md", "architecture.md") + ".",
        "",
        "## Roles",
        "",
        table(["role", "label"], [(code(r), labels[r]) for r in roles]),
        "",
        "## Grants",
        "",
        "A cell in the matrix holds one of these; `·` means the role is refused. The meanings are "
        "`LEGEND` in `scripts/render_docs.py`, kept by hand in step with the comment block at the top "
        "of `src/lib/auth.js`; the render fails on a grant kind the legend lacks.",
        "",
        table(["grant", "meaning"], [(code(g), LEGEND[g]) for g in LEGEND if g in a["grants"]]),
        "",
        "## The matrix",
        "",
        table(["action"] + roles,
              [[code(m["action"])] + [m["roles"][r]["grant"] for r in roles] for m in a["matrix"]]),
        "",
        i3_sentence(a),
        "",
        ahead_of_controls(a),
        "",
        "## By role",
        "",
    ]
    for r in roles:
        allowed = [(m["action"], m["roles"][r]["grant"]) for m in a["matrix"] if m["roles"][r]["grant"]]
        if allowed:
            items = ", ".join(f"{code(act)}" + ("" if g == "yes" else f" ({g})") for act, g in allowed)
        else:
            items = "nothing — read-only"
        parts.append(f"- **{labels[r]}** (`{r}`): {items}")
    parts += [
        "",
        "## Refusals, as the UI shows them",
        "",
        "Per action: the answer `can()` gives with no actor, and per role the grant with the "
        "message `can()` returns when the role is refused or its predicate does not hold "
        "(an `own` grant with someone else's request — or, for `sortie.ack`, a seat that is not the "
        "actor's — a `not-own` grant with the actor's own request, a `scope` grant on a program "
        "outside the scope, a `desk` grant without `desk` in scope, a `not-self` grant on the actor's "
        "own person). A `scope` refusal labels the program by the target's `code`, else its "
        "`program_id`, else `that program`: the intake form and the program dials pass the program "
        "object, so those tooltips show the code; the Requests drawer's Withdraw control and "
        "`withdrawRequest()` pass the request, and `newRequest()` passes `{ program_id }`, so those "
        "show the program id. "
        "The no-actor line is `can(null, …)`: the header always holds a persona, so the app never "
        "shows it, but a transition or a test called without an actor gets this answer.",
        "",
    ]
    for m in a["matrix"]:
        parts.append(f"### `{m['action']}`")
        parts.append("")
        parts.append(f"No actor (`can(null, …)`): `{m['nobody']}`")
        parts.append("")
        rows = []
        for r in roles:
            g = m["roles"][r]["grant"]
            msg = m["roles"][r]["refused"]
            if g == "yes":
                rows.append((r, g, "allowed"))
            elif g:
                rows.append((r, g, f"allowed when the predicate holds; otherwise `{msg}`"))
            else:
                rows.append((r, "·", code(msg)))
        parts.append(table(["role", "grant", "when refused"], rows))
        parts.append("")
    parts += [
        f"An unknown action is refused for everyone: `{a['unknown_action_message']}`.",
        "",
        "## Timeline events and the actions they are",
        "",
        "`EVENT_ACTION` maps each request-timeline event to the action its actor needed, so the "
        "seed's actors can be checked (I4); `actionsByRole()` in `src/lib/dispatch.js` asks "
        "`eventAction()` only to count the late-intake deferral as a filing, its other columns key "
        "on the event name. "
        f"`eventAction()` makes one exception: a `deferred` event with reason `late_intake` is "
        f"`{a['late_intake_event_action']}` — the late-intake deferral is stamped at intake by the filer, "
        "not a plan decision.",
        "",
        table(["event", "action"], [(code(e), code(act)) for e, act in a["EVENT_ACTION"].items()]),
        "",
        "## Exports of `src/lib/auth.js`",
        "",
        table(["name", "kind"], [(code(x["name"]), x["kind"]) for x in a["exports"]]),
        "",
    ]
    return "\n".join(parts)


# ---------------------------------------------------------------- rules.md block

DECL = re.compile(r"^(?P<export>export\s+)?(?:async\s+)?function\s+(?P<fn>\w+)\s*\(|^export\s+(?:const|let)\s+(?P<const>\w+)\b", re.M)
RULE = re.compile(r"rule:\s*'(?P<rule>\w+)'(?:,\s*severity:\s*'(?P<sev>\w+)')?")
AUTHORIZE = re.compile(r"authorize\(\s*actor\s*,\s*'(?P<action>[\w.]+)'")
REASON = re.compile(r"assertReason\(\s*reason\s*,\s*(?P<list>\w+)\s*\)")


def scan_functions(src):
    """Each top-level function in rules.js with the rule, severity, action and
    reason-list literals written inside it, in file order."""
    decls = list(DECL.finditer(src))
    out = []
    for i, m in enumerate(decls):
        if not m.group("fn"):
            continue
        end = decls[i + 1].start() if i + 1 < len(decls) else len(src)
        body = src[m.end():end]          # after the signature: a parameter named `reason` is not a call
        raises = []
        for r in RULE.finditer(body):
            tag = f"{r.group('rule')}·{r.group('sev')}" if r.group("sev") else f"{r.group('rule')} (no severity)"
            if tag not in raises:
                raises.append(tag)
        actions = sorted({x.group("action") for x in AUTHORIZE.finditer(body)})
        reasons = sorted({x.group("list") for x in REASON.finditer(body)})
        out.append({
            "name": m.group("fn"), "exported": bool(m.group("export")), "raises": raises,
            "authorizes": actions, "reasons": reasons, "throws": "throw new Error" in body,
        })
    return out


def render_rules_block(d):
    r = d["rules"]
    src = open(RULES_SRC).read()
    fns = scan_functions(src)
    scrub_only = [x for x in r["SCRUB_REASONS"] if x not in r["DEFERRAL_REASONS"]]
    parts = [
        "### Vocabulary",
        "",
        f"**Windows** (`WINDOWS`): {' · '.join(code(w) for w in r['WINDOWS'])}",
        "",
        "**Priorities** (`PRIORITY_RANK`, lower sorts first):",
        "",
        table(["priority", "rank"], [(code(k), v) for k, v in r["PRIORITY_RANK"].items()]),
        "",
        "**Deferral reasons** (`DEFERRAL_REASONS`, labels from `REASON_LABELS`) — the only values R8 accepts for a deferral:",
        "",
        table(["reason", "label"], [(code(k), r["REASON_LABELS"].get(k, "")) for k in r["DEFERRAL_REASONS"]]),
        "",
        f"**Scrub reasons** (`SCRUB_REASONS`): every deferral reason plus "
        + ", ".join(f"{code(k)} ({r['REASON_LABELS'].get(k, '')})" for k in scrub_only) + ".",
        "",
        "**Crew requirements** (`CREW_KINDS`, labels from `CREW_LABELS`) — what R4 matches a sortie's seats against:",
        "",
        table(["kind", "label"], [(code(k), r["CREW_LABELS"].get(k, "")) for k in r["CREW_KINDS"]]),
        "",
        f"**Build stages** (`BUILD_STAGES`): {' · '.join(code(b) for b in r['BUILD_STAGES'])}",
        "",
        f"**Triage ladder** (`TRIAGE_STEPS`): {' → '.join(code(s) for s in r['TRIAGE_STEPS'])}",
        "",
        "**The desk** — `DEFAULT_DESK` when the seed does not say (`meta.rider_desk` does), and `DESK_BOUNDS`, the only two settings that exist:",
        "",
        table(["setting", "default", "bounds"],
              [(code(k), r["DEFAULT_DESK"].get(k), f"{lo}–{hi}") for k, (lo, hi) in r["DESK_BOUNDS"].items()]),
        "",
        "### R8, as `validateReason()` says it",
        "",
        f"- deferral: `{r['r8_deferral_message']}`",
        f"- scrub: `{r['r8_scrub_message']}`",
        "",
        "### Functions",
        "",
        "Every function in `src/lib/rules.js`, in file order, with the literals written inside it: "
        "the R9 action it passes to `authorize()`, the `rule`/`severity` pairs it can return "
        "(`(no severity)` marks a result object without a severity field — the desk row's level in `checkCoverage()`, the ok/message pair of `validateReason()`), the reason list it asserts (R8), "
        "and whether it throws. Exported names are what views, `App.jsx` and the tests may import. "
        "This table is a scan of the source text, not an execution: one row per `function name(` or "
        "`export function name(` declaration (an arrow-function export would not be a row), the "
        "`rule: '…', severity: '…'`, `authorize(actor, '…')` and `assertReason(reason, …)` literals "
        "written inside it, and whether the text `throw new Error` appears — so a rule, action, reason "
        "list or throw written any other way drops out of this table while `docs:check` still passes. "
        "Keep writing them literally.",
        "",
        table(["function", "exported", "authorizes (R9)", "raises", "asserts reason (R8)", "throws"],
              [(code(f["name"]), "yes" if f["exported"] else "no",
                ", ".join(code(a) for a in f["authorizes"]) or None,
                ", ".join(f["raises"]) or None,
                ", ".join(code(x) for x in f["reasons"]) or None,
                "yes" if f["throws"] else None) for f in fns]),
        "",
        "### Exports of `src/lib/rules.js`",
        "",
        table(["name", "kind"], [(code(x["name"]), x["kind"]) for x in r["exports"]]),
    ]
    return "\n".join(parts)


# ---------------------------------------------------------------- data-model.md block

def render_schema_block():
    con = sqlite3.connect(":memory:")
    con.executescript(open(SCHEMA_SRC).read())
    tables = con.execute("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY rowid").fetchall()
    indexes = con.execute("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY rowid").fetchall()

    parts = [
        f"### Tables",
        "",
        f"{len(tables)} tables, in declaration order. Columns, keys and references come from "
        "`PRAGMA table_info`, `PRAGMA index_list`/`index_info` and `PRAGMA foreign_key_list` on a "
        "database built from `sql/schema.sql`; the DDL under each table is what SQLite stored in "
        "`sqlite_master`, comments and `CHECK` constraints included. The `null` column is what "
        "`table_info` reports: SQLite leaves a `TEXT PRIMARY KEY` nullable unless `NOT NULL` is spelled "
        "out, so single-column text keys read `null` here; the generator never writes a null id.",
        "",
    ]
    relations = []
    for name, sql in tables:
        cols = con.execute(f"PRAGMA table_info('{name}')").fetchall()
        fks = sorted(con.execute(f"PRAGMA foreign_key_list('{name}')").fetchall(), key=lambda x: -x[0])
        fk_by_col = {}
        for fk in fks:
            fk_by_col.setdefault(fk[3], []).append(f"{fk[2]}({fk[4]})")
            relations.append((f"{name}.{fk[3]}", f"{fk[2]}.{fk[4]}"))
        unique_cols = {}
        for idx in con.execute(f"PRAGMA index_list('{name}')").fetchall():
            if idx[2] and idx[3] == "u":
                members = [x[2] for x in con.execute(f"PRAGMA index_info('{idx[1]}')").fetchall()]
                for c in members:
                    unique_cols[c] = members
        rows = []
        pk_count = sum(1 for c in cols if c[5])
        for cid, col, typ, notnull, dflt, pk in cols:
            key = []
            if pk:
                key.append("PK" if pk_count == 1 else f"PK {pk}")
            if col in unique_cols:
                m = unique_cols[col]
                key.append("UNIQUE" if len(m) == 1 else f"UNIQUE ({', '.join(m)})")
            rows.append((code(col), typ or "", "not null" if notnull else "null", dflt, ", ".join(key) or None,
                         ", ".join(fk_by_col.get(col, [])) or None))
        parts.append(f"#### `{name}`")
        parts.append("")
        parts.append(table(["column", "type", "null", "default", "key", "references"], rows))
        own_idx = [(n, s) for n, t, s in indexes if t == name]
        if own_idx:
            parts.append("")
            parts.append("Indexes: " + "; ".join(f"`{n}` — `{s.split('ON', 1)[1].strip()}`" for n, s in own_idx))
        parts.append("")
        parts.append("<details><summary>DDL</summary>\n\n```sql\n" + sql.strip() + ";\n```\n\n</details>")
        parts.append("")
    parts += [
        "### References",
        "",
        f"{len(relations)} foreign keys (`PRAGMA foreign_key_list`), in declaration order; "
        "`PRAGMA foreign_keys = ON` is the first statement of the schema, so they are enforced.",
        "",
        table(["from", "to"], [(code(a), code(b)) for a, b in relations]),
        "",
        "### Indexes",
        "",
        table(["index", "table", "statement"], [(code(n), code(t), code(s)) for n, t, s in indexes]),
    ]
    con.close()
    return "\n".join(parts)


# ---------------------------------------------------------------- splice · check · write

def begin_re(block_id):
    return re.compile(rf"<!-- rendered:begin {re.escape(block_id)}\b[^>]*-->")


def end_marker(block_id):
    return f"<!-- rendered:end {block_id} -->"


def splice(path, block_id, body):
    """The file with the block between the markers replaced; the markers stay."""
    if not os.path.exists(path):
        raise SystemExit(f"{path} is missing — the hand-written half must exist")
    text = open(path).read()
    m = begin_re(block_id).search(text)
    end = text.find(end_marker(block_id))
    if not m or end < 0 or end < m.end():
        raise SystemExit(f"{path}: markers for block '{block_id}' not found "
                         f"(expected `<!-- rendered:begin {block_id} … -->` … `{end_marker(block_id)}`)")
    return text[:m.end()] + "\n" + body.rstrip("\n") + "\n" + text[end:]


def targets():
    d = dump()
    return {
        PERMISSIONS_MD: render_permissions(d).rstrip("\n") + "\n",
        RULES_MD: splice(RULES_MD, RULES_BLOCK, render_rules_block(d)),
        DATA_MODEL_MD: splice(DATA_MODEL_MD, SCHEMA_BLOCK, render_schema_block()),
    }


def main(argv):
    check = "--check" in argv
    want = targets()
    drift = []
    for path, content in want.items():
        have = open(path).read() if os.path.exists(path) else ""
        if have == content:
            continue
        drift.append(path)
        if check:
            sys.stdout.writelines(difflib.unified_diff(
                have.splitlines(True), content.splitlines(True), f"{path} (on disk)", f"{path} (rendered)"))
        else:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w") as fh:
                fh.write(content)
    if check:
        if drift:
            print(f"docs:check — {len(drift)} file(s) drifted from the code: {', '.join(drift)}. Run `npm run docs`.")
            return 1
        print(f"docs:check — {len(want)} rendered file(s) match the code")
        return 0
    print(f"docs — wrote {len(drift)} file(s)" + (f": {', '.join(drift)}" if drift else " (nothing changed)"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
