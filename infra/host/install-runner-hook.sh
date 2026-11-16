#!/usr/bin/env bash
#
# Installs the production runner's job-started hook (runner-job-started.sh,
# #353) on the mychess VM, as root: copies it to
# /usr/local/bin/mychess-runner-job-started.sh (root's, mode 755; the .sh
# tells the runner to run it with bash) and sets
# ACTIONS_RUNNER_HOOK_JOB_STARTED to it in the runner's
# /opt/actions-runner/.env, keeping every other line. Idempotent.
#
#   sudo bash /tmp/mychess-host/install-runner-hook.sh
#
# The runner reads .env when it starts, so this restarts it, but never under
# a job: while a Runner.Worker runs (a deploy) it changes nothing and asks
# for a re-run. install-runner.sh calls it with --no-restart, as it restarts
# the runner itself.
#
# MYCHESS_RUNNER_DIR (default /opt/actions-runner) and MYCHESS_HOOK_BIN
# (default /usr/local/bin/mychess-runner-job-started.sh) are for the shell test
# only.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }

restart=yes
case "${1:-}" in
  "") ;;
  --no-restart) restart=no ;;
  *) echo "usage: install-runner-hook.sh [--no-restart]" >&2; exit 2 ;;
esac

dir="${MYCHESS_RUNNER_DIR:-/opt/actions-runner}"
hook="${MYCHESS_HOOK_BIN:-/usr/local/bin/mychess-runner-job-started.sh}"
here="$(dirname "$0")"
[ -f "$dir/.runner" ] || { echo "no registered runner in $dir: run install-runner.sh" >&2; exit 1; }
if [ "$restart" = yes ] && pgrep -f Runner.Worker >/dev/null; then
  echo "a job is running on the runner: nothing changed; run this again once it is done" >&2
  exit 3
fi

install -m 755 "$here/runner-job-started.sh" "$hook"
# The runner picks a hook's shell by its extension (.sh or .ps1); a copy
# installed before without one is removed.
legacy="${hook%.sh}"
if [ "$legacy" != "$hook" ] && [ -f "$legacy" ]; then
  rm -f "$legacy"
  echo "removed the hook installed without .sh: $legacy"
fi

env_file="$dir/.env"
[ -f "$env_file" ] || install -m 644 /dev/null "$env_file"
# Rewritten in place, so the file keeps its owner and mode.
others="$(grep -v '^ACTIONS_RUNNER_HOOK_JOB_STARTED=' "$env_file" || true)"
{ [ -z "$others" ] || printf '%s\n' "$others"; printf 'ACTIONS_RUNNER_HOOK_JOB_STARTED=%s\n' "$hook"; } > "$env_file"
echo "job-started hook: $hook, set in $env_file"

if [ "$restart" = yes ]; then
  (cd "$dir" && { ./svc.sh stop || true; } && ./svc.sh start >/dev/null)
  echo "runner restarted with the hook"
fi
