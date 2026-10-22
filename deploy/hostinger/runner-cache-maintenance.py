#!/usr/bin/env python3
"""Clear only disposable npm downloads while holding the shared CI compute slot."""
import argparse
import contextlib
import json
import os
from pathlib import Path
import subprocess

RUNNER = 'github-actions-runner-seemplify-worker-1'
STATE = Path('/var/lib/docker/volumes/github-actions-runner_seemplify-worker-state/_data')


def command(args):
    return subprocess.check_output(args, text=True, timeout=360).strip()


@contextlib.contextmanager
def idle_slot(state=STATE, deployment=Path('/run/lock/seemplify-production-deploy.lock')):
    import fcntl
    # Open the existing inode: creating a replacement would split CI locking.
    with deployment.open('a') as deploy:
        fcntl.flock(deploy, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fd = os.open(state / '.seemplify-build.lock', os.O_RDWR | os.O_NOFOLLOW)
        with os.fdopen(fd, 'r+') as compute:
            fcntl.flock(compute, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if (state / '.seemplify-local-active').exists():
                raise BlockingIOError('Local CI recovery is pending')
            yield


def maintain(apply=False, threshold=1024**3):
    row = json.loads(command(['docker', 'inspect', RUNNER]))[0]
    env = dict(pair.split('=', 1) for pair in row['Config']['Env'] if '=' in pair)
    mounts = {m['Destination']: m['Source'] for m in row['Mounts']}
    if (not row['State']['Running'] or row['Config']['User'] != 'runner'
            or env.get('ACTIONS_RUNNER_HOOK_JOB_STARTED') != '/runner/hooks/ci-slot-started.sh'
            or mounts.get('/runner') != str(STATE)):
        raise RuntimeError('Runner identity or shared compute-slot contract changed')
    # The lease prevents any newly accepted native/local job from reaching npm.
    # Existing workers cause a conservative skip, even if only waiting for CI.
    processes = command(['docker', 'exec', RUNNER, 'ps', '-eo', 'comm']).splitlines()
    if any(p.strip().startswith(('Runner.Worker', 'npm', 'node', 'mongod', 'chrome', 'chromium')) for p in processes):
        return {'skipped': 'runner job or dependency process is active'}
    cache = '/home/runner/.npm'
    if command(['docker', 'exec', RUNNER, 'readlink', '-f', cache]) != cache:
        raise RuntimeError('Unexpected npm cache path')
    before = int(command(['docker', 'exec', RUNNER, 'du', '-sb', cache]).split()[0])
    report = {'cache': cache, 'bytesBefore': before, 'thresholdBytes': threshold, 'cleaned': False}
    if apply and before > threshold:
        locate = "from pathlib import Path; p=Path('/runner/_work/_tool/node'); print(next(str(x.parent.parent) for x in sorted(p.glob('*/x64/bin/node'), reverse=True) if (x.parent.parent/'lib/node_modules/npm/bin/npm-cli.js').is_file()))"
        tool = command(['docker', 'exec', RUNNER, 'python3', '-c', locate])
        if not tool.startswith('/runner/_work/_tool/node/') or '..' in Path(tool).parts:
            raise RuntimeError('Unexpected Node toolchain')
        npm = [tool + '/bin/node', tool + '/lib/node_modules/npm/bin/npm-cli.js', '--cache', cache]
        if command(['docker', 'exec', RUNNER] + npm + ['config', 'get', 'cache']) != cache:
            raise RuntimeError('npm cache configuration mismatch')
        subprocess.run(['docker', 'exec', RUNNER] + npm + ['cache', 'clean', '--force'],
                       check=True, timeout=360, capture_output=True)
        report['cleaned'] = True
    report['bytesAfter'] = int(command(['docker', 'exec', RUNNER, 'du', '-sb', cache]).split()[0])
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        with idle_slot():
            report = maintain(args.apply)
    except BlockingIOError:
        report = {'skipped': 'CI or production deployment owns the shared slot'}
    print(json.dumps(report))


if __name__ == '__main__':
    main()
