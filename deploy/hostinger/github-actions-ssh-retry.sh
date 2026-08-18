#!/usr/bin/env bash

# Shared GitHub Actions transport helpers for the Hostinger production host.
# Callers are expected to configure ~/.ssh before using these functions.

hostinger_retry() {
  local label="$1"
  shift

  local max_attempts="${HOSTINGER_RETRY_MAX_ATTEMPTS:-5}"
  local base_delay="${HOSTINGER_RETRY_BASE_DELAY_SECONDS:-5}"
  local initial_jitter="${HOSTINGER_RETRY_INITIAL_JITTER_SECONDS:-8}"
  local attempt exit_code delay

  if (( initial_jitter > 0 )); then
    delay=$((RANDOM % (initial_jitter + 1)))
    if (( delay > 0 )); then
      printf '%s waiting %ss before the first connection attempt.\n' "$label" "$delay" >&2
      sleep "$delay"
    fi
  fi

  for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
    if "$@"; then
      return 0
    else
      exit_code=$?
    fi

    if (( attempt == max_attempts )); then
      printf '%s failed after %s attempts (exit %s).\n' \
        "$label" "$max_attempts" "$exit_code" >&2
      return "$exit_code"
    fi

    delay=$((base_delay * (1 << (attempt - 1))))
    printf '%s attempt %s/%s failed (exit %s); retrying in %ss.\n' \
      "$label" "$attempt" "$max_attempts" "$exit_code" "$delay" >&2
    sleep "$delay"
  done
}

hostinger_ssh_command() {
  hostinger_retry 'Hostinger SSH command' ssh "$@"
}

hostinger_upload_with_lock() {
  local local_file="$1"
  local ssh_target="$2"
  local remote_file="$3"

  [[ -f "$local_file" ]] || {
    printf 'Upload source does not exist: %s\n' "$local_file" >&2
    return 2
  }
  [[ "$remote_file" =~ ^/[A-Za-z0-9._/-]+$ ]] || {
    printf 'Refusing unsafe remote upload path: %s\n' "$remote_file" >&2
    return 2
  }

  _hostinger_upload_attempt() {
    ssh "$ssh_target" \
      "REMOTE_FILE='$remote_file' flock --exclusive --wait 1800 /var/lock/seemplify-production-deploy.lock bash -c 'umask 077; command cat > \"\$REMOTE_FILE\"'" \
      <"$local_file"
  }

  hostinger_retry 'Hostinger locked upload' _hostinger_upload_attempt
}

hostinger_ssh_stdin() {
  local stdin_file exit_code
  stdin_file=$(mktemp)
  chmod 600 "$stdin_file"
  command cat >"$stdin_file"

  _hostinger_ssh_stdin_attempt() {
    ssh "$@" <"$stdin_file"
  }

  if hostinger_retry 'Hostinger SSH script' _hostinger_ssh_stdin_attempt "$@"; then
    exit_code=0
  else
    exit_code=$?
  fi
  rm -f "$stdin_file"
  return "$exit_code"
}
