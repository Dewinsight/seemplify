import axios from 'axios';
import crypto from 'crypto';

/**
 * CrossModuleApiService
 * 
 * Service for aggregating employee data from various HR modules.
 * Pulls data via API calls without replicating data in the IDP database.
 * 
 * Each method includes error handling to gracefully handle unavailable modules.
 */
class CrossModuleApiService {
    constructor() {
        this.endpoints = {
            leave: process.env.LEAVE_MANAGEMENT_API_URL,
            payroll: process.env.PAYROLL_MANAGEMENT_API_URL,
            performance: process.env.PERFORMANCE_MANAGEMENT_API_URL,
            timeAttendance: process.env.TIME_ATTENDANCE_API_URL || 'https://api-time.seemplifyai.com',
            lms: process.env.LMS_API_URL
        };

        // Timeout for external API calls (5 seconds)
        this.timeout = 5000;
    }

    /**
     * Fetch leave balance and upcoming time off
     * @param {string} userId - User ID
     * @param {string} orgId - Organization ID
     * @returns {Promise<Object|null>}
     */
    async fetchLeaveData(userId, orgId) {
        try {
            if (!this.endpoints.leave) {
                console.warn('Leave Management API URL not configured');
                return null;
            }

            const response = await axios.get(
                `${this.endpoints.leave}/employees/${userId}/leave-balance`,
                {
                    headers: {
                        'x-organization-id': orgId,
                        'x-internal-request': 'true'
                    },
                    timeout: this.timeout
                }
            );

            return response.data;
        } catch (error) {
            console.error('Failed to fetch leave data:', error.message);
            return null;
        }
    }

    /**
     * Fetch payroll summary (latest payslip, YTD)
     * @param {string} userId - User ID
     * @param {string} orgId - Organization ID
     * @returns {Promise<Object|null>}
     */
    async fetchPayrollData(userId, orgId) {
        try {
            if (!this.endpoints.payroll) {
                console.warn('Payroll API URL not configured');
                return null;
            }

            const response = await axios.get(
                `${this.endpoints.payroll}/employees/${userId}/payroll-summary`,
                {
                    headers: {
                        'x-organization-id': orgId,
                        'x-internal-request': 'true'
                    },
                    timeout: this.timeout
                }
            );

            return response.data;
        } catch (error) {
            console.error('Failed to fetch payroll data:', error.message);
            return null;
        }
    }

    /**
     * Fetch performance summary (goals, feedback)
     * @param {string} userId - User ID
     * @param {string} orgId - Organization ID
     * @returns {Promise<Object|null>}
     */
    async fetchPerformanceData(userId, orgId) {
        try {
            if (!this.endpoints.performance) {
                console.warn('Performance API URL not configured');
                return null;
            }

            const timestamp = new Date().toISOString();
            const secret = process.env.INTERNAL_SERVICE_SECRET || process.env.IDP_PERFORMANCE_SERVICE_SECRET || '';
            const signature = secret
                ? crypto.createHmac('sha256', secret).update(`${timestamp}.${JSON.stringify({})}`).digest('hex')
                : '';
            const response = await axios.get(
                `${this.endpoints.performance}/employees/${userId}/performance-summary`,
                {
                    headers: {
                        'x-organization-id': orgId,
                        'x-internal-request': 'true',
                        'x-service-id': 'identity-provider',
                        'x-service-timestamp': timestamp,
                        'x-service-signature': signature ? `sha256=${signature}` : ''
                    },
                    timeout: this.timeout
                }
            );

            return response.data;
        } catch (error) {
            console.error('Failed to fetch performance data:', error.message);
            return null;
        }
    }

    /**
     * Fetch time tracking summary (current week hours, punch status)
     * @param {string} userId - User ID
     * @param {string} orgId - Organization ID
     * @returns {Promise<Object|null>}
     */
    async fetchTimeTrackingData(userId, orgId) {
        try {
            if (!this.endpoints.timeAttendance) {
                console.warn('Time & Attendance API URL not configured');
                return null;
            }

            const response = await axios.get(
                `${this.endpoints.timeAttendance}/employees/${userId}/time-tracking-summary`,
                {
                    headers: {
                        'x-organization-id': orgId,
                        'x-internal-request': 'true'
                    },
                    timeout: this.timeout
                }
            );

            return response.data;
        } catch (error) {
            console.error('Failed to fetch time tracking data:', error.message);
            return null;
        }
    }

    /**
     * Fetch learning/LMS data (assigned courses, progress)
     * @param {string} userId - User ID
     * @param {string} orgId - Organization ID
     * @returns {Promise<Object|null>}
     */
    async fetchLearningData(userId, orgId) {
        try {
            if (!this.endpoints.lms) {
                console.warn('LMS API URL not configured');
                return null;
            }

            const response = await axios.get(
                `${this.endpoints.lms}/courses/assigned/${userId}`,
                {
                    headers: {
                        'x-organization-id': orgId,
                        'x-internal-request': 'true'
                    },
                    timeout: this.timeout
                }
            );

            return response.data;
        } catch (error) {
            console.error('Failed to fetch learning data:', error.message);
            return null;
        }
    }

    /**
     * Fetch all employee dashboard data from all modules in parallel
     * @param {string} userId - User ID
     * @param {string} orgId - Organization ID
     * @returns {Promise<Object>}
     */
    async fetchAllEmployeeData(userId, orgId) {
        // Fetch all data in parallel with Promise.allSettled to handle failures gracefully
        const [leave, payroll, performance, time, learning] = await Promise.allSettled([
            this.fetchLeaveData(userId, orgId),
            this.fetchPayrollData(userId, orgId),
            this.fetchPerformanceData(userId, orgId),
            this.fetchTimeTrackingData(userId, orgId),
            this.fetchLearningData(userId, orgId)
        ]);

        return {
            leave: leave.status === 'fulfilled' ? leave.value : null,
            payroll: payroll.status === 'fulfilled' ? payroll.value : null,
            performance: performance.status === 'fulfilled' ? performance.value : null,
            time: time.status === 'fulfilled' ? time.value : null,
            learning: learning.status === 'fulfilled' ? learning.value : null,
            // Metadata about data freshness
            fetchedAt: new Date().toISOString(),
            availability: {
                leave: leave.status === 'fulfilled' && leave.value !== null,
                payroll: payroll.status === 'fulfilled' && payroll.value !== null,
                performance: performance.status === 'fulfilled' && performance.value !== null,
                time: time.status === 'fulfilled' && time.value !== null,
                learning: learning.status === 'fulfilled' && learning.value !== null
            }
        };
    }
}


export default CrossModuleApiService;
