#!/usr/bin/env bash
set -euo pipefail
[ "${1:-}" = '--install' ] || { printf 'Usage: install-backup-timer.sh --install\n'; exit 2; }
: "${SEEMPLIFY_MAIL_COMPOSE_DIR:?Set SEEMPLIFY_MAIL_COMPOSE_DIR}"
command -v systemctl >/dev/null 2>&1 || { printf 'systemd is required\n' >&2; exit 1; }
cat > /etc/systemd/system/seemplify-mail-backup.service <<EOF
[Unit]
Description=Encrypted Seemplify mail backup to R2
After=docker.service
[Service]
Type=oneshot
WorkingDirectory=${SEEMPLIFY_MAIL_COMPOSE_DIR}
ExecStart=/usr/bin/docker compose --profile backup run --rm mail-backup
EOF
cat > /etc/systemd/system/seemplify-mail-backup.timer <<'EOF'
[Unit]
Description=Nightly Seemplify mail backup
[Timer]
OnCalendar=*-*-* 02:15:00 UTC
Persistent=true
RandomizedDelaySec=900
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now seemplify-mail-backup.timer
systemctl list-timers seemplify-mail-backup.timer --no-pager
