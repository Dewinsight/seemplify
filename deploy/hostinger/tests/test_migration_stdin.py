import os
from pathlib import Path
import subprocess
import textwrap
import unittest


def migration_commands():
    workflow = Path(__file__).parents[3] / '.github/workflows/deploy-core-hostinger.yml'
    lines = workflow.read_text().splitlines()
    commands = []
    for index, line in enumerate(lines):
        if '"${compose[@]}" run --rm' not in line:
            continue
        command = [line]
        while command[-1].endswith('\\'):
            index += 1
            command.append(lines[index])
        if any('scripts/migrate' in item for item in command):
            commands.append(textwrap.dedent('\n'.join(command)))
    return commands


class MigrationInputTests(unittest.TestCase):
    def test_migrations_do_not_share_the_release_scripts_input(self):
        commands = migration_commands()
        self.assertEqual(len(commands), 2)
        for command in commands:
            self.assertIn('< /dev/null', command)
            self.assertIn('--no-deps -T', command)

    @unittest.skipUnless(os.name == 'posix', 'Executes the Linux release shell')
    def test_activation_is_reached_even_if_a_job_consumes_stdin(self):
        for command in migration_commands():
            with self.subTest(command=command):
                script = '''set -eu
docker() { cat > /dev/null; }
compose=(docker)
RELEASE_SHA=tested-release
''' + command + '\nprintf "activation-reached\\n"\n'
                result = subprocess.run(['bash', '-s'], input=script, text=True,
                                        capture_output=True, check=True, timeout=10)
                self.assertIn('activation-reached', result.stdout)
