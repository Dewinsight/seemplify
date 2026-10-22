#!/usr/bin/env python3
"""Execute trusted canonical GitHub workflows without Actions job dispatch."""
import argparse
import concurrent.futures
import contextlib
import datetime
import json
import os
from pathlib import Path
import re
import signal
import shutil
import sqlite3
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

SHA = re.compile(r'[0-9a-f]{40}\Z')
CRM_IMAGE = re.compile(r'(xplorer-(?:crm|backend)-(?:dev|staging)):[a-f0-9]{12,40}\Z')


@contextlib.contextmanager
def compute_slot(config, stop):
    """Serialize native CI and local releases when a host shares one CPU/RAM slot."""
    filename = config.get('compute_lock')
    if not filename:
        yield
        return
    import fcntl
    fd = os.open(filename, os.O_RDWR | os.O_NOFOLLOW)
    with os.fdopen(fd, 'a') as lock:
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if stop.wait(.25):
                    raise InterruptedError('Stopped while waiting for shared compute slot')
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def obsolete_release_images(images, used, service_images, keep=3, minimum_age_hours=24):
    """Select only old CRM releases; protect all container/service/rollback refs."""
    protected = set(used)
    references = {ref.split('@', 1)[0] for ref in service_images}
    groups = {}
    for image in images:
        tags = image.get('RepoTags') or []
        if (image['Id'] in service_images or any(tag in references for tag in tags)
                or set(image.get('RepoDigests') or []).intersection(service_images)):
            protected.add(image['Id'])
        for tag in tags:
            match = CRM_IMAGE.fullmatch(tag)
            if match:
                groups.setdefault(match[1], {})[image['Id']] = image
    for group in groups.values():
        protected.update(row['Id'] for row in sorted(group.values(), key=lambda row: row['Created'], reverse=True)[:keep])
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=minimum_age_hours)
    selected = []
    for image in images:
        tags = image.get('RepoTags') or []
        if not tags or image['Id'] in protected or not all(CRM_IMAGE.fullmatch(tag) for tag in tags):
            continue
        created = datetime.datetime.fromisoformat(image['Created'].replace('Z', '+00:00'))
        if created < cutoff:
            selected.append(image)
    return selected


def memory_limit_bytes(value):
    match = re.fullmatch(r'([1-9][0-9]*)([kmgt]?)b?', str(value), re.I)
    if not match:
        raise ValueError('Invalid configured memory limit')
    return int(match[1]) * 1024 ** ('kmgt'.index(match[2].lower()) + 1 if match[2] else 0)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('GitHub API redirects are not allowed')


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def read_with_retry(operation):
    """Retry only bounded, read-only network operations before execution."""
    for attempt in range(3):
        try:
            return operation()
        except urllib.error.HTTPError as error:
            if error.code != 429 and error.code < 500:
                raise
            if attempt == 2:
                raise
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            if attempt == 2:
                raise
        time.sleep(attempt + 1)


