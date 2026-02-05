#!/bin/sh
# Injects TURN_AUTH_SECRET and COTURN_EXTERNAL_IP into coturn config and starts coturn.

set -e

CONF_SRC=/etc/coturn/turnserver.conf
CONF=/tmp/turnserver.conf
cp "$CONF_SRC" "$CONF"
if [ -n "$TURN_AUTH_SECRET" ]; then
  echo "static-auth-secret=$TURN_AUTH_SECRET" >> "$CONF"
fi
if [ -n "$COTURN_EXTERNAL_IP" ]; then
  echo "external-ip=$COTURN_EXTERNAL_IP" >> "$CONF"
fi
exec turnserver -c "$CONF"
