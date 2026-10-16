import os
from pathlib import Path
import subprocess
import tempfile
import unittest


@unittest.skipUnless(os.name == 'posix', 'Executes the Linux deployment script')
class IdentityImageTests(unittest.TestCase):
    def test_exact_release_image_survives_stale_environment_pin(self):
        script = Path(__file__).parents[1] / 'generate-idp-clients.sh'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'bin').mkdir()
            docker = root / 'bin/docker'
            docker.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE"\ntouch "$RESULT"\n')
            docker.chmod(0o700)
            envfile = root / 'apps.env'
            envfile.write_text('IDENTITY_PROVIDER_IMAGE=seemplify/identity-provider:stale\n')
            output = root / 'clients.json'
            capture = root / 'arguments'
            environment = dict(os.environ, PATH=str(root / 'bin') + ':' + os.environ['PATH'],
                CAPTURE=str(capture), RESULT=str(output))
            for supplied, expected in [('seemplify/identity-provider:tested', 'tested'), ('', 'stale')]:
                with self.subTest(caller_image=supplied):
                    environment['IDENTITY_PROVIDER_IMAGE'] = supplied
                    subprocess.run(['bash', str(script), str(envfile), str(root / 'input.json'),
                        str(output)], env=environment, check=True, capture_output=True)
                    arguments = capture.read_text().splitlines()
                    self.assertIn('seemplify/identity-provider:' + expected, arguments)
                    self.assertEqual(output.stat().st_mode & 0o777, 0o600)
