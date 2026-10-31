#!/usr/bin/env bash
#
# Shell test of e2e-stack.sh with a stub docker on PATH; no container starts.
#
#   bash infra/ci/tests/e2e-stack-test.sh
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

# Stub docker: records each call with the APP_IMAGE it saw; `port <service>
# <port>` prints a loopback address, nothing for STUB_NO_PORT's service;
# `run --rm migrate` fails with STUB_MIGRATE_FAIL=1.
mkdir "$work/bin"
cat > "$work/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf 'APP_IMAGE=%s %s\n' "$APP_IMAGE" "$*" >> "$STUB_DIR/docker.calls"
case "$*" in
  *" port "*)
    set -- "${@: -2}"
    [ "$1" != "${STUB_NO_PORT:-none}" ] || exit 0
    case "$1" in web) echo 127.0.0.1:3100 ;; mailpit) echo 127.0.0.1:49001 ;; postgres) echo 127.0.0.1:49002 ;; esac ;;
  *"run --rm migrate") [ "${STUB_MIGRATE_FAIL:-0}" != 1 ] || exit 1 ;;
esac
STUB
chmod +x "$work/bin/docker"
export STUB_DIR="$work" PATH="$work/bin:$PATH"
stack="$here/e2e-stack.sh"
reset() { rm -f "$work/docker.calls"; unset STUB_NO_PORT STUB_MIGRATE_FAIL APP_IMAGE; }
at() { grep -n -- "$1" "$work/docker.calls" | head -n 1 | cut -d: -f1; }

reset
out="$(APP_IMAGE=mychess:t-arm64 bash "$stack" up mychess-e2e-1 2>/dev/null)"
check "up: prints the web's base URL" test "$out" = http://127.0.0.1:3100
check "up: starts the given image" grep -q "APP_IMAGE=mychess:t-arm64 compose -p mychess-e2e-1" "$work/docker.calls"
check "up: app.yml with e2e.yml" grep -q "compose/app.yml -f .*compose/e2e.yml" "$work/docker.calls"
check "up: migrates before web starts" test "$(at 'run --rm migrate')" -lt "$(at 'up -d --wait web')"
check "up: seeds nothing (the tests make their own data)" bash -c '! grep -q seed "$1"' _ "$work/docker.calls"

reset
bash "$stack" up mychess-e2e-1 > /dev/null 2>&1
check "up without APP_IMAGE: refused" test $? = 2
check "and starts nothing" test ! -e "$work/docker.calls"

reset
APP_IMAGE=mychess:t-arm64 STUB_MIGRATE_FAIL=1 bash "$stack" up mychess-e2e-1 > /dev/null 2>&1
check "a failed migration fails up" test $? != 0
check "before web starts" bash -c '! grep -q "up -d --wait web" "$1"' _ "$work/docker.calls"

reset
check "mailpit: prints its API URL" test "$(bash "$stack" mailpit p)" = http://127.0.0.1:49001
check "database: prints a DATABASE_URL for the tests" test "$(bash "$stack" database p)" = postgres://mychess:e2e@127.0.0.1:49002/mychess

reset
STUB_NO_PORT=mailpit bash "$stack" mailpit p > /dev/null 2>&1
check "no published port: fails" test $? = 1

reset
bash "$stack" down mychess-e2e-1 > /dev/null 2>&1
check "down: removes the stack and its volumes" grep -q "compose -p mychess-e2e-1 .* --profile tasks down -v --remove-orphans" "$work/docker.calls"

reset
bash "$stack" sideways p > /dev/null 2>&1
check "an unknown action: refused" test $? = 2

echo
[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
