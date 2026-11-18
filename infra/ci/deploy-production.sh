#!/usr/bin/env bash
#
# Deploys one release of the app image to production on the mychess VM, as
# root. Run by ci.yml's deploy job once the gate and E2E have passed (R-213),
# by the rollback button (deploy-production.yml), or by hand from a checkout:
#
#   sudo infra/ci/deploy-production.sh [--if-newer] <image tag> [<image archive> <sha256>]
#
# <image tag> is `<40-char commit sha>-arm64`: the image mychess:<tag>. With an
# archive (ci.yml passes the one its image job built and Trivy scanned, and
# its sha256) the image is loaded from it first (release-image.sh); without
# one it must already be here, one of the last few releases kept for a
# rollback. --if-newer (ci.yml) deploys nothing, and exits 0, when production
# already runs this commit or one after it: two pushes' runs can finish out of
# order, and an older commit never replaces a newer one. The button leaves it
# off, since going back to an earlier commit is what it is for.
#
# deployed-tag records the release that runs. Every run holds a lock, so two
# never overlap. A failed web's log stays on the host (/srv/mychess/logs),
# never in the job log, which is public.
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

usage="usage: deploy-production.sh [--if-newer] <image tag> [<image archive> <sha256>]"
if_newer=false
case "${1:-}" in
  --if-newer) if_newer=true; shift ;;
  -*) echo "$usage" >&2; exit 2 ;;
esac
tag_pattern='^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$'
tag="${1:?$usage}"
archive="${2:-}"
archive_sha="${3:-}"
[[ "$tag" =~ $tag_pattern ]] || { echo "not an image tag: $tag" >&2; exit 2; }
[[ -z "$archive" || "$archive_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "an image archive needs its sha256, got: $archive_sha" >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }

root="${MYCHESS_ROOT:-/srv/mychess}"
state="$root/production"
[ -d "$state" ] || { echo "$state is missing: run infra/host/bootstrap.sh" >&2; exit 1; }
# One deploy at a time, whoever starts it (the VM's one runner already runs
# one job at a time; a deploy by hand is the other).
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

# Read under the lock: no other deploy can move production meanwhile.
previous="$(state_tag deployed-tag)"
if [ "$if_newer" = true ] && [ -n "$previous" ] && tag_holds "$previous" "$tag"; then
  echo "production runs $previous, which already holds $tag: not deployed"
  exit 0
fi

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
# Best effort: the release is live whatever pruning does.
prune_releases "$tag" "$previous" || echo "warning: old release images not pruned" >&2
echo "production: $tag on $APP_DOMAIN"
