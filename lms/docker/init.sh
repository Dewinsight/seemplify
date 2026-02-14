#!/bin/bash
# LMS deployment bootstrap for Docker/Dokploy.
# Uses environment variables so the same stack works across local/dev/prod.

set -euo pipefail

echo "Initializing LMS application..."

SITE_NAME="${LMS_SITE_NAME:-${LMS_HOSTNAME:-lms.seemplifyai.com}}"
PUBLIC_HOST="${LMS_HOSTNAME:-$SITE_NAME}"
APP_NAME_VALUE="${LMS_APP_NAME:-LMS by AIIN}"
ADMIN_PASSWORD_VALUE="${LMS_ADMIN_PASSWORD:-${ADMIN_PASSWORD:-admin123}}"
MYSQL_ROOT_PASSWORD_VALUE="${MYSQL_ROOT_PASSWORD:-123}"
DEVELOPER_MODE_VALUE="${LMS_DEVELOPER_MODE:-1}"
APP_SOURCE_PATH="${LMS_APP_SOURCE_PATH:-/lms-app}"

export PATH="${NVM_DIR}/versions/node/v${NODE_VERSION_DEVELOP}/bin/:${PATH}"

echo "Using site: ${SITE_NAME}"
echo "Using host: ${PUBLIC_HOST}"
echo "Using app source: ${APP_SOURCE_PATH}"

bench init --skip-redis-config-generation frappe-bench

cd frappe-bench

# Use Docker service names instead of localhost.
bench set-mariadb-host mariadb
bench set-redis-cache-host redis://redis:6379
bench set-redis-queue-host redis://redis:6379
bench set-redis-socketio-host redis://redis:6379

# Remove unsupported services from Procfile for this container mode.
sed -i '/redis/d' ./Procfile
sed -i '/watch/d' ./Procfile
sed -i '/socketio/d' ./Procfile

# Use local LMS app source mounted in the container.
bench get-app "${APP_SOURCE_PATH}"

bench new-site "${SITE_NAME}" \
  --force \
  --mariadb-root-password "${MYSQL_ROOT_PASSWORD_VALUE}" \
  --admin-password "${ADMIN_PASSWORD_VALUE}" \
  --no-mariadb-socket

bench --site "${SITE_NAME}" install-app lms
bench --site "${SITE_NAME}" set-config developer_mode "${DEVELOPER_MODE_VALUE}"

# Set app branding dynamically.
bench --site "${SITE_NAME}" execute "frappe.db.set_single_value('Website Settings', 'app_name', '${APP_NAME_VALUE}')"
bench --site "${SITE_NAME}" execute "frappe.db.set_single_value('System Settings', 'app_name', '${APP_NAME_VALUE}')"
bench --site "${SITE_NAME}" execute "frappe.db.commit()"

# Update site_config.json with app_name and host_name.
export SITE_NAME PUBLIC_HOST APP_NAME_VALUE
python3 - <<'PYCODE'
import json
import os

site_name = os.environ["SITE_NAME"]
public_host = os.environ["PUBLIC_HOST"]
app_name = os.environ["APP_NAME_VALUE"]
config_path = f"/home/frappe/frappe-bench/sites/{site_name}/site_config.json"

with open(config_path, "r", encoding="utf-8") as fh:
    data = json.load(fh)

data["app_name"] = app_name
data["host_name"] = public_host

with open(config_path, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=1)
    fh.write("\n")
PYCODE

# Configure SMTP/email if env is available (supports both env file and direct env vars).
if [ -f /workspace/setup-brevo-email.sh ]; then
  bash /workspace/setup-brevo-email.sh /workspace-idp-env "${SITE_NAME}" || true
fi

bench --site "${SITE_NAME}" clear-cache
bench use "${SITE_NAME}"

bench start
