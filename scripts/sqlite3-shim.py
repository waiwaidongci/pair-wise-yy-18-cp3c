#!/usr/bin/env python3
"""极简 sqlite3 命令行垫片。

运行环境缺少 sqlite3 CLI 时顶替使用，只实现 server.js 依赖的能力：
- 从 stdin 读取 SQL；
- 识别 `.mode json` 等点命令（忽略其余点命令）；
- 按分号切分多条语句（识别引号与注释）；
- SELECT/PRAGMA 等有结果集的语句输出 JSON 数组，其余静默执行。
"""
import json
import sqlite3
import sys


def split_statements(sql):
    statements = []
    buf = []
    i = 0
    n = len(sql)
    while i < n:
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < n else ""
        if ch == "-" and nxt == "-":
            end = sql.find("\n", i)
            i = n if end == -1 else end
            continue
        if ch == "/" and nxt == "*":
            end = sql.find("*/", i + 2)
            i = n if end == -1 else end + 2
            continue
        if ch in ("'", '"', "`") or (ch == "[" ):
            quote = ch
            close = "]" if ch == "[" else ch
            buf.append(ch)
            i += 1
            while i < n:
                c = sql[i]
                buf.append(c)
                if c == close:
                    if quote != "[" and i + 1 < n and sql[i + 1] == close:
                        # 转义的引号 '' / ""
                        buf.append(sql[i + 1])
                        i += 2
                        continue
                    i += 1
                    break
                i += 1
            continue
        if ch == ";":
            stmt = "".join(buf).strip()
            if stmt:
                statements.append(stmt)
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    tail = "".join(buf).strip()
    if tail:
        statements.append(tail)
    return statements


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("usage: sqlite3-shim.py DATABASE\n")
        sys.exit(1)

    db_path = sys.argv[1]
    raw = sys.stdin.read()

    json_mode = False
    lines = []
    for line in raw.splitlines():
        stripped = line.strip()
        if stripped.startswith("."):
            parts = stripped.split()
            if len(parts) >= 2 and parts[0].lower() == ".mode" and parts[1].lower() == "json":
                json_mode = True
            continue
        lines.append(line)
    sql = "\n".join(lines).strip()
    if not sql:
        return

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    last_rows = None
    try:
        cursor = conn.cursor()
        for statement in split_statements(sql):
            cursor.execute(statement)
            if cursor.description is not None:
                last_rows = [dict(row) for row in cursor.fetchall()]
        conn.commit()
        if last_rows is not None:
            if json_mode:
                sys.stdout.write(json.dumps(last_rows, ensure_ascii=False))
            else:
                for row in last_rows:
                    sys.stdout.write("|".join("" if v is None else str(v) for v in row.values()) + "\n")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
