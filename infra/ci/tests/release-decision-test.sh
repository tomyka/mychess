#!/usr/bin/env bash
#
# Shell test of release-decision.sh against a throwaway git history and a temp
# directory as /srv/mychess; no host is touched.
#
#   bash infra/ci/tests/release-decision-test.sh
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
not() { ! "$@"; }
is() { [ "$1" = "$2" ] || { printf '     got:      %s\n     expected: %s\n' "$1" "$2"; return 1; }; }

# main's history: a0 -> a1 -> m (adds a migration) -> b1 -> b2 -> h (changes
# only a host script), x off a1 (a commit main never had), and off b2 one
# commit each changing infra/ci, infra/compose and infra/edge.
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid
git init -q "$work/repo"
cd "$work/repo" || exit 1
commit() { # message [file]
  mkdir -p "$(dirname "${2:-app/$1}")"
  echo "$1" > "${2:-app/$1}"
  git add -A && git commit -qm "$1" && git rev-parse HEAD
}
a0="$(commit a0)"
a1="$(commit a1)"
git checkout -q -b side
x="$(commit x)"
git checkout -q -
m="$(commit m packages/db/migrations/0001_new.sql)"
b1="$(commit b1)"
b2="$(commit b2)"
h="$(commit h infra/host/some-host-script.sh)"
off_b2() { # name, file
  git checkout -q -b "$1" "$b2" && commit "$1" "$2"
}
infra_ci="$(off_b2 ci infra/ci/changed)"
infra_compose="$(off_b2 compose infra/compose/changed)"
infra_edge="$(off_b2 edge infra/edge/changed)"
workflow="$(off_b2 workflow .github/workflows/ci.yml)"
git checkout -q -
unknown=ffffffffffffffffffffffffffffffffffffffff

export MYCHESS_ROOT="$work/srv"
# shellcheck source=infra/ci/release-decision.sh
source "$here/release-decision.sh"
state() { # deployed sha, confirmed sha (empty: no file)
  rm -rf "$work/srv"; mkdir -p "$work/srv/production"
  [ -z "$1" ] || echo "$1-arm64" > "$work/srv/production/deployed-tag"
  [ -z "${2:-}" ] || echo "$2-arm64" > "$work/srv/production/confirmed-tag"
}
plan() { deploy_plan "$1" 2> "$work/err"; }

# The deploy right after the image.
state "$a0" "$a0"
check "plan: a newer commit, no migration since the running release: deploy" is "$(plan "$a1")" deploy
state "$a1" "$a1"
check "plan: production runs this commit: skip" is "$(plan "$a1")" skip
state "$b1" "$a1"
check "plan: production runs a newer commit: skip" is "$(plan "$a1")" skip
check "plan: and says which" grep -q "production runs $b1" "$work/err"
state "$a1" "$a1"
check "plan: the commit adds a migration: hold" is "$(plan "$m")" hold
check "plan: and says why" grep -q "^packages/db/migrations/0001_new.sql$" "$work/err"
check "plan: a later commit over a migration production lacks: hold" is "$(plan "$b2")" hold
state "$m" "$m"
check "plan: the migration is live: the next commits deploy" is "$(plan "$b2")" deploy
state "$b2" "$b2"
for pair in "ci $infra_ci" "compose $infra_compose" "edge $infra_edge"; do
  read -r part changed <<< "$pair"
  check "plan: infra/$part changed since the running release: hold" is "$(plan "$changed")" hold
  check "plan: and says why (infra/$part)" grep -q "infra/$part" "$work/err"
done
check "plan: ci.yml changed (the verdict and rollback logic): hold" is "$(plan "$workflow")" hold
check "plan: a host script alone is not deployed by a deploy: deploy" is "$(plan "$h")" deploy
state "" ""
check "plan: no deployed-tag (first deploy): hold" is "$(plan "$a1")" hold
state "$unknown" ""
check "plan: a release main does not know: hold" is "$(plan "$a1")" hold
echo garbage > "$work/srv/production/deployed-tag"
check "plan: an unreadable deployed-tag: hold" is "$(plan "$a1")" hold

# The gated deploy's order check.
state "$b1" "$b1"
check "newer: an older commit is not" not newer_than_production "$a1" 2>/dev/null
check "newer: the running commit is not" not newer_than_production "$b1" 2>/dev/null
check "newer: a later commit is" newer_than_production "$b2"
check "newer: a commit off main's line is (only the button goes back)" newer_than_production "$x"
state "" ""
check "newer: with nothing deployed, anything is" newer_than_production "$a0"

