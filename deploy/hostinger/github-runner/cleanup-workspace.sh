#!/usr/bin/env bash
set -euo pipefail

work_root="/runner/${RUNNER_WORKDIR:-_work}"

if [[ ! -d "$work_root" ]]; then
  exit 0
fi

# A completed job no longer needs its checked-out repositories or temporary
# payloads. Keep downloaded actions/toolchains so infrequent deployments remain
# fast, while pruning cache entries that have not been touched for 14 days.
find "$work_root" -mindepth 1 -maxdepth 1 -type d \
  ! -name _actions ! -name _tool ! -name _temp \
  -exec rm -rf -- {} +

if [[ -d "$work_root/_temp" ]]; then
  find "$work_root/_temp" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
fi

for cache_root in "$work_root/_actions" "$work_root/_tool"; do
  if [[ -d "$cache_root" ]]; then
    find "$cache_root" -mindepth 1 -maxdepth 4 -type d -mtime +14 -empty -delete || true
  fi
done
