#!/usr/bin/env bash
#
# Shell test of deploy-production.sh with stub id, docker, zstd and curl on
# PATH and a temp directory as /srv/mychess; no host, image or database is
# touched.
#
#   bash infra/ci/tests/deploy-production-test.sh
set -uo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fails=0
ok() { printf 'ok   %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }
check() { # name command...
  local name="$1"; shift
  if "$@"; then ok "$name"; else bad "$name"; fi
}

mkdir "$work/bin"
# Stub id: `id -u` prints STUB_UID (default 0, root).
cat > "$work/bin/id" <<'STUB'
#!/usr/bin/env bash
echo "${STUB_UID:-0}"
STUB
# Stub docker: every call is one line of docker.calls, compose calls prefixed
# with the APP_IMAGE and APP_DOMAIN they saw. Images are the lines of
# $STUB_DIR/images; `load` adds the line it reads. `up -d --wait web` fails for
# the image named in STUB_UNHEALTHY.
cat > "$work/bin/docker" <<'STUB'
#!/usr/bin/env bash
images="$STUB_DIR/images"
touch "$images"
if [ "$1" = compose ]; then
  printf 'compose APP_IMAGE=%s APP_DOMAIN=%s %s\n' "${APP_IMAGE:-}" "${APP_DOMAIN:-}" "${*:2}" >> "$STUB_DIR/docker.calls"
  case "$*" in
    *"up -d --wait web") [ "${APP_IMAGE:-}" != "${STUB_UNHEALTHY:-none}" ] || exit 1 ;;
    *"logs --tail"*) echo "web log line naming player@example.invalid" ;;
  esac
  exit 0
fi
printf '%s\n' "$*" >> "$STUB_DIR/docker.calls"
case "$1 $2" in
  "network inspect") exit 0 ;;
  "exec "*) printf 'PGDMP-fake' ;;
  "image inspect") grep -qx "${*: -1}" "$images" || exit 1; printf 'sha256:fake\n' ;;
  "image ls") grep "^$3:" "$images" | cut -d: -f2 ;;
  "image rm") grep -vx "$3" "$images" > "$images.new"; mv "$images.new" "$images" ;;
  load*) read -r line && printf '%s\n' "$line" >> "$images" ;;
esac
STUB
cat > "$work/bin/zstd" <<'STUB'
#!/usr/bin/env bash
cat "${*: -1}"
STUB
# Stub curl (the release check): /api/version reports STUB_COMMIT, every page 200.
cat > "$work/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_DIR/curl.calls"
url="${*: -1}"
if [ "${url##*/api/}" = version ]; then printf '{"commit":"%s"}' "$STUB_COMMIT"; else printf 200; fi
STUB
chmod +x "$work/bin/"*
export STUB_DIR="$work" PATH="$work/bin:$PATH" MYCHESS_ROOT="$work/srv" VERIFY_ATTEMPTS=1 VERIFY_INTERVAL=0

