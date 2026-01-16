// Runtime configuration for production deployment
// This file is loaded before any other scripts to configure API endpoints
window.__RUNTIME_CONFIG__ = {
  NEXT_PUBLIC_API_BASE_URL: "https://api.seemplifyai.com",
  NEXT_PUBLIC_WS_BASE_URL: "wss://api.seemplifyai.com",
  NEXT_PUBLIC_INACTIVITY_TIMEOUT: "1800000",
  NEXT_PUBLIC_INACTIVITY_WARNING_TIME: "300000"
};
