#!/usr/bin/env node

/** Apply checksummed, additive PostgreSQL runtime migrations as the owner role. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { assertRuntimeSchemaContract } from './postgres-runtime-contract.mjs';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultMigrationsDir = path.join(projectDir, 'backend', 'migrations', 'postgres');

class UpgradeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function emit(event, details = {}, stream = process.stdout) {
  stream.write(`${JSON.stringify({ event, at: new Date().toISOString(), ...details })}\n`);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h' || token === '--json') { result[token.replace(/^-+/, '')] = true; continue; }
    if (!token.startsWith('--')) throw new UpgradeError('INVALID_ARGUMENT', `Unexpected positional argument: ${token}`);
    const separator = token.indexOf('=');
    const key = token.slice(2, separator < 0 ? undefined : separator);
    const value = separator < 0 ? argv[++index] : token.slice(separator + 1);
    if (value === undefined || value.startsWith('--')) throw new UpgradeError('INVALID_ARGUMENT', `--${key} requires a value.`);
    result[key] = value;
  }
  return result;
}

function sslConfig(mode) {
  const value = String(mode || 'disable').toLowerCase();
  if (['disable', 'false', '0', 'off'].includes(value)) return false;
  if (['require', 'true', '1', 'on', 'no-verify'].includes(value)) return { rejectUnauthorized: false };
  if (['verify-full', 'verify-ca'].includes(value)) return { rejectUnauthorized: true };
  throw new UpgradeError('INVALID_SSL_MODE', `Unsupported PostgreSQL SSL mode: ${value}`);
}

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function normalizedSql(value) { return String(value).replace(/\r\n?/gu, '\n'); }

function migrationsIn(directory) {
  if (!fs.existsSync(directory)) throw new UpgradeError('MIGRATIONS_MISSING', `Migration directory does not exist: ${directory}`);
  const migrations = fs.readdirSync(directory).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name)).sort().map((name) => {
    const version = Number(name.slice(0, 4));
    const sql = normalizedSql(fs.readFileSync(path.join(directory, name), 'utf8'));
    if (!sql.trim()) throw new UpgradeError('MIGRATION_EMPTY', `Migration is empty: ${name}`);
    return { version, name, sql, checksum: sha256(sql) };
  });
  const versions = new Set();
  for (const migration of migrations) {
    if (versions.has(migration.version)) throw new UpgradeError('MIGRATION_VERSION_DUPLICATE', `Duplicate migration version: ${migration.version}`);
    versions.add(migration.version);
  }
  for (let version = 2; version <= (migrations.at(-1)?.version || 1); version += 1) {
    if (!versions.has(version)) throw new UpgradeError('MIGRATION_VERSION_GAP', `Runtime migration ${version} is missing.`);
  }
  return migrations;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    process.stdout.write('Usage: node scripts/upgrade-postgres-schema.mjs --expected-source-version 1 --expected-source-sha256 <digest> [--target-version 2] [--pg-user role] [--pg-password-file file]\n');
    return;
  }
  const migrationsDir = path.resolve(String(args['migrations-dir'] || defaultMigrationsDir));
  const migrations = migrationsIn(migrationsDir);
  const availableVersion = migrations.at(-1)?.version || 0;
  const targetVersion = Number(args['target-version'] || process.env.POSTGRES_RUNTIME_SCHEMA_VERSION || availableVersion);
  if (!Number.isInteger(targetVersion) || targetVersion < 1 || targetVersion > availableVersion) {
    throw new UpgradeError('TARGET_VERSION_INVALID', `Runtime migration target ${targetVersion} is not available.`);
  }
  const expectedSourceVersion = Number(args['expected-source-version']);
  const expectedSourceSha256 = String(args['expected-source-sha256'] || '').trim().toLowerCase();
  if (!Number.isInteger(expectedSourceVersion) || expectedSourceVersion < 1) {
    throw new UpgradeError('EXPECTED_SOURCE_VERSION_REQUIRED', '--expected-source-version must be a positive integer.');
  }
  if (!/^[a-f0-9]{64}$/u.test(expectedSourceSha256)) {
    throw new UpgradeError('EXPECTED_SOURCE_SHA256_REQUIRED', '--expected-source-sha256 must be a 64-character hexadecimal digest.');
  }
  const passwordFile = path.resolve(String(args['pg-password-file'] || process.env.POSTGRES_PASSWORD_FILE || ''));
  if (!passwordFile || !fs.existsSync(passwordFile)) throw new UpgradeError('PASSWORD_FILE_MISSING', 'A PostgreSQL owner password file is required.');
  const password = fs.readFileSync(passwordFile, 'utf8').replace(/[\r\n]+$/u, '');
  if (!password) throw new UpgradeError('PASSWORD_FILE_EMPTY', 'The PostgreSQL owner password file is empty.');

  const pg = await import('pg');
  const Client = pg.Client || pg.default?.Client;
  const connection = {
    host: String(args['pg-host'] || process.env.POSTGRES_HOST || '127.0.0.1'),
    port: Number(args['pg-port'] || process.env.POSTGRES_PORT || 5432),
    database: String(args['pg-database'] || process.env.POSTGRES_DATABASE || 'seemplify_experience'),
    user: String(args['pg-user'] || process.env.POSTGRES_USER || 'seemplify_experience_owner'),
    password,
    ssl: sslConfig(args['pg-ssl'] || process.env.POSTGRES_SSL),
    application_name: 'seemplify-experience-runtime-migrator',
    connectionTimeoutMillis: 10_000,
    query_timeout: 120_000
  };
  const client = new Client(connection);
  await client.connect();
  const lockKey = `seemplify:experience:runtime-schema:${connection.database}`;
  let locked = false;
  try {
    const identity = (await client.query(`SELECT current_user username,pg_is_in_recovery() recovery,
      has_schema_privilege(current_user,current_schema(),'CREATE') schema_create`)).rows[0];
    if (identity.recovery) throw new UpgradeError('POSTGRES_READ_ONLY', 'The PostgreSQL server is a recovery replica.');
    if (!identity.schema_create) throw new UpgradeError('OWNER_PRIVILEGES_REQUIRED', 'The migration role cannot create schema objects.');
    await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [lockKey]);
    locked = true;
    let sourceRows;
    try {
      sourceRows = (await client.query(`SELECT version,source_sha256 FROM public.experience_schema_version
        WHERE singleton=TRUE`)).rows;
    } catch (error) {
      throw new UpgradeError('SOURCE_SCHEMA_METADATA_MISSING', `The immutable PostgreSQL source metadata could not be read: ${error?.message || String(error)}`);
    }
    if (sourceRows.length !== 1 || Number(sourceRows[0].version) !== expectedSourceVersion
        || String(sourceRows[0].source_sha256 || '').toLowerCase() !== expectedSourceSha256) {
      throw new UpgradeError('SOURCE_SCHEMA_PRECONDITION_FAILED', 'The PostgreSQL source version/hash does not match the committed cutover source.');
    }
    await client.query(`CREATE TABLE IF NOT EXISTS experience_runtime_schema_version (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`);
    const appliedRows = (await client.query('SELECT version,name,checksum,applied_at FROM experience_runtime_schema_version ORDER BY version')).rows;
    const byVersion = new Map(migrations.map((migration) => [migration.version, migration]));
    for (const applied of appliedRows) {
      const known = byVersion.get(Number(applied.version));
      if (!known) throw new UpgradeError('APPLIED_MIGRATION_UNKNOWN', `Applied runtime migration ${applied.version} is not present in this release.`);
      if (applied.name !== known.name || applied.checksum !== known.checksum) {
        throw new UpgradeError('APPLIED_MIGRATION_CHANGED', `Applied runtime migration ${applied.version} no longer matches its checksum.`);
      }
    }
    const appliedVersions = new Set(appliedRows.map((row) => Number(row.version)));
    for (const migration of migrations.filter((item) => item.version <= targetVersion)) {
      if (appliedVersions.has(migration.version)) continue;
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout='10s'");
        await client.query("SET LOCAL idle_in_transaction_session_timeout='5min'");
        await client.query(migration.sql);
        await assertRuntimeSchemaContract((sql) => client.query(sql), { schema: 'public', runtimeVersion: migration.version });
        await client.query(`INSERT INTO experience_runtime_schema_version(version,name,checksum,applied_at)
          VALUES ($1,$2,$3,$4)`, [migration.version, migration.name, migration.checksum, new Date().toISOString()]);
        await client.query('COMMIT');
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* preserve migration error */ }
        throw error;
      }
      emit('postgres_runtime_migration_applied', { version: migration.version, name: migration.name, checksum: migration.checksum });
    }
    const current = Number((await client.query('SELECT COALESCE(MAX(version),0)::integer version FROM experience_runtime_schema_version')).rows[0].version);
    if (current !== targetVersion) throw new UpgradeError('RUNTIME_SCHEMA_VERSION_MISMATCH', `Runtime schema is ${current}; expected ${targetVersion}.`);
    await assertRuntimeSchemaContract((sql) => client.query(sql), { schema: 'public', runtimeVersion: current });
    emit('postgres_runtime_schema_ready', { version: current, migrations: migrations.filter((item) => item.version <= current).length });
  } finally {
    if (locked) {
      try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lockKey]); } catch { /* connection close releases it */ }
    }
    await client.end();
  }
}

main().catch((error) => {
  emit('error', { code: error?.code || 'POSTGRES_RUNTIME_UPGRADE_FAILED', message: error?.message || String(error) }, process.stderr);
  process.exitCode = 1;
});
