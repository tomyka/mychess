#!/usr/bin/env bash
#
# Shell test of release-image.sh with stub docker and zstd on PATH; no image
# is touched.
#
#   bash infra/ci/tests/release-image-test.sh
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

# Stub docker: images are the lines of $STUB_DIR/images (newest first);
# `load` adds the line it reads, `rm` removes. STUB_LOAD_FAIL=1 fails load.
mkdir "$work/bin"
cat > "$work/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_DIR/docker.calls"
images="$STUB_DIR/images"
touch "$images"
case "$1 $2" in
  "image inspect")
    ref="${*: -1}"
    grep -qx "$ref" "$images" || exit 1
    [ "$3" != --format ] || printf 'id-of:%s\n' "$ref" ;;
  "image ls") grep "^$3:" "$images" | cut -d: -f2 ;;
  "image rm") grep -vx "$3" "$images" > "$images.new"; mv "$images.new" "$images" ;;
  load*) [ "${STUB_LOAD_FAIL:-0}" != 1 ] || exit 1; read -r line && printf '%s\n' "$line" >> "$images" ;;
esac
STUB
# Stub zstd: `zstd -dc <file>` prints the file (the "archive" is plain text here).
cat > "$work/bin/zstd" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_DIR/zstd.calls"
cat "${*: -1}"
STUB
chmod +x "$work/bin/docker" "$work/bin/zstd"
export STUB_DIR="$work" PATH="$work/bin:$PATH"

# shellcheck source=infra/ci/release-image.sh
source "$here/release-image.sh"
sha=0123456789abcdef0123456789abcdef01234567
tag="$sha-arm64"
archive="$work/image.tar.zst"
reset() { rm -f "$work/images" "$work/docker.calls" "$work/zstd.calls" "$work/err" "$archive"; unset STUB_LOAD_FAIL; }
has() { grep -qx "$1" "$work/images"; }
sum() { sha256sum "$1" | cut -d' ' -f1; }

reset
echo "mychess:$tag" > "$work/images"
check "no archive: an image already here is used" load_image "$tag"
check "no archive: nothing is loaded" bash -c '! grep -q load "$1"' _ "$work/docker.calls"

reset
load_image "$tag" > /dev/null 2> "$work/err"
check "no archive and no image: fails" test $? = 1
check "and says only the last releases are kept" grep -q "only the last 3 releases are kept" "$work/err"

reset
echo "mychess:$tag" > "$archive"
check "archive: loaded when its checksum is the build's" load_image "$tag" "$archive" "$(sum "$archive")"
check "archive: the tag is then here" has "mychess:$tag"
check "archive: decompressed with zstd" grep -qx -- "-dc $archive" "$work/zstd.calls"

reset
echo "mychess:$tag" > "$archive"
load_image "$tag" "$archive" "$(printf '%064d' 0)" > /dev/null 2> "$work/err"
check "archive: other bytes are refused" test $? = 1
check "archive: and named" grep -q "not the build's 0000" "$work/err"
check "archive: before anything is loaded" test ! -e "$work/docker.calls"

reset
echo "mychess:$tag" > "$archive"
load_image "$tag" "$archive" "" > /dev/null 2> "$work/err"
check "archive without a checksum: refused" test $? = 1

reset
load_image "$tag" "$work/missing.tar.zst" "$(printf '%064d' 0)" > /dev/null 2> "$work/err"
check "archive missing: fails" test $? = 1
check "archive missing: and says so" grep -q "missing or empty" "$work/err"

reset
echo "mychess:$tag" > "$archive"
STUB_LOAD_FAIL=1 load_image "$tag" "$archive" "$(sum "$archive")" > /dev/null 2> "$work/err"
check "a failed load fails" test $? = 1
check "and says so" grep -q "could not load" "$work/err"

reset
echo "mychess:something-else" > "$archive"
load_image "$tag" "$archive" "$(sum "$archive")" > /dev/null 2> "$work/err"
check "an archive without the tag fails" test $? = 1
check "and says so" grep -q "did not hold mychess:$tag" "$work/err"

reset
printf 'mychess:%s\n' t6 t5 t4 t3 t2 t1 > "$work/images"
echo "postgres:18.6" >> "$work/images"
prune_releases t1
check "prune: keeps the newest 3" bash -c 'grep -qx mychess:t6 "$1" && grep -qx mychess:t5 "$1" && grep -qx mychess:t4 "$1"' _ "$work/images"
check "prune: keeps a named one, however old" has mychess:t1
check "prune: removes the rest" bash -c '! grep -qx mychess:t3 "$1" && ! grep -qx mychess:t2 "$1"' _ "$work/images"
check "prune: touches no other image" has postgres:18.6

reset
printf 'mychess:%s\n' t2 t1 > "$work/images"
prune_releases "" ""
check "prune: fewer than 3 removes nothing" test "$(wc -l < "$work/images")" = 2

# The deploy script loads before it changes anything and prunes only after a
# good release.
deploy="$here/deploy-production.sh"
line() { grep -n "$1" "$deploy" | head -n 1 | cut -d: -f1; }
check "deploy: loads before it changes anything" test "$(line 'load_image "\$tag"')" -lt "$(line '^install -d')"
check "deploy: a failed load exits" grep -q 'load_image "\$tag" "\$archive" "\$archive_sha" || exit 1' "$deploy"
check "deploy: prunes after recording the release" test "$(line 'prune_releases')" -gt "$(line 'deployed-tag"$')"
check "the docker-prune timer spares release images" grep -q 'label!=mychess.release' "$here/../host/docker-prune.service"
check "and the Dockerfile labels them" grep -qx 'LABEL mychess.release=true' "$here/../../Dockerfile"

echo
if [ "$fails" -eq 0 ]; then echo "all passed"; else echo "$fails failed"; exit 1; fi
