#!/usr/bin/env bash
set -euo pipefail

# SSH deployment commands inherit this builder without changing application
# source or workflow image tags. Build output remains in the host image store.
test "$(id -u)" -eq 0
builder=seemplify-production
config=/etc/seemplify/buildkitd.toml
install -d -m 700 /etc/seemplify
cat >"$config" <<'EOF'
[worker.oci]
  max-parallelism = 1
  gc = true
  reservedSpace = "2GB"
  maxUsedSpace = "12GB"
  minFreeSpace = "25GB"
EOF
chmod 600 "$config"

if ! docker buildx inspect "$builder" >/dev/null 2>&1; then
  docker buildx create --name "$builder" --driver docker-container \
    --driver-opt memory=3g,memory-swap=3g,cpu-period=100000,cpu-quota=150000,cpu-shares=256,default-load=true \
    --buildkitd-config "$config" >/dev/null
fi
docker buildx inspect --bootstrap "$builder" >/dev/null
python3 - <<'PY'
import json, subprocess
container = json.loads(subprocess.check_output([
    'docker', 'inspect', 'buildx_buildkit_seemplify-production0']))[0]
host = container['HostConfig']
assert host['Memory'] == 3 * 1024 ** 3, 'Builder memory limit differs'
assert host['MemorySwap'] == host['Memory'], 'Builder must not use swap'
assert host['CpuPeriod'] == 100000 and host['CpuQuota'] == 150000, 'Builder CPU limit differs'
PY

docker buildx use --default "$builder"
printf 'SetEnv BUILDX_BUILDER=seemplify-production\n' \
  >/etc/ssh/sshd_config.d/91-seemplify-build-environment.conf
chmod 644 /etc/ssh/sshd_config.d/91-seemplify-build-environment.conf
sshd -t
systemctl reload ssh
printf 'SSH production builds use one bounded BuildKit worker with local image loading.\n'
