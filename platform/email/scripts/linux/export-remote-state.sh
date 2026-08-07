#!/usr/bin/env bash
set -euo pipefail

PROJECT='seemplify-mail-prod'; OUTPUT=''
while [ $# -gt 0 ]; do case "$1" in --project) PROJECT="${2:-}"; shift 2;; --output) OUTPUT="${2:-}"; shift 2;; *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2;; esac; done
[ -n "$OUTPUT" ] || { printf 'Pass --output <directory>\n' >&2; exit 2; }
mkdir -p "$OUTPUT"; chmod 0700 "$OUTPUT"
resolve() { docker ps --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=$1" --format '{{.Names}}'; }
db="$(resolve mariadb)"; [ "$(printf '%s\n' "$db"|grep -c .)" -eq 1 ] || { printf 'MariaDB target is ambiguous\n' >&2; exit 1; }
docker exec "$db" sh -c 'exec mariadb-dump --user=root --password="$MARIADB_ROOT_PASSWORD" --single-transaction --quick --routines --events --triggers --all-databases' | gzip -9 > "$OUTPUT/mariadb.sql.gz"
for spec in 'postal-config:postal-config.tar.gz' 'mail-api-data:mail-api-state.tar.gz'; do vol="${spec%%:*}"; archive="${spec#*:}"; docker run --rm --network none -v "${PROJECT}_${vol}:/source:ro" alpine:3.20 tar -C /source -czf - . > "$OUTPUT/$archive"; done
(cd "$OUTPUT" && sha256sum mariadb.sql.gz postal-config.tar.gz mail-api-state.tar.gz > SHA256SUMS)
printf '[remote-export] state exported to %s\n' "$OUTPUT"
