#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const identifier = /^[a-z_][a-z0-9_]*$/u;
const database = String(process.env.POSTGRES_DATABASE || 'seemplify_experience').trim();
const ownerUser = String(process.env.POSTGRES_OWNER_USER || '').trim();
const appUser = String(process.env.POSTGRES_USER || '').trim();
const ownerPasswordFile = path.resolve(String(process.env.POSTGRES_OWNER_PASSWORD_FILE || ''));
const targetVersion = Number(process.env.POSTGRES_RUNTIME_SCHEMA_VERSION || 30);

for (const [label, value] of [['POSTGRES_DATABASE', database], ['POSTGRES_OWNER_USER', ownerUser], ['POSTGRES_USER', appUser]]) {
  if (!identifier.test(value)) throw new Error(`${label} must be an identifier-safe PostgreSQL name.`);
}
if (!Number.isInteger(targetVersion) || targetVersion < 1) throw new Error('POSTGRES_RUNTIME_SCHEMA_VERSION must be a positive integer.');
if (!fs.existsSync(ownerPasswordFile)) throw new Error('POSTGRES_OWNER_PASSWORD_FILE is required.');

const ownerPassword = fs.readFileSync(ownerPasswordFile, 'utf8').trim();
if (!ownerPassword) throw new Error('POSTGRES_OWNER_PASSWORD_FILE is empty.');

const connection = {
  host: String(process.env.POSTGRES_HOST || '127.0.0.1'),
  port: Number(process.env.POSTGRES_PORT || 5432),
  database,
  user: ownerUser,
  password: ownerPassword,
  ssl: ['true', 'require', 'required'].includes(String(process.env.POSTGRES_SSL || '').toLowerCase())
    ? { rejectUnauthorized: true }
    : false,
  connectionTimeoutMillis: 10_000,
  query_timeout: 120_000,
  application_name: 'seemplify-experience-dokploy-migrator'
};

async function sourceState() {
  const client = new pg.Client(connection);
  await client.connect();
  try {
    const source = (await client.query(
      'SELECT version,source_sha256 FROM experience_schema_version WHERE singleton=TRUE'
    )).rows[0];
    const current = Number((await client.query(
      'SELECT COALESCE(MAX(version),0)::integer version FROM experience_runtime_schema_version'
    )).rows[0]?.version || 0);
    return { sourceVersion: Number(source?.version), sourceSha256: String(source?.source_sha256 || ''), current };
  } finally {
    await client.end();
  }
}

async function applyRuntimePrivileges() {
  const templatePath = path.resolve('backend/migrations/postgres/runtime_privileges.sql');
  const sql = fs.readFileSync(templatePath, 'utf8')
    .replaceAll('__DATABASE__', database)
    .replaceAll('__OWNER_ROLE__', ownerUser)
    .replaceAll('__APP_ROLE__', appUser);
  const client = new pg.Client(connection);
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

const state = await sourceState();
if (!Number.isInteger(state.sourceVersion) || !/^[a-f0-9]{64}$/u.test(state.sourceSha256)) {
  throw new Error('The restored Experience source schema metadata is invalid.');
}
if (state.current > targetVersion) {
  throw new Error(`Database runtime ${state.current} is newer than application runtime ${targetVersion}.`);
}
if (state.current < targetVersion) {
  const result = spawnSync(process.execPath, [
    'scripts/upgrade-postgres-schema.mjs',
    '--expected-source-version', String(state.sourceVersion),
    '--expected-source-sha256', state.sourceSha256,
    '--target-version', String(targetVersion),
    '--pg-user', ownerUser,
    '--pg-password-file', ownerPasswordFile
  ], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw new Error(`PostgreSQL runtime migration failed with exit code ${result.status}.`);
}

await applyRuntimePrivileges();
process.stdout.write(`${JSON.stringify({ event: 'dokploy_runtime_ready', runtimeSchemaVersion: targetVersion })}\n`);