def lane_cloud_settings(filename):
    path = Path(filename)
    if os.name != 'nt' and path.stat().st_mode & 0o077:
        raise ValueError('Deployment settings must be root-only')
    allowed = {'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'CLOUDINARY_URL'}
    values = {}
    for line in path.read_text().splitlines():
        key, separator, value = line.partition('=')
        if separator and key in allowed and value.strip():
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                value = value[1:-1]
            if value:
                values[key] = value
    required = {'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'}
    if not required.issubset(values):
        raise ValueError('Complete existing lane media settings are required')
    return values


class Queue:
    def __init__(self, directory):
        self.root = Path(directory)
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path = self.root / 'queue.sqlite3'
        with self.connect() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS jobs (
                    id INTEGER PRIMARY KEY, route TEXT NOT NULL, sha TEXT NOT NULL,
                    kind TEXT NOT NULL, dedupe TEXT UNIQUE NOT NULL,
                    state TEXT NOT NULL DEFAULT 'queued', created TEXT NOT NULL,
                    started TEXT, finished TEXT, attempt INTEGER NOT NULL DEFAULT 0,
                    status_sent INTEGER NOT NULL DEFAULT 0);
                CREATE INDEX IF NOT EXISTS jobs_state_id ON jobs(state,id);
                CREATE TABLE IF NOT EXISTS cursors (route TEXT PRIMARY KEY,sha TEXT NOT NULL);
            ''')

    @contextlib.contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA busy_timeout=30000')
        try:
            with db:
                yield db
        finally:
            db.close()

    def enqueue(self, route, sha, kind='deploy', nonce=''):
        if not SHA.fullmatch(sha) or kind not in ('deploy', 'probe'):
            raise ValueError('Invalid job identity')
        dedupe = ':'.join([route, sha, kind, nonce])
        with self.connect() as db:
            db.execute('INSERT OR IGNORE INTO jobs(route,sha,kind,dedupe,created) VALUES(?,?,?,?,?)',
                       (route, sha, kind, dedupe, now()))
            return db.execute('SELECT id FROM jobs WHERE dedupe=?', (dedupe,)).fetchone()[0]

    def claim(self):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            job = db.execute('''SELECT * FROM jobs j WHERE state='queued' AND
                (kind='probe' OR NOT EXISTS(SELECT 1 FROM jobs r WHERE
                 r.state='running' AND r.kind='deploy' AND r.route=j.route))
                ORDER BY id LIMIT 1''').fetchone()
            if not job:
                return None
            db.execute("UPDATE jobs SET state='running',started=?,attempt=attempt+1 WHERE id=?", (now(), job['id']))
            return dict(db.execute('SELECT * FROM jobs WHERE id=?', (job['id'],)).fetchone())

    def finish(self, job_id, success):
        with self.connect() as db:
            db.execute('UPDATE jobs SET state=?,finished=?,status_sent=0 WHERE id=?',
                       ('success' if success else 'failure', now(), job_id))

    def rows(self):
        with self.connect() as db:
            return [dict(row) for row in db.execute('SELECT * FROM jobs ORDER BY id')]

    def job_directory(self, job_id):
        if not isinstance(job_id, int) or job_id < 1:
            raise ValueError('Invalid cleanup job identity')
        base = self.root / 'jobs'
        directory = base / str(job_id)
        if base.is_symlink() or directory.is_symlink() or directory.resolve().parent != base.resolve():
            raise ValueError('Cleanup must stay inside the private jobs directory')
        return directory

    def remove_payload(self, job_id, apply=False):
        directory = self.job_directory(job_id)
        removed = 0
        for name in ('source', 'variables.env', 'event.json', 'workflow.yml', 'secrets.env'):
            path = directory / name
            if not path.exists() and not path.is_symlink():
                continue
            if apply:
                if path.is_dir() and not path.is_symlink():
                    shutil.rmtree(path)
                else:
                    path.unlink()
            removed += 1
        return removed

    def cleanup(self, apply=False, retention_days=30, keep_latest=20):
        """Reclaim terminal job payloads/logs; preserve the ledger and release proofs."""
        if retention_days < 1 or keep_latest < 1:
            raise ValueError('Cleanup must retain recent job history')
        report = {'checked_at': now(), 'applied': apply, 'payloads': 0, 'logs': 0, 'errors': []}
        cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=retention_days)
        with self.connect() as db:
            # Serializes against claim/retry while deleting only terminal job files.
            db.execute('BEGIN IMMEDIATE')
            jobs = list(db.execute("SELECT * FROM jobs WHERE state IN ('success','failure','skipped') ORDER BY id DESC"))
            for index, job in enumerate(jobs):
                try:
                    report['payloads'] += self.remove_payload(job['id'], apply=apply)
                    log = self.job_directory(job['id']) / 'job.log'
                    finished = datetime.datetime.fromisoformat(job['finished']) if job['finished'] else None
                    if (index >= keep_latest and job['status_sent'] and finished is not None
                            and finished < cutoff and (log.exists() or log.is_symlink())):
                        if apply:
                            log.unlink()
                        report['logs'] += 1
                except (OSError, ValueError, TypeError) as error:
                    # Never print exception text, paths, payloads or credential values.
                    report['errors'].append({'job': job['id'], 'type': type(error).__name__})
        if apply:
            target = self.root / 'cleanup-report.json'
            if target.is_symlink():
                raise ValueError('Cleanup report cannot be a symlink')
            target.write_text(json.dumps(report, indent=2) + '\n')
            target.chmod(0o600)
        return report

    def undelivered(self):
        with self.connect() as db:
            return [dict(row) for row in db.execute("SELECT * FROM jobs WHERE state IN ('queued','success','failure') AND status_sent=0 ORDER BY id LIMIT 100")]


class Driver:
    def __init__(self, config):
        self.config = config
        self.queue = Queue(config['state_dir'])
        self.routes = {route['name']: route for route in config['routes']}
        if len(self.routes) != len(config['routes']):
            raise ValueError('Duplicate route')
        self.token = Path(config['token_file']).read_text().strip()
        self.stop = threading.Event()
        self.api_lock = threading.Lock()

    def cleanup_images(self, apply=False):
        if not self.config.get('cleanup_release_images', False):
            return {'enabled': False}
        import fcntl
        # Both canonical CRM deploy scripts hold exactly this host lock.
        fd = os.open('/var/lock/xplorer-kvm2-deploy.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return {'skipped': 'deployment_active'}
            def inspect(kind, ids):
                return json.loads(subprocess.check_output(['docker', kind, 'inspect'] + ids, text=True)) if ids else []
            ids = list(dict.fromkeys(subprocess.check_output(['docker', 'image', 'ls', '-q', '--no-trunc'], text=True).split()))
            images = inspect('image', ids)
            ids = subprocess.check_output(['docker', 'ps', '-aq'], text=True).split()
            containers = json.loads(subprocess.check_output(['docker', 'inspect'] + ids, text=True)) if ids else []
            ids = subprocess.check_output(['docker', 'service', 'ls', '-q'], text=True).split()
            services = inspect('service', ids)
            references = []
            for service in services:
                for spec in ('Spec', 'PreviousSpec'):
                    ref = service.get(spec, {}).get('TaskTemplate', {}).get('ContainerSpec', {}).get('Image')
                    if ref:
                        references.append(ref)
            selected = obsolete_release_images(images, {row['Image'] for row in containers}, references)
            report = {'checked_at': now(), 'applied': apply, 'eligible_images': len(selected), 'removed_images': 0, 'errors': []}
            if apply:
                for image in selected:
                    try:
                        # No force flag: Docker refuses to delete an image taken by a new container.
                        subprocess.run(['docker', 'image', 'rm'] + image['RepoTags'], check=True, capture_output=True)
                        report['removed_images'] += 1
                    except subprocess.CalledProcessError:
                        report['errors'].append({'type': 'CalledProcessError'})
                path = self.queue.root / 'image-cleanup-report.json'
                if path.is_symlink():
                    raise ValueError('Image cleanup report cannot be a symlink')
                path.write_text(json.dumps(report, indent=2) + '\n')
                path.chmod(0o600)
            return report

    def api(self, path, payload=None):
        if not path.startswith('/repos/') or '\\' in path or '..' in path:
            raise ValueError('Unexpected GitHub endpoint')
        request = urllib.request.Request('https://api.github.com' + path,
            data=json.dumps(payload).encode() if payload is not None else None,
            headers={'Authorization': 'Bearer ' + self.token, 'Accept': 'application/vnd.github+json',
                     'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'})
        def read():
            with urllib.request.build_opener(NoRedirect()).open(request, timeout=45) as response:
                return json.load(response)
        return read_with_retry(read) if payload is None else read()

    def status(self, job, state):
        route = self.routes[job['route']]
        self.api(f"/repos/{route['repo']}/statuses/{job['sha']}", {
            'context': 'hostinger-ci/' + (route['name'] if job['kind'] == 'deploy' else 'runner-health'),
            'state': state,
            'description': f"Hostinger job {job['id']}: {'queued; waiting for capacity' if job.get('state') == 'queued' else state}; private logs on VPS"})

    def poll(self):
        failures = []
        for route in self.routes.values():
            try:
                self.poll_route(route)
            except Exception as error:
                # A broken lane must not starve healthy repositories or branches.
                # Avoid printing API errors that can contain credential-bearing URLs.
                print('poll_route_failed=' + route['name'] + ':' + type(error).__name__, flush=True)
                failures.append(error)
        if failures:
            raise failures[0]

    def poll_route(self, route):
        variables = self.api(f"/repos/{route['repo']}/actions/variables")['variables']
        driver = next((v['value'] for v in variables if v['name'] == 'HOSTINGER_CI_DRIVER'), 'actions')
        head = self.api(f"/repos/{route['repo']}/git/ref/heads/{route['ref']}")['object']['sha']
        with self.queue.connect() as db:
            cursor = db.execute('SELECT sha FROM cursors WHERE route=?', (route['name'],)).fetchone()
        if driver != 'local' or cursor is None:
            with self.queue.connect() as db:
                db.execute('INSERT OR REPLACE INTO cursors VALUES(?,?)', (route['name'], head))
            return
        if cursor[0] == head:
            return
        revisions, current = [], head
        for _ in range(100):
            if current == cursor[0]:
                break
            revisions.append(current)
            commit = self.api(f"/repos/{route['repo']}/git/commits/{current}")
            if not commit['parents']:
                raise ValueError('Canonical branch ancestry changed')
            current = commit['parents'][0]['sha']
        else:
            raise ValueError('Canonical backlog exceeds 100 revisions; operator review required')
        if current != cursor[0]:
            raise ValueError('Canonical branch no longer contains its durable cursor')
        for revision in reversed(revisions):
            self.queue.enqueue(route['name'], revision)
        with self.queue.connect() as db:
            db.execute('UPDATE cursors SET sha=? WHERE route=?', (head, route['name']))

    def command(self, argv, log, cwd=None, env=None, timeout=None, umask=-1):
        process = subprocess.Popen(argv, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT,
                                   start_new_session=True, umask=umask)
        try:
            code = process.wait(timeout=timeout or self.config['timeout_seconds'])
            if code:
                raise RuntimeError('Command failed; see private job log')
        except BaseException:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGTERM)
            with contextlib.suppress(subprocess.TimeoutExpired):
                process.wait(timeout=20)
            if process.poll() is None:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGKILL)
            raise

    def workspace_path(self, name):
        if not re.fullmatch(r'[a-z0-9-]+', name):
            raise ValueError('Invalid workspace route')
        base = self.queue.root / 'workspaces'
        if base.is_symlink():
            raise ValueError('Workspace base cannot be a symlink')
        base.mkdir(mode=0o700, exist_ok=True)
        workspace = base / name
        if workspace.is_symlink() or workspace.resolve().parent != base.resolve():
            raise ValueError('Workspace must remain inside its private base')
        return workspace

    def prepare_workspace(self, name, source):
        workspace = self.workspace_path(name)
        if workspace.exists():
            shutil.rmtree(workspace)
        # Preserve Git symlinks rather than reading their host-side targets.
        shutil.copytree(source, workspace, symlinks=True)
        return workspace

    def work(self, job):
        with compute_slot(self.config, self.stop):
            self._work(job)

    def _work(self, job):
        root = self.queue.root / 'jobs' / str(job['id'])
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        label = f"hostinger-ci.job={job['id']}"
        success = False
        with (root / 'job.log').open('a') as log:
            try:
                # act cannot pull this private local image if host cleanup removed it.
                # The trusted host helper rebuilds it and pins it with an isolated keeper.
                self.command([str(Path(__file__).with_name('ensure-image.sh'))], log)
                self.status(job, 'pending')
                if job['kind'] == 'probe':
                    self.command(['docker', 'run', '--rm', '--label', label, '--cpus', str(self.config['job_cpus']),
                        '--memory', self.config['job_memory'], '--memory-swap', self.config['job_memory'],
                        '--env', 'EXPECTED_CPU=' + str(round(float(self.config['job_cpus']) * 100000)) + ' 100000',
                        '--env', 'EXPECTED_MEMORY=' + str(memory_limit_bytes(self.config['job_memory'])),
                        '--pids-limit', '2048', '--network', 'none', '--entrypoint', 'python3', self.config['image'],
                        '-c', 'import json,pathlib,time,os; p=pathlib.Path; cpu=p("/sys/fs/cgroup/cpu.max").read_text().strip();memory=p("/sys/fs/cgroup/memory.max").read_text().strip();assert cpu==os.environ["EXPECTED_CPU"];assert memory==os.environ["EXPECTED_MEMORY"];assert p("/sys/fs/cgroup/memory.swap.max").read_text().strip()=="0";assert not p("/var/run/docker.sock").exists();print(json.dumps({"started":time.time(),"cpu":cpu,"memory":memory}),flush=True);time.sleep(12);print("Probe passed",flush=True)'], log)
                else:
                    self.deploy(job, root, log)
                success = True
            except Exception as error:
                # Exception text may include request URLs or credential-bearing commands.
                log.write('\nHostinger job failed: ' + type(error).__name__ + '\n')
            finally:
                containers = subprocess.run(['docker', 'ps', '-aq', '--filter', 'label=' + label],
                                            capture_output=True, text=True, check=False).stdout.split()
                for container in containers:
                    subprocess.run(['docker', 'rm', '-f', container], stdout=log, stderr=log, check=False)
                subprocess.run(['rm', '-rf', '--', str(root / 'source')], stdout=log, stderr=log, check=False)
                if self.routes[job['route']]['repo'] == 'Dewinsight/Xplorer-Full-backend':
                    with contextlib.suppress(OSError, ValueError):
                        workspace = self.workspace_path(job['route'])
                        if workspace.exists():
                            shutil.rmtree(workspace)
                for filename in ('variables.env', 'event.json', 'workflow.yml', 'secrets.env'):
                    (root / filename).unlink(missing_ok=True)
                self.queue.finish(job['id'], success)
                try:
                    self.status(job, 'success' if success else 'failure')
                    with self.queue.connect() as db:
                        db.execute('UPDATE jobs SET status_sent=1 WHERE id=?', (job['id'],))
                except Exception:
                    pass  # Durable status delivery is retried by the coordinator.

    def deploy(self, job, root, log):
        import base64
        import yaml
        import polinrider_scanner
        route = self.routes[job['route']]
        label = f"hostinger-ci.job={job['id']}"
        files, commit = [], None
        for page in range(1, 31):
            commit = self.api(f"/repos/{route['repo']}/commits/{job['sha']}?per_page=100&page={page}")
            batch = commit['files']
            files.extend(batch)
            if len(batch) < 100:
                break
        else:
            raise ValueError('Commit exceeds immutable scan pagination limit')
        findings = polinrider_scanner.check_commits([commit])
        for file in files:
            if file.get('status') == 'removed':
                continue
            content = read_with_retry(lambda: polinrider_scanner.read_blob(route['repo'], file['sha'], self.token))
            if content is not None:
                findings.extend(polinrider_scanner.scan_text(file['filename'], content))
        errors = sum(finding[0] == 'error' for finding in findings)
        log.write(f'Immutable pre-execution scan: errors={errors} warnings={len(findings)-errors}\n')
        log.flush()
        self.api(f"/repos/{route['repo']}/statuses/{job['sha']}", {
            'context': 'hostinger-ci/polinrider-scan', 'state': 'failure' if errors else 'success',
            'description': 'Immutable pre-execution scan: ' + str(errors) + ' errors'})
        if errors:
            raise ValueError('Immutable pre-execution scan rejected this revision')
        source = root / 'source'
        env = os.environ.copy()
        env.update(GIT_CONFIG_COUNT='1', GIT_CONFIG_KEY_0='http.https://github.com/.extraheader',
                   GIT_CONFIG_VALUE_0='AUTHORIZATION: basic ' + base64.b64encode(('x-access-token:' + self.token).encode()).decode(),
                   GIT_TERMINAL_PROMPT='0')
        self.command(['git', 'clone', '--quiet', '--depth', '1', '--branch', route['ref'],
                      'https://github.com/' + route['repo'] + '.git', str(source)], log, env=env, umask=0o022)
        self.command(['git', 'fetch', '--quiet', '--depth', '1', 'origin', job['sha']], log, cwd=source, env=env)
        self.command(['git', 'checkout', '--quiet', '--detach', job['sha']], log, cwd=source, umask=0o022)
        actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip()
        if actual != job['sha']:
            raise ValueError('Checkout revision mismatch')
        if route['repo'] == 'Dewinsight/Xplorer-Full-backend':
            # Jest hashes the project root. A per-job path defeats its shared cache.
            # Per-route queue serialization prevents concurrent workspace reuse.
            source = self.prepare_workspace(route['name'], source)
        workflow = source / route['workflow']
        # Preserve tests and deploy steps, but use the host's persistent npm cache.
        class WorkflowLoader(yaml.SafeLoader):
            pass
        WorkflowLoader.yaml_implicit_resolvers = {key: [(tag, pattern) for tag, pattern in values
            if tag != 'tag:yaml.org,2002:bool'] for key, values in yaml.SafeLoader.yaml_implicit_resolvers.items()}
        WorkflowLoader.add_implicit_resolver('tag:yaml.org,2002:bool', re.compile(r'^(?:true|false)$', re.I), list('tTfF'))
        data = yaml.load(workflow.read_text(), Loader=WorkflowLoader)
        # The durable host queue owns concurrency; act's schema predates queue:max.
        data.pop('concurrency', None)
        for definition in data['jobs'].values():
            definition.pop('concurrency', None)
            definition['if'] = definition.get('if', '').replace("vars.HOSTINGER_CI_DRIVER != 'local'", 'true') or 'true'
            for step in definition.get('steps', []):
                if step.get('uses', '').startswith('actions/setup-node@'):
                    step.get('with', {}).pop('cache', None)
                    step.get('with', {}).pop('cache-dependency-path', None)
        adapted = root / 'workflow.yml'
        adapted.write_text(yaml.safe_dump(data, sort_keys=False))
        event = {'ref': 'refs/heads/' + route['ref'], 'after': job['sha'],
                 'repository': {'full_name': route['repo'], 'name': route['repo'].split('/')[1],
                   'owner': {'login': route['repo'].split('/')[0], 'name': route['repo'].split('/')[0]},
                   'default_branch': route['ref'], 'html_url': 'https://github.com/' + route['repo']},
                 'head_commit': {'id': job['sha']}}
        (root / 'event.json').write_text(json.dumps(event))
        variables = self.api(f"/repos/{route['repo']}/actions/variables")['variables']
        lane = 'staging' if route['ref'] == 'staging' else 'dev'
        try:
            variables += self.api(f"/repos/{route['repo']}/environments/{lane}/variables")['variables']
        except urllib.error.HTTPError as error:
            if error.code not in (403, 404):
                raise
        values = {v['name']: v['value'] for v in variables}
        values['HOSTINGER_CI_DRIVER'] = 'actions'
        secrets_file = self.config['secrets_file']
        if route.get('deployment_env_file'):
            settings = lane_cloud_settings(route['deployment_env_file'])
            values['CLOUDINARY_CLOUD_NAME'] = settings.pop('CLOUDINARY_CLOUD_NAME')
            local_secrets = root / 'secrets.env'
            local_secrets.write_text(Path(secrets_file).read_text().rstrip() + '\n' +
                ''.join(key + '=' + json.dumps(value) + '\n' for key, value in settings.items()))
            local_secrets.chmod(0o600)
            secrets_file = str(local_secrets)
        (root / 'variables.env').write_text('\n'.join(k + '=' + json.dumps(v) for k, v in values.items()) + '\n')
        options = f"--cpus={self.config['job_cpus']} --memory={self.config['job_memory']} --memory-swap={self.config['job_memory']} --pids-limit=2048 --label={label} --volume=hostinger-ci-npm-cache:/root/.npm"
        if route['repo'] == 'Dewinsight/Xplorer-Full-backend':
            options += ' --volume=hostinger-ci-jest-cache:/tmp/jest_0'
        self.command([self.config['act'], 'push', '-W', str(adapted), '-e', str(root / 'event.json'),
            '-P', 'self-hosted=' + self.config['image'], '-P', 'dewinsight-kvm2-crm=' + self.config['image'],
            '--pull=false', '--network', 'bridge', '--concurrent-jobs', '1', '--container-daemon-socket', '-',
            '--container-options', options, '--secret-file', secrets_file,
            '--var-file', str(root / 'variables.env'), '--no-cache-server', '--action-offline-mode',
            '--action-cache-path', str(self.queue.root / 'action-cache' / route['name']),
            '--env', 'GITHUB_RUN_ID=' + str(job['id']), '--env', 'GITHUB_RUN_ATTEMPT=' + str(job['attempt']),
            '--env', 'NODE_OPTIONS=--max-old-space-size=3072'], log, cwd=source)
        services = {'crm-frontend-dev': 'xplorer-crm-dev', 'crm-frontend-staging': 'xplorer-crm-d70y00',
                    'crm-backend-dev': 'xplorer-backend-dev', 'crm-backend-staging': 'xplorer-backend-rdvizg'}
        container = subprocess.check_output(['docker', 'ps', '-q', '--filter',
            'label=com.docker.swarm.service.name=' + services[route['name']]], text=True).split()
        if not container:
            raise ValueError('Deployed service is not running')
        details = json.loads(subprocess.check_output(['docker', 'inspect', container[0]], text=True))[0]
        revision = details['Config']['Labels'].get('com.xplorer.commit')
        health = details['State'].get('Health', {}).get('Status', details['State']['Status'])
        if revision != job['sha'] or health not in ('healthy', 'running'):
            raise ValueError('Live revision or health mismatch')
        (root / 'verification.json').write_text(json.dumps({'sha': revision, 'health': health,
            'container': container[0], 'image': details['Config']['Image']}, indent=2))

    def capacity_available(self, active_jobs=0):
        # Keep accepted pushes durable while application load needs the RAM.
        available = next(int(line.split()[1]) * 1024 for line in
            Path('/proc/meminfo').read_text().splitlines()
            if line.startswith('MemAvailable:'))
        reserve = int(self.config.get('minimum_free_memory_after_job_mb', 512)) * 1024 ** 2
        # Reserve the full ceiling for admitted workers before Docker allocates
        # their RAM. This is conservative once a worker has allocated memory.
        required = (active_jobs + 1) * memory_limit_bytes(self.config['job_memory']) + reserve
        disk_floor = int(self.config.get('minimum_free_disk_mb', 8192)) * 1024 ** 2
        return available >= required and shutil.disk_usage(self.queue.root).free >= disk_floor

    def serve(self):
        # No second coordinator can recover leases while another owns the database.
        import fcntl
        import shutil
        lock = (self.queue.root / 'coordinator.lock').open('w')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda *_: self.stop.set())
        for job in self.queue.rows():
            if job['state'] == 'running':
                containers = subprocess.check_output(['docker', 'ps', '-aq', '--filter',
                    'label=hostinger-ci.job=' + str(job['id'])], text=True).split()
                for container in containers:
                    subprocess.run(['docker', 'rm', '-f', container], check=True,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                self.queue.remove_payload(job['id'], apply=True)
        with self.queue.connect() as db:
            db.execute("UPDATE jobs SET state='queued',started=NULL,status_sent=0 WHERE state='running'")
        futures = {}
        next_poll = 0
        next_cleanup = 0
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.config['workers']) as executor:
            while not self.stop.is_set():
                for future, job in list(futures.items()):
                    if future.done():
                        if future.exception() is not None:
                            self.queue.finish(job['id'], False)
                            print('worker_failed=' + type(future.exception()).__name__, flush=True)
                        del futures[future]
                        next_cleanup = 0
                if time.monotonic() >= next_cleanup:
                    try:
                        print('cleanup=' + json.dumps(self.queue.cleanup(apply=True)), flush=True)
                        print('image_cleanup=' + json.dumps(self.cleanup_images(apply=True)), flush=True)
                    except Exception as error:
                        print('cleanup_failed=' + type(error).__name__, flush=True)
                    next_cleanup = time.monotonic() + 3600
                if time.monotonic() >= next_poll:
                    try:
                        self.poll()
                    except Exception as error:
                        print('poll_failed=' + type(error).__name__, flush=True)
                    next_poll = time.monotonic() + self.config.get('poll_seconds', 30)
                    for job in self.queue.undelivered():
                        try:
                            self.status(job, 'pending' if job['state'] == 'queued' else job['state'])
                            with self.queue.connect() as db:
                                db.execute('UPDATE jobs SET status_sent=1 WHERE id=?', (job['id'],))
                        except Exception:
                            pass
                while len(futures) < self.config['workers']:
                    if not self.capacity_available(len(futures)):
                        break
                    job = self.queue.claim()
                    if job is None:
                        break
                    futures[executor.submit(self.work, job)] = job
                self.stop.wait(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', default='/etc/hostinger-ci/config.json')
    parser.add_argument('command', choices=['serve', 'status', 'enqueue', 'retry', 'cleanup'])
    parser.add_argument('--apply', action='store_true', help='Apply cleanup; otherwise report only')
    parser.add_argument('--route')
    parser.add_argument('--sha')
    parser.add_argument('--kind', choices=['deploy', 'probe'], default='deploy')
    parser.add_argument('--nonce', default='')
    parser.add_argument('--job', type=int)
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    driver = Driver(config)
    if args.command == 'serve':
        driver.serve()
    elif args.command == 'status':
        print(json.dumps(driver.queue.rows(), indent=2))
    elif args.command == 'cleanup':
        report = driver.queue.cleanup(apply=args.apply)
        report['release_images'] = driver.cleanup_images(apply=args.apply)
        print(json.dumps(report, indent=2))
        if report['errors'] or report['release_images'].get('errors'):
            raise SystemExit(1)
    elif args.command == 'retry':
        with driver.queue.connect() as db:
            changed = db.execute("UPDATE jobs SET state='queued',started=NULL,finished=NULL,status_sent=0 WHERE id=? AND state='failure'", (args.job,)).rowcount
        if changed != 1:
            raise SystemExit('Only a failed job can be retried')
    else:
        if args.route not in driver.routes:
            raise SystemExit('Route is not allowlisted')
        route = driver.routes[args.route]
        head = driver.api(f"/repos/{route['repo']}/git/ref/heads/{route['ref']}")['object']['sha']
        if args.sha and args.sha != head:
            raise SystemExit('Manual enqueue must use the current canonical branch head')
        print(driver.queue.enqueue(args.route, head, args.kind, args.nonce))


if __name__ == '__main__':
    main()
