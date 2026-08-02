// Runtime configuration for deployment
// Dynamically detects environment from hostname
(function () {
  var hostname = window.location.hostname;
  var isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  var isDev = hostname.includes('-dev') || hostname.includes('.dev.') || isLocal;

  // White-label domains that proxy to the same production backend
  var isWhiteLabel = hostname.includes('jetstone.aiinnigeria.com') || hostname.includes('akwaibom.aiinnigeria.com');

  var apiBase = isDev ? 'https://api-dev.seemplifyai.com' : 'https://api.seemplifyai.com';
  var wsBase = isDev ? 'wss://api-dev.seemplifyai.com' : 'wss://api.seemplifyai.com';
  var idpBase = isDev ? 'https://auth-dev.seemplifyai.com' : 'https://auth.seemplifyai.com';

  // For localhost, use local backend and IdP
  if (isLocal) {
    apiBase = 'http://localhost:5001';
    wsBase = 'ws://localhost:5001';
    idpBase = 'http://localhost:4000';
  }

  // White-label domains use production backend
  if (isWhiteLabel) {
    apiBase = 'https://api.seemplifyai.com';
    wsBase = 'wss://api.seemplifyai.com';
    idpBase = 'https://auth.seemplifyai.com';
  }

  window.__RUNTIME_CONFIG__ = {
    NEXT_PUBLIC_API_BASE_URL: apiBase,
    NEXT_PUBLIC_WS_BASE_URL: wsBase,
    NEXT_PUBLIC_IDP_URL: idpBase,
    NEXT_PUBLIC_INACTIVITY_TIMEOUT: '1800000',
    NEXT_PUBLIC_INACTIVITY_WARNING_TIME: '300000'
  };

  console.log('Runtime config loaded:', {
    hostname: hostname,
    isDev: isDev,
    isWhiteLabel: isWhiteLabel,
    apiBase: apiBase,
    idpBase: idpBase
  });
})();
