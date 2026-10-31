#!/usr/bin/env bash
#
# One-time baseline for the mychess production VM (Oracle A1, Ubuntu 24.04
# arm64; ADR 0010). Idempotent: run it again after any edit. From the laptop:
#
#   scp -r infra/host mychess:/tmp/mychess-host
#   ssh mychess 'sudo bash /tmp/mychess-host/bootstrap.sh'
#
# Production only: no build or test runs here (those are GitHub-hosted), so
# no Node and no browser libraries. Installs Docker, the runner user, the
# directories, the host firewall's 80/443, and the timers: docker prune
# (enabled), the rate-limit prune (enabled once the production .env exists),
# the nightly backup (enabled once /etc/mychess/backup.env exists,
# set-backup-par.sh) and its morning watch (once /etc/mychess/alert.env
# exists, set-alert-email.sh). The runner and its watchdog have their own
# scripts (install-runner.sh, install-runner-watchdog.sh).
#
# Oracle-specific (learned on sportbet_new): the Ubuntu image ships iptables
# REJECT rules in /etc/iptables/rules.v4 beneath the VCN security list, so 80
# and 443 are opened there too - live and in the boot file, never with
# `netfilter-persistent save` (that would snapshot Docker's chains).
#
# Run this inside tmux or with nohup: apt-get upgrade can drop the SSH session
# partway through (a restarted sshd), and a dropped foreground shell would
# leave the script half-run.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
say() { printf '\n==> %s\n' "$*"; }
export DEBIAN_FRONTEND=noninteractive

say "Packages"
apt-get update -q
# force-confdef/confold: keep the admin's (our) config for any package whose
# maintainer shipped a changed default, instead of prompting - there is no
# terminal to prompt on a non-interactive run.
apt-get upgrade -yq -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold
echo 'iptables-persistent iptables-persistent/autosave_v4 boolean false' | debconf-set-selections
echo 'iptables-persistent iptables-persistent/autosave_v6 boolean false' | debconf-set-selections
apt-get install -yq ca-certificates curl gnupg jq zstd unattended-upgrades netfilter-persistent iptables-persistent

say "Automatic security updates"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF

say "Time: UTC"
timedatectl set-timezone UTC
systemctl enable --now systemd-timesyncd >/dev/null

say "Host name: mychess"
hostnamectl set-hostname mychess
# cloud-init would set the instance's console name back on the next boot.
printf 'preserve_hostname: true\n' > /etc/cloud/cloud.cfg.d/99-mychess-hostname.cfg
grep -q '^127.0.1.1 mychess$' /etc/hosts || echo '127.0.1.1 mychess' >> /etc/hosts

say "Swap (2 GB)"
if ! swapon --show | grep -q '/swapfile'; then
  [ -f /swapfile ] || { fallocate -l 2G /swapfile; chmod 600 /swapfile; mkswap /swapfile >/dev/null; }
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab

say "SSH: keys only, no root login"
cat > /etc/ssh/sshd_config.d/10-mychess.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
CONF
sshd -t
systemctl reload ssh

say "Docker Engine + Compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck source=/dev/null # /etc/os-release only exists on the target host, not in lint
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
DAEMON_JSON='{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}'
if [ "$(cat /etc/docker/daemon.json 2>/dev/null || true)" != "$DAEMON_JSON" ]; then
  printf '%s\n' "$DAEMON_JSON" > /etc/docker/daemon.json
  systemctl restart docker
fi
systemctl enable --now docker >/dev/null

say "runner user, /srv/mychess, /etc/mychess and the edge network"
id runner >/dev/null 2>&1 || useradd --create-home --shell /bin/bash runner
usermod -aG docker runner
install -d -m 755 /srv/mychess /srv/mychess/production /srv/mychess/edge
install -d -m 700 /srv/mychess/backups /etc/mychess
docker network inspect edge >/dev/null 2>&1 || docker network create edge >/dev/null

say "Host firewall: 80 and 443, IPv4 and IPv6"
open_port() {
  local tool="$1" file="$2" port="$3"
  local rule="-p tcp -m state --state NEW -m tcp --dport $port -j ACCEPT"
  # shellcheck disable=SC2086 # $rule is a deliberately word-split argument list for iptables
  if ! $tool -C INPUT $rule 2>/dev/null; then
    local at
    at=$($tool -L INPUT --line-numbers -n | awk '$2 == "REJECT" { print $1; exit }')
    # shellcheck disable=SC2086 # $rule is a deliberately word-split argument list for iptables
    if [ -n "$at" ]; then $tool -I INPUT "$at" $rule; else $tool -A INPUT $rule; fi
  fi
  if [ -f "$file" ] && ! grep -qF -- "-A INPUT $rule" "$file"; then
    awk -v line="-A INPUT $rule" '!done && /^-A INPUT .*-j REJECT/ { print line; done = 1 } { print }' \
      "$file" > "$file.new" && mv "$file.new" "$file"
  fi
}
for port in 80 443; do
  open_port iptables /etc/iptables/rules.v4 "$port"
  open_port ip6tables /etc/iptables/rules.v6 "$port"
done

say "Timers: docker prune, rate-limit prune, nightly backup with its alert and morning watch"
install -m 755 "$here/backup-production.sh" /usr/local/bin/mychess-production-backup
install -m 755 "$here/backup-alert.sh" /usr/local/bin/mychess-backup-alert
install -m 755 "$here/backup-watch.sh" /usr/local/bin/mychess-backup-watch
install -m 755 "$here/rate-limit-prune.sh" /usr/local/bin/mychess-rate-limit-prune
install -m 644 "$here/docker-prune.service" "$here/docker-prune.timer" \
  "$here/mychess-production-backup.service" "$here/mychess-production-backup.timer" \
  "$here/mychess-backup-alert@.service" "$here/mychess-backup-watch.service" "$here/mychess-backup-watch.timer" \
  "$here/mychess-rate-limit-prune.service" "$here/mychess-rate-limit-prune.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now docker-prune.timer
enable_when() { # file timer reason
  if [ -f "$1" ]; then
    systemctl enable --now "$2"
  else
    echo "no $1 yet: $2 stays off ($3)"
  fi
}
enable_when /srv/mychess/production/.env mychess-rate-limit-prune.timer "production-env.sh, then this again"
enable_when /etc/mychess/backup.env mychess-production-backup.timer "set-backup-par.sh enables it"
enable_when /etc/mychess/alert.env mychess-backup-watch.timer "set-alert-email.sh enables it"

say "Done"
docker --version; docker compose version; zstd --version
