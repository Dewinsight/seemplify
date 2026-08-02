// Runtime configuration for deployment
// diGiLog talks to its own self-hosted backend (Azure VM) — no Seemplify IdP, no api.seemplifyai.com.
(function () {
  var hostname = window.location.hostname;
  var isLocal = hostname === 'localhost' || hostname === '127.0.0.1';

  // Self-hosted digiLog backend (production)
  var apiBase = 'https://recruit-api.radiantdigilog.com';
  var wsBase = 'wss://recruit-api.radiantdigilog.com';

  // Local development uses a local backend
  if (isLocal) {
    apiBase = 'http://localhost:5001';
    wsBase = 'ws://localhost:5001';
  }

  window.__RUNTIME_CONFIG__ = {
    NEXT_PUBLIC_API_BASE_URL: apiBase,
    NEXT_PUBLIC_WS_BASE_URL: wsBase,
    NEXT_PUBLIC_INACTIVITY_TIMEOUT: '1800000',
    NEXT_PUBLIC_INACTIVITY_WARNING_TIME: '300000'
  };

  console.log('Runtime config loaded:', { hostname: hostname, apiBase: apiBase });
})();
