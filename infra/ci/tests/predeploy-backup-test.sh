#!/usr/bin/env bash
#
# Shell test of predeploy-backup.sh with a stub docker on PATH and a temp
# directory; no database is touched.
#
#   bash infra/ci/tests/predeploy-backup-test.sh
set -uo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fails=0
ok() { printf 'ok   %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }
check() { # name command...
  local name="$1"; shift
  if "$@"; then ok "$name"; else bad "$name"; fi
}

# Stub docker: records its arguments; STUB_DUMP_FAIL=1 exits 1, STUB_DUMP_EMPTY=1
# writes nothing, otherwise it writes a few bytes of "dump".
mkdir "$work/bin"
cat > "$work/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_DIR/docker.calls"
[ "${STUB_DUMP_FAIL:-0}" != 1 ] || exit 1
[ "${STUB_DUMP_EMPTY:-0}" = 1 ] || printf 'PGDMP-fake'
STUB
chmod +x "$work/bin/docker"
export STUB_DIR="$work" PATH="$work/bin:$PATH" BACKUP_DIR="$work/backups"

# shellcheck source=infra/ci/predeploy-backup.sh
source "$here/predeploy-backup.sh"
sha=0123456789abcdef0123456789abcdef01234567
reset() { rm -rf "$work/backups" "$work/docker.calls" "$work/out" "$work/err"; unset STUB_DUMP_FAIL STUB_DUMP_EMPTY SKIP_PREDEPLOY_BACKUP; }
run() { predeploy_backup "$1" > "$work/out" 2> "$work/err"; }
dumps() { find "$work/backups" -maxdepth 1 -name 'predeploy-*.dump' 2>/dev/null; }

reset
run "$sha-arm64"
check "success: returns 0" test "$?" = 0
check "success: one predeploy dump named with the short tag" bash -c 'ls "$1" | grep -Eq "^predeploy-[0-9]{8}T[0-9]{6}Z-0123456789ab\.dump$"' _ "$work/backups"
# Windows file systems (Git Bash) ignore modes: only assert where chmod is honoured.
touch "$work/probe"; chmod 600 "$work/probe"
if [ "$(stat -c %a "$work/probe")" = 600 ]; then
  check "success: mode 600" test "$(stat -c %a "$(dumps)")" = 600
else
  ok "success: mode 600 (skipped: this file system ignores modes)"
fi
check "success: the dump is what pg_dump wrote" grep -q PGDMP-fake "$(dumps)"
check "success: dumps as mychess in custom format from the production container" grep -q "exec mychess-production-postgres-1 pg_dump -U mychess -d mychess -Fc" "$work/docker.calls"
check "success: prints the path and size" grep -Eq "pre-deploy backup: .*predeploy-.*\.dump \(10 bytes\)" "$work/out"
check "success: leaves no partial file" test ! -e "$work/backups/.predeploy-partial"

reset
STUB_DUMP_FAIL=1 run "$sha-arm64"
check "dump failure: returns 1, so the deploy stops before migrating" test "$?" = 1
check "dump failure: says what happened" grep -q "pre-deploy backup failed" "$work/err"
check "dump failure: keeps no file" test -z "$(dumps)"
check "dump failure: and no partial one" test ! -e "$work/backups/.predeploy-partial"

reset
STUB_DUMP_EMPTY=1 run "$sha-arm64"
check "an empty dump counts as a failure" test "$?" = 1
check "and is not kept" test -z "$(dumps)"

reset
SKIP_PREDEPLOY_BACKUP=1 run "$sha-arm64"
check "opt-out: returns 0" test "$?" = 0
check "opt-out: warns loudly" grep -q "WARNING: SKIP_PREDEPLOY_BACKUP=1" "$work/err"
check "opt-out: takes no dump and does not call docker" test ! -e "$work/docker.calls" -a ! -d "$work/backups"

reset
mkdir -p "$work/backups"
for i in $(seq 1 16); do
  touch -d "2026-10-$(printf %02d "$i") 00:00:00" "$work/backups/predeploy-old$i.dump"
done
touch -d "2026-10-01 00:00:00" "$work/backups/production-20261001T000000Z.dump" "$work/backups/notes.txt"
run "$sha-arm64"
check "pruning: keeps exactly the newest 14 predeploy dumps" test "$(dumps | wc -l)" = 14
check "pruning: the new one stays" bash -c 'ls "$1" | grep -q 0123456789ab' _ "$work/backups"
check "pruning: the oldest are gone" test ! -e "$work/backups/predeploy-old1.dump" -a ! -e "$work/backups/predeploy-old3.dump"
check "pruning: a newer old one stays" test -e "$work/backups/predeploy-old4.dump" -a -e "$work/backups/predeploy-old16.dump"
check "pruning: touches no nightly dump or other file" test -e "$work/backups/production-20261001T000000Z.dump" -a -e "$work/backups/notes.txt"

reset
run main-arm64
check "a branch tag is named whole" bash -c 'ls "$1" | grep -q "main-arm64.dump$"' _ "$work/backups"

# The deploy script takes the restore point before it migrates, and stops if it fails.
deploy="$here/deploy-production.sh"
check "deploy: the backup comes before the migration" test "$(grep -n 'predeploy_backup "\$tag"' "$deploy" | cut -d: -f1)" -lt "$(grep -n 'run --rm migrate' "$deploy" | cut -d: -f1)"
check "deploy: a failed backup exits" grep -q 'predeploy_backup "\$tag" || exit 1' "$deploy"

echo
[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
