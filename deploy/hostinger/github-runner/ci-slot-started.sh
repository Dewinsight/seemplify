#!/usr/bin/env bash
set -euo pipefail
exec python3 /runner/hooks/ci-slot.py acquire
