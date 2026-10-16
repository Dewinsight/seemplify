import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


@unittest.skipUnless(os.name == 'posix', 'Executes isolated Linux deployment commands')
class DeploymentSafetyTests(unittest.TestCase):
    def test_existing_site_is_never_replaced_by_historical_sql(self):
        original = (Path(__file__).parents[2] / 'deploy/hostinger/deploy-lms.sh').read_text()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release = root / 'release'
            helpers = release / 'deploy/hostinger'
            helpers.mkdir(parents=True)
            (helpers / 'prepare-lms-base.sh').write_text('true\n')
            (helpers / 'lms.compose.yml').write_text('services: {}\n')
            envfile = root / 'lms.env'
            envfile.write_text('')
            layout = root / 'layout'
            layout.mkdir()
            (layout / 'index.json').write_text(json.dumps({'manifests': [{'digest': 'sha256:' + 'b' * 64}]}))
            script = original.replace('/opt/seemplify/releases/$RELEASE_SHA', str(release))
            script = script.replace('/opt/seemplify/secrets/lms.env', str(envfile))
            script = script.replace('/opt/seemplify/build/lms-base-e703fe9', str(layout))
            script = script.replace('/opt/seemplify/deploy/hostinger/lms.compose.yml', str(root / 'active.yml'))
            (root / 'deploy.sh').write_text(script)
            binaries = root / 'bin'
            binaries.mkdir()
            docker = binaries / 'docker'
            docker.write_text('''#!/usr/bin/env python3
import sys,os,json
args=sys.argv[1:]
with open(os.environ['CALLS'],'a') as log:log.write(json.dumps(args)+'\\n')
if args[-1].endswith('/.historical-restore-complete'):sys.exit(int(os.environ['MARKER_MISSING']))
if args[0]=='inspect':print(os.environ['RELEASE_SHA'])
''')
            docker.chmod(0o700)
            curl = binaries / 'curl'
            curl.write_text('#!/bin/sh\nprintf pong\n')
            curl.chmod(0o700)
            calls = root / 'calls'
            environment = dict(os.environ, PATH=str(binaries) + ':' + os.environ['PATH'],
                RELEASE_SHA='a' * 40, CALLS=str(calls))
            for missing in (True, False):
                with self.subTest(marker_missing=missing):
                    calls.write_text('')
                    environment['MARKER_MISSING'] = str(int(missing))
                    result = subprocess.run(['bash', str(root / 'deploy.sh')], env=environment,
                        capture_output=True, text=True)
                    self.assertEqual(result.returncode, 1 if missing else 0, result.stderr)
                    operations = [json.loads(line) for line in calls.read_text().splitlines()]
                    self.assertFalse(any('restore' in args for args in operations))
                    if missing:
                        self.assertIn('Refusing historical SQL restore', result.stderr)
