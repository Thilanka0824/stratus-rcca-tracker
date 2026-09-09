"""
Render docs/analytics.md: every query in sql/analytics/*.sql, its leading
comment as the question, and its result against data/stratus.sqlite.

Run from the project root after generate_data.py (npm run data does both).
"""

import glob
import os
import sqlite3

DB = "data/stratus.sqlite"
OUT = "docs/analytics.md"


def leading_comment(sql):
    lines = []
    for line in sql.splitlines():
        if line.startswith("--"):
            lines.append(line[2:].strip())
        elif lines:
            break
    return " ".join(lines)


def table(cols, rows):
    if not rows:
        return "_no rows_\n"
    fmt = lambda v: "" if v is None else str(v)
    out = ["| " + " | ".join(cols) + " |", "|" + "|".join("---" for _ in cols) + "|"]
    out += ["| " + " | ".join(fmt(v) for v in r) + " |" for r in rows]
    return "\n".join(out) + "\n"


def main():
    if not os.path.exists(DB):
        raise SystemExit(f"{DB} missing — run python3 generate_data.py first")
    con = sqlite3.connect(DB)
    today = con.execute("SELECT max(date) FROM test_runs").fetchone()[0]
    parts = [
        "# Stratus analytics notebook",
        "",
        "The dispatch metrics as SQL, run against the seed database the generator writes "
        f"(`data/stratus.sqlite`, schema in `sql/schema.sql`). Dataset today is **{today}**. "
        "The app computes the same numbers live in `src/lib/dispatch.js`; where a definition "
        "matters (percentiles, denominators) the two are written to agree. "
        "Regenerate with `npm run data`.",
        "",
    ]
    for path in sorted(glob.glob("sql/analytics/*.sql")):
        sql = open(path).read()
        name = os.path.basename(path)[3:-4].replace("_", " ")
        parts.append(f"## {name}")
        parts.append("")
        parts.append(leading_comment(sql))
        parts.append("")
        cur = con.execute(sql)
        cols = [d[0] for d in cur.description]
        parts.append(table(cols, cur.fetchall()))
        parts.append("<details><summary>query</summary>\n\n```sql\n" + sql.strip() + "\n```\n\n</details>")
        parts.append("")
    con.close()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        fh.write("\n".join(parts))
    print(f"wrote {OUT}: {len(glob.glob('sql/analytics/*.sql'))} queries")


if __name__ == "__main__":
    main()
