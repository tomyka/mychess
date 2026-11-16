#!/usr/bin/env bash
#
# Shell test of runner-job-started.sh (the production runner's job-started
# hook, #353) and install-runner-hook.sh, with stub id, pgrep and svc.sh and a
# temp directory as the runner's; nothing on the host is touched.
#
#   bash infra/host/tests/runner-hook-test.sh
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

# --- runner-job-started.sh
hook="$here/runner-job-started.sh"
wf=tomyka/mychess/.github/workflows
job() { # repository event ref workflow_ref: runs the hook with that job's env
  env -i PATH="$PATH" GITHUB_REPOSITORY="$1" GITHUB_EVENT_NAME="$2" GITHUB_REF="$3" GITHUB_WORKFLOW_REF="$4" \
    bash "$hook" > "$work/out" 2>&1
}
allowed() { # name repository event ref workflow_ref
  local name="$1"; shift
  job "$@"
  check "allows $name" test "$?" = 0
}
refused() { # name repository event ref workflow_ref
  local name="$1"; shift
  job "$@"
  check "refuses $name" test "$?" = 1
}

allowed "a push of main's ci.yml" tomyka/mychess push refs/heads/main "$wf/ci.yml@refs/heads/main"
check "and says so" grep -qx 'job-started hook: allowed, .github/workflows/ci.yml@refs/heads/main on push' "$work/out"
allowed "ci.yml dispatched on main" tomyka/mychess workflow_dispatch refs/heads/main "$wf/ci.yml@refs/heads/main"
allowed "the deploy button on main" tomyka/mychess workflow_dispatch refs/heads/main "$wf/deploy-production.yml@refs/heads/main"

refused "a fork's pull request editing quality.yml" tomyka/mychess pull_request refs/pull/7/merge "$wf/quality.yml@refs/pull/7/merge"
check "naming the event" grep -q "refused, event 'pull_request'" "$work/out"
refused "pull_request_target" tomyka/mychess pull_request_target refs/heads/main "$wf/ci.yml@refs/heads/main"
refused "a schedule" tomyka/mychess schedule refs/heads/main "$wf/ci.yml@refs/heads/main"
refused "a workflow_run" tomyka/mychess workflow_run refs/heads/main "$wf/ci.yml@refs/heads/main"
refused "a push of a branch" tomyka/mychess push refs/heads/feature "$wf/ci.yml@refs/heads/feature"
check "naming the ref" grep -q "refused, ref 'refs/heads/feature'" "$work/out"
refused "a tag" tomyka/mychess push refs/tags/v1 "$wf/ci.yml@refs/tags/v1"
refused "a ref that only starts with main" tomyka/mychess push refs/heads/main-x "$wf/ci.yml@refs/heads/main-x"
refused "another workflow on main" tomyka/mychess push refs/heads/main "$wf/quality.yml@refs/heads/main"
check "naming the workflow" grep -q "refused, workflow 'tomyka/mychess/.github/workflows/quality.yml@refs/heads/main'" "$work/out"
refused "a new workflow on main" tomyka/mychess push refs/heads/main "$wf/probe.yml@refs/heads/main"
refused "ci.yml from a branch on a main ref" tomyka/mychess push refs/heads/main "$wf/ci.yml@refs/heads/feature"
refused "a reusable workflow of another repository" tomyka/mychess push refs/heads/main "evil/repo/.github/workflows/ci.yml@refs/heads/main"
refused "another repository" evil/mychess push refs/heads/main "evil/mychess/.github/workflows/ci.yml@refs/heads/main"
refused "a repository whose name only contains this one" tomyka/mychess2 push refs/heads/main "tomyka/mychess2/.github/workflows/ci.yml@refs/heads/main"
refused "an empty environment" "" "" "" ""
check "naming the repository first" grep -q "refused, repository ''" "$work/out"
env -i PATH="$PATH" bash "$hook" > /dev/null 2>&1
check "refuses with no GitHub variables at all" test "$?" = 1

