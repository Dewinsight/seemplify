// Shared helpers for the Atlas(Mongo) -> Postgres(Prisma) ETL.
//
// Source = the real dataset in `smart_hr_db` (override via ETL_SOURCE_DB).
// Target = the Prisma client singleton (db/client.js), which auto-generates ids
// and exposes `_id`. We always preserve the original Mongo `_id` as the PK so
// every cross-collection reference stays valid after the copy.
require('dotenv').config();
const { MongoClient } = require('mongodb');
const prisma = require('../../db/client');

const SOURCE_DB = process.env.ETL_SOURCE_DB || 'smart_hr_db';

// NUL byte (U+0000) — built via fromCharCode so it never appears literally in source.
const NUL = String.fromCharCode(0);

let _client = null;
async function getSource() {
  if (!_client) {
    _client = new MongoClient(process.env.MONGO_URI);
    await _client.connect();
  }
  return { client: _client, db: _client.db(SOURCE_DB) };
}
async function closeSource() {
  if (_client) { await _client.close(); _client = null; }
}

/** ObjectId | string | null -> 24-hex string | null */
const oid = (x) => (x == null ? null : String(x));
/** '' / undefined -> null (so sparse-unique columns don't collide on '') */
const nz = (x) => (x === '' || x === undefined ? null : x);
/** value -> Date | null */
const asDate = (x) => (x ? new Date(x) : null);

/**
 * Recursively strip NUL bytes from strings — Postgres text/JSONB cannot store
 * them, but Mongo (e.g. PDF-extracted resume text) can. Only recurses into plain
 * objects and arrays; Dates/Buffers/ObjectIds / other class instances pass through.
 */
function stripNul(v) {
  if (typeof v === 'string') {
    return v.indexOf(NUL) === -1 ? v : v.split(NUL).join('');
  }
  if (Array.isArray(v)) return v.map(stripNul);
  if (v && typeof v === 'object' && v.constructor === Object) {
    const out = {};
    for (const k of Object.keys(v)) out[k] = stripNul(v[k]);
    return out;
  }
  return v;
}

/** Run an async per-row writer with error capture into a stats bucket. */
async function safe(stats, label, fn) {
  try {
    await fn();
    stats[label] = (stats[label] || 0) + 1;
  } catch (e) {
    stats.failed = (stats.failed || 0) + 1;
    if (!stats.errors) stats.errors = [];
    if (stats.errors.length < 8) stats.errors.push(`${label}: ${e.message}`);
  }
}

module.exports = { prisma, getSource, closeSource, SOURCE_DB, oid, nz, asDate, stripNul, safe };
