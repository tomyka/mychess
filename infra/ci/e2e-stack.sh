#!/usr/bin/env bash
#
# A throwaway application stack for CI's e2e job, from the release image
# (infra/compose/app.yml + e2e.yml).
#
#   APP_IMAGE=mychess:<tag> infra/ci/e2e-stack.sh up <project>   # prints the base URL
#   infra/ci/e2e-stack.sh mailpit <project>                      # prints Mailpit's API URL
#   infra/ci/e2e-stack.sh database <project>                     # prints the DATABASE_URL
#   infra/ci/e2e-stack.sh down <project>
#
# `up` migrates an empty database, as the e2e job always has: the tests make
# their own accounts and data, so nothing is seeded. The web port is
# E2E_WEB_PORT (default 3100; e2e.yml says why it is fixed).
set -euo pipefail

usage="usage: e2e-stack.sh up|mailpit|database|down <project>"
action="${1:?$usage}"
project="${2:?$usage}"
here="$(cd "$(dirname "$0")/../compose" && pwd)"
export POSTGRES_PASSWORD=e2e
export APP_IMAGE="${APP_IMAGE:-unused}"
compose=(docker compose -p "$project" -f "$here/app.yml" -f "$here/e2e.yml")

port() { # service container-port: prints host:port, fails when there is none
  local addr
  addr="$("${compose[@]}" port "$1" "$2")"
  if [ -z "$addr" ]; then
    echo "e2e-stack.sh: docker compose port $1 $2 returned nothing" >&2
    exit 1
  fi
  printf '%s' "$addr"
}

case "$action" in
  up)
    [ "$APP_IMAGE" != unused ] || { echo "e2e-stack.sh up: APP_IMAGE is required" >&2; exit 2; }
    "${compose[@]}" up -d --wait postgres >&2
    "${compose[@]}" run --rm migrate >&2
    "${compose[@]}" up -d --wait web >&2
    addr="$(port web 3000)"
    echo "http://$addr"
    ;;
  mailpit)
    addr="$(port mailpit 8025)"
    echo "http://$addr"
    ;;
  database)
    addr="$(port postgres 5432)"
    echo "postgres://mychess:$POSTGRES_PASSWORD@$addr/mychess"
    ;;
  down)
    "${compose[@]}" --profile tasks down -v --remove-orphans
    ;;
  *)
    echo "$usage" >&2
    exit 2
    ;;
esac
