import fs from 'node:fs';
import { MessageChannel, Worker, receiveMessageOnPort } from 'node:worker_threads';
import Database from 'better-sqlite3';

export type DatabaseProvider = 'sqlite' | 'postgres';

export type DatabaseRunResult = {
  changes: number;
  lastInsertRowid: number | bigint;
};

export type DatabaseHealth = {
  provider: DatabaseProvider;
  ready: boolean;
  schemaVersion?: number;
  runtimeSchemaVersion?: number;
  error?: string;
};

export interface DatabaseStatement {
  run(...parameters: unknown[]): DatabaseRunResult;
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
}

export interface DatabaseRuntime {
  readonly provider: DatabaseProvider;
  prepare(sql: string): DatabaseStatement;
  exec(sql: string): this;
  pragma(source: string): unknown;
  transaction<Callback extends (...parameters: any[]) => any>(callback: Callback): Callback;
  health(): DatabaseHealth;
  close(): void;
}

type PostgresSettings = {
  host: string;
  port: number;
  database: string;
  user: string;
  passwordFile: string;
  ssl: false | { rejectUnauthorized: boolean };
  schemaVersion: number;
  runtimeSchemaVersion: number;
  sourceSha256?: string;
};

type DatabaseSettings = {
  databaseProvider: DatabaseProvider;
  databasePath: string;
  postgres: PostgresSettings;
};

type WorkerPacket = {
  id: number;
  ok: boolean;
  result?: { rows: Record<string, unknown>[]; rowCount: number };
  error?: { name?: string; message?: string; code?: string; detail?: string; constraint?: string };
};

type BoundQuery = { text: string; values: unknown[] };

const postgresWorkerSource = String.raw`
  const { parentPort } = require('node:worker_threads');
  const { Client, types } = require('pg');
  types.setTypeParser(20, (value) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : value;
  });
  let client;
  let commandPort;
  let signal;

  function serializableError(error) {
    return {
      name: error && error.name,
      message: error && error.message ? String(error.message) : String(error),
      code: error && error.code ? String(error.code) : undefined,
      detail: error && error.detail ? String(error.detail) : undefined,
      constraint: error && error.constraint ? String(error.constraint) : undefined
    };
  }

  function reply(packet) {
    commandPort.postMessage(packet);
    Atomics.store(signal, 0, 1);
    Atomics.notify(signal, 0, 1);
  }

  parentPort.once('message', async (message) => {
    commandPort = message.port;
    signal = new Int32Array(message.signal);
    try {
      client = new Client(message.connection);
      client.on('error', () => { /* surfaced by the next command/health query */ });
      await client.connect();
      await client.query("SET application_name = 'seemplify-experience'");
      reply({ id: 0, ok: true, result: { rows: [], rowCount: 0 } });
    } catch (error) {
      reply({ id: 0, ok: false, error: serializableError(error) });
      return;
    }

    commandPort.on('message', async (command) => {
      try {
        if (command.type === 'close') {
          await client.end();
          reply({ id: command.id, ok: true, result: { rows: [], rowCount: 0 } });
          return;
        }
        const result = await client.query({ text: command.text, values: command.values });
        reply({
          id: command.id,
          ok: true,
          result: { rows: result.rows || [], rowCount: Number(result.rowCount || 0) }
        });
      } catch (error) {
        reply({ id: command.id, ok: false, error: serializableError(error) });
      }
    });
  });
`;

function plainParameterObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value)
    && !(value instanceof Date);
}

function namedValue(values: Record<string, unknown>, marker: string, name: string) {
  if (Object.prototype.hasOwnProperty.call(values, name)) return values[name];
  if (Object.prototype.hasOwnProperty.call(values, `${marker}${name}`)) return values[`${marker}${name}`];
  throw new Error(`Missing named SQL parameter: ${name}`);
}

