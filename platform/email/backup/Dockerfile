FROM alpine:3.20

RUN apk add --no-cache age aws-cli bash coreutils gzip mariadb-client tar tzdata

COPY backup.sh restore.sh lifecycle.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/lifecycle.sh

ENTRYPOINT ["/usr/local/bin/backup.sh"]
