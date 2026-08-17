#!/usr/bin/env bash
set -euo pipefail

env_file=${1:-/opt/seemplify/secrets/mail.env}
compose_file=${2:-/opt/seemplify/deploy/hostinger/mail.compose.yml}

set -a
# shellcheck disable=SC1090
. "$env_file"
set +a

compose=(docker compose --env-file "$env_file" -f "$compose_file")
config_volume=seemplify-mail_postal_config

docker volume create "$config_volume" >/dev/null

docker run --rm \
  --user 0:0 \
  -e MARIADB_PASSWORD \
  -e POSTAL_RAILS_SECRET \
  -v "$config_volume:/config" \
  --entrypoint sh \
  ghcr.io/postalserver/postal:3.3.7 -euc '
    umask 077
    if [ ! -s /config/postal.yml ]; then
      cat > /config/postal.yml <<EOF
version: 2

postal:
  web_hostname: postal.seemplifyai.com
  web_protocol: https
  smtp_hostname: postal.seemplifyai.com
  use_ip_pools: false
  smtp_relays:
    - smtp://postfix-relay:25
  signing_key_path: /config/signing.key

web_server:
  default_port: 5000
  default_bind_address: 0.0.0.0

main_db:
  host: mariadb
  username: postal
  password: ${MARIADB_PASSWORD}
  database: postal

message_db:
  host: mariadb
  username: postal
  password: ${MARIADB_PASSWORD}
  prefix: postal

smtp_server:
  default_port: 25
  default_bind_address: 0.0.0.0

dns:
  mx_records:
    - postal.seemplifyai.com
  spf_include: postal.seemplifyai.com
  return_path_domain: bounce.seemplifyai.com
  route_domain: routes.seemplifyai.com
  track_domain: track.seemplifyai.com

smtp:
  host: postfix-relay
  port: 25
  from_name: Seemplify
  from_address: no-reply@dewinsight.com

rails:
  secret_key: ${POSTAL_RAILS_SECRET}
EOF
      openssl genrsa -out /config/signing.key 2048 >/dev/null 2>&1
      chown 999:999 /config/postal.yml /config/signing.key
      chmod 0600 /config/postal.yml /config/signing.key
    fi
  '

"${compose[@]}" up -d --build mariadb postfix-relay

for _ in $(seq 1 60); do
  state=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' seemplify-mail-mariadb-1 2>/dev/null || true)
  [ "$state" = healthy ] && break
  sleep 2
done
[ "${state:-}" = healthy ] || { echo 'MariaDB did not become healthy.' >&2; exit 1; }

docker exec seemplify-mail-mariadb-1 sh -euc '
  mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" <<SQL
GRANT ALL PRIVILEGES ON postal.* TO '\''postal'\''@'\''%'\'';
GRANT ALL PRIVILEGES ON \`postal-%\`.* TO '\''postal'\''@'\''%'\'';
FLUSH PRIVILEGES;
SQL
'

"${compose[@]}" run --rm --no-deps --entrypoint postal postal-web initialize

user_count=$(docker exec seemplify-mail-mariadb-1 sh -euc \
  'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -Nse "SELECT COUNT(*) FROM postal.users WHERE email_address=\"michael.egbo@dewinsight.com\""')
if [ "$user_count" = 0 ]; then
  printf '%s\n%s\n%s\n%s\n' \
    'michael.egbo@dewinsight.com' 'Michael' 'Egbo' "$POSTAL_ADMIN_PASSWORD" \
    | "${compose[@]}" run --rm --no-deps --entrypoint postal postal-web make-user
fi

"${compose[@]}" run --rm --no-deps \
  --user 0:0 \
  -e POSTAL_ADMIN_EMAIL=michael.egbo@dewinsight.com \
  --entrypoint sh postal-web -euc '
    cd /opt/postal/app
    bundle exec rails runner '\''
      user = User.find_by!(email_address: ENV.fetch("POSTAL_ADMIN_EMAIL"))
      org = Organization.find_or_initialize_by(permalink: "seemplify")
      if org.new_record?
        org.name = "Seemplify"
        org.owner = user
        org.time_zone = "Africa/Lagos"
        org.save!
      end
      OrganizationUser.find_or_create_by!(organization: org, user: user) do |membership|
        membership.admin = true
        membership.all_servers = true
      end
      server = org.servers.find_or_initialize_by(permalink: "transactional")
      if server.new_record?
        server.name = "Seemplify Transactional"
        server.mode = "Live"
        server.save!
      end
      domain = Domain.find_or_create_by!(owner: org, name: "seemplifyai.com") do |record|
        record.verification_method = "DNS"
        record.outgoing = true
        record.incoming = false
      end
      domain.mark_as_verified unless domain.verified?
      credential = server.credentials.find_or_create_by!(name: "Seemplify Mail API", type: "API")
      File.write("/config/mail-api-postal-key", credential.key)
      File.chmod(0600, "/config/mail-api-postal-key")
    '\''
  '

postal_key=$(docker run --rm -v "$config_volume:/config:ro" --entrypoint sh alpine:3.20 -c 'cat /config/mail-api-postal-key')
temp_env=$(mktemp "${env_file}.XXXXXX")
found=0
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    MAIL_API_POSTAL_API_KEY=*)
      printf 'MAIL_API_POSTAL_API_KEY=%s\n' "$postal_key"
      found=1
      ;;
    *) printf '%s\n' "$line" ;;
  esac
done < "$env_file" > "$temp_env"
[ "$found" = 1 ] || printf 'MAIL_API_POSTAL_API_KEY=%s\n' "$postal_key" >> "$temp_env"
chmod 0600 "$temp_env"
mv "$temp_env" "$env_file"
unset postal_key

"${compose[@]}" up -d --build
printf 'mail_stack=%s\n' ready
