const cron = require('node-cron');
const mongoose = require('mongoose');
const PayrollEngineService = require('../services/PayrollEngineService');
const PayrollRun = mongoose.model('PayrollRun');

class MonthlyPayrollScheduler {
  constructor() {
    this.payrollEngine = new PayrollEngineService();
    this.isRunning = false;
  }

  initializeScheduler() {
    // Schedule to run on the 25th of every month at 2 AM
    cron.schedule('0 2 25 * *', async () => {
      console.log('Starting monthly payroll job...');
      await this.executeMonthlyPayroll();
    }, {
      timezone: 'UTC'
    });

    // Schedule reminder on the 20th of every month
    cron.schedule('0 9 20 * *', async () => {
      console.log('Sending payroll preparation reminder...');
      await this.sendPayrollReminder();
    }, {
      timezone: 'UTC'
    });

    console.log('Monthly payroll scheduler initialized');
    console.log('- Payroll processing: 25th of each month at 2:00 AM UTC');
    console.log('- Payroll reminder: 20th of each month at 9:00 AM UTC');
  }

  async executeMonthlyPayroll() {
    if (this.isRunning) {
      console.log('Payroll job is already running. Skipping this execution.');
      return;
    }

    this.isRunning = true;
    
    try {
      const now = new Date();
      const month = now.getMonth() + 1; // JavaScript months are 0-indexed
      const year = now.getFullYear();

      console.log(`Processing payroll for ${month}/${year}`);

      // Get all organizations with active payroll profiles
      const organizations = await this.getOrganizationsWithPayroll();

      for (const orgId of organizations) {
        try {
          await this.processOrganizationPayroll(orgId, month, year);
        } catch (error) {
          console.error(`Error processing payroll for organization ${orgId}:`, error);
        }
      }

      console.log('Monthly payroll processing completed');
    } catch (error) {
      console.error('Error in monthly payroll job:', error);
    } finally {
      this.isRunning = false;
    }
  }

  async processOrganizationPayroll(organizationId, month, year) {
    try {
      // Check if payroll run already exists for this month (check with correct field structure)
      const existingRun = await PayrollRun.findOne({
        organizationId,
        'payPeriod.type': 'monthly',
        'payPeriod.month': month,
        'payPeriod.year': year,
        status: { $nin: ['cancelled'] }
      });

      if (existingRun) {
        console.log(`Payroll run already exists for organization ${organizationId}, month ${month}/${year} (status: ${existingRun.status})`);
        return { skipped: true, reason: 'Run already exists' };
      }

      // Use PayrollEngineService to process - it will create the run internally
      const payrollResult = await this.payrollEngine.processPayrollRun(organizationId, {
        month,
        year,
        includeBonuses: true,
        includeOvertime: true
      });

      if (payrollResult?.skipped) {
        return payrollResult;
      }

      // Use only the run created by this invocation. Another scheduler replica
      // may own a different in-flight run for the same organization.
      const createdRun = payrollResult?.run?._id
        ? await PayrollRun.findOne({ _id: payrollResult.run._id, organizationId })
        : null;
      
      if (createdRun) {
        createdRun.processedBy = 'system-scheduler';
        createdRun.processedByName = 'Automated Scheduler';
        await createdRun.save();
        
        console.log(`Payroll processed for organization ${organizationId}: ${payrollResult.totalEmployees} employees, total cost: ${payrollResult.totalPayrollCost}`);

        // Send notification to finance/admin
        if (createdRun.status === 'calculated') {
          await this.notifyPayrollReady(createdRun);
        } else {
          console.warn(`Payroll run ${createdRun._id} requires review and was not submitted.`);
        }
        
        return { success: true, run: createdRun, result: payrollResult };
      } else {
        console.warn(`No payroll run found after processing for organization ${organizationId}`);
        return { success: false, reason: 'Run not found after processing' };
      }

    } catch (error) {
      console.error(`Error processing organization payroll for ${organizationId}:`, error);
      throw error;
    }
  }

  async getOrganizationsWithPayroll() {
    // This should return list of organization IDs that have active payroll profiles
    const PayrollProfile = mongoose.model('PayrollProfile');
    const orgs = await PayrollProfile.distinct('organizationId', {
      isActive: true,
      $or: [{ payFrequency: 'monthly' }, { payFrequency: { $exists: false } }],
    });
    return orgs;
  }

  async sendPayrollReminder() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    console.log(`Payroll reminder sent for ${month}/${year}: Please ensure all compensation requests are approved by the 25th`);
    
    // In a real implementation, this would send emails/notifications to managers and HR
    const organizations = await this.getOrganizationsWithPayroll();
    
    for (const orgId of organizations) {
      await this.notifyOrganizationForPayrollPreparation(orgId, month, year);
    }
  }

  async notifyPayrollReady(payrollRun) {
    // In a real implementation, this would send notifications to finance/admin users
    const month = payrollRun.payPeriod?.month || 'N/A';
    const year = payrollRun.payPeriod?.year || 'N/A';
    const totalEmployees = payrollRun.summary?.totalEmployees || 0;
    const totalCost = payrollRun.summary?.totalEmployerCost || 0;
    
    console.log(`PAYROLL READY FOR REVIEW: Organization ${payrollRun.organizationId}, ${month}/${year}`);
    console.log(`Total employees: ${totalEmployees}, Total cost: ${totalCost}`);
    console.log(`Review and approve at: /admin/payroll-runs/${payrollRun._id}`);
  }

  async notifyOrganizationForPayrollPreparation(organizationId, month, year) {
    // In a real implementation, this would send notifications to managers
    console.log(`Payroll preparation reminder for organization ${organizationId}: Complete all compensation requests by ${month}/25/${year}`);
  }

  // Manual trigger for testing
  async triggerManualPayroll(organizationId, month, year) {
    console.log(`Manually triggering payroll for organization ${organizationId}, ${month}/${year}`);
    return await this.processOrganizationPayroll(organizationId, month, year);
  }

  // Get scheduler status
  getStatus() {
    return {
      isRunning: this.isRunning,
      nextRun: this.getNextRunDate()
    };
  }

  getNextRunDate() {
    const now = new Date();
    const currentDay = now.getDate();
    
    let nextRun = new Date(now.getFullYear(), now.getMonth(), 25, 2, 0, 0);
    
    if (currentDay > 25) {
      nextRun = new Date(now.getFullYear(), now.getMonth() + 1, 25, 2, 0, 0);
    }
    
    return nextRun;
  }
}

module.exports = MonthlyPayrollScheduler;
