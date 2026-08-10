#!/bin/sh
set -eu

umask 077

runtime_dir="${RUNTIME_DIR:-/app/runtime}"
mkdir -p "$runtime_dir" "$runtime_dir/codex" "$runtime_dir/uploads" \
  "$runtime_dir/knowledge" "$runtime_dir/esign"

write_secret() {
  variable_name="$1"
  destination="$2"
  required="$3"
  value="$(printenv "$variable_name" 2>/dev/null || true)"
  if [ -n "$value" ]; then
    printf '%s' "$value" > "$destination"
    chmod 0600 "$destination"
    return
  fi
  if [ -s "$destination" ]; then
    return
  fi
  if [ "$required" = "required" ]; then
    echo "Missing required Dokploy secret: $variable_name" >&2
    exit 1
  fi
  node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))" > "$destination"
  chmod 0600 "$destination"
}

write_secret POSTGRES_PASSWORD "$runtime_dir/postgres-password" required
write_secret POSTGRES_OWNER_PASSWORD "$runtime_dir/postgres-owner-password" required
write_secret ADMIN_PASSWORD "$runtime_dir/admin-password" optional
write_secret SESSION_SECRET "$runtime_dir/session-secret" optional
write_secret JOURNEY_IDENTITY_HASH_KEY "$runtime_dir/journey-identity-hash-key" optional
write_secret ESIGN_ENCRYPTION_KEY "$runtime_dir/esign-encryption-key" optional
write_secret NYLAS_CREDENTIAL_ENCRYPTION_KEY "$runtime_dir/nylas-credential-encryption-key" optional
write_secret BREVO_WEBHOOK_SECRET "$runtime_dir/brevo-webhook-secret" optional
write_secret X_CREDENTIAL_ENCRYPTION_KEY "$runtime_dir/x-credential-encryption-key" optional

export POSTGRES_PASSWORD_FILE="$runtime_dir/postgres-password"
export POSTGRES_OWNER_PASSWORD_FILE="$runtime_dir/postgres-owner-password"
export ADMIN_PASSWORD_FILE="$runtime_dir/admin-password"
export SESSION_SECRET_FILE="$runtime_dir/session-secret"
export JOURNEY_IDENTITY_HASH_KEY_FILE="$runtime_dir/journey-identity-hash-key"
export ESIGN_ENCRYPTION_KEY_FILE="$runtime_dir/esign-encryption-key"
export NYLAS_CREDENTIAL_ENCRYPTION_KEY_FILE="$runtime_dir/nylas-credential-encryption-key"
export BREVO_WEBHOOK_SECRET_FILE="$runtime_dir/brevo-webhook-secret"
export X_CREDENTIAL_ENCRYPTION_KEY_FILE="$runtime_dir/x-credential-encryption-key"
export CODEX_RUNTIME_DIR="$runtime_dir/codex"
export UPLOAD_DIR="$runtime_dir/uploads"
export KNOWLEDGE_STORAGE_DIR="$runtime_dir/knowledge"
export ESIGN_STORAGE_DIR="$runtime_dir/esign"

node scripts/dokploy-runtime-migrate.mjs
exec node backend/dist/server.js
