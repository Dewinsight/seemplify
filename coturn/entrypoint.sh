#!/bin/sh
# Injects TURN_AUTH_SECRET and routable TURN addresses into coturn config.

set -e

CONF_SRC=/etc/coturn/turnserver.conf
CONF=/tmp/turnserver.conf
cp "$CONF_SRC" "$CONF"
if [ -n "$TURN_AUTH_SECRET" ]; then
  echo "static-auth-secret=$TURN_AUTH_SECRET" >> "$CONF"
fi
RELAY_IP=${COTURN_RELAY_IP:-$COTURN_EXTERNAL_IP}
if [ -n "$RELAY_IP" ]; then
  echo "relay-ip=$RELAY_IP" >> "$CONF"
else
  echo "relay-ip=0.0.0.0" >> "$CONF"
fi
if [ -n "$COTURN_EXTERNAL_IP" ]; then
  echo "external-ip=$COTURN_EXTERNAL_IP" >> "$CONF"
fi
exec turnserver -c "$CONF"