deploy="$here/deploy-production.sh"
old=1111111111111111111111111111111111111111
sha=0123456789abcdef0123456789abcdef01234567
tag="$sha-arm64"
archive="$work/image.tar.zst"
reset() {
  rm -rf "$work/srv" "$work/images" "$work"/*.calls "$work/out" "$work/err" "$archive"
  unset STUB_UID STUB_UNHEALTHY
  export STUB_COMMIT=$sha
  mkdir -p "$work/srv/production"
  printf 'POSTGRES_PASSWORD=x\nBETTER_AUTH_URL=https://mychess.example\n' > "$work/srv/production/.env"
  echo "$old-arm64" > "$work/srv/production/deployed-tag"
  echo "mychess:$old-arm64" > "$work/images"
  echo "mychess:$tag" > "$archive"
}
run() { bash "$deploy" "$@" > "$work/out" 2> "$work/err"; }
calls() { cat "$work/docker.calls" 2>/dev/null; }
at() { calls | grep -n -- "$1" | head -n 1 | cut -d: -f1; }

reset
run "$tag" "$archive" "$(sha256sum "$archive" | cut -d' ' -f1)"
check "a good release: exits 0" test "$?" = 0
check "records the new tag" test "$(cat "$work/srv/production/deployed-tag")" = "$tag"
check "copies the compose files to the host" test -f "$work/srv/production/app.yml" -a -f "$work/srv/production/production.yml"
check "copies the edge and its Caddyfile" test -f "$work/srv/edge/edge.yml" -a -f "$work/srv/edge/caddy/Caddyfile"
check "Caddy gets the domain from BETTER_AUTH_URL" grep -q "APP_DOMAIN=mychess.example -p mychess-edge" "$work/docker.calls"
check "and reloads its config" grep -q "exec -T caddy caddy reload" "$work/docker.calls"
check "the release check asks that domain" grep -q -- "--resolve mychess.example:443:127.0.0.1" "$work/curl.calls"
check "the compose project is mychess-production with the host's .env" grep -q -- "-p mychess-production --env-file $work/srv/production/.env" "$work/docker.calls"
check "a restore point is dumped into the host's backups" bash -c 'ls "$1"/predeploy-*.dump >/dev/null' _ "$work/srv/backups"
check "the dump comes before the migration" test "$(at 'pg_dump')" -lt "$(at 'run --rm migrate')"
check "the migration runs the new image before web is replaced" test "$(at "APP_IMAGE=mychess:$tag .* run --rm migrate")" -lt "$(at "APP_IMAGE=mychess:$tag .*up -d --wait web")"
check "keeps the previous release's image (in use until now)" grep -qx "mychess:$old-arm64" "$work/images"

reset
run "$tag" "$archive" "$(printf '%064d' 0)"
check "an archive with other bytes: fails" test "$?" = 1
check "and changes nothing" test ! -e "$work/srv/edge" -a "$(cat "$work/srv/production/deployed-tag")" = "$old-arm64"
check "not even a compose call" bash -c '! grep -q compose "$1" 2>/dev/null' _ "$work/docker.calls"

reset
run "$tag"
check "no archive and no such image here: fails before any change" test "$?" = 1 -a ! -e "$work/srv/edge"

reset
echo "mychess:$tag" >> "$work/images"
run "$tag"
check "no archive, image kept here (the rollback button): deploys it" test "$?" = 0 -a "$(cat "$work/srv/production/deployed-tag")" = "$tag"

reset
export STUB_UNHEALTHY="mychess:$tag"
run "$tag" "$archive" "$(sha256sum "$archive" | cut -d' ' -f1)"
check "web never healthy: fails" test "$?" = 1
check "and puts the previous web back" grep -q "APP_IMAGE=mychess:$old-arm64 .*up -d --wait web" "$work/docker.calls"
check "and says so" grep -q "rolled back to $old-arm64" "$work/err"
check "and keeps the previous tag recorded" test "$(cat "$work/srv/production/deployed-tag")" = "$old-arm64"

reset
export STUB_COMMIT=ffffffffffffffffffffffffffffffffffffffff
run "$tag" "$archive" "$(sha256sum "$archive" | cut -d' ' -f1)"
check "healthy but another commit answers: fails" test "$?" = 1
check "and puts the previous web back" grep -q "APP_IMAGE=mychess:$old-arm64 .*up -d --wait web" "$work/docker.calls"
check "and keeps the previous tag recorded" test "$(cat "$work/srv/production/deployed-tag")" = "$old-arm64"

reset
rm "$work/srv/production/.env"
run "$tag" "$archive" "$(sha256sum "$archive" | cut -d' ' -f1)"
check "no production .env: fails" test "$?" = 1
check "and names the script that writes it" grep -q "production-env.sh" "$work/err"

reset
printf 'BETTER_AUTH_URL=http://mychess.example\n' > "$work/srv/production/.env"
run "$tag" "$archive" "$(sha256sum "$archive" | cut -d' ' -f1)"
check "a non-https BETTER_AUTH_URL: fails" test "$?" = 1
check "and changes nothing" test ! -e "$work/srv/edge" -a ! -e "$work/docker.calls"

good() { sha256sum "$archive" | cut -d' ' -f1; }
deployed() { cat "$work/srv/production/deployed-tag" 2>/dev/null; }

reset
# The stub lists images in file order, newest first: the previous one is the oldest.
printf 'mychess:%s\n' t3 t2 t1 t0 "$old-arm64" > "$work/images"
run "$tag" "$archive" "$(good)"
check "pruning keeps the previous release's image, however old" grep -qx "mychess:$old-arm64" "$work/images"
check "and removes the others beyond the newest three" bash -c '! grep -qx mychess:t0 "$1"' _ "$work/images"

# --if-newer (ci.yml): never replaces production with an older commit. A
# throwaway history c1 -> c2, and c3 off c1 (RELEASE_REPO is for the shell
# test only).
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid
git init -q "$work/repo"
git -C "$work/repo" commit -q --allow-empty -m c1
c1="$(git -C "$work/repo" rev-parse HEAD)"
git -C "$work/repo" commit -q --allow-empty -m c2
c2="$(git -C "$work/repo" rev-parse HEAD)"
git -C "$work/repo" checkout -q -b side "$c1"
git -C "$work/repo" commit -q --allow-empty -m c3
c3="$(git -C "$work/repo" rev-parse HEAD)"
export RELEASE_REPO="$work/repo"
deploy_case() { # commit production runs, commit to deploy, options...
  local running="$1" commit="$2"; shift 2
  reset
  echo "$running-arm64" > "$work/srv/production/deployed-tag"
  echo "mychess:$commit-arm64" > "$archive"
  export STUB_COMMIT="$commit"
  run "$@" "$commit-arm64" "$archive" "$(good)"
}
deploy_case "$c1" "$c2" --if-newer
check "if newer: a later commit on the same line deploys" test "$?" = 0 -a "$(deployed)" = "$c2-arm64"
deploy_case "$c2" "$c1" --if-newer
check "if newer: an older commit is not deployed, and that is no failure" test "$?" = 0 -a "$(deployed)" = "$c2-arm64"
check "and nothing is touched" test ! -e "$work/docker.calls"
check "and says why" grep -q "already holds $c1-arm64: not deployed" "$work/out"
deploy_case "$c2" "$c2" --if-newer
check "if newer: the commit production runs is not deployed again" test "$?" = 0 -a ! -e "$work/docker.calls"
deploy_case "$c2" "$c3" --if-newer
check "if newer: a commit off production's line (force-push) deploys" test "$?" = 0 -a "$(deployed)" = "$c3-arm64"
deploy_case "$old" "$c1" --if-newer
check "if newer: a running commit unknown to the checkout does not hold it back" test "$?" = 0 -a "$(deployed)" = "$c1-arm64"
deploy_case "$c2" "$c1"
check "without --if-newer (the button): an older commit deploys" test "$?" = 0 -a "$(deployed)" = "$c1-arm64"
unset RELEASE_REPO

# A failed web's log may hold personal data (R: no personal data in logs): it
# stays on the host, root only, and the public job log gets its path.
reset
export STUB_UNHEALTHY="mychess:$tag"
run "$tag" "$archive" "$(good)"
check "a failed web's log is not printed" bash -c '! grep -q player@example.invalid "$1" "$2"' _ "$work/out" "$work/err"
check "it is kept on the host" bash -c 'grep -q player@example.invalid "$1"/logs/web-*.log' _ "$work/srv"
check "and the job log names where" grep -q "web log kept on the host: $work/srv/logs/web-" "$work/err"
touch "$work/probe"; chmod 600 "$work/probe"
if [ "$(stat -c %a "$work/probe")" = 600 ]; then
  check "root only" test "$(stat -c %a "$work/srv/logs")" = 700
else
  ok "root only (skipped: this file system ignores modes)"
fi
unset STUB_UNHEALTHY

run --bogus "$tag"
check "an unknown option: refused" test "$?" = 2

reset
rm -rf "$work/srv/production"
run "$tag" "$archive" "$(good)"
check "no production directory: fails" test "$?" = 1

reset
exec 8> "$work/srv/production/.deploy.lock"
flock 8
# The waiting run must not inherit the holder's descriptor, or it holds the lock itself.
( exec 8>&-; run "$tag" "$archive" "$(good)"; echo "$?" > "$work/locked" ) &
sleep 1
check "a second run waits for the lock" test ! -e "$work/locked" -a ! -e "$work/docker.calls"
exec 8>&-
wait
check "and goes on once it is free" test "$(cat "$work/locked")" = 0

reset
STUB_UID=1000 run "$tag"
check "not root: refused" test "$?" = 1

reset
run 'bad tag;rm'
check "a malformed tag: refused" test "$?" = 2
run "$tag" "$archive"
check "an archive without its checksum: refused" test "$?" = 2

echo
[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
