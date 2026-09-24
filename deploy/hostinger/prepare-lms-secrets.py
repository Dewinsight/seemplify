"""Run as root once, under the production deployment lock. Never prints values."""
import json
import os
from pathlib import Path
import secrets

root = Path('/opt/seemplify/secrets')
path = root / 'lms.env'
if not path.exists():
    values = {name: secrets.token_hex(32) for name in (
        'LMS_DB_ROOT_PASSWORD', 'LMS_DB_PASSWORD', 'LMS_ADMIN_PASSWORD', 'OIDC_LMS_SECRET'
    )}
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(''.join(f'{key}={value}\n' for key, value in values.items()))
values = dict(line.strip().split('=', 1) for line in path.read_text().splitlines() if '=' in line)
core = root / 'core-apps.env'
lines = [line for line in core.read_text().splitlines() if not line.startswith('OIDC_LMS_SECRET=')]
core.write_text('\n'.join(lines) + '\nOIDC_LMS_SECRET=' + values['OIDC_LMS_SECRET'] + '\n')
os.chmod(core, 0o600)
clients_path = root / 'idp-clients.json'
clients = json.loads(clients_path.read_text())
clients['clients'] = [c for c in clients['clients'] if c.get('client_id') != 'lms']
clients['clients'].append({
    'client_id': 'lms', 'client_secret': values['OIDC_LMS_SECRET'],
    'redirect_uris': ['https://lms.seemplifyai.com/api/method/lms.lms.production_auth.callback'],
    'redirect_uri_patterns': ['https://lms.seemplifyai.com/api/method/lms.lms.production_auth.callback'],
    'allowed_origins': ['https://lms.seemplifyai.com'],
    'response_types': ['code'], 'grant_types': ['authorization_code'],
    'token_endpoint_auth_method': 'client_secret_post'
})
# Preserve the bind-mounted inode used by the running Identity container.
clients_path.write_text(json.dumps(clients, indent=2) + '\n')
os.chmod(clients_path, 0o600)
print('LMS credentials and Identity client configured; no secret values displayed.')
