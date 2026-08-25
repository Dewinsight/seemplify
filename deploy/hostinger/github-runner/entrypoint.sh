#!/usr/bin/env bash
set -euo pipefail

cd /runner

if [[ ! -f .runner ]]; then
  : "${RUNNER_URL:?RUNNER_URL is required for first registration}"
  : "${RUNNER_TOKEN:?RUNNER_TOKEN is required for first registration}"
  : "${RUNNER_NAME:?RUNNER_NAME is required for first registration}"

  config_args=(
    --unattended
    --url "$RUNNER_URL"
    --token "$RUNNER_TOKEN"
    --name "$RUNNER_NAME"
    --work "${RUNNER_WORKDIR:-_work}"
    --labels "${RUNNER_LABELS:-dewinsight-kvm8}"
    --replace
  )

  if [[ -n "${RUNNER_GROUP:-}" ]]; then
    config_args+=(--runnergroup "$RUNNER_GROUP")
  fi

  ./config.sh "${config_args[@]}"
fi

exec ./run.sh
