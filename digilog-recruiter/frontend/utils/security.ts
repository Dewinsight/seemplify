/**
 * Frontend Security Utilities
 * Provides input sanitization and validation for the frontend
 */

import DOMPurify from 'dompurify';

/**
 * Sanitize HTML content to prevent XSS attacks
 * @param html - Raw HTML string
 * @returns Sanitized HTML string
 */
export const sanitizeHTML = (html: string): string => {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li', 'span'],
    ALLOWED_ATTR: ['class', 'style']
  });
};

/**
 * Sanitize user input to prevent injection attacks
 * @param input - User input string
 * @returns Sanitized string
 */
export const sanitizeInput = (input: string): string => {
  if (typeof input !== 'string') return '';
  
  // Remove null bytes
  let sanitized = input.replace(/\0/g, '');
  
  // Only remove dangerous patterns, don't escape normal characters
  // Remove script tags and dangerous protocols
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  sanitized = sanitized.replace(/javascript:/gi, '');
  sanitized = sanitized.replace(/on\w+\s*=/gi, '');
  
  // Remove HTML tags but keep the content
  sanitized = sanitized.replace(/<[^>]*>/g, '');
  
  return sanitized;
};

/**
 * More aggressive sanitization for API requests
 * @param input - User input string
 * @returns Sanitized string with HTML entities escaped
 */
export const sanitizeForAPI = (input: string): string => {
  if (typeof input !== 'string') return '';
  
  // Remove null bytes
  let sanitized = input.replace(/\0/g, '');
  
  // Escape HTML entities for API safety
  sanitized = sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
  
  // Remove potential script injections
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  sanitized = sanitized.replace(/javascript:/gi, '');
  sanitized = sanitized.replace(/on\w+\s*=/gi, '');
  
  return sanitized.trim();
};

/**
 * Sanitize object for API requests (prevent NoSQL injection)
 * @param obj - Object to sanitize
 * @returns Sanitized object
 */
export const sanitizeObject = (obj: any): any => {
  if (!obj || typeof obj !== 'object') return obj;
  
  // Only block the most dangerous MongoDB operators and prototype pollution keys
  const dangerousKeys = [
    '$where',      // Can execute JavaScript
    '$expr',       // Can execute expressions  
    '$jsonSchema', // Can be complex
    '$text',       // Full text search
    '$search',     // Atlas search
    '$meta',       // Metadata access
    '$function',   // Function execution
    '__proto__', 'constructor', 'prototype' // Prototype pollution
  ];
  
  const clean = (item: any): any => {
    if (Array.isArray(item)) {
      return item.map(clean);
    }
    
    if (item && typeof item === 'object') {
      const cleaned: any = {};
      
      for (const [key, value] of Object.entries(item)) {
        // Skip dangerous keys
        if (dangerousKeys.some(dangerous => key.includes(dangerous))) {
          console.warn(`Potential injection attempt blocked: ${key}`);
          continue;
        }
        
        // Recursively clean nested objects
        if (typeof value === 'string') {
          cleaned[key] = sanitizeForAPI(value);
        } else {
          cleaned[key] = clean(value);
        }
      }
      
      return cleaned;
    }
    
    return item;
  };
  
  return clean(obj);
};

/**
 * Validate email format
 * @param email - Email string to validate
 * @returns Boolean indicating if email is valid
 */
export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate password strength
 * @param password - Password to validate
 * @returns Object with validation result and message
 */
export const validatePassword = (password: string): { valid: boolean; message?: string } => {
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long' };
  }
  
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter' };
  }
  
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter' };
  }
  
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number' };
  }
  
  return { valid: true };
};

/**
 * Sanitize URL to prevent redirect attacks
 * @param url - URL to sanitize
 * @returns Sanitized URL or null if invalid
 */
export const sanitizeURL = (url: string): string | null => {
  try {
    const parsed = new URL(url, window.location.origin);
    
    // Only allow HTTP(S) protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    
    // Check for localhost/internal IPs (prevent SSRF)
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.endsWith('.local')
    ) {
      return null;
    }
    
    return parsed.toString();
  } catch {
    return null;
  }
};

/**
 * Create a secure API request wrapper
 * @param url - API endpoint
 * @param options - Fetch options
 * @returns Fetch response
 */
export const secureFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  // Sanitize the body if it exists
  if (options.body && typeof options.body === 'string') {
    try {
      const parsed = JSON.parse(options.body);
      const sanitized = sanitizeObject(parsed);
      options.body = JSON.stringify(sanitized);
    } catch {
      // If not JSON, sanitize as string
      options.body = sanitizeInput(options.body);
    }
  }
  
  // Add security headers
  options.headers = {
    ...options.headers,
    'X-Requested-With': 'XMLHttpRequest',
    'X-Content-Type-Options': 'nosniff'
  };
  
  return fetch(url, options);
};

/**
 * Prevent clickjacking by checking if app is in iframe
 */
export const preventClickjacking = (): void => {
  if (window.self !== window.top) {
    console.warn('Application loaded in iframe - potential clickjacking attempt');
    // Optionally break out of iframe
    // window.top!.location = window.self.location;
  }
};

/**
 * Rate limiter for frontend actions
 */
export class RateLimiter {
  private attempts: Map<string, number[]> = new Map();
  
  constructor(
    private maxAttempts: number = 5,
    private windowMs: number = 60000 // 1 minute
  ) {}
  
  check(action: string): boolean {
    const now = Date.now();
    const attempts = this.attempts.get(action) || [];
    
    // Remove old attempts
    const validAttempts = attempts.filter(time => now - time < this.windowMs);
    
    if (validAttempts.length >= this.maxAttempts) {
      return false;
    }
    
    validAttempts.push(now);
    this.attempts.set(action, validAttempts);
    return true;
  }
  
  reset(action: string): void {
    this.attempts.delete(action);
  }
}

// Export a default rate limiter instance
export const defaultRateLimiter = new RateLimiter();
