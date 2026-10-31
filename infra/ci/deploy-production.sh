#!/usr/bin/env bash
#
# Deploys one release of the app image to production on the mychess VM, as
# root. Run by ci.yml's deploy job after every green push to main, by the
# rollback button (deploy-production.yml), or by hand from a checkout:
#
#   sudo infra/ci/deploy-production.sh <image tag> [<image archive> <sha256>]
#
# <image tag> is `<40-char commit sha>-arm64`: the image mychess:<tag>. With an
# archive (ci.yml passes the one its image job built and e2e tested, and its
# sha256) the image is loaded from it first (release-image.sh); without one it
# must already be here, one of the last few releases kept for a rollback.
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

tag="${1:?usage: deploy-production.sh <image tag> [<image archive> <sha256>]}"
archive="${2:-}"
archive_sha="${3:-}"
[[ "$tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || { echo "not an image tag: $tag" >&2; exit 2; }
[[ -z "$archive" || "$archive_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "an image archive needs its sha256, got: $archive_sha" >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }

root="${MYCHESS_ROOT:-/srv/mychess}"
infra="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=infra/ci/verify-release.sh
source "$(dirname "$0")/verify-release.sh"
# shellcheck source=infra/ci/predeploy-backup.sh
source "$(dirname "$0")/predeploy-backup.sh"
# shellcheck source=infra/ci/release-image.sh
source "$(dirname "$0")/release-image.sh"
env_file="$root/production/.env"
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

previous="$(cat "$root/production/deployed-tag" 2>/dev/null || true)"

production "$tag" up -d --wait postgres
predeploy_backup "$tag" || exit 1
production "$tag" run --rm migrate
roll_back() {
  if [ -n "$previous" ]; then
    production "$previous" up -d --wait web
    echo "production web rolled back to $previous" >&2
  fi
}

if ! production "$tag" up -d --wait web; then
  echo "web $tag did not turn healthy" >&2
  production "$tag" logs --tail 100 web || true
  roll_back
  exit 1
fi
# Healthy is not working: prove the site through the edge, and that it is the
# commit just deployed (verify-release.sh); if not, put the previous web back.
if ! verify_release "$tag"; then
  echo "web $tag failed verification" >&2
  production "$tag" logs --tail 100 web || true
  roll_back
  exit 1
fi
echo "$tag" > "$root/production/deployed-tag"
# Best effort: the release is live whatever pruning does.
prune_releases "$tag" "$previous" || echo "warning: old release images not pruned" >&2
echo "production: $tag on $APP_DOMAIN"
