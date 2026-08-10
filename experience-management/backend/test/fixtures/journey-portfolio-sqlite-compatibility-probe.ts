import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-owner-compat-'));
process.env.DATABASE_PATH = path.join(root, 'compat.sqlite');
process.env.UPLOAD_DIR = path.join(root, 'uploads');
process.env.FRONTEND_DIST = path.join(root, 'frontend');
process.env.SESSION_SECRET = 'portfolio-compatibility-session-secret-that-is-long-enough';
process.env.ADMIN_EMAIL = 'portfolio-compat@example.test';
process.env.ADMIN_PASSWORD = 'Portfolio-compatibility-password-2026!';

const { db } = await import('../../src/database.js');
await import('../../src/platformSchema.js');
const at = '2026-08-07T00:00:00.000Z';
db.prepare(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
  VALUES ('compat-user','compat-user@example.test','Compatibility user','x','member',1,?,?)`).run(at, at);
db.prepare(`INSERT INTO spaces(id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
  VALUES ('compat-space','Compatibility','compat-space','compat-user',NULL,?,?)`).run(at, at);
db.prepare(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
  VALUES ('compat-space','compat-user','member',?,?)`).run(at, at);
db.exec(`
  CREATE TABLE journey_portfolio_items (
    id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, lifecycle TEXT NOT NULL, owner_user_id TEXT, priority TEXT, due_date TEXT,
    state TEXT NOT NULL, updated_at TEXT NOT NULL, retention_expires_at TEXT,
    UNIQUE(id,space_id),
    FOREIGN KEY(space_id,owner_user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE RESTRICT
  );
  CREATE INDEX journey_portfolio_items_compat_index ON journey_portfolio_items(space_id,owner_user_id);
  CREATE TABLE portfolio_compat_child (
    item_id TEXT NOT NULL, space_id TEXT NOT NULL,
    FOREIGN KEY(item_id,space_id) REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE
  );
  INSERT INTO journey_portfolio_items
    (id,space_id,kind,lifecycle,owner_user_id,priority,due_date,state,updated_at,retention_expires_at)
    VALUES ('compat-item','compat-space','initiative','planned','compat-user','high',NULL,'active','2026-08-07T00:00:00.000Z',NULL);
  INSERT INTO portfolio_compat_child(item_id,space_id) VALUES ('compat-item','compat-space');
`);

await import('../../src/journeyPortfolio.js');
const fks = db.pragma('foreign_key_list(journey_portfolio_items)') as Array<{ table: string; from: string }>;
assert.ok(fks.some((fk) => fk.table === 'users' && fk.from === 'owner_user_id'));
assert.ok(!fks.some((fk) => fk.table === 'space_memberships'));
assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='journey_portfolio_items_compat_index'").get());
assert.equal((db.prepare('SELECT owner_user_id owner FROM journey_portfolio_items WHERE id=?').get('compat-item') as { owner: string }).owner, 'compat-user');
db.prepare("DELETE FROM space_memberships WHERE space_id='compat-space' AND user_id='compat-user'").run();
assert.equal((db.prepare('SELECT COUNT(*) count FROM portfolio_compat_child').get() as { count: number }).count, 1);
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
db.close();
fs.rmSync(root, { recursive: true, force: true });
