/**
 * Global Error Handler Middleware
 * Prevents information disclosure through error messages
 */

const errorHandler = (err, req, res, next) => {
  // Log the error internally
  console.error('❌ Error occurred:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
    timestamp: new Date().toISOString()
  });

  // Default error status
  let statusCode = err.statusCode || 500;
  let message = 'An error occurred';

  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Invalid input data';
  } else if (err.name === 'UnauthorizedError') {
    statusCode = 401;
    message = 'Unauthorized access';
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid resource identifier';
  } else if (err.code === 11000) {
    // MongoDB duplicate key error
    statusCode = 409;
    message = 'Resource already exists';
  }

  // In production, don't send detailed error messages
  if (process.env.NODE_ENV === 'production') {
    // Generic error messages for production
    const productionErrors = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      409: 'Conflict',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable'
    };

    res.status(statusCode).json({
      error: productionErrors[statusCode] || 'An error occurred',
      requestId: req.requestId || 'N/A'
    });
  } else {
    // In development, provide more details (but still sanitized)
    res.status(statusCode).json({
      error: message,
      details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      requestId: req.requestId || 'N/A'
    });
  }
};

/**
 * 404 Not Found Handler
 */
const notFoundHandler = (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested resource was not found',
    path: req.path
  });
};

module.exports = {
  errorHandler,
  notFoundHandler
};
