#!/usr/bin/env bash
#
# Structural test of every infra script and unit: each script parses (bash -n)
# and passes shellcheck where it is installed (GitHub's ubuntu runners have
# it), each unit bootstrap.sh installs exists, each program a unit runs is
# installed by bootstrap.sh or a script that installs it, and each script is
# executable in git once it is tracked (the deploy job runs
# infra/ci/deploy-production.sh directly).
#
#   bash infra/host/tests/scripts-test.sh
set -uo pipefail

infra="$(cd "$(dirname "$0")/../.." && pwd)"
repo="$(cd "$infra/.." && pwd)"
fails=0
ok() { printf 'ok   %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }
check() { # name command...
  local name="$1"; shift
  if "$@"; then ok "$name"; else bad "$name"; fi
}

mapfile -t scripts < <(cd "$repo" && find infra -name '*.sh' | sort)
for script in "${scripts[@]}"; do
  check "$script parses" bash -n "$repo/$script"
done

if command -v shellcheck >/dev/null; then
  for script in "${scripts[@]}"; do
    check "$script passes shellcheck (warnings and errors)" shellcheck -S warning -x -P "$repo" "$repo/$script"
  done
else
  ok "shellcheck (skipped: not installed here)"
fi

bootstrap="$infra/host/bootstrap.sh"
for unit in $(grep -o '"\$here/[A-Za-z0-9@._-]*\.\(service\|timer\)"' "$bootstrap" | sed 's/"\$here\/\(.*\)"/\1/'); do
  check "bootstrap installs $unit, which exists" test -f "$infra/host/$unit"
done
for unit in "$infra"/host/*.service; do
  for program in $(sed -n 's/^ExecStart=\(\/usr\/local\/bin\/[A-Za-z0-9-]*\).*/\1/p' "$unit"); do
    check "$(basename "$unit") runs $program, which a script installs" \
      grep -rqE "install -m 755 .* $program\$" "$infra/host"
  done
done
for timer in "$infra"/host/*.timer; do
  check "$(basename "$timer") has a service" test -f "${timer%.timer}.service"
done

for script in "${scripts[@]}"; do
  mode="$(cd "$repo" && git ls-files -s -- "$script" | cut -d' ' -f1)"
  [ -z "$mode" ] && continue
  check "$script is executable in git" test "$mode" = 100755
done

echo
[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
