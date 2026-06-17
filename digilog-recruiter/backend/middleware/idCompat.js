// `_id` compatibility middleware.
//
// The frontend (and large parts of the backend) expect every record to carry an
// `_id` string. Postgres/Prisma rows use `id`. This middleware wraps res.json so
// every outgoing payload gets a deep, additive `_id` mirrored from `id` —
// regardless of whether the data came from Prisma, a raw query, or a hand-built
// object. `id` is left in place (additive, harmless).
function addUnderscoreId(value, seen) {
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (seen.has(value)) return value; // guard against circular references
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) addUnderscoreId(item, seen);
    return value;
  }

  if (
    Object.prototype.hasOwnProperty.call(value, 'id') &&
    value._id === undefined &&
    (typeof value.id === 'string' || typeof value.id === 'number')
  ) {
    value._id = value.id;
  }
  for (const key of Object.keys(value)) {
    addUnderscoreId(value[key], seen);
  }
  return value;
}

module.exports = function idCompat(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (body) => originalJson(addUnderscoreId(body, new WeakSet()));
  next();
};
