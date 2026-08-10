const required = (name) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const dokployOrigin = required('DOKPLOY_URL').replace(/\/$/, '');
const apiBase = dokployOrigin.endsWith('/api') ? dokployOrigin : `${dokployOrigin}/api`;
const token = required('DOKPLOY_TOKEN');
const sharedSecret = required('PRESENCE_REPORTER_SERVICE_SECRET');
const recruiterAppId = required('RECRUITER_BACKEND_APP_ID');
const timeAttendanceAppId = required('TIME_ATTENDANCE_BACKEND_APP_ID');
const headers = { 'x-api-key': token, 'content-type': 'application/json', accept: 'application/json' };

function mergeEnvironment(current, updates) {
  const entries = new Map();
  const passthrough = [];

  for (const line of String(current || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const separator = line.indexOf('=');
    if (separator < 1) {
      passthrough.push(line);
      continue;
    }
    entries.set(line.slice(0, separator), line.slice(separator + 1));
  }

  for (const [key, value] of Object.entries(updates)) entries.set(key, value);
  return [...entries].map(([key, value]) => `${key}=${value}`).concat(passthrough).join('\n');
}

async function request(pathname, options = {}) {
  const response = await fetch(`${apiBase}${pathname}`, { ...options, headers: { ...headers, ...options.headers } });
  const text = await response.text();
  if (!response.ok) throw new Error(`Dokploy ${pathname} returned ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function configure(applicationId, updates) {
  const application = await request(`/application.one?applicationId=${encodeURIComponent(applicationId)}`);
  await request('/application.saveEnvironment', {
    method: 'POST',
    body: JSON.stringify({
      applicationId,
      env: mergeEnvironment(application.env, updates),
      buildArgs: application.buildArgs ?? '',
      buildSecrets: application.buildSecrets ?? '',
      createEnvFile: application.createEnvFile ?? false,
    }),
  });
  await request('/application.deploy', {
    method: 'POST',
    body: JSON.stringify({ applicationId }),
  });
}

await configure(timeAttendanceAppId, { PRESENCE_REPORTER_SERVICE_SECRET: sharedSecret });
await configure(recruiterAppId, {
  PRESENCE_REPORTER_SERVICE_SECRET: sharedSecret,
  TIME_ATTENDANCE_PRESENCE_URL: 'https://api-time.seemplifyai.com/api/internal/v1/presence',
});

console.log('Presence reporting environment configured and backend deployments triggered.');