/** Convert better-sqlite3 positional/named bindings to node-postgres bindings. */
export function bindPostgresQuery(sql: string, parameters: unknown[]): BoundQuery {
  const named = parameters.length === 1 && plainParameterObject(parameters[0]) ? parameters[0] : null;
  const values: unknown[] = [];
  const namedIndexes = new Map<string, number>();
  let positionalIndex = 0;
  let output = '';
  let state: 'normal' | 'single' | 'double' | 'line-comment' | 'block-comment' = 'normal';

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];
    if (state === 'single') {
      output += character;
      if (character === "'" && next === "'") { output += next; index += 1; }
      else if (character === "'") state = 'normal';
      continue;
    }
    if (state === 'double') {
      output += character;
      if (character === '"' && next === '"') { output += next; index += 1; }
      else if (character === '"') state = 'normal';
      continue;
    }
    if (state === 'line-comment') {
      output += character;
      if (character === '\n') state = 'normal';
      continue;
    }
    if (state === 'block-comment') {
      output += character;
      if (character === '*' && next === '/') { output += next; index += 1; state = 'normal'; }
      continue;
    }
    if (character === "'") { state = 'single'; output += character; continue; }
    if (character === '"') { state = 'double'; output += character; continue; }
    if (character === '-' && next === '-') { state = 'line-comment'; output += character + next; index += 1; continue; }
    if (character === '/' && next === '*') { state = 'block-comment'; output += character + next; index += 1; continue; }

    if (character === '?') {
      if (named) throw new Error('A SQL statement cannot mix positional placeholders with an object binding.');
      if (positionalIndex >= parameters.length) throw new Error(`Missing positional SQL parameter ${positionalIndex + 1}.`);
      values.push(parameters[positionalIndex]);
      positionalIndex += 1;
      output += `$${values.length}`;
      continue;
    }

    const isNamedMarker = character === '@' || character === ':' || character === '$';
    if (isNamedMarker && named && /[A-Za-z_]/u.test(next || '') && !(character === ':' && sql[index - 1] === ':')) {
      let end = index + 2;
      while (end < sql.length && /[A-Za-z0-9_]/u.test(sql[end])) end += 1;
      const name = sql.slice(index + 1, end);
      let bindingIndex = namedIndexes.get(name);
      if (!bindingIndex) {
        values.push(namedValue(named, character, name));
        bindingIndex = values.length;
        namedIndexes.set(name, bindingIndex);
      }
      output += `$${bindingIndex}`;
      index = end - 1;
      continue;
    }
    output += character;
  }

  if (!named && positionalIndex !== parameters.length) {
    throw new Error(`SQL received ${parameters.length} positional values but uses ${positionalIndex} placeholders.`);
  }
  return { text: output, values };
}

function jsonPath(path: string) {
  if (!path.startsWith('$.')) return '';
  return path.slice(2).split('.').map((part) => part.replace(/[^A-Za-z0-9_-]/gu, '')).filter(Boolean).join(',');
}