# The verdict on a commit deployed on trial.
state "$b1" "$a1"
check "pass, production runs it: confirm" is "$(verdict "$b1" deploy success success success)" "confirm $b1"
state "$b2" "$a1"
check "pass, a newer trial runs: confirm (the newer one's target moves up)" is "$(verdict "$b1" deploy success success success)" "confirm $b1"
state "$b2" "$b2"
check "pass, a newer one is confirmed already: keep" is "$(verdict "$b1" deploy success success success | cut -d' ' -f1)" keep
state "$a1" "$a1"
check "pass, production was rolled back below it: keep" is "$(verdict "$b1" deploy success success success | cut -d' ' -f1)" keep
state "$b1" "$a1"
check "check failed, production runs it: roll back to the confirmed release" is "$(verdict "$b1" deploy success failure success)" "roll-back $a1"
check "e2e failed: roll back" is "$(verdict "$b1" deploy success success failure)" "roll-back $a1"
check "cancelled: roll back" is "$(verdict "$b1" deploy success cancelled success)" "roll-back $a1"
check "e2e skipped: roll back" is "$(verdict "$b1" deploy success success skipped)" "roll-back $a1"
state "$b2" "$a1"
check "failed, a newer push runs: keep (its own run decides)" is "$(verdict "$b1" deploy success failure success | cut -d' ' -f1)" keep
state "$a1" "$a1"
check "failed, already rolled back: keep" is "$(verdict "$b1" deploy success failure success | cut -d' ' -f1)" keep
state "$b1" ""
check "failed, no confirmed release: stranded" is "$(verdict "$b1" deploy success failure success | cut -d' ' -f1)" stranded
state "$b1" "$b1"
check "failed, but confirmed is itself: stranded" is "$(verdict "$b1" deploy success failure success | cut -d' ' -f1)" stranded

state "$b1" "$x"
check "pass, but the confirmed release is off this line (force-push): keep" is "$(verdict "$b1" deploy success success success | cut -d' ' -f1)" keep

# The trial deploy itself did not succeed (failed, cancelled, timed out).
state "$b1" "$a1"
check "deploy cancelled before recording: restore the recorded release" is "$(verdict "$b2" deploy cancelled success success)" "restore $b1"
check "deploy failed: restore too (the script put the previous web back; this makes sure)" is "$(verdict "$b2" deploy failure cancelled cancelled)" "restore $b1"
check "plan output lost, nothing gated changed: restore" is "$(verdict "$b2" "" cancelled success success)" "restore $b1"
# A restore runs this commit's deploy script as root with its compose and Caddy
# files: never for a commit that changes them (or a migration, or ci.yml).
state "$b2" "$b2"
for pair in "infra/ci $infra_ci" "infra/compose $infra_compose" "infra/edge $infra_edge" "ci.yml $workflow"; do
  read -r part changed <<< "$pair"
  check "deploy failed, the commit changes $part: never restore" is "$(verdict "$changed" deploy failure success success | cut -d' ' -f1)" stranded
  check "plan output lost, the commit changes $part: never restore" is "$(verdict "$changed" "" cancelled success success | cut -d' ' -f1)" stranded
done
check "and the reason names the deploy button" bash -c '[[ "$1" == *"deploy button"* ]]' _ "$(verdict "$infra_ci" deploy failure success success)"
state "$a1" "$a1"
check "a migration since the recorded release: never restore" is "$(verdict "$b1" deploy cancelled success success | cut -d' ' -f1)" stranded
# A held or skipped commit was never deployed on trial: its verdict touches nothing.
state "$b2" "$b2"
for plan in hold skip; do
  for result in cancelled failure success; do
    check "plan $plan, deploy $result: no production action" is "$(verdict "$infra_ci" "$plan" "$result" failure success | cut -d' ' -f1)" keep
  done
done
state "$b1" "$a1"
check "deploy cancelled after recording: judged like a deployed trial" is "$(verdict "$b1" deploy cancelled cancelled success)" "roll-back $a1"
state "$b2" "$a1"
check "deploy cancelled, a newer push deployed since: keep" is "$(verdict "$b1" deploy cancelled success success | cut -d' ' -f1)" keep
state "" ""
check "deploy cancelled, no release recorded: stranded" is "$(verdict "$b1" deploy cancelled success success | cut -d' ' -f1)" stranded

# Two quick pushes, b1 then b2, both deployed on trial; the verdicts come in
# either order and production ends on the last confirmed good release.
state "$b2" "$a1"
check "b2 fails first: back to a1, not to b1 (untested)" is "$(verdict "$b2" deploy success failure success)" "roll-back $a1"
state "$a1" "$a1"
check "then b1 fails: production runs a1, keep" is "$(verdict "$b1" deploy success failure success | cut -d' ' -f1)" keep
state "$b2" "$a1"
check "b1 passes first: confirm b1" is "$(verdict "$b1" deploy success success success)" "confirm $b1"
state "$b2" "$b1"
check "then b2 fails: back to b1" is "$(verdict "$b2" deploy success failure success)" "roll-back $b1"

cd / || exit 1
echo
[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
