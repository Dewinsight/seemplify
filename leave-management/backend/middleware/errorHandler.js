// Central error handling middleware

class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

const errorHandler = (err, req, res, next) => {
  // Default error values
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let code = err.code || 'INTERNAL_ERROR';

  // Log error
  console.error('Error:', {
    message: err.message,
    code: err.code,
    stack: err.stack,
    path: req.path,
    method: req.method,
    user: req.user?.id,
  });

  // Handle specific error types
  if (err.name === 'ValidationError') {
    // Mongoose validation error
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = Object.values(err.errors)
      .map(e => e.message)
      .join(', ');
  }

  if (err.name === 'CastError') {
    // Mongoose cast error (invalid ObjectId, etc.)
    statusCode = 400;
    code = 'INVALID_ID';
    message = 'Invalid ID format';
  }

  if (err.code === 11000) {
    // MongoDB duplicate key error
    statusCode = 409;
    code = 'DUPLICATE_ERROR';
    message = 'Duplicate entry';
  }

  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    code = 'INVALID_TOKEN';
    message = 'Invalid token';
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    code = 'TOKEN_EXPIRED';
    message = 'Token has expired';
  }

  // Don't leak error details in production
  if (process.env.NODE_ENV === 'production' && !err.isOperational) {
    message = 'Something went wrong';
    code = 'INTERNAL_ERROR';
  }

  res.status(statusCode).json({
    error: message,
    code,
    ...(process.env.NODE_ENV === 'development' && {
      stack: err.stack,
      details: err.details,
    }),
  });
};

// Async handler wrapper to catch async errors
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Not found handler
const notFoundHandler = (req, res, next) => {
  const error = new AppError(`Route ${req.originalUrl} not found`, 404, 'NOT_FOUND');
  next(error);
};

module.exports = {
  AppError,
  errorHandler,
  asyncHandler,
  notFoundHandler,
};
