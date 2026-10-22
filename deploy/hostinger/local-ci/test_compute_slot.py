import importlib.util
import os
from pathlib import Path
import tempfile
import threading
import unittest

spec = importlib.util.spec_from_file_location('runner_compute_test', Path(__file__).with_name('runner_queue.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


@unittest.skipUnless(os.name == 'posix', 'Linux host flock contract')
class ComputeSlotTests(unittest.TestCase):
    def test_shared_native_lock_blocks_release_and_releases_after_exit(self):
        import fcntl
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / 'compute.lock'
            filename.touch()
            entered = threading.Event()
            stop = threading.Event()
            with filename.open('a') as native:
                fcntl.flock(native, fcntl.LOCK_EX)
                def local_job():
                    with module.compute_slot({'compute_lock': str(filename)}, stop):
                        entered.set()
                worker = threading.Thread(target=local_job)
                worker.start()
                self.assertFalse(entered.wait(.35))
                fcntl.flock(native, fcntl.LOCK_UN)
                self.assertTrue(entered.wait(2))
                worker.join(2)
                self.assertFalse(worker.is_alive())

    def test_rejects_symlink_lock_and_missing_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / 'compute.lock'
            with self.assertRaises(FileNotFoundError):
                with module.compute_slot({'compute_lock': str(filename)}, threading.Event()):
                    self.fail('Must not silently create a replacement inode')
            filename.symlink_to(Path(directory) / 'target')
            with self.assertRaises(OSError):
                with module.compute_slot({'compute_lock': str(filename)}, threading.Event()):
                    self.fail('Must reject symlink')

    def test_unconfigured_hosts_keep_existing_behavior(self):
        with module.compute_slot({}, threading.Event()):
            pass

    def test_shutdown_interrupts_wait_without_entering(self):
        import fcntl
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / 'compute.lock'
            filename.touch()
            stop = threading.Event()
            stop.set()
            with filename.open('a') as native:
                fcntl.flock(native, fcntl.LOCK_EX)
                with self.assertRaises(InterruptedError):
                    with module.compute_slot({'compute_lock': str(filename)}, stop):
                        self.fail('Shutdown must not start new work')
