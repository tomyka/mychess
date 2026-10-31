#!/usr/bin/env bash
#
# Installs the runner watchdog (runner-watchdog.sh) on the mychess VM, as root,
# and proves the token works first. The token arrives on stdin and is never
# printed, never put in a command line and never written anywhere but
# /etc/mychess/runner-watchdog.env (root, 0600). Run again to renew the token.
#
#   (from the laptop, with the token on the clipboard)
#   scp infra/host/install-runner-watchdog.sh infra/host/runner-watchdog.sh \
#     infra/host/mychess-runner-watchdog.service infra/host/mychess-runner-watchdog.timer mychess:/tmp/
#   powershell -NoProfile -Command "Get-Clipboard" | ssh mychess 'sudo bash /tmp/install-runner-watchdog.sh production'
#
# The token: a fine-grained personal access token for tomyka/mychess only,
# with the repository permission Actions: read (Metadata: read comes with it).
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }

label="${1:?usage: install-runner-watchdog.sh <runner label>}"
[[ "$label" =~ ^[a-z0-9-]+$ ]] || { echo "not a runner label: $label" >&2; exit 2; }
IFS= read -r raw || true
token="$(printf '%s' "$raw" | tr -d '[:space:]')"
unset raw
[[ "$token" =~ ^[A-Za-z0-9_]+$ ]] || { echo "stdin does not hold a GitHub token: nothing changed" >&2; exit 2; }

mapfile -t units < <(systemctl list-units --all --plain --no-legend 'actions.runner.*.service' | awk '{print $1}')
[ "${#units[@]}" -eq 1 ] || { echo "expected one runner unit here, found ${#units[@]}: nothing changed" >&2; exit 3; }

printf 'header = "Authorization: Bearer %s"\nurl = "https://api.github.com/repos/tomyka/mychess/actions/runs?per_page=1"\n' "$token" \
  | curl -fsS --max-time 20 -K - -o /dev/null \
  || { echo "the token cannot read this repository's Actions: nothing changed" >&2; exit 4; }

here="$(dirname "$0")"
install -d -m 700 /etc/mychess
(umask 077; printf 'GITHUB_TOKEN=%s\nRUNNER_LABEL=%s\nRUNNER_SERVICE=%s\n' "$token" "$label" "${units[0]}" \
  > /etc/mychess/runner-watchdog.env)
unset token
install -m 755 "$here/runner-watchdog.sh" /usr/local/bin/mychess-runner-watchdog
install -m 644 "$here/mychess-runner-watchdog.service" "$here/mychess-runner-watchdog.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mychess-runner-watchdog.timer
systemctl start mychess-runner-watchdog.service
journalctl -u mychess-runner-watchdog.service -n 5 --no-pager -o cat | grep 'runner watchdog:' | tail -n 1
