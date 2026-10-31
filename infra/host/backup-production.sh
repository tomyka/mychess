#!/usr/bin/env bash
#
# Nightly production backup on the mychess VM (installed as
# /usr/local/bin/mychess-production-backup; run by
# mychess-production-backup.timer, as root). Dumps the database, restores the
# dump into a throwaway Postgres 18, checks every table's row count against
# the live database, uploads the dump to the Object Storage bucket through a
# write-only pre-authenticated request (the host can add objects, never read,
# list or delete them), and writes /srv/mychess/backup-status.json.
#
#   mychess-production-backup             the nightly run
#   mychess-production-backup --dry-run   dump and restore test only: no upload,
#                                         no local copy, no status file, and no
#                                         PAR needed; for proving the pipeline
#                                         (and the restore test) by hand
#
# /etc/mychess/backup.env (root, 0600) holds BACKUP_PAR_URL: the PAR's full
# URL, ending in /o/ (set-backup-par.sh). It is the only secret here and is
# never printed, logged or put on a command line (curl reads it from a config
# on stdin). Without it the restore test still runs and the status is
# `failed`.
#
# Every failure - including a kill by the unit's timeout - leaves status
# `failed` and a reason in backup-status.json, which backup-watch.sh reads
# every morning. A run that never started leaves no new file, so the watch
# also mails when updated_at is more than 26 hours old.
#
# Production takes writes while the dump runs, so the restore test cannot
# compare with a count taken once: each table's live count is read before and
# after the dump, and the restored count must lie between the two (a table
# that changed both ways in that window can fail a night; the next one runs).
# The newest 7 dumps stay in /srv/mychess/backups (root only: they hold every
# player's email address and repertoires).
#
# postgres:18.x below is pinned exactly, bumped deliberately together with
# the same tag in infra/compose/app.yml and packages/db/src/testing/database.ts.
set -Eeuo pipefail

dry=0
case "${1:-}" in
  '') ;;
  --dry-run) dry=1 ;;
  *) echo "usage: mychess-production-backup [--dry-run]" >&2; exit 2 ;;
esac

LIVE=mychess-production-postgres-1
TEST=mychess-production-restore-test
STATUS=/srv/mychess/backup-status.json
KEEP_DIR=/srv/mychess/backups
[ "$dry" = 1 ] && TEST=mychess-production-restore-test-dry # never collides with the timer's run

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="production-$stamp.dump"
object="mychess/production/$file"
work="$(mktemp -d)"
sha=""

write_status() { # status reason bytes
  if [ "$dry" = 1 ]; then return 0; fi
  jq -n --arg status "$1" --arg reason "$2" --arg file "$object" --argjson bytes "${3:-0}" \
    --arg sha256 "$sha" --arg updated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{status: $status, reason: $reason, file: $file, bytes: $bytes, sha256: $sha256, updated_at: $updated_at}' \
    > "$STATUS.new"
  chmod 644 "$STATUS.new"
  mv "$STATUS.new" "$STATUS"
}
cleanup() { docker rm -f "$TEST" >/dev/null 2>&1 || true; rm -rf "$work"; }
fail() { trap - ERR; write_status failed "$1" 0; echo "backup failed: $1" >&2; exit 1; }
trap 'fail "unexpected error on line $LINENO"' ERR
trap 'fail "terminated before it finished"' TERM INT
trap cleanup EXIT

psql_live() { docker exec "$LIVE" psql -U mychess -d mychess -Atc "$1"; }
psql_test() { docker exec "$TEST" psql -U postgres -d mychess -Atc "$1"; }
counts() { # one "table count" line per table, from the live database
  local table
  while IFS= read -r table; do
    printf '%s %s\n' "$table" "$(psql_live "select count(*) from $table")"
  done <<< "$tables"
}

if [ "$dry" = 0 ]; then install -d -m 700 "$KEEP_DIR"; fi

tables="$(psql_live "select format('%I.%I', schemaname, tablename) from pg_tables where schemaname not in ('pg_catalog', 'information_schema') order by 1")"
[ -n "$tables" ] || fail "live database has no tables"

counts > "$work/before"
docker exec "$LIVE" pg_dump -U mychess -d mychess -Fc > "$work/$file" || fail "pg_dump failed"
counts > "$work/after"
bytes="$(stat -c %s "$work/$file")"
[ "$bytes" -gt 0 ] || fail "pg_dump wrote an empty file"
sha="$(sha256sum "$work/$file" | cut -d' ' -f1)"

docker rm -f "$TEST" >/dev/null 2>&1 || true
docker run -d --name "$TEST" -e POSTGRES_PASSWORD=restore-test postgres:18.6 >/dev/null
for _ in $(seq 60); do
  docker exec "$TEST" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$TEST" pg_isready -h 127.0.0.1 -U postgres >/dev/null || fail "restore container never became ready"
docker exec "$TEST" createdb -U postgres mychess
docker exec -i "$TEST" pg_restore -U postgres -d mychess --no-owner --no-privileges --exit-on-error \
  < "$work/$file" || fail "pg_restore failed"

checked=0
while read -r table low; do
  high="$(awk -v t="$table" '$1 == t { print $2 }' "$work/after")"
  [ -n "$high" ] || fail "$table is gone after the dump"
  if [ "$high" -lt "$low" ]; then t="$low"; low="$high"; high="$t"; fi
  restored="$(psql_test "select count(*) from $table")"
  if [ "$restored" -lt "$low" ] || [ "$restored" -gt "$high" ]; then
    fail "$table: $low..$high rows live, $restored restored"
  fi
  checked=$((checked + 1))
done < "$work/before"

if [ "$dry" = 1 ]; then
  have_par=no
  if [ -f /etc/mychess/backup.env ] && grep -q '^BACKUP_PAR_URL=.' /etc/mychess/backup.env; then have_par=yes; fi
  echo "dry run ok: $bytes bytes, sha256 $sha, $checked tables restored and counted; nothing uploaded, nothing kept (PAR configured: $have_par)"
  exit 0
fi

# Off-host copy, then the local one. The PAR is read here, not before, so the
# restore test above runs even when it is missing.
# shellcheck source=/dev/null # /etc/mychess/backup.env only exists on the host
[ -f /etc/mychess/backup.env ] && . /etc/mychess/backup.env
[ -n "${BACKUP_PAR_URL:-}" ] || fail "no BACKUP_PAR_URL in /etc/mychess/backup.env"
[[ "$BACKUP_PAR_URL" =~ ^https://[a-z0-9.-]+/p/[^/]+/n/[^/]+/b/[^/]+/o/$ ]] \
  || fail "BACKUP_PAR_URL is not a bucket PAR URL ending in /o/"
want="$(openssl md5 -binary "$work/$file" | base64)"
# The URL goes to curl on stdin, never as an argument (ps shows arguments).
printf 'url = "%s%s"\n' "$BACKUP_PAR_URL" "$object" \
  | curl -fsS --retry 3 --max-time 900 -K - -o /dev/null -D "$work/headers" -T "$work/$file" \
  || fail "upload failed (a 404 means the PAR expired or was deleted)"
got="$(tr -d '\r' < "$work/headers" | awk 'tolower($1) == "opc-content-md5:" { print $2 }')"
[ "$got" = "$want" ] || fail "the bucket's checksum differs from the dump's"

install -m 600 "$work/$file" "$KEEP_DIR/$file"
find "$KEEP_DIR" -name 'production-*.dump' -printf '%T@ %p\n' | sort -rn | awk 'NR > 7 { print $2 }' | xargs -r rm -f

write_status ok "" "$bytes"
echo "backup ok: $object ($bytes bytes), restore test passed"
