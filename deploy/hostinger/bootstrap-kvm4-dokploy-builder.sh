#!/usr/bin/env bash
set -euo pipefail

# Reuse the host builder through Dokploy's existing Docker socket and durable
# Docker configuration volume. Copy only its public Unix-socket definition;
# registry credentials and unrelated builders remain in their original stores.
test "$(id -u)" = 0
python3 - <<'PY'
import json, pathlib, subprocess

def run(*args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, **kwargs)

service = json.loads(run('docker', 'service', 'inspect', 'dokploy').stdout)[0]
worker = json.loads(run('docker', 'inspect', 'buildx_buildkit_seemplify-production0').stdout)[0]
limits = worker['HostConfig']
assert limits['Memory'] == limits['MemorySwap'] == 3 * 1024**3
assert limits['CpuQuota'] == 150000 and limits['CpuPeriod'] == 100000
assert worker['State']['Running']
definition = pathlib.Path('/root/.docker/buildx/instances/seemplify-production').read_bytes()
instance = json.loads(definition)
assert instance['Name'] == 'seemplify-production' and instance['Driver'] == 'docker-container'
assert all(n['Endpoint'] == 'unix:///var/run/docker.sock' for n in instance['Nodes'])
container = run('docker', 'ps', '--filter', 'label=com.docker.swarm.service.name=dokploy',
                '--format', '{{.ID}}').stdout.decode().splitlines()
assert len(container) == 1
run('docker', 'exec', '-i', container[0], 'sh', '-c',
    'umask 077; mkdir -p /root/.docker/buildx/instances; '
    'cat > /root/.docker/buildx/instances/seemplify-production', input=definition)
environment = dict(v.split('=', 1) for v in service['Spec']['TaskTemplate']['ContainerSpec'].get('Env', []))
if environment.get('BUILDX_BUILDER') != 'seemplify-production':
    run('docker', 'service', 'update', '--no-resolve-image', '--env-add',
        'BUILDX_BUILDER=seemplify-production', 'dokploy')
print('Dokploy configured to share the bounded production BuildKit worker')
PY
