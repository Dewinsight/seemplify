const handleNylasError = (error) => {
  // Log the full error for debugging
  console.error('Nylas API Error:', {
    message: error.message,
    status: error.response?.status,
    data: error.response?.data,
    stack: error.stack
  });
  
  if (error.response) {
    const { status, data } = error.response;
    
    switch (status) {
      case 400:
        return {
          statusCode: 400,
          error: 'INVALID_REQUEST',
          message: 'Invalid request parameters',
          details: data?.message || 'Check your request data'
        };
        
      case 401:
        return {
          statusCode: 401,
          error: 'AUTHENTICATION_FAILED',
          message: 'Authentication failed - grant may be invalid or expired',
          requiresReauth: true
        };
        
      case 403:
        return {
          statusCode: 403,
          error: 'ACCESS_DENIED',
          message: 'Access denied - insufficient permissions',
          details: data?.message
        };
        
      case 404:
        return {
          statusCode: 404,
          error: 'RESOURCE_NOT_FOUND',
          message: 'Requested resource not found',
          details: data?.message
        };
        
      case 409:
        return {
          statusCode: 409,
          error: 'CONFLICT',
          message: 'Resource conflict - may already exist',
          details: data?.message
        };
        
      case 429:
        return {
          statusCode: 429,
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Rate limit exceeded - please try again later',
          retryAfter: error.response.headers['retry-after']
        };
        
      case 500:
      case 502:
      case 503:
        return {
          statusCode: 500,
          error: 'SERVICE_ERROR',
          message: 'Nylas service temporarily unavailable',
          details: data?.message
        };
        
      default:
        return {
          statusCode: status,
          error: 'NYLAS_API_ERROR',
          message: `Nylas API error (${status})`,
          details: data
        };
    }
  }
  
  // Network or other errors
  return {
    statusCode: 500,
    error: 'NETWORK_ERROR',
    message: 'Network or service error occurred',
    details: error.message
  };
};

const handleInterviewError = (error, context = '') => {
  // Log the error for debugging
  console.error(`Interview Error [${context}]:`, {
    message: error.message,
    stack: error.stack,
    context: context
  });
  
  // Check if it's a Nylas-related error (has response property typically from axios)
  if (error.response) {
    const nylasError = handleNylasError(error);
    return {
      ...nylasError,
      context: context,
      timestamp: new Date().toISOString()
    };
  }
  
  // Handle MongoDB/Mongoose errors
  if (error.name === 'ValidationError') {
    return {
      statusCode: 400,
      error: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: error.message,
      context: context,
      timestamp: new Date().toISOString()
    };
  }
  
  if (error.name === 'CastError') {
    return {
      statusCode: 400,
      error: 'INVALID_ID',
      message: 'Invalid ID format',
      details: error.message,
      context: context,
      timestamp: new Date().toISOString()
    };
  }

  // Preserve structured operational errors raised by internal services.
  if (error.code && Number.isInteger(error.statusCode)) {
    return {
      statusCode: error.statusCode,
      error: error.code,
      message: error.message,
      context: context,
      timestamp: new Date().toISOString()
    };
  }
  
  // Handle other general errors
  return {
    statusCode: 500,
    error: 'INTERNAL_ERROR',
    message: error.message || 'An unexpected error occurred',
    context: context,
    timestamp: new Date().toISOString()
  };
};

module.exports = { 
  handleNylasError, 
  handleInterviewError 
};
