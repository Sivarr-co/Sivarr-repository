#!/usr/bin/env python3
"""_SCHEMA ordering check.

database.py applies _SCHEMA one statement at a time, and init_db() catches a
failing statement, logs a warning and CONTINUES. That is deliberate -- it stops
one bad statement taking the whole app down -- but it also means an ALTER or
CREATE INDEX placed above its own CREATE TABLE fails silently on a fresh
database and leaves the schema quietly wrong.

Not hypothetical. `ALTER TABLE docs ADD COLUMN is_public` sat 343 lines above
`CREATE TABLE docs`, so every fresh database got a docs table with no is_public
column and every document write failed with:

    column "is_public" of relation "docs" does not exist

Production was unaffected -- its table predated the change -- so the damage was
invisible outside CI, where it turned the build red for eight consecutive
pushes before anyone traced it.

Put new columns in the CREATE TABLE, and keep the ALTER after it for databases
that already exist.
"""
import re
import sys
from pathlib import Path


def main() -> int:
    src = Path("database.py").read_text()
    i = src.find("_SCHEMA")
    if i == -1:
        print("could not find _SCHEMA in database.py", file=sys.stderr)
        return 1
    q1 = src.find('"""', i)
    q2 = src.find('"""', q1 + 3)
    schema = src[q1 + 3:q2]

    created: set[str] = set()
    problems = []
    for n, line in enumerate(schema.split("\n"), start=1):
        c = re.match(r"\s*CREATE TABLE IF NOT EXISTS (\w+)", line)
        if c:
            created.add(c.group(1))
            continue
        a = re.match(r"\s*ALTER TABLE (\w+)", line)
        x = re.match(r"\s*CREATE (?:UNIQUE )?INDEX IF NOT EXISTS \w+ ON (\w+)", line)
        m = a or x
        if m and m.group(1) not in created:
            problems.append((n, "ALTER" if a else "INDEX", m.group(1), line.strip()[:72]))

    if not problems:
        print("_SCHEMA ordering: OK")
        return 0
    for n, kind, table, sql in problems:
        print(
            f'::error::_SCHEMA line {n}: {kind} on "{table}" runs before its '
            f"CREATE TABLE. On a fresh database this fails silently and leaves "
            f"the column missing. Move it below the CREATE, and put the column "
            f"in the CREATE too. -> {sql}"
        )
    print(f"{len(problems)} ordering problem(s)")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
