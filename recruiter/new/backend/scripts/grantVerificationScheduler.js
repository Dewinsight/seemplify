const cron = require('node-cron');
const grantVerificationService = require('../services/grantVerificationService');

class GrantVerificationScheduler {
  constructor() {
    this.isRunning = false;
  }

  /**
   * Start the grant verification scheduler
   */
  start() {
    console.log('🔄 Starting grant verification scheduler...');

    // Run every hour to check for expired grants
    cron.schedule('0 * * * *', async () => {
      if (this.isRunning) {
        console.log('⏭️ Grant verification already running, skipping...');
        return;
      }

      this.isRunning = true;
      console.log('🔍 Running scheduled grant verification...');
      
      try {
        const results = await grantVerificationService.verifyAllUserGrants();
        console.log(`✅ Grant verification complete: ${results.valid} valid, ${results.invalid} invalid, ${results.errors} errors`);
        
        // Log any users that need re-authentication
        if (results.invalidUsers.length > 0) {
          console.log('⚠️ Users requiring re-authentication:');
          results.invalidUsers.forEach(user => {
            console.log(`   - ${user.email}: ${user.error}`);
          });
        }
      } catch (error) {
        console.error('❌ Scheduled grant verification failed:', error);
      } finally {
        this.isRunning = false;
      }
    });

    // Run daily at 2 AM to do a comprehensive check
    cron.schedule('0 2 * * *', async () => {
      if (this.isRunning) {
        console.log('⏭️ Grant verification already running, skipping daily check...');
        return;
      }

      this.isRunning = true;
      console.log('🔍 Running daily comprehensive grant verification...');
      
      try {
        const results = await grantVerificationService.verifyAllUserGrants();
        console.log(`✅ Daily grant verification complete: ${results.valid} valid, ${results.invalid} invalid, ${results.errors} errors`);
        
        // Generate a daily report
        const report = {
          timestamp: new Date().toISOString(),
          totalUsers: results.total,
          validGrants: results.valid,
          invalidGrants: results.invalid,
          errors: results.errors,
          invalidUsers: results.invalidUsers
        };
        
        console.log('📊 Daily Grant Verification Report:', JSON.stringify(report, null, 2));
        
        // TODO: Send email report to admins
        // await emailService.sendGrantVerificationReport(report);
      } catch (error) {
        console.error('❌ Daily grant verification failed:', error);
      } finally {
        this.isRunning = false;
      }
    });

    console.log('✅ Grant verification scheduler started');
    console.log('   - Hourly verification: Every hour');
    console.log('   - Daily comprehensive check: 2:00 AM');
  }

  /**
   * Stop the scheduler (for graceful shutdown)
   */
  stop() {
    console.log('🛑 Stopping grant verification scheduler...');
    // Note: node-cron doesn't provide a direct way to stop all tasks
    // In a production environment, you'd want to keep track of task references
  }

  /**
   * Run verification immediately (for testing)
   */
  async runNow() {
    if (this.isRunning) {
      console.log('⏭️ Grant verification already running...');
      return;
    }

    this.isRunning = true;
    console.log('🔍 Running immediate grant verification...');
    
    try {
      const results = await grantVerificationService.verifyAllUserGrants();
      console.log(`✅ Immediate grant verification complete: ${results.valid} valid, ${results.invalid} invalid, ${results.errors} errors`);
      return results;
    } catch (error) {
      console.error('❌ Immediate grant verification failed:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }
}

module.exports = new GrantVerificationScheduler(); 