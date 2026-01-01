const crypto = require('crypto');

/**
 * Convert MongoDB ObjectID to UUID v5
 * This ensures consistent UUID generation for the same ObjectID
 */
function mongoIdToUuid(mongoId) {
  const idString = mongoId.toString();
  
  // Create a deterministic UUID from the MongoDB ID
  // Using namespace UUID for consistent generation
  const namespace = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // Standard DNS namespace
  
  // Use SHA-1 hash to create UUID v5
  const hash = crypto.createHash('sha1');
  hash.update(namespace + idString);
  const hashHex = hash.digest('hex');
  
  // Format as UUID v5
  const uuid = [
    hashHex.slice(0, 8),
    hashHex.slice(8, 12),
    '5' + hashHex.slice(13, 16), // Version 5
    ((parseInt(hashHex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + hashHex.slice(18, 20),
    hashHex.slice(20, 32)
  ].join('-');
  
  return uuid;
}

/**
 * Store mapping between MongoDB ID and UUID
 * Returns the UUID for a given MongoDB ID
 */
const idMapping = new Map();

function getOrCreateUuid(mongoId) {
  const idString = mongoId.toString();
  
  if (!idMapping.has(idString)) {
    idMapping.set(idString, mongoIdToUuid(idString));
  }
  
  return idMapping.get(idString);
}

module.exports = {
  mongoIdToUuid,
  getOrCreateUuid,
};
