#!/usr/bin/env node

/**
 * Create a schema-complete, data-empty SQLite source database by importing
 * only the built repository modules that own SQLite schema migrations.
 *
 * This deliberately never imports app.js or server.js, so listeners, workers,
 * account seeding, and external integrations cannot start.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');
const backendDist = path.join(projectDir, 'backend', 'dist');

function output(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value)}\n`);
}

function fail(message, code = 'SQLITE_BOOTSTRAP_FAILED') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArgs(argv) {
  let sqlite;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === '--json') continue;
    if (argument === '--sqlite') {
      sqlite = argv[index + 1];
      index += 1;
      if (!sqlite) throw fail('--sqlite requires a filesystem path.', 'INVALID_ARGUMENT');
      continue;
    }
    if (argument.startsWith('--sqlite=')) {
      sqlite = argument.slice('--sqlite='.length);
      if (!sqlite) throw fail('--sqlite requires a filesystem path.', 'INVALID_ARGUMENT');
      continue;
    }
    throw fail(`Unknown argument: ${argument}`, 'INVALID_ARGUMENT');
  }
  if (!sqlite) throw fail('--sqlite is required.', 'INVALID_ARGUMENT');
  return { sqlite: path.resolve(sqlite) };
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('Usage: node scripts/bootstrap-sqlite-store.mjs --sqlite <new-database-path> [--json]\n');
    return;
  }

  if (fs.existsSync(args.sqlite)) {
    throw fail(`Refusing to modify an existing SQLite database: ${args.sqlite}`, 'SQLITE_ALREADY_EXISTS');
  }

  const requiredModules = ['database.js', 'spaces.js', 'knowledgeRepository.js', 'intelligence.js'];
  const missingModules = requiredModules.filter((name) => !fs.existsSync(path.join(backendDist, name)));
  if (missingModules.length) {
    throw fail(
      `The built backend is incomplete (${missingModules.join(', ')} missing). Run the backend build first.`,
      'BACKEND_BUILD_MISSING'
    );
  }

  fs.mkdirSync(path.dirname(args.sqlite), { recursive: true });
  process.env.DOTENV_CONFIG_QUIET = 'true';
  process.env.DATABASE_PROVIDER = 'sqlite';
  process.env.DATABASE_PATH = args.sqlite;

  let db;
  try {
    const databaseModule = await import(pathToFileURL(path.join(backendDist, 'database.js')).href);
    db = databaseModule.db;
    await import(pathToFileURL(path.join(backendDist, 'spaces.js')).href);
    await import(pathToFileURL(path.join(backendDist, 'knowledgeRepository.js')).href);
    await import(pathToFileURL(path.join(backendDist, 'intelligence.js')).href);

    if (db.provider !== 'sqlite') throw fail('Built runtime did not select SQLite.', 'WRONG_DATABASE_PROVIDER');

    const integrity = db.pragma('integrity_check');
    const integrityRows = Array.isArray(integrity) ? integrity : [];
    if (integrityRows.length !== 1 || String(integrityRows[0]?.integrity_check || '').toLowerCase() !== 'ok') {
      throw fail('The bootstrapped SQLite database failed its integrity check.', 'SQLITE_INTEGRITY_FAILED');
    }
    const foreignKeyRows = db.pragma('foreign_key_check');
    if (Array.isArray(foreignKeyRows) && foreignKeyRows.length) {
      throw fail('The bootstrapped SQLite database contains foreign-key violations.', 'SQLITE_FOREIGN_KEY_FAILED');
    }

    const tables = db.prepare(`SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all();
    const migration = db.prepare('SELECT COUNT(*) AS count,MAX(version) AS version FROM schema_migrations').get();
    let applicationRows = 0;
    const nonemptyTables = [];
    for (const { name } of tables) {
      if (name === 'schema_migrations') continue;
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`).get();
      const count = Number(row?.count || 0);
      applicationRows += count;
      if (count) nonemptyTables.push({ table: name, rows: count });
    }
    if (applicationRows !== 0) {
      throw fail(
        `Bootstrap unexpectedly created application data in: ${nonemptyTables.map((item) => item.table).join(', ')}.`,
        'SQLITE_NOT_EMPTY'
      );
    }

    output({
      event: 'sqlite_bootstrap_complete',
      at: new Date().toISOString(),
      sqlite: args.sqlite,
      provider: db.provider,
      tables: tables.length,
      schemaMigrations: Number(migration?.count || 0),
      schemaVersion: Number(migration?.version || 0),
      applicationRows
    });
  } finally {
    db?.close();
  }
}

main().catch((error) => {
  output({
    event: 'error',
    at: new Date().toISOString(),
    code: error?.code || 'SQLITE_BOOTSTRAP_FAILED',
    message: error?.message || String(error)
  }, process.stderr);
  process.exitCode = 1;
});
