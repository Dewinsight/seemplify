#!/bin/bash
# LMS Local Development - build from LOCAL repo code
# Usage (from Windows PowerShell):
#   cd c:\Users\Michael\Documents\GitHub\seemplify\lms\docker
#   docker-compose -f docker-compose.local.yml up

set -e

echo "Initializing LMS application for LOCAL development (site: localhost)..."

# Ensure Node for bench JS build is on PATH if NVM is present
if [ -n "${NVM_DIR}" ] && [ -n "${NODE_VERSION_DEVELOP}" ]; then
  export PATH="${NVM_DIR}/versions/node/v${NODE_VERSION_DEVELOP}/bin/:${PATH}"
fi

# 1) Create a fresh bench
bench init --skip-redis-config-generation frappe-bench

cd frappe-bench

# 2) Point bench to the dockerised services
bench set-mariadb-host mariadb
bench set-redis-cache-host redis://redis:6379
bench set-redis-queue-host redis://redis:6379
bench set-redis-socketio-host redis://redis:6379

# Remove redis, watch from Procfile (bench start is done from the frappe service)
sed -i '/redis/d' ./Procfile
sed -i '/watch/d' ./Procfile

# 3) Install LMS app from YOUR local repo
# bench get-app ensures bench metadata is set up; then we overwrite app code with /workspace-lms
echo "Fetching LMS app skeleton into bench..."
bench get-app lms

echo "Overlaying LMS app with local repo code from /workspace-lms..."
rm -rf ./apps/lms
cp -r /workspace-lms ./apps/lms

# 4) Create local site "localhost" and install LMS
SITE_NAME="localhost"

bench new-site "$SITE_NAME" \
  --force \
  --mariadb-root-password "${MYSQL_ROOT_PASSWORD:-123}" \
  --admin-password admin123 \
  --no-mariadb-socket

bench --site "$SITE_NAME" install-app lms
bench --site "$SITE_NAME" set-config developer_mode 1

bench --site "$SITE_NAME" clear-cache
bench use "$SITE_NAME"

echo "Starting bench for local LMS dev on http://localhost:8000 ..."
bench start

#!/bin/bash
# LMS Local Development - Use localhost for site
# Run with: docker-compose -f docker-compose.yml -f docker-compose.local.yml up

echo "Initializing LMS application (local development)..."

export PATH="${NVM_DIR}/versions/node/v${NODE_VERSION_DEVELOP}/bin/:${PATH}"

bench init --skip-redis-config-generation frappe-bench

cd frappe-bench

# Use containers instead of localhost
bench set-mariadb-host mariadb
bench set-redis-cache-host redis://redis:6379
bench set-redis-queue-host redis://redis:6379
bench set-redis-socketio-host redis://redis:6379

# Remove redis, watch from Procfile
sed -i '/redis/d' ./Procfile
sed -i '/watch/d' ./Procfile

# Use localhost as site for local Docker access
SITE_NAME="localhost"

# Get LMS app from GitHub (local get-app has compatibility issues)
bench get-app lms

# Create new site with localhost
bench new-site $SITE_NAME \
  --force \
  --mariadb-root-password ${MYSQL_ROOT_PASSWORD:-123} \
  --admin-password admin123 \
  --no-mariadb-socket

bench --site $SITE_NAME install-app lms
bench --site $SITE_NAME set-config developer_mode 1

bench --site $SITE_NAME clear-cache
bench use $SITE_NAME

bench start
