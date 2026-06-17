// ObjectId helpers for the Postgres/Prisma migration.
//
// IDs stay as Mongo ObjectId 24-hex strings (text PKs) so existing data and the
// frontend `_id: string` contract are preserved. `bson` is already installed
// (transitive via mongoose / the mongodb driver) so this needs no new dependency.
const { ObjectId } = require('bson');

/** Generate a new ObjectId-format 24-hex string for a new row's primary key. */
const newId = () => new ObjectId().toHexString();

/**
 * Validate that a value looks like a Mongo ObjectId (24 hex chars).
 * Drop-in replacement for `mongoose.Types.ObjectId.isValid(x)` — behaviour is
 * identical for all legacy and newly-generated ids.
 */
const isObjectIdLike = (v) => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);

/** Normalize an ObjectId | string | null to a plain id string (or null). */
const oid = (v) => (v == null ? null : String(v));

module.exports = { newId, isObjectIdLike, oid };
