#!/usr/bin/env python3
"""Job-lifetime compute lease and cleanup for unprivileged CRM native runners.

The Docker socket belongs to this CI user's rootless daemon. No command here
connects to the production Docker daemon, deletes application data, or uses sudo.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import uuid

LOCK = '/run/lock/hostinger-ci-compute.lock'


def process_identity(pid):
    try:
        return Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[19]
    except (FileNotFoundError, ProcessLookupError):
        return None


def worker_identity():
    pid = os.getpid()
    for _ in range(24):
        if Path(f'/proc/{pid}/comm').read_text().strip() == 'Runner.Worker':
            return pid, process_identity(pid)
        pid = int(Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[1])
        if pid <= 1:
            break
    raise RuntimeError('No owning runner worker')


def lease(pid, identity, ready):
    import fcntl
    fd = os.open(LOCK, os.O_RDWR | os.O_NOFOLLOW)
    try:
        with os.fdopen(fd, 'a') as lock:
            while process_identity(pid) == identity:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    time.sleep(.25)
                    continue
                available = next(int(line.split()[1]) * 1024 for line in
                    Path('/proc/meminfo').read_text().splitlines()
                    if line.startswith('MemAvailable:'))
                if available < 7680 * 1024 ** 2 or shutil.disk_usage('/var/lib/hostinger-actions').free < 12 * 1024 ** 3:
                    fcntl.flock(lock, fcntl.LOCK_UN)
                    time.sleep(2)
                    continue
                Path(ready).touch(mode=0o600)
                while process_identity(pid) == identity:
                    time.sleep(.25)
                return
    finally:
        Path(ready).unlink(missing_ok=True)


def home_directory():
    path = Path.home()
    if path not in (Path('/var/lib/hostinger-actions/backend'), Path('/var/lib/hostinger-actions/frontend')) or path.resolve() != path:
        raise RuntimeError('Unexpected CI home')
    return path


def acquire():
    pid, identity = worker_identity()
    directory = home_directory() / '.leases'
    directory.mkdir(mode=0o700, exist_ok=True)
    ready = directory / (uuid.uuid4().hex + '.ready')
    child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'lease',
        str(pid), identity, str(ready)], stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True,
        start_new_session=True, env={'PATH': '/usr/bin:/bin', 'HOME': str(home_directory())})
    while not ready.exists():
        if child.poll() is not None:
            raise RuntimeError('Compute lease failed')
        time.sleep(.25)
    print('Exclusive Hostinger compute slot acquired; lease follows this job worker', flush=True)


def docker(args, check=True):
    env = dict(os.environ)
    env.pop('DOCKER_CONTEXT', None)
    return subprocess.run(['/usr/bin/docker', '--host', f'unix:///run/user/{os.getuid()}/docker.sock', *args],
        env=env, text=True, capture_output=True, check=check)


def cleanup():
    home = home_directory()
    security = json.loads(docker(['info', '--format', '{{json .SecurityOptions}}']).stdout)
    if not any('rootless' in value for value in security):
        raise RuntimeError('Refusing cleanup outside the isolated rootless engine')
    ids = docker(['ps', '-aq']).stdout.split()
    if ids:
        docker(['rm', '-f', *ids])
    # CI engines contain no production volumes or rollback images.
    docker(['volume', 'prune', '--force'])
    docker(['builder', 'prune', '--force', '--filter', 'until=24h', '--keep-storage', '4GB'], check=False)
    docker(['image', 'prune', '--force', '--filter', 'until=72h'], check=False)
    work = home / '_work'
    removed = []
    if work.is_symlink():
        raise RuntimeError('Refusing symlinked work root')
    if work.exists():
        for child in work.iterdir():
            if child.name in ('_actions', '_tool', '_temp'):
                continue
            removed.append(child.name)
            if child.is_symlink() or child.is_file():
                child.unlink()
            else:
                shutil.rmtree(child)
        temp = work / '_temp'
        if temp.is_symlink():
            temp.unlink()
        elif temp.is_dir():
            for child in temp.iterdir():
                if child.is_symlink() or child.is_file():
                    child.unlink()
                else:
                    shutil.rmtree(child)
    config = home / '.docker'
    if config.is_symlink():
        config.unlink()
    else:
        (config / 'config.json').unlink(missing_ok=True)
    report = {'at': time.time(), 'removed_containers': len(ids), 'removed_workspaces': removed,
              'uid': os.getuid(), 'rootless': True}
    (home / 'cleanup-report.json').write_text(json.dumps(report) + '\n')
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    command = sys.argv[1:]
    if command == ['acquire']:
        acquire()
    elif command == ['cleanup']:
        cleanup()
    elif len(command) == 4 and command[0] == 'lease':
        lease(int(command[1]), command[2], command[3])
    else:
        raise SystemExit('Invalid hook command')
