#!/usr/bin/env bash
set -euo pipefail
# Caller holds the canonical production deployment lock. No app recreation.
source_root="$(cd "$(dirname "$0")" && pwd)"
target=/opt/seemplify/deploy/hostinger
install -d -m 755 "$target"
for script in runner-cache-maintenance.py storage-maintenance.py backup-hostinger.sh restore-smoke-hostinger.sh; do
  install -m 755 "$source_root/$script" "$target/$script"
done
install -m 755 "$source_root/backup-hostinger.sh" /usr/local/sbin/seemplify-backup
install -m 755 "$source_root/restore-smoke-hostinger.sh" /usr/local/sbin/seemplify-restore-smoke
for unit in seemplify-runner-cache.service seemplify-runner-cache.timer; do
  install -m 644 "$source_root/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable --now seemplify-runner-cache.timer
# The timer acquires both deployment and CI locks itself after this installer
# exits; starting its service here would race our enclosing deployment lock.
systemctl is-enabled seemplify-runner-cache.timer
systemctl is-active seemplify-runner-cache.timer
sha256sum "$target/runner-cache-maintenance.py" "$target/storage-maintenance.py" /usr/local/sbin/seemplify-backup
