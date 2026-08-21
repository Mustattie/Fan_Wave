"""Delete orphaned objects from the `clips` storage bucket.

v9.4.4. Run find_orphaned_clip_objects.sql first and READ THE LIST -- this is
an irreversible delete against production storage.

    cd fan-wave-app
    python supabase/scripts/query.py \
        supabase/scripts/find_orphaned_clip_objects.sql --names > /tmp/orphans.txt
    python supabase/scripts/purge_orphaned_clip_objects.py /tmp/orphans.txt

WHY NOT `supabase storage rm`:
    Broken in CLI 2.115. Given the correct URI it returns
        {"deleted":[],"buckets_deleted":[],"message":""}
    and `--debug` shows it never issues the DELETE -- it fetches the project
    api-keys and returns. Silent no-op, exit code 0. The shell version of this
    script looked like it worked and removed nothing. Hence the REST call here,
    which reports a real HTTP status per object.

The service_role key is read from the CLI at runtime and never written down.
Requires `supabase login` with an account that can see the project.

2026-08-21 run: 10 objects, 156 MB reclaimed. Bucket 395 MB -> 239 MB.
"""
import json
import re
import subprocess
import sys
import urllib.request

PROJECT_REF = 'fwlfiejvxmslkpoojggs'


def service_key(ref: str) -> str:
    out = subprocess.run(
        ['npx', 'supabase', 'projects', 'api-keys', '--project-ref', ref, '--experimental'],
        capture_output=True, text=True, shell=True,
    ).stdout
    m = re.search(r'\[.*\]', out, re.S)
    if not m:
        raise SystemExit(f'could not read api-keys (are you logged in?):\n{out[:400]}')
    for k in json.loads(m.group(0)):
        if k.get('name') == 'service_role':
            return k['api_key']
    raise SystemExit('no service_role key returned')


def main(list_path: str) -> None:
    paths = [l.strip() for l in open(list_path, encoding='utf-8') if l.strip()]
    if not paths:
        raise SystemExit('list is empty -- nothing to do')

    print(f'About to DELETE {len(paths)} objects from the clips bucket.')
    print('These must already have been confirmed orphaned by')
    print('find_orphaned_clip_objects.sql -- that query checks match_moments and')
    print('messages too, not just media_clips. Checking media_clips alone reports')
    print('26 orphans when the true number is 10; the rest are live user media.')
    if input('Type DELETE to continue: ').strip() != 'DELETE':
        raise SystemExit('aborted')

    key = service_key(PROJECT_REF)
    ok = fail = 0
    for p in paths:
        url = f'https://{PROJECT_REF}.supabase.co/storage/v1/object/clips/{p}'
        req = urllib.request.Request(
            url, method='DELETE',
            headers={'Authorization': f'Bearer {key}', 'apikey': key},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                print(f'  {r.status}  deleted  {p}')
                ok += 1
        except Exception as e:      # noqa: BLE001 - report and keep going
            print(f'  FAIL     {p}  -> {e}')
            fail += 1
    print(f'\ndeleted {ok}, failed {fail}')
    print('Re-run find_orphaned_clip_objects.sql to confirm 0 remain.')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
