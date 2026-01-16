const fs = require('fs');
const path = require('path');

/**
 * ConfigLoader - Loads and manages application configuration
 * Uses app.config.json for environment-specific settings
 */
class ConfigLoader {
  constructor() {
    this.config = null;
    this.loadConfig();
  }

  loadConfig() {
    try {
      const configPath = path.join(__dirname, 'app.config.json');
      const configData = fs.readFileSync(configPath, 'utf8');
      this.config = JSON.parse(configData);
      console.log('✅ Application configuration loaded successfully');
    } catch (error) {
      console.error('❌ Failed to load app.config.json:', error.message);
      // Fallback to defaults if config file is missing
      this.config = {
        development: {
          baseUrl: 'http://localhost:5001',
          callbackPath: '/api/interviews/oauth/callback'
        },
        production: {
          baseUrl: 'https://api.seemplifyai.com',
          callbackPath: '/api/interviews/oauth/callback'
        }
      };
    }
  }

  /**
   * Get the current environment (development or production)
   * DEFAULTS TO PRODUCTION for safety - only uses development when explicitly set
   */
  getEnvironment() {
    return process.env.NODE_ENV === 'development' ? 'development' : 'production';
  }

  /**
   * Get configuration for the current environment
   */
  getCurrentConfig() {
    const env = this.getEnvironment();
    return this.config[env] || this.config.development;
  }

  /**
   * Get the base URL for the current environment
   */
  getBaseUrl() {
    const config = this.getCurrentConfig();
    return config.baseUrl;
  }

  /**
   * Get the full callback URL for Nylas OAuth
   */
  getCallbackUrl() {
    const config = this.getCurrentConfig();
    return `${config.baseUrl}${config.callbackPath}`;
  }

  /**
   * Get configuration for a specific environment
   */
  getConfigForEnvironment(env) {
    return this.config[env] || this.config.development;
  }
}

// Export a singleton instance
module.exports = new ConfigLoader();

