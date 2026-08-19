const axios = require('axios');
const crypto = require('crypto');

function baseUrl() {
  return String(
    process.env.RECRUITER_INTERNAL_API_URL
      || process.env.RECRUITER_API_URL
      || 'http://localhost:5001'
  ).replace(/\/$/, '');
}

function secret() {
  return process.env.PEOPLE_TRANSITIONS_SERVICE_SECRET
    || process.env.INTERNAL_SERVICE_SECRET
    || '';
}

function signedHeaders(body) {
  const timestamp = new Date().toISOString();
  const configuredSecret = secret();
  if (!configuredSecret && process.env.NODE_ENV === 'production') {
    throw new Error('Payroll to People Transitions authentication is not configured');
  }
  const signature = configuredSecret
    ? crypto.createHmac('sha256', configuredSecret)
      .update(`${timestamp}.${JSON.stringify(body || {})}`)
      .digest('hex')
    : '';

  return {
    'content-type': 'application/json',
    'x-service-id': 'payroll',
    'x-service-timestamp': timestamp,
    'x-service-signature': signature ? `sha256=${signature}` : '',
  };
}

async function post(path, body) {
  try {
    const response = await axios.post(
      `${baseUrl()}/api/internal/v1/people-transitions${path}`,
      body,
      {
        headers: signedHeaders(body),
        timeout: Number(process.env.RECRUITER_INTERNAL_API_TIMEOUT_MS || 15000),
      }
    );
    return response.data;
  } catch (error) {
    const detail = error.response?.data?.error
      || error.response?.data?.msg
      || error.message
      || 'People Transitions request failed';
    const wrapped = new Error(detail);
    wrapped.statusCode = error.response?.status || 502;
    wrapped.response = error.response?.data;
    throw wrapped;
  }
}

function getTransitionSummaries({ idpOrganizationId, subjectIds }) {
  return post('/summary', { idpOrganizationId, subjectIds });
}

function startMemberOnboarding(payload) {
  return post('/members/start', payload);
}

function remindMemberOnboarding(payload) {
  return post('/members/remind', payload);
}

module.exports = {
  getTransitionSummaries,
  remindMemberOnboarding,
  startMemberOnboarding,
  signedHeaders,
};
