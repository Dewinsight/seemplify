// ---------------------------------------------------------------------------
// Runtime 27 (journey portfolio), 28 (collaboration) and 29 (hierarchy and
// service blueprints).
//
// These three blocks were derived from the schema the committed migrations
// actually produce on the pinned PostgreSQL 16 engine, not hand-transcribed, so
// every column, key, index, default, check, composite constraint and trigger of
// all 56 new tables is pinned exactly. assertRuntimeSchemaContract runs inside
// the migration transaction (scripts/upgrade-postgres-schema.mjs), so any drift
// between a release's SQL and this contract aborts that migration rather than
// leaving a half-registered runtime behind.
//
// Named-constraint entries are deliberately restricted to composite keys: a
// single-column foreign key is already pinned exactly by RequiredForeignKeys,
// while the grouping of a composite key is the tenant-isolation guarantee that
// the per-column shape cannot express. Constraint-backing indexes are likewise
// omitted -- the primary-key and constraint contracts already own them.
// ---------------------------------------------------------------------------
