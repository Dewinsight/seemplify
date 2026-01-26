// Error handler middleware
const errorHandler = (err, req, res, next) => {
    console.error('Error:', err);

    // Mongoose validation error
    if (err.name === 'ValidationError') {
        const messages = Object.values(err.errors).map(e => e.message);
        return res.status(400).json({
            error: 'Validation Error',
            messages,
            code: 'VALIDATION_ERROR',
        });
    }

    // Mongoose duplicate key error
    if (err.code === 11000) {
        return res.status(409).json({
            error: 'Duplicate entry',
            code: 'DUPLICATE_ENTRY',
        });
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
            error: 'Invalid token',
            code: 'INVALID_TOKEN',
        });
    }

    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
            error: 'Token expired',
            code: 'TOKEN_EXPIRED',
        });
    }

    // Default error
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal Server Error';

    res.status(statusCode).json({
        error: message,
        code: err.code || 'SERVER_ERROR',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
};

module.exports = { errorHandler };
