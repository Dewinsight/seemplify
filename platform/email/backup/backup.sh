#!/usr/bin/env bash
set -euo pipefail
umask 077

die() { printf '[backup] FATAL %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }
required() { [ -n "${!1:-}" ] || die "$1 is required"; }

for tool in age aws mariadb-dump sha256sum tar gzip; do need "$tool"; done
for name in BACKUP_MARIADB_HOST BACKUP_MARIADB_DATABASE BACKUP_MARIADB_USER \
  BACKUP_MARIADB_PASSWORD BACKUP_AGE_RECIPIENT BACKUP_R2_BUCKET BACKUP_R2_ENDPOINT \
  AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do required "$name"; done

case "$BACKUP_AGE_RECIPIENT" in age1*) ;; *) die 'BACKUP_AGE_RECIPIENT must be an age public recipient';; esac
prefix="${BACKUP_R2_PREFIX:-seemplify-mail}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work="/work/${stamp}.partial"
final="/work/${stamp}"
rm -rf -- "$work" "$final"
mkdir -p "$work/payload"

export MYSQL_PWD="$BACKUP_MARIADB_PASSWORD"
mariadb-dump --host="$BACKUP_MARIADB_HOST" --user="$BACKUP_MARIADB_USER" \
  --single-transaction --quick --routines --events --triggers --all-databases \
  | gzip -9 > "$work/payload/mariadb.sql.gz"
unset MYSQL_PWD BACKUP_MARIADB_PASSWORD

tar -C /source/postal-config -czf "$work/payload/postal-config.tar.gz" .
tar -C /source/mail-api-data -czf "$work/payload/mail-api-state.tar.gz" .
(cd "$work/payload" && sha256sum mariadb.sql.gz postal-config.tar.gz mail-api-state.tar.gz > SHA256SUMS)
printf '{"schema":"seemplify-mail-backup/1","createdAt":"%s","retentionDays":%s}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${BACKUP_RETENTION_DAYS:-14}" > "$work/payload/manifest.json"

tar -C "$work/payload" -cf - . | age -r "$BACKUP_AGE_RECIPIENT" -o "$work/seemplify-mail-${stamp}.tar.age"
sha256sum "$work/seemplify-mail-${stamp}.tar.age" > "$work/seemplify-mail-${stamp}.tar.age.sha256"
mv "$work" "$final"

object="s3://${BACKUP_R2_BUCKET}/${prefix}/nightly/${stamp}/"
aws --endpoint-url "$BACKUP_R2_ENDPOINT" s3 cp --only-show-errors \
  "$final/seemplify-mail-${stamp}.tar.age" "${object}seemplify-mail-${stamp}.tar.age"
aws --endpoint-url "$BACKUP_R2_ENDPOINT" s3 cp --only-show-errors \
  "$final/seemplify-mail-${stamp}.tar.age.sha256" "${object}seemplify-mail-${stamp}.tar.age.sha256"

printf '[backup] uploaded encrypted snapshot %s\n' "$stamp"
rm -rf -- "$final"
