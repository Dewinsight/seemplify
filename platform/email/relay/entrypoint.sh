#!/bin/sh
set -eu

log() { printf '[relay] %s\n' "$*"; }
die() { printf '[relay] FATAL: %s\n' "$*" >&2; exit 1; }

upstream_host="${RELAY_UPSTREAM_HOST:-smtp.gmail.com}"
upstream_port="${RELAY_UPSTREAM_PORT:-587}"
smtp_username="${RELAY_SMTP_USERNAME:-}"
password_file="${RELAY_PASSWORD_FILE:-/run/secrets/relay_smtp_password}"
allowed_networks="${RELAY_ALLOWED_NETWORKS:-}"
sender_domain="${RELAY_SENDER_DOMAIN:-dewinsight.com}"

[ -n "$smtp_username" ] || die 'RELAY_SMTP_USERNAME is required.'
[ -n "$allowed_networks" ] || die 'RELAY_ALLOWED_NETWORKS is required.'
[ -r "$password_file" ] && [ -s "$password_file" ] || die 'The Google app-password file is missing or empty.'

credential="$(tr -d '[:space:]' < "$password_file")"
[ "${#credential}" -eq 16 ] || die 'The Google app password must contain 16 letters after spaces are removed.'
case "$credential" in *[!a-z]*) die 'The Google app password contains invalid characters.' ;; esac

umask 077
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
