import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-x-seed-'));
const files = {
  password: path.join(root, 'admin-password'), session: path.join(root, 'session-secret'), key: path.join(root, 'x-key'),
  consumerKey: path.join(root, 'x-consumer-key'), consumerSecret: path.join(root, 'x-consumer-secret'), bearer: path.join(root, 'x-bearer-token'),
  accessToken: path.join(root, 'x-access-token'), accessSecret: path.join(root, 'x-access-token-secret')
};
const sentinels = {
  consumerKey: 'seed-consumer-key-not-real', consumerSecret: 'seed-consumer-secret-not-real', bearer: 'seed-bearer-token-not-real',
  accessToken: 'seed-access-token-not-real', accessSecret: 'seed-access-secret-not-real'
};
fs.writeFileSync(files.password, 'Fresh-Admin-Password-2026!'); fs.writeFileSync(files.session, 'fresh-session-secret-longer-than-twenty-characters');
fs.writeFileSync(files.key, Buffer.alloc(32, 13).toString('base64url'));
for (const name of ['consumerKey', 'consumerSecret', 'bearer', 'accessToken', 'accessSecret'] as const) fs.writeFileSync(files[name], sentinels[name]);
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'seed.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'), ADMIN_EMAIL: 'fresh-admin@example.com',
  ADMIN_PASSWORD_FILE: files.password, SESSION_SECRET_FILE: files.session, X_CREDENTIAL_ENCRYPTION_KEY_FILE: files.key,
  X_SEED_CONSUMER_KEY_FILE: files.consumerKey, X_SEED_CONSUMER_SECRET_FILE: files.consumerSecret, X_SEED_BEARER_TOKEN_FILE: files.bearer,
  X_SEED_ACCESS_TOKEN_FILE: files.accessToken, X_SEED_ACCESS_TOKEN_SECRET_FILE: files.accessSecret
});

const { bootstrapAdminAccount } = await import('../src/auth.js');
const { db } = await import('../src/database.js');
const { getXIntegrationStatus, seedXIntegrationForAdmin } = await import('../src/xIntegration.js');

after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

test('bootstraps the owner and consumes plaintext X seed files into the encrypted store once', () => {
  const userId = bootstrapAdminAccount();
  assert.equal((db.prepare('SELECT role FROM users WHERE id=?').get(userId) as any).role, 'owner');
  assert.equal(seedXIntegrationForAdmin(), true);
  for (const name of ['consumerKey', 'consumerSecret', 'bearer', 'accessToken', 'accessSecret'] as const) assert.equal(fs.existsSync(files[name]), false);

  const app = db.prepare('SELECT * FROM x_apps').get() as any; const connection = db.prepare('SELECT * FROM x_connections').get() as any;
  assert.ok(app && connection); assert.equal(connection.status, 'pending_verification');
  for (const secret of Object.values(sentinels)) {
    assert.doesNotMatch(JSON.stringify(app), new RegExp(secret)); assert.doesNotMatch(JSON.stringify(connection), new RegExp(secret));
  }
  const spaceId = (db.prepare('SELECT active_space_id FROM users WHERE id=?').get(userId) as { active_space_id: string }).active_space_id;
  const status = getXIntegrationStatus({ id: userId, email: 'fresh-admin@example.com', name: 'Workspace admin', role: 'owner', sessionVersion: 1 }, spaceId);
  assert.equal(status.app.configured, true); assert.equal(status.app.bearerTokenConfigured, true); assert.ok(status.connection);
  for (const secret of Object.values(sentinels)) assert.doesNotMatch(JSON.stringify(status), new RegExp(secret));
});
