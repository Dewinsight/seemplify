/**
 * Adaptive Risk Service
 * Evaluates authentication requests for suspicious patterns and risk factors
 */

class AdaptiveRiskService {
  /**
   * Evaluate request for risk factors
   * @param {Object} params - Request parameters
   * @param {Object} params.req - Express request object
   * @param {Object} params.user - User object
   * @param {Object} params.session - Session object
   * @param {Object} params.decoded - Decoded JWT token
   * @returns {Object} Risk evaluation result
   */
  async evaluateRequest({ req, user, session, decoded }) {
    const riskFactors = [];
    let riskScore = 0;

    // Check 1: IP Address change
    if (session.ip !== req.ip) {
      riskFactors.push('ip_changed');
      riskScore += 20;
    }

    // Check 2: User Agent change
    const currentUA = req.headers['user-agent'] || '';
    if (session.userAgent !== currentUA) {
      riskFactors.push('user_agent_changed');
      riskScore += 15;
    }

    // Check 3: Rapid location change (would require geo-IP service)
    // This is a placeholder - in production, use a service like MaxMind
    const locationChanged = false; // TODO: Implement geo-IP checking
    if (locationChanged) {
      riskFactors.push('location_anomaly');
      riskScore += 30;
    }

    // Check 4: Time-based anomalies
    const now = new Date();
    const lastActivity = new Date(session.lastActivityAt);
    const timeSinceLastActivity = now - lastActivity;
    
    // Suspicious if sudden activity after long inactivity
    if (timeSinceLastActivity > 7 * 24 * 60 * 60 * 1000) { // 7 days
      riskFactors.push('long_inactivity');
      riskScore += 10;
    }

    // Check 5: Multiple failed login attempts (from user data)
    if (user.security?.otpAttempts > 3) {
      riskFactors.push('multiple_failed_attempts');
      riskScore += 25;
    }

    // Check 6: Concurrent sessions from different locations
    // This would require tracking active sessions
    const hasConcurrentSessions = false; // TODO: Implement session tracking
    if (hasConcurrentSessions) {
      riskFactors.push('concurrent_sessions');
      riskScore += 20;
    }

    // Determine if step-up authentication is required
    const requireStepUp = riskScore >= 50;

    return {
      requireStepUp,
      riskScore,
      riskFactors,
      reason: requireStepUp ? `High risk detected (score: ${riskScore}): ${riskFactors.join(', ')}` : null
    };
  }

  /**
   * Log risk event for analysis
   * @param {String} userId - User ID
   * @param {String} eventType - Type of risk event
   * @param {Object} details - Event details
   */
  async logRiskEvent(userId, eventType, details) {
    // In production, this would log to a security monitoring system
    console.log(`[RISK] User ${userId} - ${eventType}:`, details);
  }

  /**
   * Check if user should be challenged with additional verification
   * @param {Object} user - User object
   * @param {String} action - Action being performed
   * @returns {Boolean} Whether to require additional verification
   */
  shouldChallenge(user, action) {
    // Implement business rules for when to require step-up auth
    const highRiskActions = ['change_password', 'add_payment_method', 'delete_account'];
    
    if (highRiskActions.includes(action)) {
      return true;
    }

    // Challenge if user hasn't verified recently
    const lastVerified = user.security?.lastOtpSent;
    if (lastVerified) {
      const hoursSinceVerified = (Date.now() - new Date(lastVerified)) / (1000 * 60 * 60);
      if (hoursSinceVerified > 24) {
        return true;
      }
    }

    return false;
  }
}

module.exports = {
  evaluateRequest: (...args) => new AdaptiveRiskService().evaluateRequest(...args),
  logRiskEvent: (...args) => new AdaptiveRiskService().logRiskEvent(...args),
  shouldChallenge: (...args) => new AdaptiveRiskService().shouldChallenge(...args)
};
