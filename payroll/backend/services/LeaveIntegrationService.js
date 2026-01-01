const axios = require('axios');

class LeaveIntegrationService {
  constructor() {
    this.leaveServiceUrl = process.env.LEAVE_SERVICE_URL || 'http://localhost:5004';
    this.internalApiKey = process.env.INTERNAL_API_SECRET || 'internal-secret-key';
  }

  async getUnpaidLeaveSummary(userId, month, year) {
    try {
      const response = await axios.get(`${this.leaveServiceUrl}/api/leave-requests/summary`, {
        params: {
          userId,
          month,
          year,
          status: 'approved',
          type: 'unpaid'
        },
        headers: {
          'X-Internal-API-Key': this.internalApiKey,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
    } catch (error) {
      console.error('Error fetching unpaid leave data:', error.message);
      // Return default values if service is unavailable
      return {
        unpaidDays: 0,
        totalHours: 0
      };
    }
  }

  async calculateUnpaidLeaveDeduction(userId, basicSalary, month, year) {
    const leaveSummary = await this.getUnpaidLeaveSummary(userId, month, year);
    
    if (leaveSummary.unpaidDays === 0) {
      return {
        days: 0,
        amount: 0
      };
    }

    // Calculate daily rate (assuming 30 days month)
    const dailyRate = Math.round(basicSalary / 30);
    const deductionAmount = leaveSummary.unpaidDays * dailyRate;

    return {
      days: leaveSummary.unpaidDays,
      amount: deductionAmount
    };
  }

  async getAttendanceData(userId, month, year) {
    try {
      const response = await axios.get(`${this.leaveServiceUrl}/api/attendance/summary`, {
        params: {
          userId,
          month,
          year
        },
        headers: {
          'X-Internal-API-Key': this.internalApiKey,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
    } catch (error) {
      console.error('Error fetching attendance data:', error.message);
      return {
        workingDays: 22,
        presentDays: 22,
        lateDays: 0,
        absentDays: 0
      };
    }
  }
}

module.exports = LeaveIntegrationService;