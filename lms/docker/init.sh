#!/bin/bash
# LMS Vanilla Deployment - Safe Initialization
#
# This script initializes the LMS application
# It will NOT delete existing data or configurations
#
# To reinitialize with a fresh database, manually remove:
# 1. The site: bench --site lms.seemplifyai.com drop-site --force
# 2. Then run this script

echo "Initializing LMS application..."

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

# Get fresh LMS app from GitHub
bench get-app lms

# Create new site with fresh database
bench new-site lms.seemplifyai.com \
--force \
--mariadb-root-password ${MYSQL_ROOT_PASSWORD:-123} \
--admin-password admin123 \
--no-mariadb-socket

bench --site lms.seemplifyai.com install-app lms
bench --site lms.seemplifyai.com set-config developer_mode 1

# Set branding to "LMS by AIIN"
bench --site lms.seemplifyai.com execute "frappe.db.set_single_value('Website Settings', 'app_name', 'LMS by AIIN')"
bench --site lms.seemplifyai.com execute "frappe.db.set_single_value('System Settings', 'app_name', 'LMS by AIIN')"
bench --site lms.seemplifyai.com execute "frappe.db.commit()"

# Update site_config.json with app_name and host_name
python3 -c "import json; f='/home/frappe/frappe-bench/sites/lms.seemplifyai.com/site_config.json'; d=json.load(open(f)); d['app_name']='LMS by AIIN'; d['host_name']='lms.seemplifyai.com'; json.dump(d, open(f, 'w'), indent=1)"

bench --site lms.seemplifyai.com clear-cache
bench use lms.seemplifyai.com

bench start
