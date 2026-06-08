const { evaluate, parse } = require('mathjs');

/**
 * Safely evaluates a formula with field references
 * @param {string} formula - Formula string with {{fieldId}} placeholders
 * @param {Object} fieldValues - Object mapping fieldId to numeric values
 * @returns {number|null} - Calculated result or null on error
 * 
 * @example
 * evaluateFormula('({{technical}} + {{problemSolving}}) / 2', { technical: 4, problemSolving: 5 })
 * // Returns: 4.5
 */
function evaluateFormula(formula, fieldValues) {
  try {
    if (!formula || typeof formula !== 'string') {
      console.error('Invalid formula: must be a non-empty string');
      return null;
    }

    if (!fieldValues || typeof fieldValues !== 'object') {
      console.error('Invalid fieldValues: must be an object');
      return null;
    }

    // Replace {{fieldId}} with actual values
    let resolvedFormula = formula;
    const fieldPattern = /\{\{(\w+)\}\}/g;
    let match;
    const missingFields = [];

    // First pass: check for missing fields
    while ((match = fieldPattern.exec(formula)) !== null) {
      const fieldId = match[1];
      if (fieldValues[fieldId] === undefined || fieldValues[fieldId] === null) {
        missingFields.push(fieldId);
      }
    }

    if (missingFields.length > 0) {
      console.warn(`Missing field values for: ${missingFields.join(', ')}`);
      // Use 0 as default for missing fields
    }

    // Reset regex
    resolvedFormula = formula.replace(/\{\{(\w+)\}\}/g, (match, fieldId) => {
      const value = fieldValues[fieldId];
      return (value !== undefined && value !== null) ? value : 0;
    });

    // Evaluate using mathjs (safe evaluation)
    const result = evaluate(resolvedFormula);

    // Ensure result is a number
    if (typeof result !== 'number' || !isFinite(result)) {
      console.error('Formula evaluation did not produce a valid number');
      return null;
    }

    // Round to 2 decimal places
    return Math.round(result * 100) / 100;

  } catch (error) {
    console.error('Formula evaluation error:', error.message);
    return null;
  }
}

/**
 * Validates formula syntax before saving
 * @param {string} formula - Formula string to validate
 * @returns {Object} - { isValid: boolean, errors: string[] }
 */
function validateFormula(formula) {
  const errors = [];

  try {
    if (!formula || typeof formula !== 'string') {
      errors.push('Formula must be a non-empty string');
      return { isValid: false, errors };
    }

    // Check for valid field references
    const fieldPattern = /\{\{(\w+)\}\}/g;
    const matches = formula.match(fieldPattern);
    
    if (!matches || matches.length === 0) {
      errors.push('Formula must contain at least one field reference in {{fieldId}} format');
      return { isValid: false, errors };
    }

    // Replace field references with dummy values for syntax validation
    const testFormula = formula.replace(/\{\{(\w+)\}\}/g, '1');

    // Try to parse the formula
    try {
      parse(testFormula);
    } catch (parseError) {
      errors.push(`Invalid formula syntax: ${parseError.message}`);
      return { isValid: false, errors };
    }

    // Try to evaluate with dummy values
    try {
      const testResult = evaluate(testFormula);
      if (typeof testResult !== 'number' || !isFinite(testResult)) {
        errors.push('Formula must produce a numeric result');
        return { isValid: false, errors };
      }
    } catch (evalError) {
      errors.push(`Formula evaluation error: ${evalError.message}`);
      return { isValid: false, errors };
    }

    // Check for potentially dangerous operations (though mathjs is already safe)
    const dangerousPatterns = [
      /import\s/i,
      /require\s*\(/i,
      /eval\s*\(/i,
      /Function\s*\(/i,
      /setTimeout|setInterval/i
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(formula)) {
        errors.push('Formula contains potentially unsafe operations');
        return { isValid: false, errors };
      }
    }

    return { isValid: true, errors: [] };

  } catch (error) {
    errors.push(`Validation error: ${error.message}`);
    return { isValid: false, errors };
  }
}

/**
 * Helper function to extract field IDs from a formula
 * @param {string} formula - Formula string
 * @returns {string[]} - Array of field IDs
 */
function extractFieldIds(formula) {
  const fieldPattern = /\{\{(\w+)\}\}/g;
  const fieldIds = [];
  let match;

  while ((match = fieldPattern.exec(formula)) !== null) {
    if (!fieldIds.includes(match[1])) {
      fieldIds.push(match[1]);
    }
  }

  return fieldIds;
}

module.exports = {
  evaluateFormula,
  validateFormula,
  extractFieldIds
};

