#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$script_dir/github-actions-ssh-retry.sh"

export HOSTINGER_RETRY_MAX_ATTEMPTS=5
export HOSTINGER_RETRY_BASE_DELAY_SECONDS=0

attempts=0
flaky_command() {
  attempts=$((attempts + 1))
  (( attempts >= 3 ))
}

hostinger_retry 'retry unit test' flaky_command
[[ "$attempts" == 3 ]]

attempts=0
always_fails() {
  attempts=$((attempts + 1))
  return 17
}

set +e
hostinger_retry 'failure unit test' always_fails
exit_code=$?
set -e
[[ "$exit_code" == 17 ]]
[[ "$attempts" == 5 ]]

stdin_capture=$(mktemp)
fake_bin=$(mktemp -d)
trap 'rm -f "$stdin_capture"; rm -rf "$fake_bin"' EXIT
cat >"$fake_bin/ssh" <<'FAKE_SSH'
#!/usr/bin/env bash
command cat >"$SSH_STDIN_CAPTURE"
FAKE_SSH
chmod +x "$fake_bin/ssh"
export SSH_STDIN_CAPTURE="$stdin_capture"
PATH="$fake_bin:$PATH"

hostinger_ssh_stdin example.invalid 'bash -s' <<'PAYLOAD'
preserved stdin payload
PAYLOAD
grep -Fx 'preserved stdin payload' "$stdin_capture" >/dev/null

printf 'Hostinger SSH retry helper tests passed.\n'
