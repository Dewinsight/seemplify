#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_SHA:?Tested main commit required}"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]
release_root="/opt/seemplify/releases/$RELEASE_SHA"
archive="/opt/seemplify/build/admin-handoffs-$RELEASE_SHA.tgz"
install -d -m 700 "$release_root"
tar -xzf "$archive" -C "$release_root"

identity_image="seemplify/identity-provider:hostinger-$RELEASE_SHA"
learning_image="seemplify/learning:hostinger-$RELEASE_SHA"
docker build --label "org.opencontainers.image.revision=$RELEASE_SHA" -t "$identity_image" "$release_root/Identityprovider"
docker build --label "org.opencontainers.image.revision=$RELEASE_SHA" -t "$learning_image" "$release_root/seemplify-learning"

old_identity=$(docker inspect --format '{{.Config.Image}}' seemplify-core-identity-provider-1)
old_learning=$(docker inspect --format '{{.Config.Image}}' seemplify-core-learning-1)
compose=(docker compose
  --env-file /opt/seemplify/secrets/shared-infrastructure.env
  --env-file /opt/seemplify/secrets/core-apps.env
  -f /opt/seemplify/deploy/hostinger/core-apps.compose.yml)

wait_healthy() {
  local state
  for _ in $(seq 1 60); do
    state=$(docker inspect --format '{{.State.Health.Status}}' "$1")
    [[ "$state" == healthy ]] && return 0
    [[ "$state" == unhealthy ]] && return 1
    sleep 2
  done
  return 1
}
rollback() {
  export IDENTITY_PROVIDER_IMAGE="$old_identity" LEARNING_IMAGE="$old_learning"
  "${compose[@]}" up -d --no-deps identity-provider learning
  echo 'Admin handoff deployment failed; previous images restored.' >&2
}
export IDENTITY_PROVIDER_IMAGE="$identity_image" LEARNING_IMAGE="$learning_image"
"${compose[@]}" config --quiet
trap rollback ERR
"${compose[@]}" up -d --no-deps identity-provider learning
for container in seemplify-core-identity-provider-1 seemplify-core-learning-1; do
  wait_healthy "$container"
  revision=$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$container")
  [[ "$revision" == "$RELEASE_SHA" ]]
done

# Persist the successfully deployed tags for subsequent Compose operations.
python3 - "$identity_image" "$learning_image" <<'PY'
import os, pathlib, sys
p = pathlib.Path('/opt/seemplify/secrets/core-apps.env')
values = dict(zip(['IDENTITY_PROVIDER_IMAGE', 'LEARNING_IMAGE'], sys.argv[1:]))
lines = p.read_text().splitlines()
lines = [line for line in lines if line.split('=', 1)[0] not in values]
lines.extend(f'{key}={value}' for key, value in values.items())
temp = p.with_suffix('.env.admin-handoffs')
temp.write_text('\n'.join(lines) + '\n')
os.chmod(temp, 0o600)
os.replace(temp, p)
PY
trap - ERR
cp -a "$release_root/Identityprovider/." /opt/seemplify/source/Identityprovider/
cp -a "$release_root/seemplify-learning/." /opt/seemplify/source/seemplify-learning/
echo "Identity and Learning deployed and healthy at $RELEASE_SHA"
