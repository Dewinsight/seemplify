/**
 * Security Logger Utility
 * Centralized logging for security-related events
 */

const logLevels = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL'
};

class SecurityLogger {
  constructor() {
    this.logs = [];
    this.maxLogs = 10000; // Keep last 10k logs in memory
  }

  /**
   * Log a security event
   * @param {String} level - Log level
   * @param {String} event - Event type
   * @param {Object} details - Event details
   */
  log(level, event, details) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      details,
      // In production, add: serverInstance, region, etc.
    };

    // Console output with color coding
    const color = this.getColorForLevel(level);
    console.log(`${color}[SECURITY ${level}] ${event}:`, JSON.stringify(details, null, 2), '\x1b[0m');

    // Store in memory (in production, send to logging service)
    this.logs.push(logEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift(); // Remove oldest
    }

    // In production, you would:
    // 1. Send to centralized logging (ELK, Splunk, etc.)
    // 2. Alert on CRITICAL events
    // 3. Store in secure audit log
    if (level === logLevels.CRITICAL) {
      this.sendAlert(event, details);
    }
  }

  /**
   * Get color code for log level
   */
  getColorForLevel(level) {
    switch (level) {
      case logLevels.INFO: return '\x1b[36m'; // Cyan
      case logLevels.WARN: return '\x1b[33m'; // Yellow
      case logLevels.ERROR: return '\x1b[31m'; // Red
      case logLevels.CRITICAL: return '\x1b[35m'; // Magenta
      default: return '\x1b[0m'; // Reset
    }
  }

  /**
   * Send alert for critical events
   */
  sendAlert(event, details) {
    // In production, this would:
    // - Send email/SMS to security team
    // - Trigger PagerDuty/OpsGenie alert
    // - Post to security Slack channel
    console.error(`🚨 CRITICAL SECURITY EVENT: ${event}`, details);
  }

  /**
   * Convenience methods
   */
  info(event, details) {
    this.log(logLevels.INFO, event, details);
  }

  warn(event, details) {
    this.log(logLevels.WARN, event, details);
  }

  error(event, details) {
    this.log(logLevels.ERROR, event, details);
  }

  critical(event, details) {
    this.log(logLevels.CRITICAL, event, details);
  }

  /**
   * Get recent logs for analysis
   */
  getRecentLogs(count = 100) {
    return this.logs.slice(-count);
  }

  /**
   * Get logs by event type
   */
  getLogsByEvent(eventType) {
    return this.logs.filter(log => log.event === eventType);
  }

  /**
   * Get logs by level
   */
  getLogsByLevel(level) {
    return this.logs.filter(log => log.level === level);
  }

  /**
   * Clear logs (for testing)
   */
  clearLogs() {
    this.logs = [];
  }
}

// Export singleton instance
module.exports = new SecurityLogger();