/** Translate the small SQLite expression surface retained by runtime queries. */
export function translatePostgresSql(sql: string): string {
  let translated = sql.trim().replace(/;+\s*$/u, '');
  translated = translated.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/giu, 'INSERT INTO');

  translated = translated.replace(
    /datetime\(COALESCE\(([^)]+)\),\s*'\+'\s*\|\|\s*([A-Za-z_][\w.]*)\s*\|\|\s*' hours'\s*\)/giu,
    "(COALESCE($1)::timestamptz + (($2)::text || ' hours')::interval)"
  );
  translated = translated.replace(/datetime\((\$\d+)\)/giu, '($1::timestamptz)');
  translated = translated.replace(
    /CAST\(julianday\(([^)]+)\)\s*-\s*julianday\(([^)]+)\)\s+AS\s+INTEGER\)/giu,
    'CAST(EXTRACT(EPOCH FROM (($1)::timestamptz - ($2)::timestamptz)) / 86400 AS INTEGER)'
  );

  translated = translated.replace(
    /CASE\s+WHEN\s+json_valid\(\s*([-A-Za-z0-9_.]+)\s*\)\s+THEN\s+json_extract\(\s*\1\s*,\s*'([^']+)'\s*\)\s+END/giu,
    (_match, expression: string, path: string) => `experience_json_extract_safe(${expression},'${path}')`
  );
  translated = translated.replace(/json_extract\(([-A-Za-z0-9_.]+),\s*'([^']+)'\)/giu,
    (_match, expression: string, path: string) => `experience_json_extract_safe(${expression},'${path}')`);
  translated = translated.replace(/json_valid\(([-A-Za-z0-9_.]+)\)/giu, '($1 IS NOT NULL)');
  translated = translated.replace(/FROM\s+json_each\(([-A-Za-z0-9_.]+),\s*'([^']+)'\)\s+([A-Za-z_][\w]*)/giu,
    (_match, expression: string, path: string, alias: string) => {
      const parts = jsonPath(path);
      const selector = parts ? `(${expression})::jsonb #> '{${parts}}'` : `(${expression})::jsonb`;
      return `FROM jsonb_array_elements_text(COALESCE(${selector},'[]'::jsonb)) AS ${alias}(value)`;
    });
  translated = translated.replace(/FROM\s+json_each\(([-A-Za-z0-9_.]+)\)/giu,
    "FROM jsonb_array_elements_text(COALESCE(($1)::jsonb,'[]'::jsonb)) AS json_each(value)");

  translated = translated.replace(/\bMAX\(([-A-Za-z0-9_.]+),\s*(\$\d+|[-A-Za-z0-9_.]+)\)/giu, 'GREATEST($1,$2)');
  translated = translated.replace(/\bMIN\(([-A-Za-z0-9_.]+),\s*(\$\d+|[-A-Za-z0-9_.]+)\)/giu, 'LEAST($1,$2)');
  translated = translated.replace(/([A-Za-z_][\w.]*)\s*=\s*(\$\d+)\s+COLLATE\s+NOCASE/giu, 'LOWER($1)=LOWER($2)');
  translated = translated.replace(/([A-Za-z_][\w.]*)\s+COLLATE\s+NOCASE/giu, 'LOWER($1)');
  translated = translated.replace(/(\$\d+)\s+IS\s+(NOT\s+)?NULL/giu, '($1::text) IS $2NULL');

  if (/^INSERT\s+INTO\b/iu.test(translated) && /\bINSERT\s+OR\s+IGNORE\b/iu.test(sql)
      && !/\bON\s+CONFLICT\b/iu.test(translated)) {
    translated += ' ON CONFLICT DO NOTHING';
  }
  return translated;
}

function workerError(packet: WorkerPacket) {
  const error = new Error(packet.error?.message || 'PostgreSQL command failed.') as Error & {
    code?: string; detail?: string; constraint?: string;
  };
  error.name = packet.error?.name || 'PostgresError';
  error.code = packet.error?.code;
  error.detail = packet.error?.detail;
  error.constraint = packet.error?.constraint;
  return error;
}

class PostgresStatement implements DatabaseStatement {
  constructor(private runtime: PostgresRuntime, private sql: string) {}

  run(...parameters: unknown[]): DatabaseRunResult {
    const result = this.runtime.execute(this.sql, parameters);
    return { changes: result.rowCount, lastInsertRowid: 0 };
  }

  get(...parameters: unknown[]) {
    if (/^\s*PRAGMA\s+foreign_key_check\s*;?\s*$/iu.test(this.sql)) return undefined;
    const rows = this.runtime.queryRows(this.sql, parameters);
    return rows[0];
  }

  all(...parameters: unknown[]) {
    if (/^\s*PRAGMA\s+foreign_key_check\s*;?\s*$/iu.test(this.sql)) return [];
    return this.runtime.queryRows(this.sql, parameters);
  }
}

class PostgresRuntime implements DatabaseRuntime {
  readonly provider = 'postgres' as const;
  private worker: Worker;
  private port: MessageChannel['port1'];
  private signal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  private sequence = 0;
  private transactionDepth = 0;
  private closed = false;
  private readonly commandTimeoutMs = 120_000;

  constructor(private settings: PostgresSettings) {
    const password = fs.readFileSync(settings.passwordFile, 'utf8').replace(/[\r\n]+$/u, '');
    if (!password) throw new Error(`PostgreSQL password file is empty: ${settings.passwordFile}`);
    if (!settings.host || !settings.database || !settings.user) throw new Error('PostgreSQL host, database, and user are required.');
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.unref();
    this.worker = new Worker(postgresWorkerSource, { eval: true });
    this.worker.unref();
    Atomics.store(this.signal, 0, 0);
    this.worker.postMessage({
      port: channel.port2,
      signal: this.signal.buffer,
      connection: {
        host: settings.host,
        port: settings.port,
        database: settings.database,
        user: settings.user,
        password,
        ssl: settings.ssl,
        connectionTimeoutMillis: 15_000,
        query_timeout: this.commandTimeoutMs
      }
    }, [channel.port2]);
    try {
      this.receive(0, 20_000);
      this.assertLeastPrivilegeAndSchema();
    } catch (error) {
      this.abortWorker();
      throw error;
    }
  }

