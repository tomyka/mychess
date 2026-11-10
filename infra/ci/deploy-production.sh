#!/usr/bin/env bash
#
# Deploys one release of the app image to production on the mychess VM, as
# root. Run by ci.yml's production jobs, by the rollback button
# (deploy-production.yml), or by hand from a checkout:
#
#   sudo infra/ci/deploy-production.sh <image tag> [<image archive> <sha256>]
#   sudo infra/ci/deploy-production.sh --on-trial <image tag> <image archive> <sha256>
#   sudo infra/ci/deploy-production.sh --confirm <image tag>
#   sudo infra/ci/deploy-production.sh --roll-back <failed image tag>
#   sudo infra/ci/deploy-production.sh --restore
#
# <image tag> is `<40-char commit sha>-arm64`: the image mychess:<tag>. With an
# archive (ci.yml passes the one its image job built and Trivy scanned, and
# its sha256) the image is loaded from it first (release-image.sh); without
# one it must already be here, one of the last few releases kept for a
# rollback.
#
# Two files record the state: deployed-tag (the release that runs) and
# confirmed-tag (the newest release known to have passed check and e2e: the
# one ci.yml's automatic rollback goes back to, R-192). A plain deploy
# records its tag in both: the gated deploy, the rollback button and an
# automatic rollback only deploy releases that passed. --on-trial (ci.yml's
# deploy right after the image, while check and e2e still run) records only
# deployed-tag; with no confirmed-tag yet, the release it replaces is taken
# as confirmed (it was deployed the gated way). --confirm records a release
# that has since passed as confirmed-tag, once its image is here, and
# deploys nothing (exit 3 when that image was pruned meanwhile: newer
# releases were deployed since), and refuses a release that does not hold
# the confirmed one. --roll-back, while production still runs the failed
# tag, deploys confirmed-tag (exit 0 doing nothing when production has moved
# on). --restore redeploys deployed-tag, confirmed-tag untouched (a trial
# deploy cut short). Both read the tags under the lock, which every run
# holds, so two never overlap. A failed web's log stays on the host
# (/srv/mychess/logs), never in the job log, which is public.
#
# The site's name is the host of BETTER_AUTH_URL in
# /srv/mychess/production/.env (infra/host/production-env.sh writes it): the
# one place the domain is set. Copies the Compose and Caddy files to
# /srv/mychess (so the running stack never depends on this checkout), updates
# Caddy, migrates and replaces the web container; a pg_dump restore point is
# taken first (predeploy-backup.sh; a failed dump stops the deploy before it
# migrates). If the new web never turns healthy, or then fails verification
# (verify-release.sh: the commit it reports and the main pages, through the
# edge), the previous release's web is put back and the script fails.
#
# MYCHESS_ROOT (default /srv/mychess) is for the shell test only.
set -euo pipefail

usage="usage: deploy-production.sh [--on-trial | --confirm | --roll-back] <image tag> [<image archive> <sha256>] | --restore"
mode=confirmed
case "${1:-}" in
  --on-trial) mode=on-trial; shift ;;
  --confirm) mode=confirm; shift ;;
  --roll-back) mode=roll-back; shift ;;
  --restore) mode=restore; shift ;;
  -*) echo "$usage" >&2; exit 2 ;;
esac
tag_pattern='^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$'
if [ "$mode" = restore ]; then
  # The tag comes from deployed-tag, read under the lock.
  [ "$#" -eq 0 ] || { echo "--restore takes no arguments: $usage" >&2; exit 2; }
  tag="" archive="" archive_sha=""
else
  tag="${1:?$usage}"
  archive="${2:-}"
  archive_sha="${3:-}"
  [[ "$tag" =~ $tag_pattern ]] || { echo "not an image tag: $tag" >&2; exit 2; }
fi
[[ -z "$archive" || "$archive_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "an image archive needs its sha256, got: $archive_sha" >&2; exit 2; }
[[ "$mode" != on-trial || -n "$archive" ]] || { echo "--on-trial deploys from the build's archive: $usage" >&2; exit 2; }
[[ "$mode" != confirm && "$mode" != roll-back || -z "$archive" ]] || { echo "--$mode takes only a tag: $usage" >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }

root="${MYCHESS_ROOT:-/srv/mychess}"
state="$root/production"
[ -d "$state" ] || { echo "$state is missing: run infra/host/bootstrap.sh" >&2; exit 1; }
# One deploy, confirmation or rollback at a time, whoever starts it (the VM's
# one runner already runs one job at a time; a deploy by hand is the other).
exec 9> "$state/.deploy.lock"
flock -w 900 9 || { echo "another deploy still holds $state/.deploy.lock" >&2; exit 1; }
infra="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=infra/ci/verify-release.sh
source "$(dirname "$0")/verify-release.sh"
# shellcheck source=infra/ci/predeploy-backup.sh
source "$(dirname "$0")/predeploy-backup.sh"
# shellcheck source=infra/ci/release-image.sh
source "$(dirname "$0")/release-image.sh"

state_tag() { # state file -> its tag, or nothing
  cat "$state/$1" 2>/dev/null || true
}

# Whether the first tag's commit holds the second's, in the checkout's history
# (root runs git on the runner's checkout: safe.directory says it is meant).
# RELEASE_REPO is for the shell test only.
tag_holds() { # newer tag, older tag
  local repo="${RELEASE_REPO:-$infra/..}"
  [[ "$1" =~ ^([0-9a-f]{40})-arm64$ ]] || return 1
  local newer="${BASH_REMATCH[1]}"
  [[ "$2" =~ ^([0-9a-f]{40})-arm64$ ]] || return 1
  GIT_NO_LAZY_FETCH=1 git -c safe.directory="$repo" -C "$repo" merge-base --is-ancestor "${BASH_REMATCH[1]}" "$newer" 2>/dev/null
}

case "$mode" in
  confirm)
    # The automatic rollback deploys this tag with no archive: its image must be here.
    docker image inspect "$RELEASE_IMAGE:$tag" >/dev/null 2>&1 \
      || { echo "$RELEASE_IMAGE:$tag is not on this host any more: not confirmed" >&2; exit 3; }
    # Never backwards, never off main's line (a force-push): the button can.
    before="$(state_tag confirmed-tag)"
    if [ -n "$before" ] && [ "$before" != "$tag" ] && ! tag_holds "$tag" "$before"; then
      echo "$tag does not hold $before, the confirmed release: not confirmed (the deploy button can)" >&2
      exit 1
    fi
    echo "$tag" > "$state/confirmed-tag"
    echo "production: $tag confirmed (check and e2e passed)"
    exit 0
    ;;
  roll-back)
    # Re-read here, under the lock: production may have moved on meanwhile.
    running="$(state_tag deployed-tag)"
    if [ "$running" != "$tag" ]; then
      echo "production runs ${running:-nothing on record}, not $tag: nothing to roll back"
      exit 0
    fi
    target="$(state_tag confirmed-tag)"
    if [ -z "$target" ] || [ "$target" = "$tag" ]; then
      echo "no confirmed release before $tag to roll back to: use the deploy button" >&2
      exit 1
    fi
    echo "rolling back from $tag to $target"
    tag="$target" mode=confirmed
    ;;
  restore)
    tag="$(state_tag deployed-tag)"
    [ -n "$tag" ] || { echo "no deployed-tag: nothing to restore" >&2; exit 1; }
    echo "restoring $tag, the release on record"
    mode=on-trial
    ;;
