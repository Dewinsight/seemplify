// Runtime configuration for deployment
// Dynamically detects environment from hostname
(function () {
  var hostname = window.location.hostname;
  var isDev = hostname.includes('-dev') || hostname === 'localhost' || hostname === '127.0.0.1';

  var apiBase = isDev ? 'https://api-dev.seemplifyai.com' : 'https://api.seemplifyai.com';
  var wsBase = isDev ? 'wss://api-dev.seemplifyai.com' : 'wss://api.seemplifyai.com';

  // For localhost, use local backend
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    apiBase = 'http://localhost:5001';
    wsBase = 'ws://localhost:5001';
  }

  window.__RUNTIME_CONFIG__ = {
    NEXT_PUBLIC_API_BASE_URL: apiBase,
    NEXT_PUBLIC_WS_BASE_URL: wsBase,
    NEXT_PUBLIC_INACTIVITY_TIMEOUT: "1800000",
    NEXT_PUBLIC_INACTIVITY_WARNING_TIME: "300000"
  };

  console.log('🔧 Runtime config loaded:', { hostname: hostname, isDev: isDev, apiBase: apiBase });
})();
