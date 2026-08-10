const LOCAL_PRESENCE_URL = 'http://localhost:5010/api/internal/v1/presence';
const PRODUCTION_PRESENCE_URL = 'https://api-time.seemplifyai.com/api/internal/v1/presence';

function getPresenceReporterBaseUrl(env = process.env) {
  const configured = String(env.TIME_ATTENDANCE_PRESENCE_URL || '').trim();
  if (configured) return configured.replace(/\/$/, '');
  return env.NODE_ENV === 'production' ? PRODUCTION_PRESENCE_URL : LOCAL_PRESENCE_URL;
}

module.exports = {
  getPresenceReporterBaseUrl,
  LOCAL_PRESENCE_URL,
  PRODUCTION_PRESENCE_URL,
};
