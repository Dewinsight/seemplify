function matchesType(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function validateNode(value, schema, path, errors) {
  if (!schema || typeof schema !== 'object') {
    errors.push(`${path}: schema must be an object`);
    return;
  }

  if (Array.isArray(schema.anyOf)) {
    const valid = schema.anyOf.some((candidate) => validateJsonSchema(value, candidate).valid);
    if (!valid) errors.push(`${path}: does not match any allowed schema`);
    return;
  }

  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((candidate) => validateJsonSchema(value, candidate).valid).length;
    if (matches !== 1) errors.push(`${path}: must match exactly one allowed schema`);
    return;
  }

  const allowedTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (allowedTypes.length && !allowedTypes.some((type) => matchesType(value, type))) {
    errors.push(`${path}: expected ${allowedTypes.join(' or ')}`);
    return;
  }

  if (schema.const !== undefined && value !== schema.const) errors.push(`${path}: does not match the required constant`);
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) errors.push(`${path}: is not an allowed value`);

  if (typeof value === 'string') {
    if (Number.isFinite(schema.minLength) && value.length < schema.minLength) errors.push(`${path}: is shorter than minLength`);
    if (Number.isFinite(schema.maxLength) && value.length > schema.maxLength) errors.push(`${path}: is longer than maxLength`);
    if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern).test(value)) errors.push(`${path}: does not match pattern`);
      } catch {
        errors.push(`${path}: schema contains an invalid pattern`);
      }
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isFinite(schema.minimum) && value < schema.minimum) errors.push(`${path}: is below minimum`);
    if (Number.isFinite(schema.maximum) && value > schema.maximum) errors.push(`${path}: is above maximum`);
  }

  if (Array.isArray(value)) {
    if (Number.isFinite(schema.minItems) && value.length < schema.minItems) errors.push(`${path}: has too few items`);
    if (Number.isFinite(schema.maxItems) && value.length > schema.maxItems) errors.push(`${path}: has too many items`);
    if (schema.items) value.forEach((item, index) => validateNode(item, schema.items, `${path}[${index}]`, errors));
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties || {};
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}.${key}: is required`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (properties[key]) validateNode(child, properties[key], `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: is not allowed`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validateNode(child, schema.additionalProperties, `${path}.${key}`, errors);
      }
    }
  }
}

function validateJsonSchema(value, schema) {
  const errors = [];
  validateNode(value, schema, '$', errors);
  return { valid: errors.length === 0, errors };
}

module.exports = { validateJsonSchema };
