const cron = require('node-cron');

class BackgroundServiceManager {
  constructor() {
    this.services = new Map();
    this.isShuttingDown = false;
  }

  /**
   * Register a background service
   */
  register(name, service) {
    if (this.services.has(name)) {
      console.warn(`⚠️ Service ${name} is already registered`);
      return;
    }
    
    this.services.set(name, service);
    console.log(`✅ Registered background service: ${name}`);
  }

  /**
   * Start all registered services
   */
  startAll() {
    console.log('🚀 Starting all background services...');
    
    for (const [name, service] of this.services) {
      try {
        if (typeof service.start === 'function') {
          service.start();
          console.log(`✅ Started service: ${name}`);
        } else {
          console.warn(`⚠️ Service ${name} does not have a start method`);
        }
      } catch (error) {
        console.error(`❌ Failed to start service ${name}:`, error);
      }
    }
    
    console.log(`📊 Total services started: ${this.services.size}`);
  }

  /**
   * Stop all registered services (for graceful shutdown)
   */
  stopAll() {
    if (this.isShuttingDown) {
      console.log('⏭️ Already shutting down...');
      return;
    }
    
    this.isShuttingDown = true;
    console.log('🛑 Stopping all background services...');
    
    for (const [name, service] of this.services) {
      try {
        if (typeof service.stop === 'function') {
          service.stop();
          console.log(`✅ Stopped service: ${name}`);
        }
      } catch (error) {
        console.error(`❌ Failed to stop service ${name}:`, error);
      }
    }
    
    console.log('👋 All services stopped');
  }

  /**
   * Get status of all services
   */
  getStatus() {
    const status = {};
    
    for (const [name, service] of this.services) {
      status[name] = {
        registered: true,
        hasStart: typeof service.start === 'function',
        hasStop: typeof service.stop === 'function',
        isRunning: service.isRunning || false
      };
    }
    
    return status;
  }

  /**
   * Health check endpoint data
   */
  getHealthCheck() {
    const services = this.getStatus();
    const healthy = Object.values(services).every(s => s.registered);
    
    return {
      healthy,
      services,
      timestamp: new Date().toISOString()
    };
  }
}

// Create singleton instance
const backgroundServiceManager = new BackgroundServiceManager();

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('📨 SIGTERM received, shutting down gracefully...');
  backgroundServiceManager.stopAll();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📨 SIGINT received, shutting down gracefully...');
  backgroundServiceManager.stopAll();
  process.exit(0);
});

module.exports = backgroundServiceManager;
