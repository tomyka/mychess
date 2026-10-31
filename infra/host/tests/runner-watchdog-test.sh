#!/usr/bin/env bash
#
# Shell test of runner-watchdog.sh with stub curl, pgrep and systemctl on PATH
# and temp files; nothing is asked of GitHub and no unit is restarted. Needs
# bash, jq and GNU date.
#
#   bash infra/host/tests/runner-watchdog-test.sh
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

mkdir "$work/bin" "$work/api"
# Stub curl: reads its config from stdin, answers the url's path from
# $STUB_DIR/api/<path with / and ? as _>; STUB_CURL_EXIT fails it.
cat > "$work/bin/curl" <<'STUB'
#!/usr/bin/env bash
config="$(cat)"
printf '%s\n' "$*" >> "$STUB_DIR/curl.args"
printf '%s\n' "$config" >> "$STUB_DIR/curl.config"
[ "${STUB_CURL_EXIT:-0}" = 0 ] || exit "$STUB_CURL_EXIT"
url="$(sed -n 's/^url = "\(.*\)"$/\1/p' <<< "$config")"
path="${url#*/actions/}"
file="$STUB_DIR/api/$(tr '/?&=' '____' <<< "$path")"
[ -f "$file" ] && cat "$file" || echo '{"workflow_runs":[],"jobs":[]}'
STUB
cat > "$work/bin/pgrep" <<'STUB'
#!/usr/bin/env bash
[ "${STUB_BUSY:-0}" = 1 ]
STUB
cat > "$work/bin/systemctl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_DIR/systemctl.calls"
STUB
chmod +x "$work/bin/"*
export STUB_DIR="$work" PATH="$work/bin:$PATH" \
  MYCHESS_WATCHDOG_ENV="$work/watchdog.env" MYCHESS_WATCHDOG_STAMP="$work/state/last" \
  MYCHESS_GITHUB_API="https://api.example.test"
watchdog="$here/runner-watchdog.sh"
service=actions.runner.tomyka-mychess.mychess.service
token=github_pat_SECRET123

settings() { printf 'GITHUB_TOKEN=%s\nRUNNER_LABEL=%s\nRUNNER_SERVICE=%s\n' "$1" "$2" "$3" > "$work/watchdog.env"; }
ago() { date -u -d "$1" +%Y-%m-%dT%H:%M:%SZ; }
runs() { # status ids...
  local status="$1"; shift
  jq -n --args '{workflow_runs: [$ARGS.positional[] | {id: tonumber}]}' "$@" > "$work/api/runs_status_${status}_per_page_20"
}
jobs() { # run, then label:status:created triples
  local run="$1"; shift
  jq -n --args '{jobs: [$ARGS.positional[] | split("|") | {labels: (.[0] | split(",")), status: .[1], created_at: .[2]}]}' "$@" \
    > "$work/api/runs_${run}_jobs_filter_latest_per_page_100"
}
reset() { rm -rf "$work"/api/* "$work"/curl.* "$work/systemctl.calls" "$work/state" "$work/out"; unset STUB_BUSY STUB_CURL_EXIT; settings "$token" production "$service"; }
run_it() { bash "$watchdog" > "$work/out" 2>&1; }
restarted() { grep -qx "restart $service" "$work/systemctl.calls" 2>/dev/null; }

reset
runs queued
runs in_progress
run_it
check "nothing queued: ok" grep -q "runner watchdog: ok" "$work/out"
check "nothing queued: no restart" bash -c '! test -e "$1"' _ "$work/systemctl.calls"

reset
runs queued 11
runs in_progress
jobs 11 "self-hosted,production|queued|$(ago '10 minutes ago')"
run_it
check "a job for its label queued 10 min while idle: restarts its runner" restarted
check "and says why" grep -q "1 job(s) for 'production' queued over 180s while idle: restarting $service" "$work/out"
check "and records when" test -s "$work/state/last"

reset
runs queued
runs in_progress 12
jobs 12 "self-hosted,production|completed|$(ago '20 minutes ago')" "self-hosted,production|queued|$(ago '5 minutes ago')"
run_it
check "a queued job inside a running run counts too" restarted

reset
runs queued 13
runs in_progress
jobs 13 "self-hosted,production|queued|$(ago '1 minute ago')"
run_it
check "queued for only a minute: no restart" bash -c '! test -e "$1"' _ "$work/systemctl.calls"

reset
runs queued 14
runs in_progress
jobs 14 "self-hosted,staging|queued|$(ago '10 minutes ago')" "self-hosted,fast|queued|$(ago '10 minutes ago')"
run_it
check "jobs for other runners: no restart" bash -c '! test -e "$1"' _ "$work/systemctl.calls"

reset
runs queued 15
runs in_progress
jobs 15 "self-hosted,production|queued|$(ago '10 minutes ago')"
export STUB_BUSY=1
run_it
check "busy: no restart" bash -c '! test -e "$1"' _ "$work/systemctl.calls"
check "busy: and does not ask GitHub" bash -c '! test -e "$1"' _ "$work/curl.args"
unset STUB_BUSY

reset
runs queued 16
runs in_progress
jobs 16 "self-hosted,production|queued|$(ago '10 minutes ago')"
mkdir -p "$work/state" && date -u -d '5 minutes ago' +%s > "$work/state/last"
run_it
check "restarted 5 min ago: waits" bash -c '! test -e "$1"' _ "$work/systemctl.calls"
date -u -d '11 minutes ago' +%s > "$work/state/last"
run_it
check "restarted 11 min ago: restarts again" restarted

reset
export STUB_CURL_EXIT=22
run_it
check "GitHub unreachable: fails, so the unit shows failed" test $? != 0
check "GitHub unreachable: no restart" bash -c '! test -e "$1"' _ "$work/systemctl.calls"
unset STUB_CURL_EXIT

reset
runs queued
runs in_progress
run_it
check "the token is not on curl's command line" bash -c '! grep -q SECRET "$1"' _ "$work/curl.args"
check "the token is in the stdin config" grep -q "Authorization: Bearer $token" "$work/curl.config"
check "the token is not printed" bash -c '! grep -q SECRET "$1"' _ "$work/out"

for broken in "|production|$service" "$token|production|sshd.service" "$token|CI;rm|$service" 'a"b|production|'"$service"; do
  reset
  IFS='|' read -r t l s <<< "$broken"
  settings "$t" "$l" "$s"
  run_it
  check "refuses settings '$broken'" test $? = 1
done

echo
[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
