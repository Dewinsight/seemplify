#!/bin/sh
set -eu

log() { printf '[relay] %s\n' "$*"; }
die() { printf '[relay] FATAL: %s\n' "$*" >&2; exit 1; }

upstream_host="${RELAY_UPSTREAM_HOST:-smtp.gmail.com}"
upstream_port="${RELAY_UPSTREAM_PORT:-587}"
smtp_username="${RELAY_SMTP_USERNAME:-}"
password_file="${RELAY_PASSWORD_FILE:-/run/secrets/relay_smtp_password}"
runtime_secret="${RELAY_RUNTIME_SECRET_PATH:-/run/relay/relay_smtp_password}"
allowed_networks="${RELAY_ALLOWED_NETWORKS:-}"
sender_domain="${RELAY_SENDER_DOMAIN:-dewinsight.com}"

[ -n "$smtp_username" ] || die 'RELAY_SMTP_USERNAME is required.'
[ -n "$allowed_networks" ] || die 'RELAY_ALLOWED_NETWORKS is required.'

# Every file this script creates holds the Google app password in some form.
umask 077

# Two credential sources, in priority order:
#
#   1. RELAY_SMTP_PASSWORD, set by protected Dokploy environment
#      configuration. It is materialized into a private runtime file and the
#      variable is dropped immediately, so it is absent from the environment
#      Postfix is executed with and from /proc/<pid>/environ of every child.
#      In production that path is a tmpfs, so the value never reaches a disk.
#   2. RELAY_PASSWORD_FILE, the bind-mounted file the local Windows stack
#      uses. Unchanged, so local development keeps working exactly as before.
if [ -n "${RELAY_SMTP_PASSWORD:-}" ]; then
  secret_dir="$(dirname "$runtime_secret")"
  mkdir -p "$secret_dir" || die 'Could not create the runtime secret directory.'
  chmod 0700 "$secret_dir"
  # Create the file before writing so it is never briefly world-readable.
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

postconf -e "relayhost = [${upstream_host}]:${upstream_port}"
postconf -e "mynetworks = ${allowed_networks}"
postconf -e "smtp_helo_name = ${sender_domain}"
postconf -F '*/*/chroot = n'
postfix check

log "Authenticated Google submission is enabled for ${smtp_username} via ${upstream_host}:${upstream_port}."
log "Only ${allowed_networks} may submit; outbound Seemplify senders are normalized to Dew Insight."
exec postfix start-fg