  private abortWorker() {
    this.closed = true;
    try { this.port.close(); } catch { /* already closed */ }
    void this.worker.terminate();
  }

  private receive(expectedId: number, timeoutMs = this.commandTimeoutMs): WorkerPacket {
    const status = Atomics.wait(this.signal, 0, 0, timeoutMs);
    if (status === 'timed-out') {
      this.abortWorker();
      throw new Error(`PostgreSQL command timed out after ${timeoutMs}ms; the connection was terminated to prevent an uncertain transaction.`);
    }
    let received = receiveMessageOnPort(this.port)?.message as WorkerPacket | undefined;
    for (let attempt = 0; !received && attempt < 1_000; attempt += 1) {
      received = receiveMessageOnPort(this.port)?.message as WorkerPacket | undefined;
    }
    if (!received) throw new Error('PostgreSQL worker completed without returning a result.');
    if (received.id !== expectedId) throw new Error(`PostgreSQL worker response mismatch (${received.id} instead of ${expectedId}).`);
    if (!received.ok) throw workerError(received);
    return received;
  }

  private command(text: string, values: unknown[] = []) {
    if (this.closed) throw new Error('PostgreSQL connection is closed.');
    const id = ++this.sequence;
    Atomics.store(this.signal, 0, 0);
    this.port.postMessage({ id, type: 'query', text, values });
    return this.receive(id).result || { rows: [], rowCount: 0 };
  }

  private assertLeastPrivilegeAndSchema() {
    const role = this.command(`SELECT rolsuper,rolcreatedb,rolcreaterole
      FROM pg_catalog.pg_roles WHERE rolname=current_user`).rows[0] as any;
    if (!role || role.rolsuper || role.rolcreatedb || role.rolcreaterole) {
      throw new Error('POSTGRES_USER must be a dedicated non-superuser role without CREATEDB or CREATEROLE.');
    }
    const ownership = this.command(`SELECT
      has_schema_privilege(current_user,current_schema(),'CREATE') AS schema_create,
      pg_get_userbyid(datdba)=current_user AS database_owner
      FROM pg_catalog.pg_database WHERE datname=current_database()`).rows[0] as any;
    if (!ownership || ownership.schema_create || ownership.database_owner) {
      throw new Error('POSTGRES_USER must be a DML-only runtime role and cannot own or create database objects.');
    }
    const row = this.command(`SELECT version,source_sha256 FROM experience_schema_version WHERE singleton=TRUE`).rows[0] as any;
    if (!row) throw new Error('PostgreSQL schema manifest is missing. Run the Experience PostgreSQL migrator before startup.');
    if (Number(row.version) !== this.settings.schemaVersion) {
      throw new Error(`PostgreSQL schema version ${String(row.version)} does not match required version ${this.settings.schemaVersion}.`);
    }
    if (this.settings.sourceSha256 && row.source_sha256 !== this.settings.sourceSha256) {
      throw new Error('PostgreSQL source manifest does not match the committed cutover marker.');
    }
    const runtime = this.command('SELECT COALESCE(MAX(version),0)::integer version FROM experience_runtime_schema_version').rows[0] as any;
    if (Number(runtime?.version) !== this.settings.runtimeSchemaVersion) {
      throw new Error(`PostgreSQL runtime schema version ${String(runtime?.version ?? 0)} does not match required version ${this.settings.runtimeSchemaVersion}.`);
    }
  }

  prepare(sql: string) { return new PostgresStatement(this, sql); }

  execute(sql: string, parameters: unknown[] = []) {
    if (/^\s*PRAGMA\b/iu.test(sql)) return { rows: [], rowCount: 0 };
    const bound = bindPostgresQuery(sql, parameters);
    return this.command(translatePostgresSql(bound.text), bound.values);
  }

  queryRows(sql: string, parameters: unknown[]) {
    const tableInfo = /^\s*PRAGMA\s+table_info\(\s*([A-Za-z_][\w]*)\s*\)\s*;?\s*$/iu.exec(sql);
    if (tableInfo) {
      return this.command(`SELECT ordinal_position-1 AS cid,column_name AS name,data_type AS type,
        CASE WHEN is_nullable='NO' THEN 1 ELSE 0 END AS notnull,column_default AS dflt_value,0 AS pk
        FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position`,
      [tableInfo[1]]).rows;
    }
    if (/^\s*SELECT\s+sql\s+FROM\s+sqlite_master\b/iu.test(sql)) {
      throw new Error('sqlite_master introspection is disabled in PostgreSQL mode; schema migrations must run before startup.');
    }
    return this.execute(sql, parameters).rows;
  }

