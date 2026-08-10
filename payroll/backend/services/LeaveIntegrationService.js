const axios = require('axios');
const { signPayrollLeaveRequest } = require('./PayrollLeaveRequestSigner');

const UNPAID_LEAVE_SUMMARY_PATH = '/api/internal/payroll/unpaid-leave-summary';

class LeaveDataUnavailableError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'LeaveDataUnavailableError';
    this.code = 'LEAVE_DATA_UNAVAILABLE';
    this.statusCode = 503;
    this.cause = cause;
  }
}

class LeaveIntegrationService {
  constructor(options = {}) {
    this.httpClient = options.httpClient || axios;
    this.leaveServiceUrl = String(
      options.leaveServiceUrl || process.env.LEAVE_SERVICE_URL || 'http://localhost:5002'
    ).replace(/\/+$/, '');
    this.sharedSecret = options.sharedSecret ?? process.env.PAYROLL_LEAVE_SHARED_SECRET;
    this.serviceId = options.serviceId || process.env.PAYROLL_LEAVE_SERVICE_ID || 'payroll';
    this.clock = options.clock || (() => Date.now());
    this.nonceFactory = options.nonceFactory;
    this.environment = options.environment ?? process.env.NODE_ENV;
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs || process.env.LEAVE_SERVICE_TIMEOUT_MS || 10000));
    this.internalApiKey = process.env.INTERNAL_API_SECRET;
  }

  toDateOnly(value, fieldName) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw new LeaveDataUnavailableError(`${fieldName} is invalid.`);
    }
    return date.toISOString().slice(0, 10);
  }

  async getUnpaidLeaveSummary(organizationId, userId, startDate, endDate) {
    try {
      const payload = {
        organizationId: String(organizationId || '').trim(),
        userId: String(userId || '').trim(),
        startDate: this.toDateOnly(startDate, 'startDate'),
        endDate: this.toDateOnly(endDate, 'endDate'),
      };
      if (!payload.organizationId || !payload.userId) {
        throw new LeaveDataUnavailableError('organizationId and userId are required for leave verification.');
      }

      const rawBody = JSON.stringify(payload);
      const headers = signPayrollLeaveRequest({
        rawBody,
        path: UNPAID_LEAVE_SUMMARY_PATH,
        secret: this.sharedSecret,
        serviceId: this.serviceId,
        timestamp: String(this.clock()),
        ...(this.nonceFactory ? { nonce: this.nonceFactory() } : {}),
        environment: this.environment,
      });
      const response = await this.httpClient.post(
        `${this.leaveServiceUrl}${UNPAID_LEAVE_SUMMARY_PATH}`,
        rawBody,
        {
          timeout: this.timeoutMs,
          maxRedirects: 0,
          headers: {
            ...headers,
            'content-type': 'application/json',
            accept: 'application/json',
          },
        }
      );

      const unpaidDays = Number(response.data?.unpaidDays);
      const workingDaysInPeriod = Number(response.data?.workingDaysInPeriod);
      const matchedRequestCount = Number(response.data?.matchedRequestCount);
      if (
        !Number.isFinite(unpaidDays)
        || unpaidDays < 0
        || !Number.isFinite(workingDaysInPeriod)
        || workingDaysInPeriod <= 0
        || unpaidDays > workingDaysInPeriod
        || !Number.isInteger(matchedRequestCount)
        || matchedRequestCount < 0
        || response.data?.organizationId !== payload.organizationId
        || response.data?.userId !== payload.userId
        || response.data?.startDate !== payload.startDate
        || response.data?.endDate !== payload.endDate
      ) {
        throw new LeaveDataUnavailableError('Leave service returned an invalid approved unpaid-leave summary.');
      }
      return { ...response.data, unpaidDays, workingDaysInPeriod, matchedRequestCount };
    } catch (error) {
      console.error('Error fetching unpaid leave data:', error.message);
      if (error instanceof LeaveDataUnavailableError) throw error;
      throw new LeaveDataUnavailableError('The authoritative leave service is unavailable.', error);
    }
  }

  async calculateUnpaidLeaveDeduction(organizationId, userId, basicSalary, startDate, endDate) {
    const leaveSummary = await this.getUnpaidLeaveSummary(
      organizationId,
      userId,
      startDate,
      endDate
    );
    
    if (leaveSummary.unpaidDays === 0) {
      return {
        days: 0,
        amount: 0
      };
    }

    // Use the organization's working-day policy returned by Leave Management.
    // This also keeps joiner/terminator proration and leave deduction on the
    // same exact payroll-period basis instead of assuming every month has 30 days.
    const normalizedSalary = Number(basicSalary);
    if (!Number.isFinite(normalizedSalary) || normalizedSalary < 0) {
      throw new LeaveDataUnavailableError('Basic salary is invalid for unpaid-leave calculation.');
    }
    const dailyRate = Math.round((normalizedSalary / leaveSummary.workingDaysInPeriod) * 100) / 100;
    const deductionAmount = Math.round((leaveSummary.unpaidDays * dailyRate) * 100) / 100;

    return {
      days: leaveSummary.unpaidDays,
      amount: deductionAmount
    };
  }

  async getAttendanceData(userId, month, year) {
    try {
      const response = await this.httpClient.get(`${this.leaveServiceUrl}/api/attendance/summary`, {
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
module.exports.LeaveDataUnavailableError = LeaveDataUnavailableError;
