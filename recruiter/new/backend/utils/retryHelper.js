/**
 * Retry helper utility for handling transient failures
 */

class RetryHelper {
  /**
   * Execute a function with retry logic
   * @param {Function} fn - The async function to execute
   * @param {Object} options - Retry options
   * @param {number} options.maxRetries - Maximum number of retry attempts (default: 3)
   * @param {number} options.delay - Initial delay in ms between retries (default: 1000)
   * @param {number} options.backoffMultiplier - Multiplier for exponential backoff (default: 2)
   * @param {Function} options.onRetry - Callback function called on each retry
   * @param {string} options.operation - Name of the operation for logging
   * @returns {Promise} The result of the function
   */
  static async withRetry(fn, options = {}) {
    const {
      maxRetries = 3,
      delay = 1000,
      backoffMultiplier = 2,
      onRetry = null,
      operation = 'Operation'
    } = options;

    let lastError;
    let currentDelay = delay;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 ${operation} - Attempt ${attempt}/${maxRetries}`);
        const result = await fn();
        
        if (attempt > 1) {
          console.log(`✅ ${operation} succeeded after ${attempt} attempts`);
        }
        
        return result;
      } catch (error) {
        lastError = error;
        console.error(`❌ ${operation} failed on attempt ${attempt}:`, error.message);

        if (attempt < maxRetries) {
          console.log(`⏳ Retrying ${operation} in ${currentDelay}ms...`);
          
          if (onRetry) {
            await onRetry(attempt, error);
          }
          
          await this.sleep(currentDelay);
          currentDelay *= backoffMultiplier;
        }
      }
    }

    console.error(`💥 ${operation} failed after ${maxRetries} attempts`);
    throw lastError;
  }

  /**
   * Sleep for a specified duration
   * @param {number} ms - Duration in milliseconds
   * @returns {Promise}
   */
  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if an error is retryable
   * @param {Error} error - The error to check
   * @returns {boolean}
   */
  static isRetryableError(error) {
    // Network errors
    if (error.code === 'ECONNRESET' || 
        error.code === 'ETIMEDOUT' || 
        error.code === 'ECONNREFUSED') {
      return true;
    }

    // HTTP status codes that are retryable
    if (error.response) {
      const status = error.response.status;
      // Retry on 429 (rate limit), 502 (bad gateway), 503 (service unavailable), 504 (gateway timeout)
      if (status === 429 || status === 502 || status === 503 || status === 504) {
        return true;
      }
    }

    // OpenAI/Azure specific errors
    if (error.message && (
      error.message.includes('rate limit') ||
      error.message.includes('timeout') ||
      error.message.includes('temporarily unavailable')
    )) {
      return true;
    }

    return false;
  }
}

module.exports = RetryHelper;
