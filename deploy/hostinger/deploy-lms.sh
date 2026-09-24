#!/usr/bin/env bash
set -euo pipefail
# Run from an immutable main release directory, under the production deploy lock.
: "${RELEASE_SHA:?required}"
release_root="/opt/seemplify/releases/$RELEASE_SHA"
secrets=/opt/seemplify/secrets/lms.env
test -f "$secrets"
set -a
. "$secrets"
set +a
export LMS_IMAGE="seemplify/lms:hostinger-$RELEASE_SHA"
if ! docker image inspect seemplify/frappe-base:backup-e703fe9 >/dev/null 2>&1; then
  context="/opt/seemplify/build/lms-recovery/frappe_docker"
  if [ ! -d "$context/.git" ]; then
    git clone https://github.com/frappe/frappe_docker.git "$context"
  fi
  git -C "$context" checkout 3d0a0e53d8ab03903f6c3f125976a37d7a0f9875
  python3 "$release_root/deploy/hostinger/prepare-lms-base.py" "$context"
  docker build --build-arg PYTHON_VERSION=3.14 --build-arg NODE_VERSION=24 \
    --build-arg FRAPPE_PATH=file:///tmp/frappe-source --build-arg FRAPPE_BRANCH=lms-restoration --build-arg INSTALL_CHROMIUM=false \
    -f "$context/Containerfile.lms" -t seemplify/frappe-base:backup-e703fe9 "$context"
fi
docker build --label "org.opencontainers.image.revision=$RELEASE_SHA" \
  -f "$release_root/lms/docker/Dockerfile.hostinger" -t "$LMS_IMAGE" "$release_root/lms"
install -m 644 "$release_root/deploy/hostinger/lms.compose.yml" /opt/seemplify/deploy/hostinger/lms.compose.yml
compose=(docker compose --env-file "$secrets" -f /opt/seemplify/deploy/hostinger/lms.compose.yml)
"${compose[@]}" up -d db redis-cache redis-queue
if ! "${compose[@]}" run --rm --no-deps backend test -f sites/lms.seemplifyai.com/site_config.json; then
  "${compose[@]}" run --rm --no-deps backend bench set-config -g db_host db
  "${compose[@]}" run --rm --no-deps backend bench set-config -g redis_cache redis://redis-cache:6379
  "${compose[@]}" run --rm --no-deps backend bench set-config -g redis_queue redis://redis-queue:6379
  "${compose[@]}" run --rm --no-deps backend bench set-config -g redis_socketio redis://redis-queue:6379
  "${compose[@]}" run --rm --no-deps backend bench new-site lms.seemplifyai.com \
    --db-name lms_stem --db-password "$LMS_DB_PASSWORD" \
    --db-root-password "$LMS_DB_ROOT_PASSWORD" --admin-password "$LMS_ADMIN_PASSWORD" \
    --mariadb-user-host-login-scope '%'
fi
if ! "${compose[@]}" run --rm --no-deps backend test -f sites/lms.seemplifyai.com/.historical-restore-complete; then
  "${compose[@]}" run --rm --no-deps -v "$release_root/lms/docker/lms-prod-restore.sql:/tmp/lms-restore.sql:ro" backend \
    bench --site lms.seemplifyai.com restore /tmp/lms-restore.sql --force --db-root-password "$LMS_DB_ROOT_PASSWORD"
  "${compose[@]}" run --rm --no-deps backend touch sites/lms.seemplifyai.com/.historical-restore-complete
fi
"${compose[@]}" run --rm --no-deps backend bench --site lms.seemplifyai.com set-config host_name https://lms.seemplifyai.com
"${compose[@]}" run --rm --no-deps backend bench --site lms.seemplifyai.com set-config developer_mode 0
"${compose[@]}" run --rm --no-deps backend bench --site lms.seemplifyai.com set-config seemplify_oidc_only 0
"${compose[@]}" run --rm --no-deps backend bench --site lms.seemplifyai.com set-config lms_standalone_auth 1
"${compose[@]}" run --rm --no-deps backend bench --site lms.seemplifyai.com set-config mute_emails 1
"${compose[@]}" run --rm --no-deps backend bench --site lms.seemplifyai.com migrate
"${compose[@]}" run --rm --no-deps backend bench --site lms.seemplifyai.com execute lms.lms.configure_hostinger.configure
"${compose[@]}" up -d
for attempt in $(seq 1 36); do
  if curl -fsS -H 'Host: lms.seemplifyai.com' http://127.0.0.1:18080/api/method/ping >/dev/null; then break; fi
  sleep 5
done
curl -fsS -H 'Host: lms.seemplifyai.com' http://127.0.0.1:18080/api/method/ping
actual=$(docker inspect seemplify-lms-backend-1 --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
test "$actual" = "$RELEASE_SHA"
printf 'lms_revision=%s\n' "$actual"
