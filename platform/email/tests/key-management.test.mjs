import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sha256Hex } from '../api/src/security.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('PowerShell key writer creates a hashed inventory and revokes exactly one ID', { skip: process.platform !== 'win32' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mail-key-'));
  const envFile = path.join(dir, '.env.runtime');
  const bearerFile = path.join(dir, 'bearer');
  writeFileSync(envFile, `MAIL_API_KEYS="existing:${'a'.repeat(64)}:read"\nUNCHANGED=value\n`);
  const script = path.join(root, 'scripts', 'new-secrets.ps1');
  const create = spawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-File',script,'-Json','-EnvironmentFile',envFile,'-NewApiKey','recruiter-test','-Scopes','send,read','-BearerOutputFile',bearerFile], { encoding: 'utf8' });
  assert.equal(create.status, 0, create.stderr);
  const bearer = readFileSync(bearerFile, 'utf8').trim();
  const [keyId, secret] = bearer.split('.', 2);
  assert.equal(keyId, 'recruiter-test');
  const created = readFileSync(envFile, 'utf8');
  assert.match(created, new RegExp(`recruiter-test:${sha256Hex(secret)}:send\\|read`));
  assert.match(created, /UNCHANGED=value/);
  assert.doesNotMatch(created, new RegExp(secret));

  const revoke = spawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-File',script,'-Json','-EnvironmentFile',envFile,'-RevokeApiKey','recruiter-test'], { encoding: 'utf8' });
  assert.equal(revoke.status, 0, revoke.stderr);
  const revoked = readFileSync(envFile, 'utf8');
  assert.doesNotMatch(revoked, /recruiter-test:/);
  assert.match(revoked, /existing:/);
  assert.match(revoked, /UNCHANGED=value/);
});
