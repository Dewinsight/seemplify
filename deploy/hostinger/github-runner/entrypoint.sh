#!/usr/bin/env bash
set -euo pipefail

cd /runner

registration_ready=true
for registration_file in .runner .credentials .credentials_rsaparams; do
  if [[ ! -s $registration_file ]]; then registration_ready=false; fi
done

if [[ $registration_ready != true ]]; then
  : "${RUNNER_URL:?RUNNER_URL is required for first registration}"
  : "${RUNNER_TOKEN:?RUNNER_TOKEN is required for first registration}"
  : "${RUNNER_NAME:?RUNNER_NAME is required for first registration}"

  # A container can be interrupted after GitHub creates the runner identity but
  # before all local credential files are durable. Remove only that incomplete
  # registration metadata so --replace can repair the same named runner.
  rm -f -- .runner .credentials .credentials_rsaparams

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
