const { decodeHTML } = require('entities');

/**
 * Decode HTML entities recursively (handles multiple encoding levels)
 * Fixes issues where &amp;amp;amp; appears instead of &
 */
function decodeHtmlEntities(text) {
  if (!text || typeof text !== 'string') return text;
  
  let decoded = text;
  let previousDecoded = '';
  
  // Keep decoding until output stops changing
  while (decoded !== previousDecoded) {
    previousDecoded = decoded;
    decoded = decodeHTML(decoded);
  }
  
  return decoded;
}

/**
 * Decode HTML entities in object properties recursively
 * Handles nested objects and arrays
 */
function decodeObjectHtmlEntities(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => 
      typeof item === 'string' ? decodeHtmlEntities(item) : 
      typeof item === 'object' ? decodeObjectHtmlEntities(item) : 
      item
    );
  }
  
  // Handle objects
  const decoded = {};
  
  for (const key in obj) {
    const value = obj[key];
    
    if (typeof value === 'string') {
      decoded[key] = decodeHtmlEntities(value);
    } else if (Array.isArray(value)) {
      decoded[key] = value.map(item => 
        typeof item === 'string' ? decodeHtmlEntities(item) : 
        typeof item === 'object' ? decodeObjectHtmlEntities(item) : 
        item
      );
    } else if (value && typeof value === 'object') {
      decoded[key] = decodeObjectHtmlEntities(value);
    } else {
      decoded[key] = value;
    }
  }
  
  return decoded;
}

module.exports = {
  decodeHtmlEntities,
  decodeObjectHtmlEntities
};

