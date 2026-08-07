#!/usr/bin/env bash
set -euo pipefail

[ "${1:-}" = '--apply' ] || { printf 'Usage: lifecycle.sh --apply\nApplies a 14-day R2 lifecycle rule. It is never run automatically.\n'; exit 2; }
: "${BACKUP_R2_BUCKET:?BACKUP_R2_BUCKET is required}"
: "${BACKUP_R2_ENDPOINT:?BACKUP_R2_ENDPOINT is required}"
days="${BACKUP_RETENTION_DAYS:-14}"
case "$days" in ''|*[!0-9]*) printf 'BACKUP_RETENTION_DAYS must be numeric\n' >&2; exit 2;; esac
[ "$days" -eq 14 ] || { printf 'This deployment requires exactly 14 days retention.\n' >&2; exit 2; }
prefix="${BACKUP_R2_PREFIX:-seemplify-mail}/nightly/"
file="$(mktemp)"; trap 'rm -f -- "$file"' EXIT
printf '{"Rules":[{"ID":"seemplify-mail-14-day-retention","Status":"Enabled","Filter":{"Prefix":"%s"},"Expiration":{"Days":14}}]}\n' "$prefix" > "$file"
aws --endpoint-url "$BACKUP_R2_ENDPOINT" s3api put-bucket-lifecycle-configuration \
  --bucket "$BACKUP_R2_BUCKET" --lifecycle-configuration "file://${file}"
printf '[backup] applied 14-day lifecycle rule to the configured prefix\n'
