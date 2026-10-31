#!/usr/bin/env bash
#
# Sourced by deploy-production.sh (and by infra/ci/tests/predeploy-backup-test.sh):
# a restore point taken before the migrations run.
#
#   predeploy_backup <image tag>   0 with the dump written (or skipped, loudly),
#                                  1 when the dump failed: the deploy must stop
#
# Dumps the production database the way infra/host/backup-production.sh does
# (pg_dump -Fc as `mychess` in the postgres container) into the backups
# directory as predeploy-<UTC time>-<tag>.dump, mode 600. The nightly script's
# glob is production-*.dump, so neither deletes the other's files. Only the
# newest 14 predeploy dumps stay: with a deploy on every green push that is a
# few days of pushes at least. A normal pg_dump -Fc file: restore it like any
# other (docs/operations.md, "Restoring a backup").
# Settings, all optional:
#   SKIP_PREDEPLOY_BACKUP=1  no dump, with a loud warning: for an emergency only
#   BACKUP_DIR               default /srv/mychess/backups
#   POSTGRES_CONTAINER       default mychess-production-postgres-1

PREDEPLOY_KEEP=14

predeploy_backup() { # image tag
  local tag="$1" dir="${BACKUP_DIR:-/srv/mychess/backups}"
  local file tmp bytes
  if [ "${SKIP_PREDEPLOY_BACKUP:-}" = 1 ]; then
    echo "WARNING: SKIP_PREDEPLOY_BACKUP=1: migrating WITHOUT a pre-deploy restore point" >&2
    return 0
  fi
  file="$dir/predeploy-$(date -u +%Y%m%dT%H%M%SZ)-${tag:0:12}.dump"
  tmp="$dir/.predeploy-partial"
  install -d -m 700 "$dir"
  rm -f "$tmp"
  if ! (umask 077; docker exec "${POSTGRES_CONTAINER:-mychess-production-postgres-1}" \
        pg_dump -U mychess -d mychess -Fc > "$tmp") || [ ! -s "$tmp" ]; then
    rm -f "$tmp"
    echo "pre-deploy backup failed: no restore point, so nothing was migrated (SKIP_PREDEPLOY_BACKUP=1 overrides, for an emergency)" >&2
    return 1
  fi
  chmod 600 "$tmp"
  mv "$tmp" "$file"
  bytes="$(stat -c %s "$file")"
  find "$dir" -maxdepth 1 -name 'predeploy-*.dump' -printf '%T@ %p\n' \
    | sort -rn | awk -v keep="$PREDEPLOY_KEEP" 'NR > keep { print $2 }' | xargs -r rm -f
  echo "pre-deploy backup: $file ($bytes bytes)"
}
