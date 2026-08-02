import { evaluate } from 'mathjs';

/**
 * Safely evaluates a formula with field references (client-side)
 * @param formula - Formula string with {{fieldId}} placeholders
 * @param fieldValues - Object mapping fieldId to numeric values
 * @returns Calculated result or null on error
 * 
 * @example
 * evaluateFormula('({{technical}} + {{problemSolving}}) / 2', { technical: 4, problemSolving: 5 })
 * // Returns: 4.5
 */
export function evaluateFormula(
  formula: string,
  fieldValues: Record<string, number>
): number | null {
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
    const missingFields: string[] = [];

    // First pass: check for missing fields
    const matches = [...formula.matchAll(fieldPattern)];
    matches.forEach((match) => {
      const fieldId = match[1];
      if (fieldValues[fieldId] === undefined || fieldValues[fieldId] === null) {
        missingFields.push(fieldId);
      }
    });

    if (missingFields.length > 0) {
      console.warn(`Missing field values for: ${missingFields.join(', ')}`);
      // Use 0 as default for missing fields
    }

    // Replace field references with values
    resolvedFormula = formula.replace(/\{\{(\w+)\}\}/g, (match, fieldId) => {
      const value = fieldValues[fieldId];
      return (value !== undefined && value !== null) ? value.toString() : '0';
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
    console.error('Formula evaluation error:', error);
    return null;
  }
}

/**
 * Extract field IDs from a formula
 * @param formula - Formula string
 * @returns Array of field IDs
 */
export function extractFieldIds(formula: string): string[] {
  const fieldPattern = /\{\{(\w+)\}\}/g;
  const fieldIds: string[] = [];
  const matches = [...formula.matchAll(fieldPattern)];
  
  matches.forEach((match) => {
    const fieldId = match[1];
    if (!fieldIds.includes(fieldId)) {
      fieldIds.push(fieldId);
    }
  });

  return fieldIds;
}

