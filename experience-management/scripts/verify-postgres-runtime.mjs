#!/usr/bin/env node

/**
 * Exercise the built PostgreSQL runtime adapter without importing the server,
 * app, repositories, workers, listeners, or account/bootstrap routines.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  runtimeExtensionTables,
  assertRuntimePrivileges,
  assertRuntimeSchemaContract,
  runtimeTableSetDifference
} from './postgres-runtime-contract.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');
const backendDist = path.join(projectDir, 'backend', 'dist');
const TEMP_TABLE = 'experience_runtime_preflight';

// The PostgreSQL adapter creates an eval worker whose CommonJS dependencies
// resolve from the process working directory. Deployment managers and the
// Control Center may invoke this verifier from outside the isolated release,
// so anchor dependency resolution to the verified project before importing
// the built adapter.
process.chdir(projectDir);

function output(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value)}\n`);
}

function fail(message, code = 'POSTGRES_RUNTIME_VERIFICATION_FAILED') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function stable(value) {
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Buffer.isBuffer(value)) return JSON.stringify({ $binary: value.toString('base64') });
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizedSql(value) {
  return String(value).replace(/\r\n?/gu, '\n');
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function expectedRuntimeMigrations(targetVersion) {
  const directory = path.join(projectDir, 'backend', 'migrations', 'postgres');
  const migrations = fs.readdirSync(directory).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name)).sort()
    .map((name) => ({ version: Number(name.slice(0, 4)), name, checksum: sha256(normalizedSql(fs.readFileSync(path.join(directory, name), 'utf8'))) }))
    .filter((migration) => migration.version <= targetVersion);
  if (!migrations.length || migrations.at(-1).version !== targetVersion) {
    throw fail(`Runtime migration ${targetVersion} is not present in this release.`, 'RUNTIME_MIGRATION_MISSING');
  }
  return migrations;
}

function parseManifest(metadata, configuredVersion, configuredSourceSha256) {
  let manifest;
  try {
    manifest = JSON.parse(String(metadata.manifest_json));
  } catch {
    throw fail('experience_schema_version.manifest_json is not valid JSON.', 'SOURCE_MANIFEST_INVALID');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw fail('The PostgreSQL source manifest must be a JSON object.', 'SOURCE_MANIFEST_INVALID');
  }

  const metadataVersion = Number(metadata.version);
  const metadataSha256 = String(metadata.source_sha256 || '').toLowerCase();
  const computedSha256 = sha256(stable({ schemaSha256: manifest.schemaSha256, tables: manifest.tables }));
  if (metadataVersion !== configuredVersion || Number(manifest.schemaVersion) !== configuredVersion) {
    throw fail('The configured, metadata, and source-manifest schema versions do not match.', 'SCHEMA_VERSION_MISMATCH');
  }
  if (!/^[a-f0-9]{64}$/u.test(metadataSha256)
      || manifest.sourceSha256 !== metadataSha256
      || computedSha256 !== metadataSha256
      || (configuredSourceSha256 && configuredSourceSha256 !== metadataSha256)) {
    throw fail('The PostgreSQL source manifest digest does not match the runtime configuration and metadata.', 'SOURCE_MANIFEST_MISMATCH');
  }
  if (!manifest.tables || typeof manifest.tables !== 'object' || Array.isArray(manifest.tables)) {
    throw fail('The PostgreSQL source manifest does not contain a table map.', 'SOURCE_MANIFEST_INVALID');
  }
  const tableNames = Object.keys(manifest.tables).sort();
  if (tableNames.length !== Number(manifest.tableCount)) {
    throw fail('The source-manifest table count does not match its table map.', 'SOURCE_MANIFEST_MISMATCH');
  }
  for (const name of tableNames) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
      throw fail(`The source manifest contains an unsafe table name: ${name}`, 'SOURCE_MANIFEST_INVALID');
    }
    const rowCount = Number(manifest.tables[name]?.rowCount);
    if (!Number.isSafeInteger(rowCount) || rowCount < 0) {
      throw fail(`The source manifest contains an invalid row count for ${name}.`, 'SOURCE_MANIFEST_INVALID');
    }
  }
  return { manifest, tableNames, metadataSha256 };
}

async function main() {
  const argumentsList = process.argv.slice(2);
  const unknownArgument = argumentsList.find((value) => !['--help', '-h', '--json'].includes(value));
  if (unknownArgument) {
    throw fail(`Unknown argument: ${unknownArgument}`, 'INVALID_ARGUMENT');
  }
  if (argumentsList.some((value) => value === '--help' || value === '-h')) {
    process.stdout.write('Usage: DATABASE_PROVIDER=postgres node scripts/verify-postgres-runtime.mjs [--json]\n');
    return;
  }

  const requiredModules = ['config.js', 'databaseAdapter.js'];
  const missingModules = requiredModules.filter((name) => !fs.existsSync(path.join(backendDist, name)));
  if (missingModules.length) {
    throw fail(
      `The built backend is incomplete (${missingModules.join(', ')} missing). Run the backend build first.`,
      'BACKEND_BUILD_MISSING'
    );
  }

  process.env.DOTENV_CONFIG_QUIET = 'true';
  const { config } = await import(pathToFileURL(path.join(backendDist, 'config.js')).href);
  const { createDatabase } = await import(pathToFileURL(path.join(backendDist, 'databaseAdapter.js')).href);
  if (config.databaseProvider !== 'postgres') {
    throw fail('DATABASE_PROVIDER must be postgres for this verification.', 'WRONG_DATABASE_PROVIDER');
  }

  let db;
  try {
    db = createDatabase(config);
    if (db.provider !== 'postgres') throw fail('The built runtime did not select PostgreSQL.', 'WRONG_DATABASE_PROVIDER');
    const health = db.health();
    if (!health.ready || health.provider !== 'postgres' || health.schemaVersion !== config.postgres.schemaVersion
        || health.runtimeSchemaVersion !== config.postgres.runtimeSchemaVersion) {
      throw fail(`PostgreSQL runtime health failed: ${health.error || 'schema/provider mismatch'}`, 'POSTGRES_HEALTH_FAILED');
    }

    const metadata = db.prepare(`SELECT version,source_sha256,migrated_at,manifest_json
      FROM experience_schema_version WHERE singleton=TRUE`).get();
    if (!metadata) throw fail('PostgreSQL migration metadata is missing.', 'SOURCE_MANIFEST_MISSING');
    const { manifest, tableNames, metadataSha256 } = parseManifest(
      metadata,
      config.postgres.schemaVersion,
      config.postgres.sourceSha256
    );
    const expectedMigrations = expectedRuntimeMigrations(config.postgres.runtimeSchemaVersion);
    const appliedMigrations = db.prepare(`SELECT version,name,checksum FROM experience_runtime_schema_version
      WHERE version<=? ORDER BY version`).all(config.postgres.runtimeSchemaVersion);
    if (stable(appliedMigrations) !== stable(expectedMigrations)) {
      throw fail('Applied PostgreSQL runtime migrations do not match this release.', 'RUNTIME_MIGRATION_CHECKSUM_MISMATCH');
    }
    const runtimeQuery = async (sql) => ({ rows: db.prepare(sql).all() });
    const schemaContract = await assertRuntimeSchemaContract(runtimeQuery, {
      schema: 'public', runtimeVersion: config.postgres.runtimeSchemaVersion
    });
    // runtimeVersion is required, not optional. Omitted, every privilege gate in
    // the contract fell back to its own default and the verifier silently
    // asserted an older runtime's expectations while reporting success.
    const privilegeContract = await assertRuntimePrivileges(runtimeQuery, config.postgres.user, {
      schema: 'public', runtimeVersion: config.postgres.runtimeSchemaVersion
    });

    const actualTableNames = (db.prepare(`SELECT table_name name
      FROM information_schema.tables
      WHERE table_schema=current_schema() AND table_type='BASE TABLE'
        AND table_name<>'experience_schema_version' ORDER BY table_name`).all()).map((row) => String(row.name));
    const { unknownTables, missingTables } = runtimeTableSetDifference(tableNames, actualTableNames, config.postgres.runtimeSchemaVersion);
    if (unknownTables.length || missingTables.length) {
      throw fail(`PostgreSQL tables differ from the source manifest plus runtime extensions (unknown: ${unknownTables.join(', ') || 'none'}; missing: ${missingTables.join(', ') || 'none'}).`, 'SOURCE_MANIFEST_MISMATCH');
    }

    let actualRows = 0;
    const rowCounts = new Map();
    for (const tableName of tableNames) {
      const count = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`).get()?.count || 0);
      rowCounts.set(tableName, count);
      actualRows += count;
    }

    const rollbackMarker = new Error('expected preflight rollback');
    const sentinel = crypto.randomUUID();
    const outer = db.transaction(() => {
      db.prepare(`CREATE TEMP TABLE ${TEMP_TABLE} (value TEXT PRIMARY KEY) ON COMMIT DROP`).run();
      db.prepare(`INSERT INTO ${TEMP_TABLE}(value) VALUES (?)`).run(sentinel);
      const inner = db.transaction(() => {
        const row = db.prepare(`SELECT value FROM ${TEMP_TABLE} WHERE value=?`).get(sentinel);
        if (row?.value !== sentinel) throw fail('Nested transaction could not read its outer transaction write.', 'NESTED_TRANSACTION_FAILED');
        db.prepare(`INSERT INTO ${TEMP_TABLE}(value) VALUES (?)`).run(`${sentinel}:nested`);
      });
      inner();
      const nestedCount = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${TEMP_TABLE}`).get()?.count || 0);
      if (nestedCount !== 2) throw fail('Nested transaction did not preserve both temporary rows.', 'NESTED_TRANSACTION_FAILED');
      throw rollbackMarker;
    });
    try {
      outer();
      throw fail('The rollback verification unexpectedly committed.', 'ROLLBACK_FAILED');
    } catch (error) {
      if (error !== rollbackMarker) throw error;
    }
    const temporaryRelation = db.prepare(`SELECT to_regclass('pg_temp.${TEMP_TABLE}') AS name`).get();
    if (temporaryRelation?.name !== null && temporaryRelation?.name !== undefined) {
      throw fail('The outer rollback left its temporary verification table behind.', 'ROLLBACK_FAILED');
    }

    const metadataAfterRollback = db.prepare(`SELECT version,source_sha256
      FROM experience_schema_version WHERE singleton=TRUE`).get();
    if (Number(metadataAfterRollback?.version) !== config.postgres.schemaVersion
        || metadataAfterRollback?.source_sha256 !== metadataSha256) {
      throw fail('Migration metadata changed during rollback verification.', 'ROLLBACK_FAILED');
    }
    for (const [tableName, before] of rowCounts) {
      const after = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`).get()?.count || 0);
      if (after !== before) throw fail(`Durable row count changed in ${tableName}.`, 'ROLLBACK_FAILED');
    }

    output({
      event: 'postgres_runtime_verified',
      at: new Date().toISOString(),
      provider: db.provider,
      schemaVersion: health.schemaVersion,
      runtimeSchemaVersion: health.runtimeSchemaVersion,
      sourceSha256: metadataSha256,
      tables: tableNames.length,
      runtimeExtensionTables: runtimeExtensionTables(config.postgres.runtimeSchemaVersion).filter((name) => !tableNames.includes(name)).length,
      runtimeContractIndexes: schemaContract.indexes,
      protectedPrivilegeTables: privilegeContract.protectedTables,
      rows: actualRows,
      sourceRows: Number(manifest.rowCount),
      nestedTransactionRolledBack: true,
      durableWrites: 0
    });
  } finally {
    db?.close();
  }
}

main().catch((error) => {
  output({
    event: 'error',
    at: new Date().toISOString(),
    code: error?.code || 'POSTGRES_RUNTIME_VERIFICATION_FAILED',
    message: error?.message || String(error)
  }, process.stderr);
  process.exitCode = 1;
});
