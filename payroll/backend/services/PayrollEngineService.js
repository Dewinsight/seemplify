const mongoose = require('mongoose');
const PayrollProfile = mongoose.model('PayrollProfile');
const CompensationRequest = mongoose.model('CompensationRequest');
const TaxCalculationService = require('./TaxCalculationService');

class PayrollEngineService {
  constructor() {
    this.taxService = new TaxCalculationService();
  }

  async generatePayslip(userId, payrollRunId, { month, year, includeBonuses = true, includeOvertime = true }) {
    try {
      // Get payroll profile
      const profile = await PayrollProfile.findOne({ userId, isActive: true });
      if (!profile) {
        throw new Error(`Payroll profile not found for user ${userId}`);
      }

      // Initialize earnings
      const earnings = {
        basic: profile.basicSalary,
        allowances: profile.allowances || [],
        bonuses: [],
        overtime: 0,
        totalGross: profile.basicSalary
      };

      // Add allowances to total
      earnings.allowances.forEach(allowance => {
        earnings.totalGross += allowance.amount || 0;
      });

      // Fetch approved compensation requests (bonuses, overtime)
      if (includeBonuses) {
        const approvedBonuses = await CompensationRequest.find({
          userId,
          type: 'bonus',
          status: 'approved_l2',
          effectiveDate: {
            $gte: new Date(year, month - 1, 1),
            $lte: new Date(year, month - 1, 31)
          }
        });

        approvedBonuses.forEach(bonus => {
          earnings.bonuses.push({
            reason: bonus.reason,
            amount: bonus.amount
          });
          earnings.totalGross += bonus.amount;
        });
      }

      if (includeOvertime) {
        const approvedOvertime = await CompensationRequest.find({
          userId,
          type: 'overtime',
          status: 'approved_l2',
          effectiveDate: {
            $gte: new Date(year, month - 1, 1),
            $lte: new Date(year, month - 1, 31)
          }
        });

        approvedOvertime.forEach(overtime => {
          earnings.overtime += overtime.amount;
        });
        earnings.totalGross += earnings.overtime;
      }

      // Calculate deductions
      const deductions = {
        tax: this.taxService.calculateMonthlyTax(earnings.totalGross, profile.currency, profile.taxRegime),
        socialSecurity: this.taxService.calculateSocialSecurity(earnings.totalGross, profile.currency),
        unpaidLeave: {
          days: 0,
          amount: 0
        },
        other: [],
        totalDeductions: 0
      };

      deductions.totalDeductions = deductions.tax + deductions.socialSecurity;

      // Calculate net pay
      const netPay = earnings.totalGross - deductions.totalDeductions;

      return {
        payrollRunId,
        userId,
        organizationId: profile.organizationId,
        earnings,
        deductions,
        netPay,
        currency: profile.currency
      };
    } catch (error) {
      console.error('Error generating payslip:', error);
      throw error;
    }
  }

  async processPayrollRun(organizationId, { month, year, includeBonuses = true, includeOvertime = true }) {
    try {
      // Get all active payroll profiles for the organization
      const profiles = await PayrollProfile.find({ 
        organizationId, 
        isActive: true 
      }).populate('gradeId');

      if (profiles.length === 0) {
        throw new Error('No active payroll profiles found for this organization');
      }

      const payslips = [];
      let totalPayrollCost = 0;

      // Generate payslip for each employee
      for (const profile of profiles) {
        try {
          const payslipData = await this.generatePayslip(
            profile.userId,
            null, // Will be set when PayrollRun is created
            { month, year, includeBonuses, includeOvertime }
          );

          // Add user snapshot from profile
          payslipData.userSnapshot = {
            name: profile.userId, // In real implementation, fetch from IdP
            email: profile.userId + '@company.com',
            designation: 'Employee', // In real implementation, fetch from IdP
            teamName: 'Team', // In real implementation, fetch from IdP
            managerName: 'Manager' // In real implementation, fetch from IdP
          };

          payslips.push(payslipData);
          totalPayrollCost += payslipData.netPay;
        } catch (error) {
          console.error(`Error processing payroll for user ${profile.userId}:`, error);
          // Continue processing other users
        }
      }

      return {
        organizationId,
        month,
        year,
        totalEmployees: profiles.length,
        totalPayrollCost,
        payslips
      };
    } catch (error) {
      console.error('Error processing payroll run:', error);
      throw error;
    }
  }

  async validateCompensationRequest(requesterId, targetUserId) {
    // In real implementation, this would validate team hierarchy via IdP
    // For now, we'll assume the requester is a manager
    return true; // Simplified validation
  }
}

module.exports = PayrollEngineService;