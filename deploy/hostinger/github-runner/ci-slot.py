#!/usr/bin/env python3
"""Share one bounded compute slot between native and local KVM4 workflows."""
from pathlib import Path
import os
import subprocess
import sys
import time
import uuid


def process_identity(pid):
    try:
        return Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[19]
    except (FileNotFoundError, IndexError):
        return None


def worker_identity():
    pid = os.getpid()
    for _ in range(16):
        if Path(f'/proc/{pid}/comm').read_text().strip() == 'Runner.Worker':
            return pid, process_identity(pid)
        pid = int(Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[1])
        if pid <= 1:
            break
    raise RuntimeError('Runner worker ancestor not found')


def lease(pid, identity, filename, ready):
    import fcntl
    try:
        with Path(filename).open('a') as lock:
            while process_identity(pid) == identity:
                if Path(filename).with_name('.seemplify-local-active').exists():
                    time.sleep(.25)
                    continue
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    time.sleep(.25)
            else:
                return
            Path(ready).touch(mode=0o600)
            while process_identity(pid) == identity:
                time.sleep(.25)
    finally:
        Path(ready).unlink(missing_ok=True)


def acquire():
    pid, identity = worker_identity()
    directory = Path('/runner/hooks/leases')
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    ready = directory / (uuid.uuid4().hex + '.ready')
    child = subprocess.Popen([sys.executable, __file__, 'lease', str(pid), identity,
                              '/runner/.seemplify-build.lock', str(ready)],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        close_fds=True, start_new_session=True, env={'PATH': '/usr/local/bin:/usr/bin:/bin'})
    while not ready.exists():
        if child.poll() is not None:
            raise RuntimeError('Shared build slot lease ended before acquisition')
        time.sleep(.25)
    print('Shared KVM4 compute slot acquired; lease follows this runner worker')


if __name__ == '__main__':
    if sys.argv[1:] == ['acquire']:
        acquire()
    elif len(sys.argv) == 6 and sys.argv[1] == 'lease':
        lease(int(sys.argv[2]), sys.argv[3], sys.argv[4], sys.argv[5])
    else:
        raise SystemExit('Invalid slot command')
