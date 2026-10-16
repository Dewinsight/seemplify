import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

script = Path(__file__).parents[1] / 'github-runner/ci-slot.py'
spec = importlib.util.spec_from_file_location('ci_slot', script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


@unittest.skipUnless(os.name == 'posix', 'Linux process identity and flock contract')
class SlotTests(unittest.TestCase):
    def test_detached_lease_survives_hook_exit_and_ends_with_owner(self):
        import fcntl
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            owner = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(15)'])
            try:
                child = subprocess.Popen([sys.executable, str(script), 'lease', str(owner.pid),
                    module.process_identity(owner.pid), str(root / 'slot'), str(root / 'ready')])
                try:
                    deadline = time.monotonic() + 5
                    while not (root / 'ready').exists() and time.monotonic() < deadline:
                        time.sleep(.05)
                    self.assertTrue((root / 'ready').exists())
                    with (root / 'slot').open('a') as lock:
                        with self.assertRaises(BlockingIOError):
                            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    owner.terminate()
                    owner.wait(timeout=5)
                    self.assertEqual(child.wait(timeout=5), 0)
                    self.assertFalse((root / 'ready').exists())
                    with (root / 'slot').open('a') as lock:
                        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                finally:
                    if child.poll() is None:
                        child.kill()
                        child.wait()
            finally:
                if owner.poll() is None:
                    owner.kill()
                    owner.wait()

    def test_expired_process_identity_cannot_hold_the_slot(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            module.lease(os.getpid(), 'expired-identity', root / 'slot', root / 'ready')
            self.assertFalse((root / 'ready').exists())


if __name__ == '__main__':
    unittest.main()
