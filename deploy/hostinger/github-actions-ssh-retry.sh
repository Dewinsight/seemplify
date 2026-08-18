#!/usr/bin/env bash

# Shared GitHub Actions transport helpers for the Hostinger production host.
# Callers are expected to configure ~/.ssh before using these functions.

hostinger_retry() {
  local label="$1"
  shift

  local max_attempts="${HOSTINGER_RETRY_MAX_ATTEMPTS:-5}"
  local base_delay="${HOSTINGER_RETRY_BASE_DELAY_SECONDS:-5}"
  local attempt exit_code delay

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

hostinger_scp() {
  hostinger_retry 'Hostinger upload' scp "$@"
}

hostinger_ssh_command() {
  hostinger_retry 'Hostinger SSH command' ssh "$@"
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
