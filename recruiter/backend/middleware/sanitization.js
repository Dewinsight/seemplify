const { body, query, param, validationResult } = require('express-validator');
const validator = require('validator');

/**
 * Backend Input Validation Middleware
 * Focuses on NoSQL injection prevention and data integrity
 * XSS protection is handled by frontend
 */
const sanitizeInputs = (req, res, next) => {
  try {
    // Helper function for basic string sanitization
    const sanitizeString = (str) => {
      if (typeof str !== 'string') return str;
      
      // Basic cleanup
      let sanitized = str.trim();
      
      // Remove null bytes (can cause issues with databases)
      sanitized = sanitized.replace(/\0/g, '');
      
      return sanitized;
    };
    
    // Helper function to detect and prevent NoSQL injection patterns
    const containsNoSQLOperator = (key) => {
      // Only block the most dangerous operators that can execute code or access system
      const dangerousOperators = [
        '$where',      // Can execute JavaScript
        '$expr',       // Can execute expressions
        '$jsonSchema', // Can be complex
        '$text',       // Full text search
        '$search',     // Atlas search
        '$meta',       // Metadata access
        '$function'    // Function execution
      ];
      
      return dangerousOperators.some(op => key.includes(op));
    };
    
    // Helper function to sanitize objects recursively
    const sanitizeObject = (obj, path = '') => {
      if (!obj || typeof obj !== 'object') return obj;
      
      // Handle arrays
      if (Array.isArray(obj)) {
        return obj.map((item, index) => sanitizeObject(item, `${path}[${index}]`));
      }
      
      // Handle objects
      const sanitized = {};
      for (const [key, value] of Object.entries(obj)) {
        // Check for MongoDB operators in keys (NoSQL injection prevention)
        if (containsNoSQLOperator(key)) {
          console.warn(`🚨 Potential NoSQL injection attempt detected at ${path}.${key}`);
          continue; // Skip this key entirely
        }
        
        // Sanitize the key itself
        const sanitizedKey = sanitizeString(key);
        
        // Check for prototype pollution attempts
        if (['__proto__', 'constructor', 'prototype'].includes(sanitizedKey)) {
          console.warn(`🚨 Potential prototype pollution attempt at ${path}.${key}`);
          continue; // Skip this key
        }
        
        // Special handling for common MongoDB query patterns
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          // Check if any keys in the value object are MongoDB operators
          const hasOperator = Object.keys(value).some(k => containsNoSQLOperator(k));
          if (hasOperator) {
            console.warn(`🚨 MongoDB operator detected in value at ${path}.${key}:`, value);
            // Instead of skipping, convert to safe string representation
            sanitized[sanitizedKey] = JSON.stringify(value);
            continue;
          }
        }
        
        // Sanitize the value
        if (typeof value === 'string') {
          sanitized[sanitizedKey] = sanitizeString(value);
        } else if (typeof value === 'object' && value !== null) {
          sanitized[sanitizedKey] = sanitizeObject(value, `${path}.${sanitizedKey}`);
        } else {
          sanitized[sanitizedKey] = value;
        }
      }
      
      return sanitized;
    };
    
    // Sanitize different parts of the request
    if (req.body) {
      req.body = sanitizeObject(req.body, 'body');
    }
    
    if (req.query) {
      req.query = sanitizeObject(req.query, 'query');
    }
    
    if (req.params) {
      req.params = sanitizeObject(req.params, 'params');
    }
    
    // Sanitize cookies if present
    if (req.cookies) {
      req.cookies = sanitizeObject(req.cookies, 'cookies');
    }
    
    next();
  } catch (error) {
    console.error('❌ Input sanitization error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: 'Failed to process request'
    });
  }
};

/**
 * MongoDB ID validation middleware
 */
const validateMongoId = (paramName) => {
  return param(paramName)
    .isMongoId()
    .withMessage(`Invalid ${paramName} format`);
};

/**
 * Email validation middleware
 */
const validateEmail = (fieldName = 'email') => {
  return body(fieldName)
    .isEmail()
    .normalizeEmail()
    .withMessage('Invalid email address');
};

/**
 * Password validation middleware
 */
const validatePassword = (fieldName = 'password') => {
  return body(fieldName)
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number');
};

/**
 * Pagination validation middleware
 */
const validatePagination = () => {
  return [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .toInt()
      .withMessage('Page must be a positive integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .toInt()
      .withMessage('Limit must be between 1 and 100')
  ];
};

/**
 * File upload validation
 */
const validateFileUpload = (fieldName, allowedTypes = ['pdf', 'doc', 'docx']) => {
  return (req, res, next) => {
    if (!req.files || !req.files[fieldName]) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const file = req.files[fieldName];
    const fileExtension = file.name.split('.').pop().toLowerCase();
    
    if (!allowedTypes.includes(fileExtension)) {
      return res.status(400).json({ 
        error: `Invalid file type. Allowed types: ${allowedTypes.join(', ')}`
      });
    }
    
    // Check file size (10MB limit)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return res.status(400).json({ 
        error: 'File size exceeds 10MB limit'
      });
    }
    
    next();
  };
};

/**
 * Check validation results middleware
 */
const checkValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

/**
 * Custom validators
 */
const customValidators = {
  isPhoneNumber: (value) => {
    // Basic phone number validation
    const phoneRegex = /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{4,6}$/;
    return phoneRegex.test(value);
  },
  
  isAlphaWithSpaces: (value) => {
    // Allow only letters and spaces
    const alphaSpaceRegex = /^[a-zA-Z\s]+$/;
    return alphaSpaceRegex.test(value);
  },
  
  isValidUrl: (value) => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  },
  
  isValidDate: (value) => {
    const date = new Date(value);
    return date instanceof Date && !isNaN(date);
  }
};

/**
 * Common field validators
 */
const validators = {
  name: body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters')
    .custom(customValidators.isAlphaWithSpaces)
    .withMessage('Name can only contain letters and spaces'),
    
  phone: body('phone')
    .optional()
    .custom(customValidators.isPhoneNumber)
    .withMessage('Invalid phone number format'),
    
  url: body('url')
    .optional()
    .custom(customValidators.isValidUrl)
    .withMessage('Invalid URL format'),
    
  date: body('date')
    .custom(customValidators.isValidDate)
    .withMessage('Invalid date format')
};

module.exports = {
  sanitizeInputs,
  validateMongoId,
  validateEmail,
  validatePassword,
  validatePagination,
  validateFileUpload,
  checkValidation,
  customValidators,
  validators
};
