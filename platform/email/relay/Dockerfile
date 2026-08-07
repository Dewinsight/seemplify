FROM alpine:3.20

RUN apk add --no-cache postfix cyrus-sasl cyrus-sasl-login ca-certificates \
    && update-ca-certificates \
    && newaliases

COPY main.cf /etc/postfix/main.cf
COPY generic /etc/postfix/generic
COPY entrypoint.sh /usr/local/bin/relay-entrypoint.sh

RUN chmod 0644 /etc/postfix/main.cf /etc/postfix/generic \
    && chmod 0755 /usr/local/bin/relay-entrypoint.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD postfix status >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/usr/local/bin/relay-entrypoint.sh"]
