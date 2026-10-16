#!/usr/bin/env python3
"""Release all Seemplify components without occupying their runner controller."""
from pathlib import Path
import datetime
import json
import re
import sys
import time
import urllib.request

WORKFLOWS = [
    'provision-experience-knowledge-hostinger.yml', 'deploy-core-hostinger.yml',
    'deploy-experience-hostinger.yml', 'deploy-approver-hostinger.yml',
    'deploy-chatgpt-gateway-hostinger.yml', 'deploy-connectors-hostinger.yml',
    'deploy-mail-service.yml', 'deploy-coturn-hostinger.yml', 'deploy-lms-hostinger.yml',
]


class Release:
    def __init__(self, revision, request_id):
        if not re.fullmatch(r'[0-9a-f]{40}', revision) or not re.fullmatch(r'[0-9]+', request_id):
            raise ValueError('Invalid release identity')
        self.revision, self.request_id = revision, request_id
        self.token = Path('/opt/seemplify/secrets/github-deploy-token').read_text().strip()
        self.root = Path('/opt/seemplify/deploy-all') / request_id
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        boundary = self.root / 'eligible-since.txt'
        if not boundary.exists():
            boundary.write_text((datetime.datetime.now(datetime.timezone.utc) -
                datetime.timedelta(minutes=10)).strftime('%Y-%m-%dT%H:%M:%SZ'))
        self.eligible_since = boundary.read_text().strip()
        self.runs = []

    def api(self, path, body=None):
        request = urllib.request.Request('https://api.github.com/repos/Dewinsight/seemplify/' + path,
            headers={'Authorization': 'Bearer ' + self.token, 'Accept': 'application/vnd.github+json',
                     'Content-Type': 'application/json'},
            data=json.dumps(body).encode() if body is not None else None)
        with urllib.request.urlopen(request, timeout=45) as response:
            raw = response.read()
            return json.loads(raw) if raw else None

    def status(self, state, description):
        self.api('statuses/' + self.revision, {'state': state,
            'context': 'hostinger-ci/seemplify-all', 'description': description})

    def require_main(self):
        if self.api('git/ref/heads/main')['object']['sha'] != self.revision:
            raise ValueError('A newer main superseded this complete-release request')

    def run_workflow(self, workflow):
        self.require_main()
        since = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        # A main push may already have started this exact component release.
        # Reuse only recent trusted runs belonging to this request window.
        candidates = self.api('actions/workflows/' + workflow + '/runs?per_page=30')['workflow_runs']
        candidates = [r for r in candidates if r['head_sha'] == self.revision
            and r['head_branch'] == 'main' and r['event'] in ('push', 'workflow_dispatch')
            and r['created_at'] >= self.eligible_since
            and r['status'] in ('queued', 'in_progress', 'completed')
            and r.get('conclusion') in (None, 'success')]
        run_id = max((r['id'] for r in candidates), default=None)
        if run_id is None:
            result = self.api('actions/workflows/' + workflow + '/dispatches', {'ref': 'main'})
            run_id = result.get('workflow_run_id') if isinstance(result, dict) else None
        deadline = time.monotonic() + 4 * 3600
        while time.monotonic() < deadline:
            if run_id is None:
                candidates = self.api('actions/workflows/' + workflow + '/runs?event=workflow_dispatch&per_page=20')['workflow_runs']
                candidates = [r for r in candidates if r['created_at'] >= since and r['head_sha'] == self.revision]
                if candidates:
                    run_id = min(candidates, key=lambda r: r['id'])['id']
            if run_id is not None:
                run = self.api('actions/runs/' + str(run_id))
                if run['head_sha'] != self.revision:
                    raise ValueError('Dispatched workflow revision mismatch')
                if run['status'] == 'completed':
                    self.runs.append({'workflow': workflow, 'id': run_id, 'sha': run['head_sha'],
                                      'conclusion': run['conclusion'], 'url': run['html_url']})
                    (self.root / 'runs.json').write_text(json.dumps(self.runs, indent=2))
                    if run['conclusion'] != 'success':
                        raise RuntimeError('Component workflow did not succeed')
                    print(workflow + ' success run=' + str(run_id), flush=True)
                    return
            time.sleep(15)
        raise TimeoutError('Component workflow exceeded its release timeout')

    def run(self):
        import fcntl
        lock = Path('/var/lock/seemplify-deploy-all.lock').open('a')
        fcntl.flock(lock, fcntl.LOCK_EX)
        self.status('pending', 'Complete Seemplify release queued on KVM4; controller remains available')
        try:
            for workflow in WORKFLOWS:
                self.run_workflow(workflow)
            self.status('success', 'All nine Seemplify component workflows passed on KVM4')
        except Exception as error:
            self.status('failure', 'Complete release stopped: ' + type(error).__name__)
            raise


if __name__ == '__main__':
    try:
        Release(sys.argv[1], sys.argv[2]).run()
    except Exception as error:
        print('Seemplify release failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
