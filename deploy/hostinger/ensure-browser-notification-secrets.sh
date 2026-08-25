#!/usr/bin/env bash
set -euo pipefail

core_env=${SEEMPLIFY_CORE_ENV_FILE:-/opt/seemplify/secrets/core-apps.env}
workspace_env=${SEEMPLIFY_WORKSPACE_ENV_FILE:-/opt/seemplify/secrets/workspace.env}
identity_image=${IDENTITY_PROVIDER_IMAGE:?IDENTITY_PROVIDER_IMAGE is required}

if [[ ! -f $core_env || ! -f $workspace_env ]]; then
  printf 'The protected core or Workspace environment file is missing.\n' >&2
  exit 1
fi

read_env_value() {
  local file=$1 key=$2
  awk -F= -v key="$key" '
    $1 == key { value = substr($0, index($0, "=") + 1) }
    END { print value }
  ' "$file"
}

write_env_value() {
  local file=$1 key=$2 value=$3 directory temporary
  directory=$(dirname "$file")
  temporary=$(mktemp "$directory/.browser-notification-env.XXXXXX")
  awk -F= -v key="$key" '$1 != key { print }' "$file" >"$temporary"
  printf '%s=%s\n' "$key" "$value" >>"$temporary"
  chown --reference="$file" "$temporary"
  chmod --reference="$file" "$temporary"
  mv -f "$temporary" "$file"
}

relay_key_id=$(read_env_value "$core_env" SEEMPLIFY_NOTIFICATION_RELAY_KEY_ID)
relay_hmac=$(read_env_value "$core_env" SEEMPLIFY_NOTIFICATION_RELAY_HMAC_KEY)
web_push_subject=$(read_env_value "$core_env" WEB_PUSH_SUBJECT)
web_push_public=$(read_env_value "$core_env" WEB_PUSH_PUBLIC_KEY)
web_push_private=$(read_env_value "$core_env" WEB_PUSH_PRIVATE_KEY)

relay_key_id=${relay_key_id:-workspace-browser-v1}
web_push_subject=${web_push_subject:-mailto:support@seemplifyai.com}
if [[ -z $relay_hmac ]]; then
  relay_hmac=$(openssl rand -base64 48 | tr -d '\n')
fi
if [[ -z $web_push_public || -z $web_push_private ]]; then
  vapid_json=$(docker run --rm --entrypoint node "$identity_image" \
    --input-type=module -e \
    'import webpush from "web-push"; process.stdout.write(JSON.stringify(webpush.generateVAPIDKeys()))')
  web_push_public=$(jq -er '.publicKey' <<<"$vapid_json")
  web_push_private=$(jq -er '.privateKey' <<<"$vapid_json")
fi

for required in relay_key_id relay_hmac web_push_subject web_push_public web_push_private; do
  value=${!required}
  if [[ -z $value || $value == *$'\n'* || $value == *$'\r'* ]]; then
    printf 'Refusing invalid browser-notification secret material.\n' >&2
    exit 1
  fi
done

write_env_value "$core_env" SEEMPLIFY_NOTIFICATION_RELAY_KEY_ID "$relay_key_id"
write_env_value "$core_env" SEEMPLIFY_NOTIFICATION_RELAY_HMAC_KEY "$relay_hmac"
write_env_value "$core_env" WEB_PUSH_SUBJECT "$web_push_subject"
write_env_value "$core_env" WEB_PUSH_PUBLIC_KEY "$web_push_public"
write_env_value "$core_env" WEB_PUSH_PRIVATE_KEY "$web_push_private"

write_env_value "$workspace_env" SEEMPLIFY_NOTIFICATION_RELAY_URL \
  'https://auth.seemplifyai.com/api/internal/browser-notifications'
write_env_value "$workspace_env" SEEMPLIFY_NOTIFICATION_RELAY_KEY_ID "$relay_key_id"
write_env_value "$workspace_env" SEEMPLIFY_NOTIFICATION_RELAY_HMAC_KEY "$relay_hmac"
write_env_value "$workspace_env" WEB_PUSH_PUBLIC_KEY "$web_push_public"

printf 'Browser notification relay secrets are present and synchronized.\n'
