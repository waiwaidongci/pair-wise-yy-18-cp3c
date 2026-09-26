import json
import sqlite3
import sys


def main():
    db_file = sys.argv[1]
    as_json = len(sys.argv) > 2 and sys.argv[2] == '--json'
    sql = sys.stdin.read()
    conn = sqlite3.connect(db_file)
    try:
        if as_json:
            cur = conn.execute(sql)
            columns = [col[0] for col in cur.description]
            rows = [dict(zip(columns, row)) for row in cur.fetchall()]
            print(json.dumps(rows, ensure_ascii=False))
        else:
            conn.executescript(sql)
            conn.commit()
    finally:
        conn.close()


main()
