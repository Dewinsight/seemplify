/**
 * Utility functions for decoding HTML entities
 * Fixes issue where & becomes &amp;, < becomes &lt;, etc.
 * Uses the 'entities' library for robust HTML entity decoding
 */

import { decodeHTML } from 'entities';

/**
 * Decode HTML entities in a string, handling multiple levels of encoding
 * @param text - Text that may contain HTML entities
 * @returns Decoded text
 */
export function decodeHtmlEntities(text: string | undefined | null): string {
  if (!text) return '';
  
  // Decode recursively until no more entities are found (handles double/triple encoding)
  let decoded = text;
  let previousDecoded = '';
  
  // Keep decoding until the output stops changing
  while (decoded !== previousDecoded) {
    previousDecoded = decoded;
    decoded = decodeHTML(decoded);
  }
  
  return decoded;
}

/**
 * Decode HTML entities in an object's string properties
 * @param obj - Object that may contain strings with HTML entities
 * @returns New object with decoded strings
 */
export function decodeObjectHtmlEntities<T extends Record<string, any>>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  
  const decoded: any = {};
  
  for (const key in obj) {
    const value = obj[key];
    
    if (typeof value === 'string') {
      decoded[key] = decodeHtmlEntities(value);
    } else if (Array.isArray(value)) {
      decoded[key] = value.map((item: any) => 
        typeof item === 'string' ? decodeHtmlEntities(item) : item
      );
    } else if (value && typeof value === 'object') {
      decoded[key] = decodeObjectHtmlEntities(value);
    } else {
      decoded[key] = value;
    }
  }
  
  return decoded as T;
}

/**
 * Sanitize and decode text before saving to prevent double-encoding
 * This should be used before submitting form data
 */
export function prepareTextForSave(text: string | undefined | null): string {
  if (!text) return '';
  
  // First decode any existing entities
  let decoded = decodeHtmlEntities(text);
  
  // Trim whitespace
  decoded = decoded.trim();
  
  return decoded;
}

/**
 * Prepare form data for submission by decoding all string fields
 * @param formData - Form data object
 * @returns Cleaned form data
 */
export function prepareFormDataForSave<T extends Record<string, any>>(formData: T): T {
  return decodeObjectHtmlEntities(formData);
}