  exec(sql: string) {
    if (/^\s*PRAGMA\b/iu.test(sql)) return this;
    throw new Error('Runtime DDL and multi-statement exec are disabled in PostgreSQL mode. Run the versioned migrator instead.');
  }

  pragma(_source: string) { return undefined; }

  transaction<Callback extends (...parameters: any[]) => any>(callback: Callback): Callback {
    const runtime = this;
    return function transaction(this: unknown, ...parameters: Parameters<Callback>) {
      const level = runtime.transactionDepth;
      const savepoint = `seemplify_nested_${level}`;
      runtime.command(level === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`);
      runtime.transactionDepth += 1;
      try {
        const result = callback.apply(this, parameters);
        if (result && typeof result.then === 'function') throw new Error('Database transactions must be synchronous.');
        runtime.transactionDepth -= 1;
        runtime.command(level === 0 ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        runtime.transactionDepth = level;
        try {
          runtime.command(level === 0 ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT ${savepoint}`);
          if (level > 0) runtime.command(`RELEASE SAVEPOINT ${savepoint}`);
        } catch { /* preserve original error */ }
        throw error;
      }
    } as Callback;
  }

  health(): DatabaseHealth {
    try {
      const row = this.command('SELECT version,source_sha256 FROM experience_schema_version WHERE singleton=TRUE').rows[0] as any;
      const runtime = this.command('SELECT COALESCE(MAX(version),0)::integer version FROM experience_runtime_schema_version').rows[0] as any;
      const version = Number(row?.version);
      const runtimeVersion = Number(runtime?.version || 0);
      const sourceMatches = !this.settings.sourceSha256 || row?.source_sha256 === this.settings.sourceSha256;
      const runtimeMatches = runtimeVersion === this.settings.runtimeSchemaVersion;
      return version === this.settings.schemaVersion && sourceMatches && runtimeMatches
        ? { provider: this.provider, ready: true, schemaVersion: version, runtimeSchemaVersion: runtimeVersion }
        : { provider: this.provider, ready: false, schemaVersion: version, runtimeSchemaVersion: runtimeVersion,
          error: !sourceMatches ? 'source_manifest_mismatch'
            : !runtimeMatches ? 'runtime_schema_version_mismatch' : 'schema_version_mismatch' };
    } catch {
      return { provider: this.provider, ready: false, error: 'database_unavailable' };
    }
  }

  close() {
    if (this.closed) return;
    const id = ++this.sequence;
    Atomics.store(this.signal, 0, 0);
    this.port.postMessage({ id, type: 'close' });
    try { this.receive(id, 10_000); } finally {
      this.closed = true;
      this.port.close();
      void this.worker.terminate();
    }
  }
}

class SqliteRuntime implements DatabaseRuntime {
  readonly provider = 'sqlite' as const;
  constructor(private database: Database.Database) {}
  prepare(sql: string) { return this.database.prepare(sql) as unknown as DatabaseStatement; }
  exec(sql: string) { this.database.exec(sql); return this; }
  pragma(source: string) { return this.database.pragma(source); }
  transaction<Callback extends (...parameters: any[]) => any>(callback: Callback) {
    return this.database.transaction(callback) as unknown as Callback;
  }
  health(): DatabaseHealth {
    try { this.database.prepare('SELECT 1').get(); return { provider: this.provider, ready: true }; }
    catch { return { provider: this.provider, ready: false, error: 'database_unavailable' }; }
  }
  close() { this.database.close(); }
}

export function createDatabase(settings: DatabaseSettings): DatabaseRuntime {
  return settings.databaseProvider === 'postgres'
    ? new PostgresRuntime(settings.postgres)
    : new SqliteRuntime(new Database(settings.databasePath));
}

export function isDatabaseConstraintError(error: unknown) {
  const code = String((error as any)?.code || '');
  return code.startsWith('SQLITE_CONSTRAINT') || code.startsWith('23');
}
