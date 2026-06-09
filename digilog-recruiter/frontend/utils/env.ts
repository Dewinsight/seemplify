// Runtime environment variable handler
// This allows us to use environment variables at runtime in Docker/static deployments.

declare global {
  interface Window {
    __RUNTIME_CONFIG__?: {
      NEXT_PUBLIC_API_BASE_URL?: string;
      NEXT_PUBLIC_WS_BASE_URL?: string;
      NEXT_PUBLIC_IDP_URL?: string;
      NEXT_PUBLIC_INACTIVITY_TIMEOUT?: string;
      NEXT_PUBLIC_INACTIVITY_WARNING_TIME?: string;
    };
  }
}

type RuntimeConfig = {
  NEXT_PUBLIC_API_BASE_URL: string;
  NEXT_PUBLIC_WS_BASE_URL: string;
  NEXT_PUBLIC_IDP_URL: string;
  NEXT_PUBLIC_INACTIVITY_TIMEOUT: string;
  NEXT_PUBLIC_INACTIVITY_WARNING_TIME: string;
};

const LOCALHOST_NAMES = new Set(['localhost', '127.0.0.1']);

function getHostname(): string {
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return window.location.hostname;
  }
  return '';
}

function getDefaultsForHostname(hostname: string): {
  apiBase: string;
  wsBase: string;
  idpBase: string;
} {
  const isLocal = LOCALHOST_NAMES.has(hostname);
  if (isLocal) {
    return {
      apiBase: 'http://localhost:5001',
      wsBase: 'ws://localhost:5001',
      idpBase: 'http://localhost:4000',
    };
  }

  const isDevHost = hostname.includes('-dev') || hostname.includes('.dev.');
  if (isDevHost) {
    return {
      apiBase: 'https://api-dev.seemplifyai.com',
      wsBase: 'wss://api-dev.seemplifyai.com',
      idpBase: 'https://auth-dev.seemplifyai.com',
    };
  }

  const isAkwaIbom = hostname.includes('ibom') || hostname.includes('akwa') || hostname.includes('jetstone');
  if (isAkwaIbom) {
    return {
      apiBase: 'https://api.seemplifyai.com',
      wsBase: 'wss://api.seemplifyai.com',
      idpBase: 'https://akwa.aiinnigeria.com',
    };
  }

  return {
    apiBase: 'https://api.seemplifyai.com',
    wsBase: 'wss://api.seemplifyai.com',
    idpBase: 'https://auth.seemplifyai.com',
  };
}

// Get runtime config from window object (injected by script) or fall back to process.env + hostname defaults.
export function getRuntimeConfig(): RuntimeConfig {
  const hostname = getHostname();
  const defaults = getDefaultsForHostname(hostname);
  const runtimeCfg = typeof window !== 'undefined' ? window.__RUNTIME_CONFIG__ || {} : {};

  return {
    NEXT_PUBLIC_API_BASE_URL:
      runtimeCfg.NEXT_PUBLIC_API_BASE_URL ||
      process.env.NEXT_PUBLIC_API_BASE_URL ||
      defaults.apiBase,
    NEXT_PUBLIC_WS_BASE_URL:
      runtimeCfg.NEXT_PUBLIC_WS_BASE_URL ||
      process.env.NEXT_PUBLIC_WS_BASE_URL ||
      defaults.wsBase,
    NEXT_PUBLIC_IDP_URL:
      runtimeCfg.NEXT_PUBLIC_IDP_URL ||
      process.env.NEXT_PUBLIC_IDP_URL ||
      defaults.idpBase,
    NEXT_PUBLIC_INACTIVITY_TIMEOUT:
      runtimeCfg.NEXT_PUBLIC_INACTIVITY_TIMEOUT ||
      process.env.NEXT_PUBLIC_INACTIVITY_TIMEOUT ||
      '1800000',
    NEXT_PUBLIC_INACTIVITY_WARNING_TIME:
      runtimeCfg.NEXT_PUBLIC_INACTIVITY_WARNING_TIME ||
      process.env.NEXT_PUBLIC_INACTIVITY_WARNING_TIME ||
      '300000',
  };
}

export function getApiBaseUrl(): string {
  return getRuntimeConfig().NEXT_PUBLIC_API_BASE_URL;
}

export function getWsBaseUrl(): string {
  return getRuntimeConfig().NEXT_PUBLIC_WS_BASE_URL;
}

export function getIdpBaseUrl(): string {
  // Digilog recruiter is fully self-contained — organizations, members, and
  // invitations are managed in-app, with no external Identity Provider.
  return '';
}

export function getInactivityTimeout(): number {
  return parseInt(getRuntimeConfig().NEXT_PUBLIC_INACTIVITY_TIMEOUT, 10);
}

export function getInactivityWarningTime(): number {
  return parseInt(getRuntimeConfig().NEXT_PUBLIC_INACTIVITY_WARNING_TIME, 10);
}
