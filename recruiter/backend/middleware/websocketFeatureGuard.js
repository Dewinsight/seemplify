const { PLATFORM_FEATURE_DEFINITIONS } = require('../config/platformFeatures');
const { getPlatformFeatureSettings } = require('../services/platformFeatureService');

function rejectUpgrade(socket, statusCode, statusText) {
  if (socket.destroyed) return;
  socket.write(
    `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
    'Connection: close\r\n' +
    'Content-Length: 0\r\n' +
    '\r\n'
  );
  socket.destroy();
}

async function allowFeatureUpgrade(
  featureKey,
  socket,
  { loadFeatureSettings = getPlatformFeatureSettings } = {}
) {
  if (!PLATFORM_FEATURE_DEFINITIONS[featureKey]) {
    throw new Error(`Unknown platform feature: ${featureKey}`);
  }

  try {
    const { features } = await loadFeatureSettings();
    if (features[featureKey]) return true;

    rejectUpgrade(socket, 403, 'Forbidden');
    return false;
  } catch (error) {
    console.error(`Failed to evaluate WebSocket feature flag ${featureKey}:`, error);
    rejectUpgrade(socket, 503, 'Service Unavailable');
    return false;
  }
}

module.exports = {
  allowFeatureUpgrade
};
