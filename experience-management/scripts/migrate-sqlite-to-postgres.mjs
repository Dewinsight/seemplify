#!/usr/bin/env node

/**
 * Lossless, restart-safe migration of the Experience Management SQLite store
 * into a dedicated PostgreSQL schema.
 *
 * The program deliberately does not import application code. It snapshots the
 * SQLite database first, derives the effective schema (including migrations
 * that only exist in a deployed database), and then performs one PostgreSQL
 * transaction under an advisory lock. Every message written to stdout is
 * JSONL so callers can safely automate and audit the cut-over.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const TOOL_VERSION = '1.0.0';
const SCHEMA_VERSION = 1;
const VERSION_TABLE = 'experience_schema_version';
const ROWID_TABLES = new Set([
  'ai_jobs',
  'knowledge_jobs',
  'knowledge_file_cleanup',
  'esign_audit_events'
]);

class MigrationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
    this.details = details;
  }
}

function json(value) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'bigint') return item.toString();
    if (Buffer.isBuffer(item)) return { $binary: item.toString('base64') };
    return item;
  });
}

function emit(event, details = {}) {
  process.stdout.write(`${json({
    event,
    at: new Date().toISOString(),
    toolVersion: TOOL_VERSION,
    ...details
  })}\n`);
}

function fail(error) {
  const normalized = error instanceof MigrationError
    ? error
    : new MigrationError('UNEXPECTED_ERROR', error?.message || String(error));
  process.stderr.write(`${json({
    event: 'error',
    at: new Date().toISOString(),
    toolVersion: TOOL_VERSION,
    code: normalized.code,
    message: normalized.message,
    ...(normalized.details === undefined ? {} : { details: normalized.details })
  })}\n`);
}

function parseArgs(argv) {
  const parsed = {};
  const booleanFlags = new Set(['help', 'json']);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new MigrationError('INVALID_ARGUMENT', `Unexpected positional argument: ${token}`);
    }
    const separator = token.indexOf('=');
    const key = token.slice(2, separator === -1 ? undefined : separator);
    if (booleanFlags.has(key)) {
      parsed[key] = separator === -1 ? true : !['0', 'false', 'no'].includes(token.slice(separator + 1).toLowerCase());
      continue;
    }
    const value = separator === -1 ? argv[++index] : token.slice(separator + 1);
    if (value === undefined || value.startsWith('--')) {
      throw new MigrationError('INVALID_ARGUMENT', `--${key} requires a value.`);
    }
    parsed[key] = value;
  }
  return parsed;
}

function usage() {
  return [
    'Usage: node scripts/migrate-sqlite-to-postgres.mjs --sqlite <file> [options]',
    '',
    'Options:',
    '  --mode migrate|dry-run|verify   Default: migrate',
    '  --backup-dir <directory>        Default: <sqlite directory>/backups',
    '  --schema <postgres schema>      Default: POSTGRES_SCHEMA or public',
    '  --pg-host <host>                Default: POSTGRES_HOST or 127.0.0.1',
    '  --pg-port <port>                Default: POSTGRES_PORT or 5432',
    '  --pg-database <database>        Default: POSTGRES_DATABASE or seemplify_experience',
    '  --pg-user <user>                Default: POSTGRES_USER or seemplify_experience_app',
    '  --pg-password-file <file>       Default: POSTGRES_PASSWORD_FILE',
    '  --pg-ssl <mode>                 disable|require|verify-full',
    '  --batch-size <rows>             Default: 250',
    '  --ddl-out <file>                Write the dry-run DDL plan to this file',
    '  --json                          Accepted for callers; output is always JSONL',
    '  --help'
  ].join('\n');
}

function resolveOptions(args, env) {
  const mode = String(args.mode || env.POSTGRES_MIGRATION_MODE || 'migrate').toLowerCase();
  if (!['migrate', 'dry-run', 'verify'].includes(mode)) {
    throw new MigrationError('INVALID_MODE', `Unsupported mode: ${mode}`);
  }
  const sqlite = path.resolve(String(args.sqlite || env.SQLITE_DATABASE_PATH || env.DATABASE_PATH || ''));
  if (!args.sqlite && !env.SQLITE_DATABASE_PATH && !env.DATABASE_PATH) {
    throw new MigrationError('SQLITE_PATH_REQUIRED', 'Pass --sqlite or set SQLITE_DATABASE_PATH/DATABASE_PATH.');
  }
  const schema = String(args.schema || env.POSTGRES_SCHEMA || 'public');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new MigrationError('INVALID_SCHEMA', 'PostgreSQL schema must be a simple identifier.');
  }
  if (schema !== 'public') {
    throw new MigrationError('UNSUPPORTED_SCHEMA', 'Experience runtime schema version 1 must be installed in the public schema.');
  }
  const port = Number(args['pg-port'] || env.POSTGRES_PORT || 5432);
  const batchSize = Number(args['batch-size'] || env.POSTGRES_MIGRATION_BATCH_SIZE || 250);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new MigrationError('INVALID_PORT', 'PostgreSQL port must be between 1 and 65535.');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) {
    throw new MigrationError('INVALID_BATCH_SIZE', 'Batch size must be between 1 and 5000.');
  }
  const backupDir = path.resolve(String(args['backup-dir'] || env.SQLITE_BACKUP_DIR || path.join(path.dirname(sqlite), 'backups')));
  return {
    mode,
    sqlite,
    backupDir,
    schema,
    batchSize,
    ddlOut: args['ddl-out'] ? path.resolve(String(args['ddl-out'])) : null,
    pg: {
      host: String(args['pg-host'] || env.POSTGRES_HOST || '127.0.0.1'),
      port,
      database: String(args['pg-database'] || env.POSTGRES_DATABASE || 'seemplify_experience'),
      user: String(args['pg-user'] || env.POSTGRES_USER || 'seemplify_experience_app'),
      passwordFile: args['pg-password-file'] || env.POSTGRES_PASSWORD_FILE || null,
      sslMode: String(args['pg-ssl'] || env.POSTGRES_SSL || 'disable').toLowerCase()
    }
  };
}

function q(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Buffer.isBuffer(value)) return JSON.stringify({ $binary: value.toString('base64') });
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function shortenName(value) {
  if (Buffer.byteLength(value, 'utf8') <= 63) return value;
  const suffix = sha256(value).slice(0, 12);
  return `${value.slice(0, 50)}_${suffix}`;
}

function splitTopLevel(value, delimiter = ',') {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (quote === ']' && character === ']') quote = null;
      else if (quote !== ']' && character === quote) {
        if (value[index + 1] === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === '`') quote = character;
    else if (character === '[') quote = ']';
    else if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === delimiter && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function balancedContent(value, openIndex) {
  let depth = 0;
  let quote = null;
  for (let index = openIndex; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (quote === ']' && character === ']') quote = null;
      else if (quote !== ']' && character === quote) {
        if (value[index + 1] === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === '`') quote = character;
    else if (character === '[') quote = ']';
    else if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return { content: value.slice(openIndex + 1, index), end: index };
    }
  }
  throw new MigrationError('SQL_PARSE_ERROR', 'Unbalanced parentheses in SQLite schema.', { sql: value });
}

function tableBody(sql) {
  const open = sql.indexOf('(');
  if (open === -1) throw new MigrationError('SQL_PARSE_ERROR', 'SQLite table has no column list.', { sql });
  return balancedContent(sql, open).content;
}

function firstIdentifier(definition) {
  const match = definition.match(/^\s*(?:"((?:[^"]|"")+)"|`([^`]+)`|\[([^\]]+)\]|([^\s]+))/);
  if (!match) return null;
  return (match[1]?.replaceAll('""', '"') || match[2] || match[3] || match[4]).replace(/,$/, '');
}

function columnDefinitions(sql) {
  const definitions = new Map();
  for (const part of splitTopLevel(tableBody(sql))) {
    if (/^(?:CONSTRAINT\b|PRIMARY\s+KEY\b|UNIQUE\b|CHECK\b|FOREIGN\s+KEY\b)/i.test(part)) continue;
    const name = firstIdentifier(part);
    if (name) definitions.set(name, part);
  }
  return definitions;
}

function extractChecks(sql) {
  const checks = [];
  let quote = null;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      if (quote === ']' && character === ']') quote = null;
      else if (quote !== ']' && character === quote) {
        if (sql[index + 1] === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === '`') { quote = character; continue; }
    if (character === '[') { quote = ']'; continue; }
    if (sql.slice(index, index + 5).toUpperCase() !== 'CHECK') continue;
    if (/[A-Za-z0-9_]/.test(sql[index - 1] || '') || /[A-Za-z0-9_]/.test(sql[index + 5] || '')) continue;
    const open = sql.indexOf('(', index + 5);
    if (open === -1) throw new MigrationError('SQL_PARSE_ERROR', 'CHECK has no expression.', { sql });
    const balanced = balancedContent(sql, open);
    checks.push(balanced.content.trim());
    index = balanced.end;
  }
  return checks;
}

function translateExpression(expression, context, schema) {
  let translated = expression;
  // SQLite's json_valid guard is used by the active-journey uniqueness index.
  // A small immutable PostgreSQL helper preserves its "invalid JSON => NULL"
  // behaviour without allowing one legacy malformed payload to abort migration.
  translated = translated.replace(
    /CASE\s+WHEN\s+json_valid\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s+THEN\s+json_extract\s*\(\s*\1\s*,\s*('(?:[^']|'')*')\s*\)\s+END/gi,
    (_match, column, jsonPath) => `${q(schema)}.${q('experience_json_extract_safe')}(${q(column)},${jsonPath})`
  );
  if (/\b(?:GLOB|REGEXP|json_valid|json_extract|json_each)\b/i.test(translated)) {
    throw new MigrationError('UNSUPPORTED_SQLITE_EXPRESSION', `Cannot safely translate ${context}.`, { expression });
  }
  return translated
    .replace(/\s+COLLATE\s+NOCASE\b/gi, '')
    .replace(/\s+COLLATE\s+BINARY\b/gi, '')
    .replace(/==/g, '=');
}

function translateDefault(value, table, column) {
  if (value === null || value === undefined) return null;
  let normalized = String(value).trim();
  if (/^\(\s*datetime\s*\(\s*'now'\s*\)\s*\)$/i.test(normalized) || /^datetime\s*\(\s*'now'\s*\)$/i.test(normalized)) {
    return 'CURRENT_TIMESTAMP';
  }
  if (/^(?:NULL|TRUE|FALSE|CURRENT_DATE|CURRENT_TIME|CURRENT_TIMESTAMP)$/i.test(normalized)) return normalized.toUpperCase();
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) return normalized;
  if (/^'(?:[^']|'')*'$/.test(normalized)) return normalized;
  if (/^"(?:[^"]|"")*"$/.test(normalized)) {
    normalized = `'${normalized.slice(1, -1).replaceAll('""', '"').replaceAll("'", "''")}'`;
    return normalized;
  }
  throw new MigrationError('UNSUPPORTED_SQLITE_DEFAULT', `Cannot safely translate default for ${table}.${column}.`, { default: value });
}

function postgresType(declaredType, nocase) {
  const type = String(declaredType || '').trim().toUpperCase();
  if (nocase) return 'CITEXT';
  if (/INT/.test(type) || /BOOL/.test(type)) return 'BIGINT';
  if (/(CHAR|CLOB|TEXT|JSON|DATE|TIME)/.test(type)) return 'TEXT';
  if (/BLOB/.test(type) || type === '') return 'BYTEA';
  if (/(REAL|FLOA|DOUB)/.test(type)) return 'DOUBLE PRECISION';
  if (/(NUMERIC|DECIMAL)/.test(type)) return 'NUMERIC';
  return 'TEXT';
}

function sqliteRows(db, sql) {
  return db.prepare(sql).all();
}

function introspect(db, schema) {
  const rawTables = sqliteRows(db, "SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  if (!rawTables.length) throw new MigrationError('EMPTY_SQLITE', 'The SQLite database has no application tables.');
  const indexSql = new Map(sqliteRows(db, "SELECT name,sql FROM sqlite_master WHERE type='index'").map((row) => [row.name, row.sql]));
  const tables = [];
  for (const raw of rawTables) {
    const sql = String(raw.sql || '');
    if (/^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(sql)) {
      throw new MigrationError('UNSUPPORTED_VIRTUAL_TABLE', `Virtual table ${raw.name} requires an explicit migration.`);
    }
    const definitions = columnDefinitions(sql);
    const columns = sqliteRows(db, `PRAGMA table_xinfo(${q(raw.name)})`).map((column) => {
      if (Number(column.hidden) !== 0) {
        throw new MigrationError('UNSUPPORTED_GENERATED_COLUMN', `Generated/hidden column ${raw.name}.${column.name} requires an explicit migration.`);
      }
      const definition = definitions.get(column.name) || '';
      const nocase = /\bCOLLATE\s+NOCASE\b/i.test(definition);
      return {
        name: column.name,
        declaredType: column.type || '',
        pgType: postgresType(column.type, nocase),
        nocase,
        notNull: Boolean(column.notnull) || column.name === 'space_id',
        default: translateDefault(column.dflt_value, raw.name, column.name),
        pkOrder: Number(column.pk) || 0
      };
    });
    if (!columns.length) throw new MigrationError('EMPTY_TABLE_SCHEMA', `Table ${raw.name} has no columns.`);
    const primaryKey = columns.filter((column) => column.pkOrder > 0).sort((a, b) => a.pkOrder - b.pkOrder).map((column) => column.name);
    const indexes = sqliteRows(db, `PRAGMA index_list(${q(raw.name)})`).map((index) => {
      const entries = sqliteRows(db, `PRAGMA index_xinfo(${q(index.name)})`).filter((entry) => Number(entry.key) === 1);
      const originalSql = indexSql.get(index.name) || null;
      let terms;
      if (entries.some((entry) => Number(entry.cid) < 0)) {
        if (!originalSql) throw new MigrationError('UNSUPPORTED_EXPRESSION_INDEX', `Cannot reconstruct index ${index.name}.`);
        const onMatch = originalSql.match(/\bON\b/i);
        const open = onMatch ? originalSql.indexOf('(', onMatch.index + onMatch[0].length) : -1;
        if (open === -1) throw new MigrationError('SQL_PARSE_ERROR', `Cannot parse index ${index.name}.`, { sql: originalSql });
        terms = splitTopLevel(balancedContent(originalSql, open).content).map((term) => translateExpression(term, `index ${index.name}`, schema));
      } else {
        terms = entries.map((entry) => `${q(entry.name)}${Number(entry.desc) ? ' DESC' : ''}`);
      }
      let predicate = null;
      if (Number(index.partial)) {
        const match = originalSql?.match(/\bWHERE\b([\s\S]+)$/i);
        if (!match) throw new MigrationError('SQL_PARSE_ERROR', `Cannot parse partial index ${index.name}.`, { sql: originalSql });
        predicate = translateExpression(match[1].trim().replace(/;$/, ''), `index ${index.name}`, schema);
      }
      return {
        sourceName: index.name,
        sourceSql: originalSql,
        name: shortenName(index.name.startsWith('sqlite_autoindex_') ? `uq_${raw.name}_${sha256(terms.join('|')).slice(0, 10)}` : index.name),
        unique: Boolean(index.unique),
        origin: index.origin,
        terms,
        predicate
      };
    }).filter((index) => index.origin !== 'pk');
    const rawFks = sqliteRows(db, `PRAGMA foreign_key_list(${q(raw.name)})`);
    const groupedFks = new Map();
    for (const fk of rawFks) {
      if (!groupedFks.has(fk.id)) groupedFks.set(fk.id, []);
      groupedFks.get(fk.id).push(fk);
    }
    const foreignKeys = [...groupedFks.entries()].map(([id, entries]) => {
      entries.sort((a, b) => Number(a.seq) - Number(b.seq));
      const referencedTable = entries[0].table;
      const referenced = rawTables.find((candidate) => candidate.name === referencedTable);
      if (!referenced) throw new MigrationError('MISSING_REFERENCED_TABLE', `${raw.name} references missing table ${referencedTable}.`);
      let to = entries.map((entry) => entry.to);
      if (to.some((value) => value === null)) {
        const targetColumns = sqliteRows(db, `PRAGMA table_xinfo(${q(referencedTable)})`)
          .filter((column) => Number(column.pk) > 0)
          .sort((a, b) => Number(a.pk) - Number(b.pk));
        if (targetColumns.length !== entries.length) {
          throw new MigrationError('AMBIGUOUS_FOREIGN_KEY', `Cannot resolve implicit target columns for ${raw.name} foreign key ${id}.`);
        }
        to = targetColumns.map((column) => column.name);
      }
      const from = entries.map((entry) => entry.from);
      const cascadeUsersToAiJobs = raw.name === 'ai_jobs' && referencedTable === 'users';
      return {
        id,
        name: shortenName(`fk_${raw.name}_${id}_${sha256(`${from.join(',')}|${referencedTable}|${to.join(',')}`).slice(0, 8)}`),
        from,
        table: referencedTable,
        to,
        onUpdate: normalizeFkAction(entries[0].on_update),
        onDelete: cascadeUsersToAiJobs ? 'CASCADE' : normalizeFkAction(entries[0].on_delete)
      };
    });
    const hasRowid = ROWID_TABLES.has(raw.name);
    if (hasRowid && /\bWITHOUT\s+ROWID\b/i.test(sql)) {
      throw new MigrationError('ROWID_REQUIRED', `Queue/audit table ${raw.name} is WITHOUT ROWID.`);
    }
    if (hasRowid && columns.some((column) => column.name.toLowerCase() === 'rowid')) {
      throw new MigrationError('ROWID_COLLISION', `Table ${raw.name} already declares a rowid column.`);
    }
    tables.push({
      name: raw.name,
      sourceSql: sql,
      columns,
      primaryKey,
      checks: extractChecks(sql).map((check) => translateExpression(check, `CHECK on ${raw.name}`, schema)),
      indexes,
      foreignKeys,
      hasRowid
    });
  }
  for (const required of ROWID_TABLES) {
    if (!tables.some((table) => table.name === required)) {
      throw new MigrationError('REQUIRED_TABLE_MISSING', `Required rowid table ${required} is missing from SQLite.`);
    }
  }
  return tables;
}

function normalizeFkAction(value) {
  const normalized = String(value || 'NO ACTION').toUpperCase();
  return ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'].includes(normalized) ? normalized : 'NO ACTION';
}

function normalizeDecimal(value) {
  if (typeof value === 'bigint') return value.toString();
  const raw = String(value);
  if (!/[.eE]/.test(raw)) return raw;
  const number = Number(raw);
  return Number.isFinite(number) ? number.toString() : raw;
}

function canonicalScalar(value, pgType) {
  if (value === null || value === undefined) return 'null';
  if (Buffer.isBuffer(value)) return `b:${value.toString('base64')}`;
  if (pgType === 'BIGINT') return `i:${String(value)}`;
  if (pgType === 'DOUBLE PRECISION') return `f:${Number(value).toString()}`;
  if (pgType === 'NUMERIC') return `n:${normalizeDecimal(value)}`;
  return `s:${String(value)}`;
}

function tableDigest(table, rows) {
  const keyColumns = table.primaryKey.length ? table.primaryKey : (table.hasRowid ? ['rowid'] : table.columns.map((column) => column.name));
  const allColumns = [...table.columns.map((column) => column.name), ...(table.hasRowid ? ['rowid'] : [])];
  const typeFor = (name) => name === 'rowid' ? 'BIGINT' : table.columns.find((column) => column.name === name)?.pgType || 'TEXT';
  const keyHashes = [];
  const rowHashes = [];
  for (const row of rows) {
    const key = keyColumns.map((column) => canonicalScalar(row[column], typeFor(column))).join('\u001f');
    const body = allColumns.map((column) => canonicalScalar(row[column], typeFor(column))).join('\u001f');
    keyHashes.push(sha256(key));
    rowHashes.push(sha256(body));
  }
  keyHashes.sort();
  rowHashes.sort();
  return {
    rowCount: rows.length,
    keySha256: sha256(keyHashes.join('')),
    rowSha256: sha256(rowHashes.join(''))
  };
}

function readSourceRows(db, table) {
  const columns = table.columns.map((column) => q(column.name)).join(',');
  const selection = table.hasRowid ? `${columns},rowid AS ${q('rowid')}` : columns;
  return db.prepare(`SELECT ${selection} FROM ${q(table.name)}`).all();
}

function sourceManifest(db, tables) {
  const tableManifests = {};
  let totalRows = 0;
  for (const table of tables) {
    const rows = readSourceRows(db, table);
    if (table.columns.some((column) => column.name === 'space_id')) {
      const missing = rows.filter((row) => row.space_id === null || row.space_id === undefined).length;
      if (missing) {
        throw new MigrationError('SPACE_ID_NULL', `${table.name}.space_id contains ${missing} NULL row(s); refusing to weaken tenant isolation.`, { table: table.name, rows: missing });
      }
    }
    tableManifests[table.name] = tableDigest(table, rows);
    totalRows += rows.length;
  }
  const schemaShape = tables.map((table) => ({
    name: table.name,
    sourceSql: table.sourceSql,
    columns: table.columns,
    primaryKey: table.primaryKey,
    checks: table.checks,
    indexes: table.indexes.map((index) => ({
      sourceName: index.sourceName,
      sourceSql: index.sourceSql,
      unique: index.unique,
      origin: index.origin,
      // Auto-indexes do not have sqlite_master SQL; their terms are native
      // column terms and therefore independent of the PostgreSQL schema.
      terms: index.sourceSql ? undefined : index.terms,
      predicate: index.sourceSql ? undefined : index.predicate
    })),
    foreignKeys: table.foreignKeys,
    hasRowid: table.hasRowid
  }));
  const schemaSha256 = sha256(stable(schemaShape));
  const sourceSha256 = sha256(stable({ schemaSha256, tables: tableManifests }));
  return {
    schemaVersion: SCHEMA_VERSION,
    schemaSha256,
    sourceSha256,
    tableCount: tables.length,
    rowCount: totalRows,
    foreignKeyCount: tables.reduce((sum, table) => sum + table.foreignKeys.length, 0),
    foreignKeyColumnCount: tables.reduce((sum, table) => sum + table.foreignKeys.reduce((inner, fk) => inner + fk.from.length, 0), 0),
    indexCount: tables.reduce((sum, table) => sum + table.indexes.length, 0),
    checkCount: tables.reduce((sum, table) => sum + table.checks.length, 0),
    rowidTables: [...ROWID_TABLES].sort(),
    tables: tableManifests
  };
}

function createTableSql(schema, table) {
  const definitions = table.columns.map((column) => {
    const pieces = [q(column.name), column.pgType];
    if (column.notNull || column.pkOrder > 0) pieces.push('NOT NULL');
    if (column.default !== null) pieces.push('DEFAULT', column.default);
    return pieces.join(' ');
  });
  if (table.hasRowid) definitions.push(`${q('rowid')} BIGINT GENERATED BY DEFAULT AS IDENTITY UNIQUE NOT NULL`);
  if (table.primaryKey.length) definitions.push(`PRIMARY KEY (${table.primaryKey.map(q).join(',')})`);
  table.checks.forEach((check, index) => {
    definitions.push(`CONSTRAINT ${q(shortenName(`ck_${table.name}_${index + 1}_${sha256(check).slice(0, 8)}`))} CHECK (${check})`);
  });
  return `CREATE TABLE ${q(schema)}.${q(table.name)} (\n  ${definitions.join(',\n  ')}\n)`;
}

function createIndexSql(schema, table, index) {
  const unique = index.unique ? 'UNIQUE ' : '';
  const where = index.predicate ? ` WHERE ${index.predicate}` : '';
  return `CREATE ${unique}INDEX ${q(index.name)} ON ${q(schema)}.${q(table.name)} (${index.terms.join(',')})${where}`;
}

function createFkSql(schema, table, fk) {
  return `ALTER TABLE ${q(schema)}.${q(table.name)} ADD CONSTRAINT ${q(fk.name)} FOREIGN KEY (${fk.from.map(q).join(',')}) REFERENCES ${q(schema)}.${q(fk.table)} (${fk.to.map(q).join(',')}) ON UPDATE ${fk.onUpdate} ON DELETE ${fk.onDelete} DEFERRABLE INITIALLY DEFERRED`;
}

function versionTableSql(schema) {
  return `CREATE TABLE ${q(schema)}.${q(VERSION_TABLE)} (\n` +
    `  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),\n` +
    `  version INTEGER NOT NULL,\n` +
    `  source_sha256 TEXT NOT NULL,\n` +
    `  migrated_at TEXT NOT NULL,\n` +
    `  manifest_json TEXT NOT NULL\n` +
    `)`;
}

function jsonExtractHelperSql(schema) {
  return `CREATE FUNCTION ${q(schema)}.${q('experience_json_extract_safe')}(input_text TEXT,path_text TEXT) RETURNS TEXT\n` +
    `LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $experience_function$\n` +
    `DECLARE document JSONB; extracted JSONB;\n` +
    `BEGIN\n` +
    `  document := input_text::JSONB;\n` +
    `  extracted := jsonb_path_query_first(document,path_text::JSONPATH,'{}'::JSONB,true);\n` +
    `  IF extracted IS NULL THEN RETURN NULL; END IF;\n` +
    `  IF jsonb_typeof(extracted)='string' THEN RETURN extracted #>> '{}'; END IF;\n` +
    `  RETURN extracted::TEXT;\n` +
    `EXCEPTION WHEN OTHERS THEN RETURN NULL;\n` +
    `END\n` +
    `$experience_function$`;
}

function buildPlan(schema, tables) {
  const statements = [
    'CREATE EXTENSION IF NOT EXISTS citext',
    `CREATE SCHEMA IF NOT EXISTS ${q(schema)}`,
    jsonExtractHelperSql(schema),
    ...tables.map((table) => createTableSql(schema, table)),
    ...tables.flatMap((table) => table.indexes.map((index) => createIndexSql(schema, table, index))),
    ...tables.flatMap((table) => table.foreignKeys.map((fk) => createFkSql(schema, table, fk))),
    versionTableSql(schema)
  ];
  return { statements, sha256: sha256(statements.join(';\n')) };
}

async function createSnapshot(sourcePath, backupDir) {
  if (!fs.existsSync(sourcePath)) throw new MigrationError('SQLITE_NOT_FOUND', `SQLite database does not exist: ${sourcePath}`);
  const sourceStats = fs.statSync(sourcePath);
  if (!sourceStats.isFile()) throw new MigrationError('SQLITE_NOT_FILE', `SQLite path is not a file: ${sourcePath}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const destination = path.join(backupDir, `${path.basename(sourcePath, path.extname(sourcePath))}.${stamp}.${crypto.randomBytes(4).toString('hex')}.sqlite`);
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(destination);
  } finally {
    source.close();
  }
  // Windows does not permit FlushFileBuffers through a read-only handle.
  const handle = fs.openSync(destination, 'r+');
  try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
  emit('sqlite_backup_created', {
    source: path.basename(sourcePath),
    backupPath: destination,
    bytes: fs.statSync(destination).size
  });
  return destination;
}

function openAndValidateSnapshot(snapshotPath) {
  const db = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  db.defaultSafeIntegers(true);
  db.pragma('query_only = ON');
  const integrityRows = db.pragma('integrity_check');
  const integrity = integrityRows.map((row) => Object.values(row)[0]);
  if (integrity.length !== 1 || integrity[0] !== 'ok') {
    db.close();
    throw new MigrationError('SQLITE_INTEGRITY_FAILED', 'SQLite integrity_check failed.', { errors: integrity.slice(0, 50) });
  }
  const fkViolations = db.pragma('foreign_key_check');
  if (fkViolations.length) {
    db.close();
    throw new MigrationError('SQLITE_FOREIGN_KEY_FAILED', 'SQLite foreign_key_check found violations.', { count: fkViolations.length, sample: fkViolations.slice(0, 50) });
  }
  emit('sqlite_validated', { integrity: 'ok', foreignKeyViolations: 0 });
  return db;
}

function sslConfig(mode) {
  if (['disable', 'false', '0', 'off'].includes(mode)) return false;
  if (['require', 'true', '1', 'on'].includes(mode)) return { rejectUnauthorized: false };
  if (['verify-full', 'verify-ca'].includes(mode)) return { rejectUnauthorized: true };
  throw new MigrationError('INVALID_SSL_MODE', `Unsupported POSTGRES_SSL mode: ${mode}`);
}

async function connectPostgres(options) {
  let pg;
  try {
    pg = await import('pg');
  } catch (error) {
    throw new MigrationError('PG_MODULE_MISSING', 'The pg package is required. Install workspace dependencies before running the migration.', { cause: error.message });
  }
  let password;
  if (options.pg.passwordFile) {
    const passwordFile = path.resolve(String(options.pg.passwordFile));
    try {
      password = fs.readFileSync(passwordFile, 'utf8').replace(/[\r\n]+$/, '');
    } catch (error) {
      throw new MigrationError('PASSWORD_FILE_FAILED', `Cannot read POSTGRES_PASSWORD_FILE: ${passwordFile}`, { cause: error.message });
    }
    if (!password) throw new MigrationError('PASSWORD_FILE_EMPTY', 'POSTGRES_PASSWORD_FILE is empty.');
  } else if (process.env.PGPASSWORD) {
    password = process.env.PGPASSWORD;
  } else {
    throw new MigrationError('POSTGRES_PASSWORD_REQUIRED', 'Set POSTGRES_PASSWORD_FILE (preferred) or PGPASSWORD. Passwords are never accepted as CLI arguments.');
  }
  const Client = pg.Client || pg.default?.Client;
  const client = new Client({
    host: options.pg.host,
    port: options.pg.port,
    database: options.pg.database,
    user: options.pg.user,
    password,
    ssl: sslConfig(options.pg.sslMode),
    application_name: 'seemplify-experience-sqlite-migration',
    connectionTimeoutMillis: 10_000,
    keepAlive: true
  });
  await client.connect();
  const identity = await client.query('SELECT current_database() database,current_user username,pg_is_in_recovery() recovery');
  if (identity.rows[0].recovery) {
    await client.end();
    throw new MigrationError('POSTGRES_READ_ONLY', 'Connected PostgreSQL server is a recovery replica.');
  }
  emit('postgres_connected', {
    host: options.pg.host,
    port: options.pg.port,
    database: identity.rows[0].database,
    user: identity.rows[0].username,
    ssl: options.pg.sslMode
  });
  return client;
}

async function targetObjects(client, schema) {
  const result = await client.query(`SELECT c.relname name,c.relkind::text kind
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relkind IN ('r','p','v','m','S','f')
    UNION ALL
    SELECT p.proname name,'function' kind FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1
    ORDER BY name`, [schema]);
  return result.rows;
}

async function targetMetadata(client, schema) {
  const exists = await client.query('SELECT to_regclass($1) name', [`${schema}.${VERSION_TABLE}`]);
  if (!exists.rows[0].name) return null;
  const rows = await client.query(`SELECT singleton,version,source_sha256,migrated_at,manifest_json FROM ${q(schema)}.${q(VERSION_TABLE)}`);
  if (rows.rowCount !== 1 || rows.rows[0].singleton !== true) {
    throw new MigrationError('TARGET_METADATA_INVALID', `${schema}.${VERSION_TABLE} must contain exactly one singleton row.`);
  }
  let manifest;
  try { manifest = JSON.parse(rows.rows[0].manifest_json); }
  catch { throw new MigrationError('TARGET_METADATA_INVALID', 'PostgreSQL migration manifest_json is invalid JSON.'); }
  return { ...rows.rows[0], manifest };
}

async function insertTable(client, db, schema, table, batchSize) {
  const rows = readSourceRows(db, table);
  const columnNames = [...table.columns.map((column) => column.name), ...(table.hasRowid ? ['rowid'] : [])];
  const maximumByParameters = Math.max(1, Math.floor(60_000 / Math.max(1, columnNames.length)));
  const effectiveBatch = Math.min(batchSize, maximumByParameters);
  for (let offset = 0; offset < rows.length; offset += effectiveBatch) {
    const batch = rows.slice(offset, offset + effectiveBatch);
    const values = [];
    const tuples = batch.map((row) => {
      const placeholders = columnNames.map((column) => {
        values.push(row[column]);
        return `$${values.length}`;
      });
      return `(${placeholders.join(',')})`;
    });
    await client.query(`INSERT INTO ${q(schema)}.${q(table.name)} (${columnNames.map(q).join(',')}) VALUES ${tuples.join(',')}`, values);
  }
  emit('table_copied', { table: table.name, rows: rows.length });
}

async function advanceIdentity(client, schema, table) {
  if (!table.hasRowid) return;
  await client.query(`SELECT setval(
    pg_get_serial_sequence($1,'rowid'),
    COALESCE((SELECT MAX(${q('rowid')}) FROM ${q(schema)}.${q(table.name)}),1),
    EXISTS(SELECT 1 FROM ${q(schema)}.${q(table.name)})
  )`, [`${schema}.${table.name}`]);
}

async function readTargetRows(client, schema, table) {
  const columns = [...table.columns.map((column) => column.name), ...(table.hasRowid ? ['rowid'] : [])];
  const result = await client.query(`SELECT ${columns.map(q).join(',')} FROM ${q(schema)}.${q(table.name)}`);
  return result.rows;
}

async function verifyTarget(client, schema, tables, source) {
  const metadata = await targetMetadata(client, schema);
  if (!metadata) throw new MigrationError('TARGET_METADATA_MISSING', `${schema}.${VERSION_TABLE} does not exist.`);
  if (Number(metadata.version) !== SCHEMA_VERSION) {
    throw new MigrationError('TARGET_VERSION_MISMATCH', `Expected schema version ${SCHEMA_VERSION}, found ${metadata.version}.`);
  }
  if (metadata.source_sha256 !== source.sourceSha256) {
    throw new MigrationError('TARGET_SOURCE_MISMATCH', 'PostgreSQL was migrated from a different SQLite snapshot.', {
      expected: source.sourceSha256,
      actual: metadata.source_sha256
    });
  }
  const verifiedTables = {};
  for (const table of tables) {
    const digest = tableDigest(table, await readTargetRows(client, schema, table));
    const expected = source.tables[table.name];
    if (digest.rowCount !== expected.rowCount || digest.keySha256 !== expected.keySha256 || digest.rowSha256 !== expected.rowSha256) {
      throw new MigrationError('TARGET_DATA_MISMATCH', `Verification failed for ${table.name}.`, { table: table.name, expected, actual: digest });
    }
    verifiedTables[table.name] = digest;
  }
  const fkResult = await client.query(`SELECT COUNT(*)::integer count FROM pg_constraint c
    JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE n.nspname=$1 AND c.contype='f'`, [schema]);
  if (fkResult.rows[0].count !== source.foreignKeyCount) {
    throw new MigrationError('TARGET_CONSTRAINT_MISMATCH', 'PostgreSQL foreign-key count differs from the migration plan.', {
      expected: source.foreignKeyCount,
      actual: fkResult.rows[0].count
    });
  }
  const nullableSpace = await client.query(`SELECT table_name FROM information_schema.columns
    WHERE table_schema=$1 AND column_name='space_id' AND is_nullable<>'NO' ORDER BY table_name`, [schema]);
  if (nullableSpace.rowCount) {
      throw new MigrationError('TARGET_SPACE_ID_NULLABLE', 'PostgreSQL contains nullable space_id columns.', { tables: nullableSpace.rows.map((row) => row.table_name) });
  }
  const expectedIndexes = tables.flatMap((table) => table.indexes.map((index) => index.name)).sort();
  const actualIndexes = new Set((await client.query(
    'SELECT indexname FROM pg_indexes WHERE schemaname=$1', [schema]
  )).rows.map((row) => row.indexname));
  const missingIndexes = expectedIndexes.filter((name) => !actualIndexes.has(name));
  if (missingIndexes.length) {
    throw new MigrationError('TARGET_INDEX_MISMATCH', 'PostgreSQL is missing translated SQLite indexes.', { indexes: missingIndexes });
  }
  const actualRowidTables = (await client.query(`SELECT table_name FROM information_schema.columns
    WHERE table_schema=$1 AND column_name='rowid' ORDER BY table_name`, [schema])).rows.map((row) => row.table_name);
  const expectedRowidTables = [...ROWID_TABLES].sort();
  if (stable(actualRowidTables) !== stable(expectedRowidTables)) {
    throw new MigrationError('TARGET_ROWID_MISMATCH', 'PostgreSQL explicit rowid columns do not match the queue/audit contract.', {
      expected: expectedRowidTables,
      actual: actualRowidTables
    });
  }
  const expectedCitext = tables.flatMap((table) => table.columns.filter((column) => column.nocase).map((column) => `${table.name}.${column.name}`)).sort();
  const actualCitext = (await client.query(`SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema=$1 AND udt_name='citext' ORDER BY table_name,column_name`, [schema])).rows
    .map((row) => `${row.table_name}.${row.column_name}`);
  if (stable(actualCitext) !== stable(expectedCitext)) {
    throw new MigrationError('TARGET_CITEXT_MISMATCH', 'PostgreSQL CITEXT columns do not match SQLite NOCASE columns.', {
      expected: expectedCitext,
      actual: actualCitext
    });
  }
  const aiJobsUserFks = await client.query(`SELECT c.confdeltype FROM pg_constraint c
    JOIN pg_class source ON source.oid=c.conrelid JOIN pg_namespace n ON n.oid=source.relnamespace
    JOIN pg_class target ON target.oid=c.confrelid
    WHERE n.nspname=$1 AND source.relname='ai_jobs' AND target.relname='users' AND c.contype='f'`, [schema]);
  if (!aiJobsUserFks.rowCount || aiJobsUserFks.rows.some((row) => row.confdeltype !== 'c')) {
    throw new MigrationError('TARGET_AI_JOB_CASCADE_MISMATCH', 'Every users→ai_jobs foreign key must use ON DELETE CASCADE.');
  }
  emit('postgres_verified', {
    schema,
    tables: tables.length,
    rows: source.rowCount,
    foreignKeys: source.foreignKeyCount,
    foreignKeyColumns: source.foreignKeyColumnCount,
    sourceSha256: source.sourceSha256
  });
  return verifiedTables;
}

async function migrate(client, db, options, tables, source, snapshotPath, plan) {
  const lockKey = `seemplify:experience:migration:${options.pg.database}:${options.schema}`;
  await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [lockKey]);
  emit('advisory_lock_acquired', { database: options.pg.database, schema: options.schema });
  let transaction = false;
  try {
    const metadata = await targetMetadata(client, options.schema);
    const objects = await targetObjects(client, options.schema);
    if (metadata) {
      if (Number(metadata.version) !== SCHEMA_VERSION || metadata.source_sha256 !== source.sourceSha256) {
        throw new MigrationError('NONEMPTY_TARGET_MISMATCH', 'Target contains migration metadata for a different source or schema version.', {
          targetVersion: metadata.version,
          targetSourceSha256: metadata.source_sha256,
          expectedVersion: SCHEMA_VERSION,
          expectedSourceSha256: source.sourceSha256
        });
      }
      await verifyTarget(client, options.schema, tables, source);
      emit('migration_complete', { status: 'already_migrated', backupPath: snapshotPath, sourceSha256: source.sourceSha256 });
      return;
    }
    if (objects.length) {
      throw new MigrationError('NONEMPTY_TARGET', 'Target schema is not empty and has no matching migration manifest.', { objects: objects.slice(0, 100) });
    }
    await client.query('BEGIN');
    transaction = true;
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='30min'");
    await client.query(plan.statements[0]);
    await client.query(plan.statements[1]);
    await client.query(plan.statements[2]);
    for (const table of tables) await client.query(createTableSql(options.schema, table));
    for (const table of tables) await insertTable(client, db, options.schema, table, options.batchSize);
    for (const table of tables) {
      for (const index of table.indexes) await client.query(createIndexSql(options.schema, table, index));
    }
    for (const table of tables) {
      for (const fk of table.foreignKeys) await client.query(createFkSql(options.schema, table, fk));
    }
    for (const table of tables) await advanceIdentity(client, options.schema, table);
    await client.query(versionTableSql(options.schema));
    const migratedAt = new Date().toISOString();
    const manifest = {
      ...source,
      toolVersion: TOOL_VERSION,
      migratedAt,
      ddlSha256: plan.sha256,
      sourceFile: path.basename(options.sqlite),
      snapshotFile: path.basename(snapshotPath)
    };
    await client.query(`INSERT INTO ${q(options.schema)}.${q(VERSION_TABLE)}
      (singleton,version,source_sha256,migrated_at,manifest_json) VALUES (TRUE,$1,$2,$3,$4)`,
      [SCHEMA_VERSION, source.sourceSha256, migratedAt, JSON.stringify(manifest)]);
    await verifyTarget(client, options.schema, tables, source);
    await client.query('COMMIT');
    transaction = false;
    emit('migration_complete', {
      status: 'migrated',
      backupPath: snapshotPath,
      schema: options.schema,
      tables: source.tableCount,
      rows: source.rowCount,
      sourceSha256: source.sourceSha256,
      ddlSha256: plan.sha256
    });
  } catch (error) {
    if (transaction) {
      try { await client.query('ROLLBACK'); } catch { /* original error wins */ }
    }
    throw error;
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lockKey]); } catch { /* connection close also releases it */ }
  }
}

