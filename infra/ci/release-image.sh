#!/usr/bin/env bash
#
# Sourced by deploy-production.sh (and by infra/ci/tests/release-image-test.sh):
# the app image of a release on this host, and only the last few kept.
#
#   load_image <tag> [<archive> <sha256>]   0 when mychess:<tag> is here: loaded
#                                           from <archive> first when one is
#                                           given, once the archive's sha256 is
#                                           <sha256>; 1 otherwise
#   prune_releases <tag>...                 removes every mychess image but the
#                                           newest RELEASES_KEEP and the tags
#                                           named (in use)
#
# There is no registry (ADR 0010): ci.yml's image job saves the image it built
# as a zstd-compressed `docker save` archive, uploaded as a short-lived
# workflow artifact with its sha256 as a job output; e2e tests the image from
# that archive, and the deploy job downloads it on this host and passes its
# path and checksum. The checksum, not the image id, proves these are the
# bytes that were tested: an image id depends on the Docker image store (a
# classic one names the config, a containerd one the manifest), and the
# runner's and this host's need not match. The rollback button passes no
# archive: its image must still be one of the releases kept here. The host's
# docker-prune timer never removes these (the image's mychess.release label),
# so only prune_releases does.

RELEASE_IMAGE=mychess
RELEASES_KEEP=3

load_image() { # image tag, [archive, sha256]
  local tag="$1" archive="${2:-}" expected="${3:-}" actual id
  if [ -n "$archive" ]; then
    if [ ! -s "$archive" ]; then
      echo "image archive $archive is missing or empty" >&2
      return 1
    fi
    actual="$(sha256sum "$archive" | cut -d' ' -f1)"
    if [ "$actual" != "$expected" ]; then
      echo "image archive $archive has sha256 $actual, not the build's ${expected:-(none given)}: not deployed" >&2
      return 1
    fi
    if ! zstd -dc "$archive" | docker load; then
      echo "could not load $archive" >&2
      return 1
    fi
  fi
  # An archive that held another tag loads it, not this one: ask for the tag.
  if ! id="$(docker image inspect --format '{{.Id}}' "$RELEASE_IMAGE:$tag" 2>/dev/null)"; then
    if [ -n "$archive" ]; then
      echo "$archive did not hold $RELEASE_IMAGE:$tag" >&2
    else
      echo "$RELEASE_IMAGE:$tag is not on this host (only the last $RELEASES_KEEP releases are kept)" >&2
    fi
    return 1
  fi
  echo "image $RELEASE_IMAGE:$tag is here ($id)"
}

prune_releases() { # tags to keep whatever their age
  local tag
  # Newest first (docker image ls sorts by creation time).
  docker image ls "$RELEASE_IMAGE" --format '{{.Tag}}' \
    | awk -v keep="$RELEASES_KEEP" 'NR > keep' \
    | while read -r tag; do
        [[ " $* " == *" $tag "* ]] && continue
        docker image rm "$RELEASE_IMAGE:$tag" >/dev/null || true
      done
}
