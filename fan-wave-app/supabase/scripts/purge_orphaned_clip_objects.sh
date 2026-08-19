#!/usr/bin/env bash
# Delete the orphaned clip objects listed in a paths file.
#
# v9.4.4. Generate the list with find_orphaned_clip_objects.sql FIRST and
# eyeball it -- this is an irreversible delete against production storage.
#
#   cd fan-wave-app
#   ./supabase/scripts/purge_orphaned_clip_objects.sh \
#       supabase/scripts/orphaned_clip_objects_2026-08-19.txt
#
# The bundled 2026-08-19 list is 10 files / 156 MB, verified against every
# url-bearing column in the public schema (media_clips, match_moments,
# messages, users, chat_rooms). Do not reuse a stale list -- regenerate it.
set -euo pipefail

LIST="${1:?usage: $0 <paths-file>}"
[ -f "$LIST" ] || { echo "no such file: $LIST" >&2; exit 1; }

echo "About to delete $(grep -c . "$LIST") objects from the clips bucket."
read -r -p "Type DELETE to continue: " confirm
[ "$confirm" = "DELETE" ] || { echo "aborted"; exit 1; }

while read -r path; do
  [ -z "$path" ] && continue
  echo "rm $path"
  npx supabase storage rm "ss:///clips/${path}" --linked --experimental
done < "$LIST"

echo "Done. Re-run find_orphaned_clip_objects.sql to confirm 0 remain."
