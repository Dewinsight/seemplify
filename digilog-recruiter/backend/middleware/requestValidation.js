/**
 * Request Validation Middleware
 * Prevents HTTP Request Smuggling / Client-side Desync attacks
 */

const requestValidation = (req, res, next) => {
  try {
    // 1. Reject requests with both Content-Length and Transfer-Encoding headers
    if (req.headers['content-length'] && req.headers['transfer-encoding']) {
      console.error('🚨 Potential desync attack detected: Both Content-Length and Transfer-Encoding present');
      return res.status(400).json({ 
        error: 'Bad Request',
        message: 'Invalid request headers - conflicting content encoding'
      });
    }
    
    // 2. Validate Content-Length if present
    if (req.headers['content-length']) {
      const contentLength = parseInt(req.headers['content-length'], 10);
      
      if (isNaN(contentLength) || contentLength < 0) {
        console.error('🚨 Invalid Content-Length header:', req.headers['content-length']);
        return res.status(400).json({ 
          error: 'Bad Request',
          message: 'Invalid Content-Length header'
        });
      }
      
      // Enforce maximum request size (10MB)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (contentLength > maxSize) {
        console.error('🚨 Request too large:', contentLength);
        return res.status(413).json({ 
          error: 'Payload Too Large',
          message: `Request body exceeds maximum size of ${maxSize} bytes`
        });
      }
    }
    
    // 3. Validate Transfer-Encoding if present
    if (req.headers['transfer-encoding']) {
      const transferEncoding = req.headers['transfer-encoding'].toLowerCase();
      
      // Only allow chunked encoding
      if (transferEncoding !== 'chunked' && !transferEncoding.includes('chunked')) {
        console.error('🚨 Invalid Transfer-Encoding:', req.headers['transfer-encoding']);
        return res.status(400).json({ 
          error: 'Bad Request',
          message: 'Invalid Transfer-Encoding header'
        });
      }
      
      // Reject multiple Transfer-Encoding values
      if (transferEncoding.includes(',') || transferEncoding.split(' ').length > 1) {
        console.error('🚨 Multiple Transfer-Encoding values detected');
        return res.status(400).json({ 
          error: 'Bad Request',
          message: 'Multiple Transfer-Encoding values not allowed'
        });
      }
    }
    
    // 4. Validate HTTP method
    const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'];
    if (!allowedMethods.includes(req.method)) {
      console.error('🚨 Invalid HTTP method:', req.method);
      return res.status(405).json({ 
        error: 'Method Not Allowed',
        message: `HTTP method ${req.method} is not allowed`
      });
    }
    
    // 5. Validate HTTP version (optional but recommended)
    const httpVersion = req.httpVersion;
    if (httpVersion && !['1.0', '1.1', '2.0'].includes(httpVersion)) {
      console.error('🚨 Unsupported HTTP version:', httpVersion);
      return res.status(505).json({ 
        error: 'HTTP Version Not Supported',
        message: `HTTP version ${httpVersion} is not supported`
      });
    }
    
    // 6. Normalize and validate request path
    if (req.path) {
      // Check for path traversal attempts
      if (req.path.includes('..') || req.path.includes('//')) {
        console.error('🚨 Potential path traversal attempt:', req.path);
        return res.status(400).json({ 
          error: 'Bad Request',
          message: 'Invalid request path'
        });
      }
      
      // Check for null bytes
      if (req.path.includes('\0')) {
        console.error('🚨 Null byte in request path');
        return res.status(400).json({ 
          error: 'Bad Request',
          message: 'Invalid characters in request path'
        });
      }
    }
    
    // 7. Validate Host header
    if (req.headers.host) {
      // Basic host validation - adjust regex based on your domain requirements
      const hostRegex = /^[a-zA-Z0-9.-]+(?::\d{1,5})?$/;
      if (!hostRegex.test(req.headers.host)) {
        console.error('🚨 Invalid Host header:', req.headers.host);
        return res.status(400).json({ 
          error: 'Bad Request',
          message: 'Invalid Host header'
        });
      }
    }
    
    // 8. Add request ID for tracking
    req.requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // 9. Log suspicious patterns (but allow the request)
    if (req.headers['x-forwarded-for'] && req.headers['x-forwarded-for'].split(',').length > 5) {
      console.warn('⚠️ Suspicious X-Forwarded-For header with many proxies:', req.headers['x-forwarded-for']);
    }
    
    next();
  } catch (error) {
    console.error('❌ Request validation error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: 'Request validation failed'
    });
  }
};

// Export additional utilities for specific routes
const validateStreamingRequest = (req, res, next) => {
  // Additional validation for SSE/streaming endpoints
  if (req.headers['accept'] && req.headers['accept'].includes('text/event-stream')) {
    // Ensure no body for SSE requests
    if (req.headers['content-length'] && req.headers['content-length'] !== '0') {
      return res.status(400).json({ 
        error: 'Bad Request',
        message: 'SSE requests should not have a body'
      });
    }
  }
  next();
};

module.exports = {
  requestValidation,
  validateStreamingRequest
};
