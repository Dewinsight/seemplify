#!/bin/bash
# Configure LMS site with Brevo SMTP from Identityprovider/.env or runtime env.
# Run from container: bash /workspace-lms/docker/setup-brevo-email.sh
# Args:
#   $1 optional env file path (default: /workspace-idp-env)
#   $2 optional site name (default: LMS_SITE_NAME -> LMS_HOSTNAME -> localhost)

set -euo pipefail
ENV_FILE="${1:-/workspace-idp-env}"
SITE_NAME_VALUE="${2:-${LMS_SITE_NAME:-${LMS_HOSTNAME:-localhost}}}"

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
bench --site "${SITE_NAME_VALUE}" set-config mail_server "smtp-relay.brevo.com"
bench --site "${SITE_NAME_VALUE}" set-config mail_port 587
bench --site "${SITE_NAME_VALUE}" set-config use_tls 1
bench --site "${SITE_NAME_VALUE}" set-config mail_login "$SMTP_LOGIN"
bench --site "${SITE_NAME_VALUE}" set-config mail_password "$SMTP_PASS"
bench --site "${SITE_NAME_VALUE}" set-config mail_email_id "$FROM_EMAIL"
bench --site "${SITE_NAME_VALUE}" clear-cache

# Create/update default outgoing Email Account required by signup/reset/login-link.
export SMTP_PASS
export SMTP_LOGIN
export FROM_EMAIL
if bench --site "${SITE_NAME_VALUE}" execute lms.docker.setup_email_account.setup_brevo_email_account; then
  echo "Brevo email configured for ${SITE_NAME_VALUE}."
else
  echo "Brevo SMTP config saved, but Email Account validation failed. Check BREVO_SMTP_LOGIN and BREVO_SMTP_KEY."
fi
