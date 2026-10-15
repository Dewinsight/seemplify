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
import sqlite3
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

SHA = re.compile(r'[0-9a-f]{40}\Z')


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

    def undelivered(self):
        with self.connect() as db:
            return [dict(row) for row in db.execute("SELECT * FROM jobs WHERE state IN ('success','failure') AND status_sent=0 ORDER BY id LIMIT 100")]


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
            'description': f"Hostinger job {job['id']}: {state}; private logs retained on the host"})

    def poll(self):
        for route in self.routes.values():
            variables = self.api(f"/repos/{route['repo']}/actions/variables")['variables']
            driver = next((v['value'] for v in variables if v['name'] == 'HOSTINGER_CI_DRIVER'), 'actions')
            head = self.api(f"/repos/{route['repo']}/git/ref/heads/{route['ref']}")['object']['sha']
            with self.queue.connect() as db:
                cursor = db.execute('SELECT sha FROM cursors WHERE route=?', (route['name'],)).fetchone()
            if driver != 'local' or cursor is None:
                with self.queue.connect() as db:
                    db.execute('INSERT OR REPLACE INTO cursors VALUES(?,?)', (route['name'], head))
                continue
            if cursor[0] == head:
                continue
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

    def work(self, job):
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
                        '--pids-limit', '2048', '--network', 'none', '--entrypoint', 'python3', self.config['image'],
                        '-c', 'import json,pathlib,time; p=pathlib.Path; cpu=p("/sys/fs/cgroup/cpu.max").read_text().strip();memory=p("/sys/fs/cgroup/memory.max").read_text().strip();assert cpu=="150000 100000";assert memory=="4294967296";assert p("/sys/fs/cgroup/memory.swap.max").read_text().strip()=="0";assert not p("/var/run/docker.sock").exists();print(json.dumps({"started":time.time(),"cpu":cpu,"memory":memory}),flush=True);time.sleep(12);print("Probe passed",flush=True)'], log)
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
                source = self.queue.root / 'jobs' / str(job['id']) / 'source'
                if source.exists():
                    shutil.rmtree(source)
        with self.queue.connect() as db:
            db.execute("UPDATE jobs SET state='queued',started=NULL WHERE state='running'")
        futures = {}
        next_poll = 0
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.config['workers']) as executor:
            while not self.stop.is_set():
                for future, job in list(futures.items()):
                    if future.done():
                        if future.exception() is not None:
                            self.queue.finish(job['id'], False)
                            print('worker_failed=' + type(future.exception()).__name__, flush=True)
                        del futures[future]
                if time.monotonic() >= next_poll:
                    try:
                        self.poll()
                    except Exception as error:
                        print('poll_failed=' + type(error).__name__, flush=True)
                    next_poll = time.monotonic() + self.config.get('poll_seconds', 30)
                    for job in self.queue.undelivered():
                        try:
                            self.status(job, job['state'])
                            with self.queue.connect() as db:
                                db.execute('UPDATE jobs SET status_sent=1 WHERE id=?', (job['id'],))
                        except Exception:
                            pass
                while len(futures) < self.config['workers']:
                    job = self.queue.claim()
                    if job is None:
                        break
                    futures[executor.submit(self.work, job)] = job
                self.stop.wait(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', default='/etc/hostinger-ci/config.json')
    parser.add_argument('command', choices=['serve', 'status', 'enqueue', 'retry'])
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
