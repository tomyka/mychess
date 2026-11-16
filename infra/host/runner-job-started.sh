#!/usr/bin/env bash
#
# The production runner's job-started hook (#353): the runner runs it before
# every job (ACTIONS_RUNNER_HOOK_JOB_STARTED in /opt/actions-runner/.env,
# written by install-runner-hook.sh; installed as
# /usr/local/bin/mychess-runner-job-started.sh), and a non-zero exit fails the
# job before any of its steps. It accepts only what deploys production:
#
#   GITHUB_REPOSITORY    tomyka/mychess
#   GITHUB_EVENT_NAME    push (ci.yml) or workflow_dispatch (ci.yml, the
#                        deploy button deploy-production.yml)
#   GITHUB_REF           refs/heads/main
#   GITHUB_WORKFLOW_REF  tomyka/mychess/.github/workflows/ci.yml or
#                        deploy-production.yml, at refs/heads/main
#
# So a workflow a pull request starts (a fork can edit quality.yml to ask for
# this runner's label), a branch's copy of ci.yml, or any other workflow is
# refused, whatever its runs-on says. The values are GitHub's own, not
# secrets; a refusal names the one that failed.
set -uo pipefail

repo=tomyka/mychess
main=refs/heads/main
refuse() { echo "job-started hook: refused, $1 (only $repo's main ci.yml and deploy-production.yml run here, #353)" >&2; exit 1; }

[ "${GITHUB_REPOSITORY:-}" = "$repo" ] || refuse "repository '${GITHUB_REPOSITORY:-}'"
case "${GITHUB_EVENT_NAME:-}" in
  push | workflow_dispatch) ;;
  *) refuse "event '${GITHUB_EVENT_NAME:-}'" ;;
esac
[ "${GITHUB_REF:-}" = "$main" ] || refuse "ref '${GITHUB_REF:-}'"
case "${GITHUB_WORKFLOW_REF:-}" in
  "$repo/.github/workflows/ci.yml@$main" | "$repo/.github/workflows/deploy-production.yml@$main") ;;
  *) refuse "workflow '${GITHUB_WORKFLOW_REF:-}'" ;;
esac
echo "job-started hook: allowed, ${GITHUB_WORKFLOW_REF#"$repo/"} on ${GITHUB_EVENT_NAME}"
