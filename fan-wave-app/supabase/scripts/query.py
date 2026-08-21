"""Run a .sql file against the linked Supabase project and print rows.

v9.4.4. Exists because the obvious one-liner --
    json.loads(out).get('rows') or []
-- reports an EMPTY RESULT when the CLI actually returned an error. The CLI
emits {"_tag":"Error",...} with no `rows` key on a 403, so a dropped session
reads as "0 orphans found" and you conclude the bucket is clean when you
simply never queried it. Anything without a `rows` key is an error here.

    python supabase/scripts/query.py <file.sql> [--names]
"""
import json
import re
import subprocess
import sys


def run(sql_path: str):
    out = subprocess.run(
        ['npx', 'supabase', 'db', 'query', '--linked', '-f', sql_path],
        capture_output=True, text=True, shell=True,
    ).stdout
    m = re.search(r'\{.*\}', out, re.S)
    if not m:
        raise SystemExit(f'no JSON in CLI output:\n{out[:600]}')
    payload = json.loads(m.group(0))
    if 'rows' not in payload:
        err = payload.get('error') or payload
        raise SystemExit(f'QUERY DID NOT RUN -- {json.dumps(err)[:400]}')
    return payload['rows']


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    rows = run(sys.argv[1])
    if '--names' in sys.argv:
        for r in rows:
            print(r['name'])
    else:
        print(f'{len(rows)} row(s)')
        for r in rows:
            print('  ' + '  '.join(f'{v}' for v in r.values()))
