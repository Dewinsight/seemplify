/**
 * Query Builder Utility
 * Provides safe query building methods that sanitize user input
 * while allowing legitimate MongoDB operators in controlled contexts
 */

const validator = require('validator');

class QueryBuilder {
  /**
   * Build a safe text search query
   * @param {string} searchTerm - User provided search term
   * @param {string[]} fields - Fields to search in
   * @returns {object} MongoDB query object
   */
  static buildTextSearch(searchTerm, fields) {
    if (!searchTerm || !fields || fields.length === 0) {
      return {};
    }

    // Sanitize the search term
    const sanitized = this.sanitizeSearchTerm(searchTerm);
    
    // Build $or query with regex
    return {
      $or: fields.map(field => ({
        [field]: new RegExp(sanitized, 'i')
      }))
    };
  }

  /**
   * Sanitize search term for use in regex
   * @param {string} term - Search term to sanitize
   * @returns {string} Sanitized search term
   */
  static sanitizeSearchTerm(term) {
    if (typeof term !== 'string') return '';
    
    // Escape special regex characters
    return term
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
      .replace(/\0/g, ''); // Remove null bytes
  }

  /**
   * Build a safe filter query from user input
   * @param {object} userFilters - User provided filters
   * @param {object} allowedFields - Map of allowed fields and their types
   * @returns {object} Safe MongoDB query object
   */
  static buildSafeFilter(userFilters, allowedFields) {
    const safeFilter = {};

    for (const [key, type] of Object.entries(allowedFields)) {
      if (userFilters[key] === undefined || userFilters[key] === null) {
        continue;
      }

      const value = userFilters[key];

      switch (type) {
        case 'string':
          if (typeof value === 'string' && value.trim()) {
            safeFilter[key] = validator.escape(value.trim());
          }
          break;

        case 'stringRegex':
          if (typeof value === 'string' && value.trim()) {
            safeFilter[key] = new RegExp(this.sanitizeSearchTerm(value), 'i');
          }
          break;

        case 'number':
          const num = Number(value);
          if (!isNaN(num)) {
            safeFilter[key] = num;
          }
          break;

        case 'boolean':
          safeFilter[key] = Boolean(value);
          break;

        case 'objectId':
          if (this.isValidObjectId(value)) {
            safeFilter[key] = value;
          }
          break;

        case 'date':
          const date = new Date(value);
          if (!isNaN(date.getTime())) {
            safeFilter[key] = date;
          }
          break;

        case 'enum':
          // Assumes allowedFields[key] is an object like { type: 'enum', values: ['a', 'b'] }
          if (allowedFields[key].values && allowedFields[key].values.includes(value)) {
            safeFilter[key] = value;
          }
          break;

        case 'array':
          if (Array.isArray(value)) {
            safeFilter[key] = value.map(v => 
              typeof v === 'string' ? validator.escape(v.trim()) : v
            );
          }
          break;
      }
    }

    return safeFilter;
  }

  /**
   * Check if a string is a valid MongoDB ObjectId
   * @param {string} id - String to check
   * @returns {boolean} True if valid ObjectId
   */
  static isValidObjectId(id) {
    if (typeof id !== 'string') return false;
    return /^[0-9a-fA-F]{24}$/.test(id);
  }

  /**
   * Build a safe date range query
   * @param {string} field - Field name
   * @param {Date|string} startDate - Start date
   * @param {Date|string} endDate - End date
   * @returns {object} Safe date range query
   */
  static buildDateRange(field, startDate, endDate) {
    const query = {};
    
    if (startDate) {
      const start = new Date(startDate);
      if (!isNaN(start.getTime())) {
        query[field] = query[field] || {};
        query[field].$gte = start;
      }
    }

    if (endDate) {
      const end = new Date(endDate);
      if (!isNaN(end.getTime())) {
        query[field] = query[field] || {};
        query[field].$lte = end;
      }
    }

    return query;
  }

  /**
   * Build pagination options
   * @param {object} params - Request parameters
   * @returns {object} Safe pagination options
   */
  static buildPagination(params) {
    const page = Math.max(1, parseInt(params.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(params.limit) || 20));
    const skip = (page - 1) * limit;

    return { skip, limit, page };
  }

  /**
   * Build safe sort options
   * @param {string} sortField - Field to sort by
   * @param {string} sortOrder - Sort order (asc/desc)
   * @param {string[]} allowedFields - List of allowed sort fields
   * @returns {object} Safe sort object
   */
  static buildSort(sortField, sortOrder, allowedFields) {
    if (!sortField || !allowedFields.includes(sortField)) {
      return { createdAt: -1 }; // Default sort
    }

    const order = sortOrder === 'asc' ? 1 : -1;
    return { [sortField]: order };
  }
}

module.exports = QueryBuilder;
