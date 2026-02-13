#!/bin/bash
# Restore LMS site to use original database _8df1a856c9c77a07 (Jan 14, 2026)
# Run on server: copy to container and execute, or run via docker exec

set -e
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-LmsSecure2026!}"
OLD_DB="_8df1a856c9c77a07"
NEW_PASSWORD="RestoreLms2026!"

echo "=== Restoring LMS to original database ==="

# 1. Reset MariaDB user password for old database (so we can connect)
echo "Resetting DB user password..."
mysql -h mariadb -uroot -p"$MYSQL_ROOT_PASSWORD" -e "
  CREATE USER IF NOT EXISTS '${OLD_DB}'@'%' IDENTIFIED BY '${NEW_PASSWORD}';
  ALTER USER '${OLD_DB}'@'%' IDENTIFIED BY '${NEW_PASSWORD}';
  GRANT ALL PRIVILEGES ON \`${OLD_DB}\`.* TO '${OLD_DB}'@'%';
  FLUSH PRIVILEGES;
" 2>/dev/null || true

# 2. Update site_config.json to use old database
SITE_CONFIG="/home/frappe/frappe-bench/sites/lms.seemplifyai.com/site_config.json"
echo "Updating site_config to use database ${OLD_DB}..."

python3 << 'PYSCRIPT'
import json
path = "/home/frappe/frappe-bench/sites/lms.seemplifyai.com/site_config.json"
with open(path) as f:
    cfg = json.load(f)
cfg["db_name"] = "_8df1a856c9c77a07"
cfg["db_user"] = "_8df1a856c9c77a07"
cfg["db_password"] = "RestoreLms2026!"
with open(path, "w") as f:
    json.dump(cfg, f, indent=1)
print("site_config updated")
PYSCRIPT

# 3. Clear cache
cd /home/frappe/frappe-bench
bench --site lms.seemplifyai.com clear-cache

echo "=== Done. Restart frappe service to apply. ==="
