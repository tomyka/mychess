#!/usr/bin/env bash
#
# Sourced by deploy-production.sh (and by infra/ci/tests/verify-release-test.sh):
# proves a freshly deployed web works through the real path, the edge's Caddy
# on this host, with the site's own name and certificate (curl --resolve keeps
# the Host header and SNI, only the address is local).
#
#   verify_release <image tag>   0 when every check passes within the retries,
#                                1 otherwise (the failed check is on stderr)
#
# Checks: GET /api/version names the commit in the tag (asked only for a tag
# `<40-hex sha>-arm64`; any other tag skips it with a warning), and the pages
# in VERIFY_PAGES end in 200. Redirects are followed: a signed-out visitor's
# `/` is sent to the sign-in page, /prisijungti. Settings:
#   VERIFY_HOST      the site's name (required; deploy-production.sh takes it
#                    from BETTER_AUTH_URL in the production .env)
#   SKIP_VERSION_CHECK=1  skips only the commit comparison, with a loud warning
#   VERIFY_ATTEMPTS  tries (default 12) and VERIFY_INTERVAL seconds between (default 5)

VERIFY_PAGES=(/ /prisijungti)
verify_failure=""

verify_get() { # path [curl options...]
  local path="$1"; shift
  curl -sS --max-time 10 --resolve "$VERIFY_HOST:443:127.0.0.1" "$@" \
    "https://$VERIFY_HOST$path"
}

# One pass of every check; sets verify_failure and returns 1 at the first miss.
verify_once() { # expected commit, or empty to skip the comparison
  local expected="$1" body commit page code
  if [ -n "$expected" ]; then
    if ! body="$(verify_get /api/version -f 2>/dev/null)"; then
      verify_failure="GET /api/version did not answer 200"
      return 1
    fi
    commit="$(printf '%s' "$body" | sed -n 's/^{"commit":"\([0-9a-f]\{40\}\)"}$/\1/p')"
    if [ "$commit" != "$expected" ]; then
      verify_failure="GET /api/version names ${commit:-no commit}, expected $expected"
      return 1
    fi
  fi
  for page in "${VERIFY_PAGES[@]}"; do
    code="$(verify_get "$page" -L --max-redirs 3 -o /dev/null -w '%{http_code}' 2>/dev/null || true)"
    if [ "$code" != 200 ]; then
      verify_failure="GET $page answered ${code:-nothing} instead of 200"
      return 1
    fi
  done
}

verify_release() { # image tag
  local tag="$1" expected="" attempt=1 attempts="${VERIFY_ATTEMPTS:-12}"
  if [ -z "${VERIFY_HOST:-}" ]; then
    echo "VERIFY_HOST is not set: no site to verify" >&2
    return 1
  fi
  if [ "${SKIP_VERSION_CHECK:-}" = 1 ]; then
    echo "WARNING: SKIP_VERSION_CHECK=1: the running commit is NOT compared (the pages are still checked)" >&2
  elif [[ "$tag" =~ ^([0-9a-f]{40})-arm64$ ]]; then
    expected="${BASH_REMATCH[1]}"
  else
    echo "warning: $tag is not <40-hex sha>-arm64; the running commit is not compared" >&2
  fi
  while ! verify_once "$expected"; do
    if [ "$attempt" -ge "$attempts" ]; then
      echo "verification failed after $attempts tries: $verify_failure" >&2
      return 1
    fi
    attempt=$((attempt + 1))
    sleep "${VERIFY_INTERVAL:-5}"
  done
  echo "verified $tag on $VERIFY_HOST: version${expected:+ $expected}, ${VERIFY_PAGES[*]} answer 200"
}