async function verify(client, options, tables, source, snapshotPath) {
  const lockKey = `seemplify:experience:migration:${options.pg.database}:${options.schema}`;
  await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [lockKey]);
  try {
    await verifyTarget(client, options.schema, tables, source);
    emit('verification_complete', {
      status: 'verified',
      backupPath: snapshotPath,
      schema: options.schema,
      tables: source.tableCount,
      rows: source.rowCount,
      sourceSha256: source.sourceSha256
    });
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lockKey]); } catch { /* connection close also releases it */ }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const options = resolveOptions(args, process.env);
  emit('migration_started', {
    mode: options.mode,
    source: path.basename(options.sqlite),
    backupDir: options.backupDir,
    target: options.mode === 'dry-run' ? null : {
      host: options.pg.host,
      port: options.pg.port,
      database: options.pg.database,
      schema: options.schema,
      user: options.pg.user
    }
  });
  const snapshotPath = await createSnapshot(options.sqlite, options.backupDir);
  const db = openAndValidateSnapshot(snapshotPath);
  let client = null;
  try {
    const tables = introspect(db, options.schema);
    const source = sourceManifest(db, tables);
    const plan = buildPlan(options.schema, tables);
    emit('migration_plan_ready', {
      mode: options.mode,
      schemaVersion: SCHEMA_VERSION,
      tables: source.tableCount,
      rows: source.rowCount,
      foreignKeys: source.foreignKeyCount,
      foreignKeyColumns: source.foreignKeyColumnCount,
      indexes: source.indexCount,
      checks: source.checkCount,
      rowidTables: source.rowidTables,
      sourceSha256: source.sourceSha256,
      ddlSha256: plan.sha256,
      statementCount: plan.statements.length
    });
    if (options.mode === 'dry-run') {
      if (options.ddlOut) {
        fs.mkdirSync(path.dirname(options.ddlOut), { recursive: true });
        fs.writeFileSync(options.ddlOut, `${plan.statements.join(';\n\n')};\n`, { encoding: 'utf8', flag: 'wx' });
      }
      emit('dry_run_complete', {
        status: 'planned',
        backupPath: snapshotPath,
        ddlOut: options.ddlOut,
        ddlSha256: plan.sha256,
        sourceSha256: source.sourceSha256,
        statements: options.ddlOut ? undefined : plan.statements
      });
      return;
    }
    client = await connectPostgres(options);
    if (options.mode === 'verify') await verify(client, options, tables, source, snapshotPath);
    else await migrate(client, db, options, tables, source, snapshotPath, plan);
  } finally {
    if (client) await client.end().catch(() => {});
    db.close();
  }
}

main().catch((error) => {
  fail(error);
  process.exitCode = 1;
});
