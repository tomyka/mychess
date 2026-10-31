#!/usr/bin/env bash
#
# Installs and registers the self-hosted GitHub Actions runner on the mychess
# VM: the one runner of tomyka/mychess, label `production`, which only ci.yml's
# deploy job and the deploy button use (R-165). The one-hour, single-use
# registration token arrives on stdin, never a file:
#
#   gh api -X POST repos/tomyka/mychess/actions/runners/registration-token --jq .token \
#     | ssh mychess 'sudo bash /tmp/mychess-host/install-runner.sh <version> <sha256>'
#
# <sha256> is the one GitHub publishes for actions-runner-linux-arm64-<version>.tar.gz.
#
# The deploy runs `sudo -n infra/ci/deploy-production.sh` from the runner's
# checkout, so a sudoers rule lets the `runner` user run exactly that path as
# root. The runner user is in the docker group and owns that checkout, so it
# is root-equivalent on this host anyway: accepted because only a push to this
# repository or a dispatch can start a job here (ci.yml has no pull_request
# trigger), and only main deploys.
#
# Idempotent: a runner already registered to tomyka/mychess stays registered;
# one registered to any other repository (sportbet's, before the clean-up) is
# refused.
set -euo pipefail

VERSION="${1:?runner version, e.g. 2.330.0}"
SHA256="${2:?sha256 of actions-runner-linux-arm64-VERSION.tar.gz}"
NAME=mychess
LABEL=production
REPO_URL=https://github.com/tomyka/mychess
DIR=/opt/actions-runner
DEPLOY_SCRIPT="$DIR/_work/mychess/mychess/infra/ci/deploy-production.sh"
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
IFS= read -r TOKEN || true

id runner >/dev/null 2>&1 || { echo "run bootstrap.sh first (no runner user)" >&2; exit 1; }
if [ -f "$DIR/.runner" ] && ! grep -q "\"gitHubUrl\": *\"$REPO_URL\"" "$DIR/.runner"; then
  echo "$DIR holds a runner of another repository: remove it first (docs/operations.md)" >&2
  exit 1
fi
install -d -o runner -g runner "$DIR"
if [ "$(cat "$DIR/.installed-version" 2>/dev/null || true)" != "$VERSION" ]; then
  # A running service holds the old binary open; stop it before overwriting.
  if [ -f "$DIR/svc.sh" ]; then "$DIR/svc.sh" stop || true; fi
  tarball="actions-runner-linux-arm64-$VERSION.tar.gz"
  curl -fsSL -o "/tmp/$tarball" "https://github.com/actions/runner/releases/download/v$VERSION/$tarball"
  echo "$SHA256  /tmp/$tarball" | sha256sum -c -
  sudo -u runner tar xzf "/tmp/$tarball" -C "$DIR"
  rm -f "/tmp/$tarball"
  echo "$VERSION" > "$DIR/.installed-version"
fi
"$DIR/bin/installdependencies.sh" >/dev/null

if [ -f "$DIR/.runner" ]; then
  echo "already registered - leaving it."
else
  [ -n "${TOKEN:-}" ] || { echo "no registration token on stdin" >&2; exit 1; }
  cd "$DIR"
  sudo -u runner ./config.sh --unattended --url "$REPO_URL" \
    --token "$TOKEN" --name "$NAME" --labels "$LABEL" --work _work --replace
fi
unset TOKEN

sudoers=/etc/sudoers.d/mychess-deploy
tmp="$(mktemp)"
printf 'runner ALL=(root) NOPASSWD: %s\n' "$DEPLOY_SCRIPT" > "$tmp"
visudo -cf "$tmp" >/dev/null
install -m 440 "$tmp" "$sudoers"
rm -f "$tmp"

cd "$DIR"
# svc.sh status exits non-zero whenever the service isn't currently running,
# registered or not, so it cannot tell us whether to install; the unit file
# itself is the install marker.
compgen -G "/etc/systemd/system/actions.runner.*.$NAME.service" >/dev/null || ./svc.sh install runner
./svc.sh stop || true
./svc.sh start
./svc.sh status
