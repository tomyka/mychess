#!/usr/bin/env bash
#
# Restarts this host's GitHub Actions runner when it has gone deaf: idle,
# shown online, while a job for its label has waited in the queue for more than
# RUNNER_MAX_WAIT seconds (seen on sportbet_new's runners after a network
# timeout). An idle runner logs nothing while it waits, so only GitHub can
# tell: this asks the API for the repository's queued and running workflow
# runs and their queued jobs. Installed as /usr/local/bin/mychess-runner-watchdog
# by infra/host/install-runner-watchdog.sh, run every 2 minutes by
# mychess-runner-watchdog.timer.
#
# Settings, from /etc/mychess/runner-watchdog.env (root, 0600; one KEY=value a
# line, read key by key, never sourced):
#   GITHUB_TOKEN     a fine-grained token, this repository's Actions: read only
#   RUNNER_LABEL     the label of this host's runner (production)
#   RUNNER_SERVICE   its systemd unit (actions.runner.<...>.service)
# The token reaches curl through a config on stdin: never a command line. A
# restart is at most once in 10 minutes. The paths can be overridden by the
# environment for the shell test (infra/host/tests/runner-watchdog-test.sh).
set -Eeuo pipefail

ENV_FILE="${MYCHESS_WATCHDOG_ENV:-/etc/mychess/runner-watchdog.env}"
STAMP="${MYCHESS_WATCHDOG_STAMP:-/var/lib/mychess/runner-watchdog.last}"
API="${MYCHESS_GITHUB_API:-https://api.github.com}/repos/tomyka/mychess/actions"
MAX_WAIT="${RUNNER_MAX_WAIT:-180}"
COOLDOWN=600

say() { echo "runner watchdog: $1"; }
setting() { # key: the value of the first KEY=value line of the env file
  sed -n "s/^$1=//p" "$ENV_FILE" 2>/dev/null | head -n 1 | tr -d '\r'
}

token="$(setting GITHUB_TOKEN)"
label="$(setting RUNNER_LABEL)"
service="$(setting RUNNER_SERVICE)"
[[ "$token" =~ ^[A-Za-z0-9_]+$ ]] || { say "no GITHUB_TOKEN in $ENV_FILE"; exit 1; }
[[ "$label" =~ ^[a-z0-9-]+$ ]] || { say "RUNNER_LABEL '$label' is not a label"; exit 1; }
[[ "$service" =~ ^actions\.runner\.[A-Za-z0-9._-]+\.service$ ]] \
  || { say "RUNNER_SERVICE '$service' is not a runner unit"; exit 1; }

# A busy runner is not deaf: a job queued behind its current one just waits.
if pgrep -x Runner.Worker >/dev/null; then
  say "busy"
  exit 0
fi

get() { # path below the repository's actions API
  printf 'header = "Authorization: Bearer %s"\nheader = "Accept: application/vnd.github+json"\nurl = "%s/%s"\n' \
    "$token" "$API" "$1" | curl -fsS --max-time 20 -K -
}

# The queued jobs for this label, created more than MAX_WAIT seconds ago.
now="$(date -u +%s)"
waiting=0
for status in queued in_progress; do
  # Assigned first, so a failed request stops the script (set -e) instead of
  # reading as "no runs".
  runs="$(get "runs?status=$status&per_page=20")"
  for run in $(jq -r '.workflow_runs[].id' <<< "$runs"); do
    [[ "$run" =~ ^[0-9]+$ ]] || continue
    jobs="$(get "runs/$run/jobs?filter=latest&per_page=100")"
    count="$(jq --arg label "$label" --argjson now "$now" --argjson max "$MAX_WAIT" \
      '[.jobs[] | select(.status == "queued" and (.labels | index($label)) and ($now - (.created_at | fromdateiso8601)) > $max)] | length' <<< "$jobs")"
    waiting=$((waiting + count))
  done
done
if [ "$waiting" -eq 0 ]; then
  say "ok"
  exit 0
fi

last="$(cat "$STAMP" 2>/dev/null || echo 0)"
[[ "$last" =~ ^[0-9]+$ ]] || last=0
if [ $((now - last)) -lt "$COOLDOWN" ]; then
  say "$waiting job(s) for '$label' queued over ${MAX_WAIT}s, restarted less than 10 min ago: waiting"
  exit 0
fi
mkdir -p "$(dirname "$STAMP")"
echo "$now" > "$STAMP"
say "$waiting job(s) for '$label' queued over ${MAX_WAIT}s while idle: restarting $service"
systemctl restart "$service"
