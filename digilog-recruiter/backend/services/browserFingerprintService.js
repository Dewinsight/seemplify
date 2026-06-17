const crypto = require('crypto');
const UAParser = require('ua-parser-js');
const prisma = require('../db/client');

class BrowserFingerprintService {
  /**
   * Generate a browser fingerprint based on multiple factors
   * @param {Object} req - Express request object
   * @returns {Object} Browser fingerprint data
   */
  generateFingerprint(req) {
    const userAgent = req.headers['user-agent'] || '';
    const acceptLanguage = req.headers['accept-language'] || '';
    const acceptEncoding = req.headers['accept-encoding'] || '';
    const ip = this.getClientIP(req);
    
    // Parse user agent for detailed info
    const parser = new UAParser(userAgent);
    const browserInfo = parser.getResult();
    
    // Create a unique fingerprint combining multiple factors
    const fingerprintData = {
      userAgent,
      acceptLanguage,
      acceptEncoding,
      browserName: browserInfo.browser.name || 'unknown',
      browserVersion: browserInfo.browser.version || 'unknown',
      osName: browserInfo.os.name || 'unknown',
      osVersion: browserInfo.os.version || 'unknown',
      deviceType: browserInfo.device.type || 'desktop',
      deviceVendor: browserInfo.device.vendor || 'unknown'
    };
    
    // Generate hash fingerprint
    const fingerprintString = JSON.stringify(fingerprintData);
    const fingerprint = crypto
      .createHash('sha256')
      .update(fingerprintString)
      .digest('hex');
    
    return {
      fingerprint,
      userAgent,
      ip,
      browserInfo: {
        name: browserInfo.browser.name,
        version: browserInfo.browser.version,
        os: browserInfo.os.name,
        device: browserInfo.device.type || 'desktop'
      }
    };
  }
  
  /**
   * Get client IP address, handling proxies
   * @param {Object} req - Express request object
   * @returns {String} Client IP address
   */
  getClientIP(req) {
    // Check for forwarded IP (when behind proxy/load balancer)
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      // x-forwarded-for can contain multiple IPs, take the first one
      return forwarded.split(',')[0].trim();
    }
    
    // Check for real IP headers
    const realIP = req.headers['x-real-ip'];
    if (realIP) {
      return realIP;
    }
    
    // Fallback to request IP
    return req.ip || req.connection.remoteAddress || 'unknown';
  }
  
  /**
   * Check if a browser is trusted for a user
   * @param {Object} user - User document
   * @param {String} fingerprint - Browser fingerprint
   * @returns {Boolean} Whether the browser is trusted
   */
  isBrowserTrusted(user, fingerprint) {
    if (!user.security || !user.security.trustedBrowsers) {
      return false;
    }
    
    // Check if fingerprint exists in trusted browsers
    const trustedBrowser = user.security.trustedBrowsers.find(
      browser => browser.fingerprint === fingerprint
    );
    
    if (!trustedBrowser) {
      return false;
    }
    
    // Check if browser hasn't been used in 30 days (optional security measure)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    if (trustedBrowser.lastUsed < thirtyDaysAgo) {
      return false; // Require re-verification for inactive browsers
    }
    
    return true;
  }
  
  /**
   * Add a browser to user's trusted list
   * @param {Object} user - User document
   * @param {Object} fingerprintData - Browser fingerprint data
   * @returns {Promise} Updated user
   */
  async addTrustedBrowser(user, fingerprintData) {
    if (!user.security) {
      user.security = {
        mfaEnabled: true,
        trustedBrowsers: []
      };
    }
    
    if (!user.security.trustedBrowsers) {
      user.security.trustedBrowsers = [];
    }
    
    // Remove if already exists (to update lastUsed)
    user.security.trustedBrowsers = user.security.trustedBrowsers.filter(
      browser => browser.fingerprint !== fingerprintData.fingerprint
    );
    
    // Add new/updated browser
    user.security.trustedBrowsers.push({
      fingerprint: fingerprintData.fingerprint,
      userAgent: fingerprintData.userAgent,
      ip: fingerprintData.ip,
      lastUsed: new Date(),
      createdAt: new Date()
    });
    
    // Keep only last 5 trusted browsers
    if (user.security.trustedBrowsers.length > 5) {
      user.security.trustedBrowsers = user.security.trustedBrowsers
        .sort((a, b) => b.lastUsed - a.lastUsed)
        .slice(0, 5);
    }
    
    return await prisma.user.update({ where: { id: user.id }, data: { security: user.security } });
  }
  
  /**
   * Update last used timestamp for a trusted browser
   * @param {Object} user - User document
   * @param {String} fingerprint - Browser fingerprint
   * @returns {Promise} Updated user
   */
  async updateBrowserLastUsed(user, fingerprint) {
    if (!user.security || !user.security.trustedBrowsers) {
      return user;
    }
    
    const browser = user.security.trustedBrowsers.find(
      b => b.fingerprint === fingerprint
    );
    
    if (browser) {
      browser.lastUsed = new Date();
      return await prisma.user.update({ where: { id: user.id }, data: { security: user.security } });
    }
    
    return user;
  }
  
  /**
   * Remove old or unused browsers
   * @param {Object} user - User document
   * @param {Number} daysInactive - Days of inactivity before removal (default: 90)
   * @returns {Promise} Updated user
   */
  async cleanupOldBrowsers(user, daysInactive = 90) {
    if (!user.security || !user.security.trustedBrowsers) {
      return user;
    }
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysInactive);
    
    user.security.trustedBrowsers = user.security.trustedBrowsers.filter(
      browser => browser.lastUsed > cutoffDate
    );
    
    return await prisma.user.update({ where: { id: user.id }, data: { security: user.security } });
  }

  async removeTrustedBrowser(user, fingerprint) {
    if (!user.security || !user.security.trustedBrowsers) {
      return user;
    }

    const originalLength = user.security.trustedBrowsers.length;

    user.security.trustedBrowsers = user.security.trustedBrowsers.filter(
      browser => browser.fingerprint !== fingerprint
    );

    if (user.security.trustedBrowsers.length !== originalLength) {
      user.security.lastDeviceRevokedAt = new Date();
      return await prisma.user.update({ where: { id: user.id }, data: { security: user.security } });
    }

    return user;
  }

  /**
   * Parse user agent string to extract browser information
   * @param {string} userAgent - User agent string
   * @returns {Object} Parsed browser information
   */
  parseBrowserInfo(userAgent) {
    const parser = new UAParser(userAgent);
    const result = parser.getResult();
    
    return {
      name: result.browser.name || 'Unknown',
      version: result.browser.version || '',
      os: result.os.name || 'Unknown',
      device: result.device.type || 'desktop'
    };
  }
}

module.exports = new BrowserFingerprintService();
