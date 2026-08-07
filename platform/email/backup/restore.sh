#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() { printf 'Usage: restore.sh --object-prefix s3://bucket/prefix/timestamp --identity /run/secrets/age-key --output /restore\n'; }
die() { printf '[restore-backup] FATAL %s\n' "$*" >&2; exit 1; }

object=''; identity=''; output=''
while [ $# -gt 0 ]; do
  case "$1" in
    --object-prefix) object="${2:-}"; shift 2;;
    --identity) identity="${2:-}"; shift 2;;
    --output) output="${2:-}"; shift 2;;
    -h|--help) usage; exit 0;;
    *) die "unknown argument: $1";;
  esac
done
[ -n "$object" ] && [ -n "$identity" ] && [ -n "$output" ] || { usage >&2; exit 2; }
[ -r "$identity" ] || die 'age identity is not readable'
[ -n "${BACKUP_R2_ENDPOINT:-}" ] || die 'BACKUP_R2_ENDPOINT is required'

name="${object##*/}"
case "$name" in *T*Z) ;; *) die 'object prefix must end with a timestamp';; esac
tmp="$(mktemp -d)"; trap 'rm -rf -- "$tmp"' EXIT
encrypted="seemplify-mail-${name}.tar.age"
aws --endpoint-url "$BACKUP_R2_ENDPOINT" s3 cp --only-show-errors "${object}/${encrypted}" "$tmp/$encrypted"
aws --endpoint-url "$BACKUP_R2_ENDPOINT" s3 cp --only-show-errors "${object}/${encrypted}.sha256" "$tmp/${encrypted}.sha256"
(cd "$tmp" && sha256sum -c "${encrypted}.sha256") || die 'encrypted object checksum failed'
mkdir -p "$tmp/plain" "$output"
age -d -i "$identity" "$tmp/$encrypted" | tar -C "$tmp/plain" -xf -
(cd "$tmp/plain" && sha256sum -c SHA256SUMS) || die 'decrypted payload checksum failed'
for file in mariadb.sql.gz postal-config.tar.gz mail-api-state.tar.gz manifest.json; do
  [ -f "$tmp/plain/$file" ] || die "$file is missing"
done
cp -a "$tmp/plain/." "$output/"
printf '[restore-backup] verified backup restored to %s; no database or volume was modified\n' "$output"
