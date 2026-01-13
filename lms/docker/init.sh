#!/bin/bash
# LMS Auto-deployment v1.0 - Last updated: 2026-01-13

if [ -d "/home/frappe/frappe-bench/apps/frappe" ]; then
    echo "Bench already exists, skipping init"
    cd frappe-bench
    bench start
else
    echo "Creating new bench..."
fi

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

bench get-app lms

bench new-site lms.seemplifyai.com \
--force \
--mariadb-root-password ${MYSQL_ROOT_PASSWORD:-123} \
--admin-password admin123 \
--no-mariadb-socket

bench --site lms.seemplifyai.com install-app lms
bench --site lms.seemplifyai.com set-config developer_mode 1

# Set branding to "Seemplify Learning"
bench --site lms.seemplifyai.com execute "frappe.db.set_single_value('Website Settings', 'app_name', 'Seemplify Learning')"
bench --site lms.seemplifyai.com execute "frappe.db.set_single_value('System Settings', 'app_name', 'Seemplify Learning')"
bench --site lms.seemplifyai.com execute "frappe.db.commit()"

bench --site lms.seemplifyai.com clear-cache
bench use lms.seemplifyai.com

bench start