# --- install-runner-hook.sh
mkdir "$work/bin"
cat > "$work/bin/id" <<'STUB'
#!/usr/bin/env bash
echo "${STUB_UID:-0}"
STUB
cat > "$work/bin/pgrep" <<'STUB'
#!/usr/bin/env bash
[ -n "${STUB_WORKER:-}" ]
STUB
chmod +x "$work/bin/id" "$work/bin/pgrep"
export PATH="$work/bin:$PATH" MYCHESS_RUNNER_DIR="$work/runner" MYCHESS_HOOK_BIN="$work/hook-bin.sh"
installer="$here/install-runner-hook.sh"
env_file="$work/runner/.env"
reset() {
  rm -rf "$work/runner" "$work/hook-bin.sh" "$work/out"; unset STUB_UID STUB_WORKER
  mkdir "$work/runner"
  printf '{"gitHubUrl": "https://github.com/tomyka/mychess"}\n' > "$work/runner/.runner"
  printf 'LANG=C.UTF-8\nPATH=/usr/bin\n' > "$env_file"
  printf '#!/usr/bin/env bash\necho "$1" >> "%s/svc.calls"\n' "$work/runner" > "$work/runner/svc.sh"
  chmod +x "$work/runner/svc.sh"
}
hook_lines() { grep -c '^ACTIONS_RUNNER_HOOK_JOB_STARTED=' "$env_file"; }

reset
bash "$installer" > "$work/out" 2>&1
check "installs the hook" test "$?" = 0 -a -x "$work/hook-bin.sh"
check "the very script" cmp -s "$hook" "$work/hook-bin.sh"
check "sets it in the runner's .env" grep -qx "ACTIONS_RUNNER_HOOK_JOB_STARTED=$work/hook-bin.sh" "$env_file"
check "keeps the runner's other settings" bash -c 'grep -qx LANG=C.UTF-8 "$1" && grep -qx PATH=/usr/bin "$1"' _ "$env_file"
check "restarts the runner so it reads it" test "$(tr '\n' ' ' < "$work/runner/svc.calls")" = "stop start "

bash "$installer" > /dev/null 2>&1
check "a re-run keeps one hook line" test "$(hook_lines)" = 1 -a "$(wc -l < "$env_file")" = 3

reset
printf 'ACTIONS_RUNNER_HOOK_JOB_STARTED=/tmp/old\n' >> "$env_file"
bash "$installer" --no-restart > /dev/null 2>&1
check "replaces an older hook" test "$?" = 0 -a "$(hook_lines)" = 1
check "pointing at the installed one" grep -qx "ACTIONS_RUNNER_HOOK_JOB_STARTED=$work/hook-bin.sh" "$env_file"
check "--no-restart leaves the runner alone" test ! -e "$work/runner/svc.calls"

reset
printf '#!/bin/sh\n' > "$work/hook-bin"
bash "$installer" --no-restart > "$work/out" 2>&1
check "removes a hook installed before without .sh" test "$?" = 0 -a ! -e "$work/hook-bin" -a -x "$work/hook-bin.sh"
check "and says so" grep -q "removed the hook installed without .sh" "$work/out"
rm -f "$work/hook-bin"
check "the hook is installed with .sh, as the runner picks its shell by extension" \
  grep -qx 'hook="${MYCHESS_HOOK_BIN:-/usr/local/bin/mychess-runner-job-started.sh}"' "$installer"

reset
rm "$env_file"
bash "$installer" --no-restart > /dev/null 2>&1
check "writes a .env the runner lacks" test "$?" = 0 -a "$(cat "$env_file")" = "ACTIONS_RUNNER_HOOK_JOB_STARTED=$work/hook-bin.sh"

reset
STUB_WORKER=1 bash "$installer" > /dev/null 2>&1
check "a job running: refused" test "$?" = 3
check "and nothing changed" bash -c '[ ! -e "$1" ] && [ ! -e "$2/svc.calls" ] && ! grep -q HOOK "$3"' _ "$work/hook-bin.sh" "$work/runner" "$env_file"
STUB_WORKER=1 bash "$installer" --no-restart > /dev/null 2>&1
check "but install-runner.sh's --no-restart goes on" test "$?" = 0 -a "$(hook_lines)" = 1

reset
rm "$work/runner/.runner"
bash "$installer" > /dev/null 2>&1
check "no registered runner: refused" test "$?" = 1 -a ! -e "$work/hook-bin.sh"

reset
STUB_UID=1000 bash "$installer" > /dev/null 2>&1
check "not root: refused" test "$?" = 1 -a ! -e "$work/hook-bin.sh"

reset
bash "$installer" --restart-later > /dev/null 2>&1
check "an unknown option: refused" test "$?" = 2 -a ! -e "$work/hook-bin.sh"

check "install-runner.sh installs the hook" grep -q '^bash "$HERE/install-runner-hook.sh" --no-restart$' "$here/install-runner.sh"

echo
[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
