const cron = require('node-cron');
const exchangeRateSyncService = require('../services/ExchangeRateSyncService');

class ExchangeRateScheduler {
  constructor() {
    this.isRunning = false;
  }

  initializeScheduler() {
    // Run once daily after the provider refresh window.
    cron.schedule('20 2 * * *', async () => {
      console.log('Starting daily exchange-rate sync job...');
      await this.executeDailySync();
    }, {
      timezone: 'UTC',
    });

    console.log('Exchange-rate scheduler initialized');
    console.log('- Exchange-rate sync: every day at 2:20 AM UTC');
  }

  async executeDailySync() {
    if (this.isRunning) {
      console.log('Exchange-rate sync job is already running. Skipping this execution.');
      return [];
    }

    this.isRunning = true;

    try {
      const results = await exchangeRateSyncService.syncAutoEnabledOrganizations();
      const successCount = results.filter((result) => result.success).length;
      const failureCount = results.length - successCount;

      console.log(`Daily exchange-rate sync completed: ${successCount} success, ${failureCount} failed`);
      return results;
    } catch (error) {
      console.error('Error in daily exchange-rate sync job:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
    };
  }
}

module.exports = ExchangeRateScheduler;
