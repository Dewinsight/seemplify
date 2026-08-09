const axios = require('axios');
const crypto = require('crypto');

function attendanceUrl() {
  return String(process.env.TIME_ATTENDANCE_API_URL || 'http://localhost:5010').replace(/\/$/, '');
}

async function fetchAttendanceContext(input) {
  const body = { schemaVersion: '1.0', ...input };
  const serialized = JSON.stringify(body);
  const timestamp = new Date().toISOString();
  const secret = process.env.INTERNAL_SERVICE_SECRET || process.env.TIME_ATTENDANCE_PERFORMANCE_SECRET || '';
  if (!secret && process.env.NODE_ENV === 'production') throw new Error('Performance to T&A authentication is not configured');
  const signature = secret ? crypto.createHmac('sha256', secret).update(`${timestamp}.${serialized}`).digest('hex') : '';
  try {
    const response = await axios.post(
      `${attendanceUrl()}/api/integrations/v1/performance/attendance-summary`,
      serialized,
      {
        headers: {
          'content-type': 'application/json',
          'x-service-id': 'performance-management',
          'x-service-timestamp': timestamp,
          'x-service-signature': signature ? `sha256=${signature}` : '',
        },
        timeout: Number(process.env.TIME_ATTENDANCE_CONTEXT_TIMEOUT_MS || 15000),
      }
    );
    return response.data.summary;
  } catch (error) {
    const wrapped = new Error(error.response?.data?.error || error.message || 'Attendance context is unavailable');
    wrapped.statusCode = error.response?.status || 502;
    throw wrapped;
  }
}

module.exports = { fetchAttendanceContext };
