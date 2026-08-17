#!/bin/sh
set -eu

log() { printf '[relay] %s\n' "$*"; }
die() { printf '[relay] FATAL: %s\n' "$*" >&2; exit 1; }

upstream_host="${RELAY_UPSTREAM_HOST:-smtp.gmail.com}"
upstream_port="${RELAY_UPSTREAM_PORT:-587}"
smtp_auth_mode="${RELAY_SMTP_AUTH_MODE:-password}"
smtp_username="${RELAY_SMTP_USERNAME:-}"
password_file="${RELAY_PASSWORD_FILE:-/run/secrets/relay_smtp_password}"
runtime_secret="${RELAY_RUNTIME_SECRET_PATH:-/run/relay/relay_smtp_password}"
allowed_networks="${RELAY_ALLOWED_NETWORKS:-}"
sender_domain="${RELAY_SENDER_DOMAIN:-dewinsight.com}"

[ -n "$allowed_networks" ] || die 'RELAY_ALLOWED_NETWORKS is required.'

# Any credential file this script creates must stay private.
umask 077

case "$smtp_auth_mode" in
  ip)
    [ "$upstream_host" = 'smtp-relay.gmail.com' ] || die 'IP-authenticated Google Workspace relay must use smtp-relay.gmail.com.'
    postconf -e 'smtp_sasl_auth_enable = no'
    postconf -X smtp_sasl_password_maps 2>/dev/null || true
    rm -f /etc/postfix/sasl_passwd
    log "Google Workspace IP-authenticated relay is enabled via ${upstream_host}:${upstream_port}."
    ;;
  password)
    [ -n "$smtp_username" ] || die 'RELAY_SMTP_USERNAME is required in password mode.'

    # Two credential sources, in priority order:
    #
    #   1. RELAY_SMTP_PASSWORD, set by protected Dokploy environment
    #      configuration. It is materialized into a private runtime file and
    #      dropped from the environment before Postfix starts.
    #   2. RELAY_PASSWORD_FILE, the bind-mounted file used by local development.
    if [ -n "${RELAY_SMTP_PASSWORD:-}" ]; then
      secret_dir="$(dirname "$runtime_secret")"
      mkdir -p "$secret_dir" || die 'Could not create the runtime secret directory.'
      chmod 0700 "$secret_dir"
      : > "$runtime_secret"
      chmod 0600 "$runtime_secret"
      printf '%s' "$RELAY_SMTP_PASSWORD" > "$runtime_secret"
      unset RELAY_SMTP_PASSWORD
      password_file="$runtime_secret"
      log "Credential materialized from protected environment configuration into ${runtime_secret} (mode 0600); the variable is no longer set."
    fi

    [ -r "$password_file" ] && [ -s "$password_file" ] || die 'No Google app password is available: set RELAY_SMTP_PASSWORD, or mount RELAY_PASSWORD_FILE.'

    credential="$(tr -d '[:space:]' < "$password_file")"
    [ "${#credential}" -eq 16 ] || die 'The Google app password must contain 16 letters after spaces are removed.'
    case "$credential" in *[!a-z]*) die 'The Google app password contains invalid characters.' ;; esac

    printf '[%s]:%s %s:%s\n' "$upstream_host" "$upstream_port" "$smtp_username" "$credential" > /etc/postfix/sasl_passwd
    chown root:postfix /etc/postfix/sasl_passwd
    chmod 0640 /etc/postfix/sasl_passwd
    unset credential
    log "Authenticated Google submission is enabled for ${smtp_username} via ${upstream_host}:${upstream_port}."
    ;;
  *)
    die 'RELAY_SMTP_AUTH_MODE must be either ip or password.'
    ;;
esac

postconf -e "relayhost = [${upstream_host}]:${upstream_port}"
postconf -e "mynetworks = ${allowed_networks}"
postconf -e "smtp_helo_name = ${sender_domain}"
postconf -F '*/*/chroot = n'
postfix check

log "Only ${allowed_networks} may submit; HELO identity is ${sender_domain}."
exec postfix start-fg
