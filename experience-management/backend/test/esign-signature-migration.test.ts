import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import Database from 'better-sqlite3';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-esign-signature-migration-'));
const databasePath = path.join(root, 'legacy.sqlite');
const databaseModule = pathToFileURL(path.resolve(import.meta.dirname, '../src/database.ts')).href;
const environment = {
  ...process.env,
  DATABASE_PATH: databasePath,
  UPLOAD_DIR: path.join(root, 'uploads'),
  ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  FRONTEND_DIST: path.join(root, 'frontend')
};

function initializeDatabase() {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval',
    `const { db } = await import(${JSON.stringify(databaseModule)}); db.close();`], {
    env: environment,
    cwd: path.resolve(import.meta.dirname, '..'),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

initializeDatabase();
const legacy = new Database(databasePath);
legacy.pragma('foreign_keys = ON');
const owner = { id: 'migration-owner' };
legacy.prepare(`INSERT INTO users (id,email,name,password_hash,role,session_version,created_at,updated_at)
  VALUES (?,?,?,'not-used','member',1,?,?)`).run(
    owner.id, 'migration-owner@example.test', 'Migration Owner',
    '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'
  );
legacy.exec(`
  DELETE FROM schema_migrations WHERE version=14;
  DROP TABLE esign_saved_signatures;
  CREATE TABLE esign_saved_signatures (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    recipient_identity_hash TEXT,
    mode TEXT NOT NULL CHECK(mode IN ('typed','drawn','uploaded')),
    label TEXT NOT NULL DEFAULT '',
    mime_type TEXT,
    display_text_enc TEXT,
    storage_key TEXT UNIQUE,
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_used_at TEXT,
    CHECK(
      (owner_user_id IS NOT NULL AND recipient_identity_hash IS NULL)
      OR (owner_user_id IS NULL AND recipient_identity_hash IS NOT NULL)
    ),
    CHECK(
      (mode='typed' AND display_text_enc IS NOT NULL AND storage_key IS NULL AND mime_type IS NULL)
      OR (mode IN ('drawn','uploaded') AND display_text_enc IS NULL AND storage_key IS NOT NULL AND mime_type IN ('image/png','image/jpeg'))
    )
  );
  CREATE INDEX esign_saved_signatures_user
    ON esign_saved_signatures(owner_user_id,updated_at DESC) WHERE owner_user_id IS NOT NULL;
  CREATE INDEX esign_saved_signatures_recipient
    ON esign_saved_signatures(recipient_identity_hash,updated_at DESC) WHERE recipient_identity_hash IS NOT NULL;
`);
legacy.prepare(`INSERT INTO esign_saved_signatures
  (id,owner_user_id,recipient_identity_hash,mode,label,display_text_enc,sha256,created_at,updated_at)
  VALUES ('legacy-recipient',NULL,'legacy-identity','typed','Legacy','legacy-ciphertext','legacy-sha',?,?)`)
  .run('2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
legacy.close();

initializeDatabase();
const migrated = new Database(databasePath);
migrated.pragma('foreign_keys = ON');

after(() => {
  migrated.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('migration 14 preserves saved signatures and permits account plus invitation identity ownership', () => {
  assert.ok(migrated.prepare("SELECT 1 FROM schema_migrations WHERE version=14 AND name='reusable_esign_signature_identity_scope'").get());
  assert.ok(migrated.prepare("SELECT 1 FROM esign_saved_signatures WHERE id='legacy-recipient' AND recipient_identity_hash='legacy-identity'").get());

  const timestamp = '2026-07-02T00:00:00.000Z';
  migrated.prepare(`INSERT INTO esign_saved_signatures
    (id,owner_user_id,recipient_identity_hash,mode,label,display_text_enc,sha256,created_at,updated_at)
    VALUES ('dual-scope',?,?,'typed','Account signature','ciphertext','sha',?,?)`)
    .run(owner.id, 'verified-email-identity', timestamp, timestamp);
  assert.ok(migrated.prepare("SELECT 1 FROM esign_saved_signatures WHERE id='dual-scope' AND owner_user_id=? AND recipient_identity_hash=?")
    .get(owner.id, 'verified-email-identity'));
  assert.throws(() => migrated.prepare(`INSERT INTO esign_saved_signatures
    (id,owner_user_id,recipient_identity_hash,mode,label,display_text_enc,sha256,created_at,updated_at)
    VALUES ('ownerless',NULL,NULL,'typed','Invalid','ciphertext','sha',?,?)`).run(timestamp, timestamp), /CHECK constraint failed/);
});
