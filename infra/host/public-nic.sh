#!/usr/bin/env bash
#
# Makes the public network card of the mychess VM answer the connections that
# arrive on it, as root. Idempotent. The VM's primary card is private; its
# public address (the spec's 129.151.205.113) belongs to a second VNIC on the
# public subnet. The values below are that VNIC's, from the OCI console (or
# `ip addr` / `ip -6 route` on the host):
#
#   sudo bash public-nic.sh <interface> <ipv4> <ipv4 gateway> [<ipv6> <ipv6 gateway>]
#   sudo bash public-nic.sh enp1s0 10.0.0.233 10.0.0.1 2603:c026:301:3100:0:432e:8ecb:4fd1 fe80::200:17ff:feed:3597
#
# The card's MAC is read from the host (/sys/class/net/<interface>/address),
# not written here.
#
# Why: a reply from a container (Docker NAT) is routed by the main table, which
# leaves through the private card with the public card's address, and the VCN
# drops it. So a connection that came in on the public card is marked on the
# way in, its replies carry the mark back (restore-mark), and the mark selects
# routing table 100, whose only route is the public subnet's gateway (the rule
# is added by the boot unit, not netplan, which has no mark-only policy).
# Nothing else changes: the private card keeps the main table.
#
# Learned on sportbet_new (whose public-nic.sh this is, renamed): the same
# routing was installed on this host as sportbet-public-nic; those units are
# replaced by these. public-nic-keep.sh keeps the rules alive afterwards.
#
# Undo: ip rule del fwmark 100 table 100; the two mangle rules; then
#   systemctl disable --now mychess-public-nic; rm /etc/systemd/system/mychess-public-nic.service /usr/local/sbin/mychess-public-nic
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }

usage="usage: public-nic.sh <interface> <ipv4> <ipv4 gateway> [<ipv6> <ipv6 gateway>]"
iface="${1:?$usage}"
ipv4="${2:?$usage}"
gw4="${3:?$usage}"
ipv6="${4:-}"
gw6="${5:-}"
[[ "$iface" =~ ^[a-z0-9]+$ ]] || { echo "not an interface name: $iface" >&2; exit 2; }
[[ "$ipv4" =~ ^[0-9.]+$ && "$gw4" =~ ^[0-9.]+$ ]] || { echo "not IPv4 addresses: $ipv4 $gw4" >&2; exit 2; }
[[ -z "$ipv6" || ( "$ipv6" =~ ^[0-9a-f:]+$ && "$gw6" =~ ^[0-9a-f:]+$ ) ]] || { echo "not IPv6 addresses: $ipv6 $gw6" >&2; exit 2; }
mac="$(cat "/sys/class/net/$iface/address" 2>/dev/null || true)"
[[ "$mac" =~ ^[0-9a-f:]{17}$ ]] || { echo "no network card $iface on this host" >&2; exit 1; }

{
  cat <<EOF
network:
  version: 2
  ethernets:
    $iface:
      match:
        macaddress: "$mac"
      set-name: "$iface"
      dhcp4: false
      dhcp6: false
      accept-ra: false
      addresses:
        - $ipv4/32
EOF
  [ -z "$ipv6" ] || echo "        - $ipv6/128"
  cat <<EOF
      routes:
        - to: 0.0.0.0/0
          via: $gw4
          on-link: true
          table: 100
EOF
  [ -z "$ipv6" ] || cat <<EOF
        - to: ::/0
          via: $gw6
          on-link: true
          table: 100
EOF
  cat <<EOF
      routing-policy:
        - from: $ipv4/32
          table: 100
          priority: 100
EOF
  [ -z "$ipv6" ] || cat <<EOF
        - from: $ipv6/128
          table: 100
          priority: 100
EOF
} > /etc/netplan/60-public-nic.yaml
chmod 600 /etc/netplan/60-public-nic.yaml

cat > /usr/local/sbin/mychess-public-nic <<EOF
#!/bin/sh
# Mark connections that arrive on the public card; restore the mark on their replies.
iptables -t mangle -C PREROUTING -i $iface -m conntrack --ctstate NEW -j CONNMARK --set-mark 100 2>/dev/null \\
  || iptables -t mangle -A PREROUTING -i $iface -m conntrack --ctstate NEW -j CONNMARK --set-mark 100
iptables -t mangle -C PREROUTING -j CONNMARK --restore-mark 2>/dev/null \\
  || iptables -t mangle -A PREROUTING -j CONNMARK --restore-mark
# Traffic for Docker's own networks (a marked connection redirected to a container)
# keeps the main table, ahead of the mark rule below.
ip rule show | grep -q 'to 172.16.0.0/12 lookup main' || ip rule add to 172.16.0.0/12 table main priority 80
# The mark selects the public card's routing table (netplan has no mark-only policy).
ip rule show | grep -q 'fwmark 0x64 lookup 100' || ip rule add fwmark 100 table 100 priority 90
EOF
chmod 755 /usr/local/sbin/mychess-public-nic

cat > /etc/systemd/system/mychess-public-nic.service <<'EOF'
[Unit]
Description=Reply routing for the public network card
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/mychess-public-nic

[Install]
WantedBy=multi-user.target
EOF

# sportbet's copy of the same routing, if this host still has it: ours replaces it.
if [ -f /etc/systemd/system/sportbet-public-nic.service ]; then
  systemctl disable sportbet-public-nic.service || true
  rm -f /etc/systemd/system/sportbet-public-nic.service /usr/local/sbin/sportbet-public-nic
fi

systemctl daemon-reload
systemctl enable mychess-public-nic.service
netplan apply
# After netplan: it drops routing rules it does not own.
systemctl restart mychess-public-nic.service
sleep 4
ip rule | head -5
iptables -t mangle -S PREROUTING