esac
# A tag read from the state files is checked like one given as an argument.
[[ "$tag" =~ $tag_pattern ]] || { echo "not an image tag: $tag" >&2; exit 1; }

env_file="$state/.env"
[ -f "$env_file" ] || { echo "$env_file is missing: run infra/host/production-env.sh" >&2; exit 1; }
app_url="$(sed -n 's/^BETTER_AUTH_URL=//p' "$env_file" | head -n 1 | tr -d '\r')"
[[ "$app_url" =~ ^https://([a-z0-9.-]+)$ ]] || { echo "BETTER_AUTH_URL in $env_file is not an https origin: ${app_url:-unset}" >&2; exit 1; }
export APP_DOMAIN="${BASH_REMATCH[1]}" VERIFY_HOST="${BASH_REMATCH[1]}"
export BACKUP_DIR="${BACKUP_DIR:-$root/backups}"
# First of all: a release whose image cannot be had changes nothing here.
load_image "$tag" "$archive" "$archive_sha" || exit 1

install -d "$root/production" "$root/edge/caddy"
cp "$infra/compose/app.yml" "$infra/compose/production.yml" "$root/production/"
cp "$infra/edge/edge.yml" "$root/edge/"
cp "$infra/edge/caddy/Caddyfile" "$root/edge/caddy/Caddyfile"

docker network inspect edge >/dev/null 2>&1 || docker network create edge >/dev/null
edge=(docker compose -p mychess-edge -f "$root/edge/edge.yml")
"${edge[@]}" up -d --wait
"${edge[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile

production() {
  local release="$1"; shift
  APP_IMAGE="$RELEASE_IMAGE:$release" \
    docker compose -p mychess-production --env-file "$env_file" \
    -f "$root/production/app.yml" -f "$root/production/production.yml" "$@"
}

previous="$(state_tag deployed-tag)"
confirmed="$(state_tag confirmed-tag)"
if [ "$mode" = on-trial ] && [ -z "$confirmed" ] && [ -n "$previous" ]; then
  confirmed="$previous"
  echo "$confirmed" > "$state/confirmed-tag"
fi

production "$tag" up -d --wait postgres
predeploy_backup "$tag" || exit 1
production "$tag" run --rm migrate
# A failed web's log can name users (an error can carry a query's
# parameters), and the job log is public: it stays on the host, root only,
# and the job log gets its path. Only the newest 20 are kept.
keep_web_log() { # tag
  local dir="$root/logs" file
  file="$dir/web-${1:0:12}-$(date -u +%Y%m%dT%H%M%SZ).log"
  install -d -m 700 "$dir"
  (umask 077; production "$1" logs --tail 200 web > "$file" 2>&1) || true
  echo "web log kept on the host: $file" >&2
  find "$dir" -maxdepth 1 -name 'web-*.log' -printf '%T@ %p\n' \
    | sort -rn | awk 'NR > 20 { print $2 }' | xargs -r rm -f
}
roll_back() {
  if [ -n "$previous" ]; then
    production "$previous" up -d --wait web
    echo "production web rolled back to $previous" >&2
  fi
}

if ! production "$tag" up -d --wait web; then
  echo "web $tag did not turn healthy" >&2
  keep_web_log "$tag"
  roll_back
  exit 1
fi
# Healthy is not working: prove the site through the edge, and that it is the
# commit just deployed (verify-release.sh); if not, put the previous web back.
if ! verify_release "$tag"; then
  echo "web $tag failed verification" >&2
  keep_web_log "$tag"
  roll_back
  exit 1
fi
echo "$tag" > "$state/deployed-tag"
if [ "$mode" = confirmed ]; then
  confirmed="$tag"
  echo "$tag" > "$state/confirmed-tag"
fi
# Best effort: the release is live whatever pruning does. The confirmed
# release is the automatic rollback's target, so its image stays too.
prune_releases "$tag" "$previous" "$confirmed" || echo "warning: old release images not pruned" >&2
echo "production: $tag on $APP_DOMAIN ($mode)"
