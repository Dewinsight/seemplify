#!/usr/bin/env bash
# Keep the private, locally built execution image available through Docker cleanup.
set -euo pipefail
image=dewinsight/hostinger-ci:1
keeper=hostinger-ci-image-keeper
context=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec 9>/var/lock/hostinger-ci-image.lock
flock -x 9
if ! docker image inspect "$image" >/dev/null 2>&1; then
  docker build --pull=false --tag "$image" "$context"
fi
image_id=$(docker image inspect --format '{{.Id}}' "$image")
if docker container inspect "$keeper" >/dev/null 2>&1; then
  owner=$(docker inspect --format '{{index .Config.Labels "hostinger-ci.image-keeper"}}' "$keeper")
  test "$owner" = true || { echo 'Image keeper name belongs to another container' >&2; exit 1; }
  current=$(docker inspect --format '{{.Image}}' "$keeper")
  if test "$current" != "$image_id"; then
    docker rm -f "$keeper" >/dev/null
  fi
fi
if ! docker container inspect "$keeper" >/dev/null 2>&1; then
  docker create --name "$keeper" --label hostinger-ci.image-keeper=true \
    --restart unless-stopped --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges --user 65534:65534 --cpus .05 \
    --memory 16m --memory-swap 16m --pids-limit 8 \
    --entrypoint /bin/sleep "$image_id" infinity >/dev/null
fi
docker start "$keeper" >/dev/null
test "$(docker inspect --format '{{.State.Running}}' "$keeper")" = true
echo 'Local CI image available and protected by running keeper'
