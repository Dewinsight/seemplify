#!/bin/bash
# Configure LMS site with Brevo SMTP from Identityprovider/.env or runtime env.
# Run from container: bash /workspace-lms/docker/setup-brevo-email.sh
# Args:
#   $1 optional env file path (default: /workspace-idp-env)
#   $2 optional site name (default: LMS_SITE_NAME -> LMS_HOSTNAME -> localhost)

set -euo pipefail
ENV_FILE="${1:-/workspace-idp-env}"
SITE_NAME_VALUE="${2:-${LMS_SITE_NAME:-${LMS_HOSTNAME:-localhost}}}"

# Ensure bench is on PATH in container modes that don't load .profile
export PATH="/home/frappe/.local/bin:${PATH}"

# Optional env file mount. If missing, rely on process environment.
if [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r key value; do
    case "$key" in
      BREVO_*|SENDER_EMAIL|SENDER_NAME|SMTP_LOGIN|SMTP_PASS|FROM_EMAIL)
        export "$key=$value"
        ;;
    esac
  done < <(grep -v '^#' "$ENV_FILE" | grep -E '^[A-Za-z_][A-Za-z0-9_]*=') 2>/dev/null || true
else
  echo "No env file at $ENV_FILE - using existing environment variables if present"
fi

# Brevo SMTP credentials:
#   password: SMTP key (preferred), fallback to BREVO_API_KEY for backward compatibility
#   login   : Brevo SMTP login user (can differ from FROM_EMAIL)
SMTP_PASS="${BREVO_SMTP_KEY:-${SMTP_PASS:-${BREVO_API_KEY:-}}}"
FROM_EMAIL="${BREVO_FROM_EMAIL:-${FROM_EMAIL:-${SENDER_EMAIL:-}}}"
SMTP_LOGIN="${BREVO_SMTP_LOGIN:-${SMTP_LOGIN:-$FROM_EMAIL}}"

if [ -z "$SMTP_PASS" ] || [ -z "$FROM_EMAIL" ]; then
  echo "Brevo config incomplete: need BREVO_SMTP_KEY (or BREVO_API_KEY) and FROM email"
  exit 0
fi

if [ -z "${BREVO_SMTP_KEY:-}" ] && [ -n "${BREVO_API_KEY:-}" ]; then
  echo "Warning: using BREVO_API_KEY as SMTP password. Prefer BREVO_SMTP_KEY from Brevo SMTP settings."
fi

cd /home/frappe/frappe-bench
echo "Configuring Brevo SMTP for LMS site: ${SITE_NAME_VALUE} ..."

SITE_CONFIG_PATH="/home/frappe/frappe-bench/sites/${SITE_NAME_VALUE}/site_config.json"
SENDER_NAME_VALUE="${SENDER_NAME:-Simplify LMS}"

# Site config updates are nice-to-have, but email sending primarily relies on the
# default outgoing Email Account. Don't fail hard if site_config.json isn't writable.
if [ -w "${SITE_CONFIG_PATH}" ]; then
  bench --site "${SITE_NAME_VALUE}" set-config mail_server "smtp-relay.brevo.com" || true
  bench --site "${SITE_NAME_VALUE}" set-config mail_port 587 || true
  bench --site "${SITE_NAME_VALUE}" set-config use_tls 1 || true
  bench --site "${SITE_NAME_VALUE}" set-config mail_login "$SMTP_LOGIN" || true
  bench --site "${SITE_NAME_VALUE}" set-config mail_password "$SMTP_PASS" || true
  bench --site "${SITE_NAME_VALUE}" set-config mail_email_id "$FROM_EMAIL" || true
  bench --site "${SITE_NAME_VALUE}" set-config mail_sender_name "$SENDER_NAME_VALUE" || true
else
  echo "Warning: ${SITE_CONFIG_PATH} is not writable; skipping bench set-config and creating Email Account only."
fi

bench --site "${SITE_NAME_VALUE}" clear-cache || true

# Create/update default outgoing Email Account required by signup/reset/login-link.
export SMTP_PASS
export SMTP_LOGIN
export FROM_EMAIL
if bench --site "${SITE_NAME_VALUE}" execute lms.docker.setup_email_account.setup_brevo_email_account; then
  echo "Brevo email configured for ${SITE_NAME_VALUE}."
else
  echo "Brevo SMTP config saved, but Email Account validation failed. Check BREVO_SMTP_LOGIN and BREVO_SMTP_KEY."
fi
