#!/usr/bin/env bash
#
# Sourced by ci.yml's production jobs on the VM (and by
# infra/ci/tests/release-decision-test.sh): what one push to main may do to
# production (R-192), decided from the host's state files (deploy-production.sh
# writes them) and main's history. It only reads; ci.yml acts on the answer.
# Run it from a full-history checkout; the VM's one runner runs one job at a
# time, so the state cannot change between this answer and the act on it.
#
#   newer_than_production <sha>   0 unless production already runs <sha> or a
#                                 commit after it
#   deploy_plan <sha>             prints what the deploy right after the image
#                                 does: `deploy` (on trial, before check and
#                                 e2e), `hold` (deploy only once check and e2e
#                                 pass: a migration, the deploy scripts, the
#                                 compose or the Caddy files changed since the
#                                 release that runs, or no known release runs)
#                                 or `skip` (production runs this commit or a
#                                 newer one)
#   verdict <sha> <plan> <deploy> <check> <e2e>
#                                 once the deploy job (its plan, empty when
#                                 lost, and result), check and e2e are over,
#                                 prints `confirm <sha>`, `roll-back
#                                 <confirmed sha>`, `restore <deployed sha>`
#                                 (the trial deploy did not finish: put back
#                                 the release on record; never when this
#                                 commit changes a gated path, since a restore
#                                 runs its deploy script as root),
#                                 `stranded <reason>` (no release to go back
#                                 to) or `keep <reason>`
#
# Reasons for `skip` and `hold` go to stderr, for the job's log.
# MYCHESS_ROOT (default /srv/mychess) is for the shell test only.

# A change to any of these since the release that runs is deployed only once
# check and e2e pass: no untested schema change, deploy script, compose or
# Caddy file, nor this workflow (the verdict and rollback logic), reaches
# production, so a trial never changes them and an automatic rollback (which
# runs the trial commit's own deploy script and copies its compose and Caddy
# files) puts back exactly what ran before.
GATED_PATHS=(packages/db/migrations infra/ci infra/compose infra/edge .github/workflows/ci.yml)

gated_change() { # from, to: whether a gated path differs (or cannot be told)
  ! git diff --quiet --no-renames "$1" "$2" -- "${GATED_PATHS[@]}" 2>/dev/null
}

release_sha() { # state file -> its commit, or nothing
  local tag
  tag="$(cat "${MYCHESS_ROOT:-/srv/mychess}/production/$1" 2>/dev/null || true)"
  if [[ "$tag" =~ ^([0-9a-f]{40})-arm64$ ]]; then printf '%s' "${BASH_REMATCH[1]}"; fi
}

holds() { # commit, commit: whether the first's history holds the second
  [ -n "$1" ] && [ -n "$2" ] && git merge-base --is-ancestor "$2" "$1" 2>/dev/null
}

newer_than_production() { # sha
  local deployed
  deployed="$(release_sha deployed-tag)"
  if holds "$deployed" "$1"; then
    echo "production runs $deployed, which already holds $1" >&2
    return 1
  fi
}

deploy_plan() { # sha
  local sha="$1" deployed
  deployed="$(release_sha deployed-tag)"
  if ! newer_than_production "$sha"; then
    echo skip
  elif [ -z "$deployed" ] || ! git cat-file -e "$deployed^{commit}" 2>/dev/null; then
    echo "no known release runs (${deployed:-no deployed-tag}): deployed once check and e2e pass" >&2
    echo hold
  elif gated_change "$deployed" "$sha"; then
    echo "changed since $deployed, so deployed once check and e2e pass:" >&2
    git diff --name-only --no-renames "$deployed" "$sha" -- "${GATED_PATHS[@]}" >&2
    echo hold
  else
    echo deploy
  fi
}

verdict() { # sha, plan (empty: lost), deploy result, check result, e2e result
  local sha="$1" plan="$2" deploy="$3" check="$4" e2e="$5" deployed confirmed
  deployed="$(release_sha deployed-tag)"
  confirmed="$(release_sha confirmed-tag)"
  if [ -n "$plan" ] && [ "$plan" != deploy ]; then
    echo "keep the plan was $plan: no trial deploy to judge"
  # A trial deploy cut short before it recorded itself (cancelled, timed out,
  # failed) may have left its web half swapped: put back the release on record,
  # unless a newer push's deploy has run since.
  elif [ "$deploy" != success ] && [ "$deployed" != "$sha" ]; then
    if [ -z "$deployed" ]; then
      echo "stranded the trial deploy of $sha did not finish and no release is on record: use the deploy button"
    elif holds "$deployed" "$sha"; then
      echo "keep production runs $deployed, deployed after $sha"
    elif gated_change "$deployed" "$sha"; then
      echo "stranded $sha changes gated files since $deployed, so its deploy script is not run untested: redeploy $deployed with the deploy button"
    else
      echo "restore $deployed"
    fi
  elif [ "$check" = success ] && [ "$e2e" = success ]; then
    if ! holds "$deployed" "$sha"; then
      echo "keep production runs ${deployed:-no known release}, not $sha or a commit after it"
    elif [ -n "$confirmed" ] && ! { [ "$confirmed" != "$sha" ] && holds "$sha" "$confirmed"; }; then
      echo "keep the confirmed release $confirmed is $sha, newer, or off its line"
    else
      echo "confirm $sha"
    fi
  elif [ "$deployed" != "$sha" ]; then
    echo "keep production runs ${deployed:-no known release}, not $sha: a newer push's run (or an earlier rollback) decides"
  elif [ -z "$confirmed" ] || [ "$confirmed" = "$sha" ]; then
    echo "stranded no confirmed release before $sha to go back to"
  else
    echo "roll-back $confirmed"
  fi
}
