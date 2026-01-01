// Runtime environment variable handler
// This allows us to use environment variables at runtime in Docker

declare global {
  interface Window {
    __RUNTIME_CONFIG__?: {
      NEXT_PUBLIC_API_BASE_URL?: string;
      NEXT_PUBLIC_WS_BASE_URL?: string;
      NEXT_PUBLIC_INACTIVITY_TIMEOUT?: string;
      NEXT_PUBLIC_INACTIVITY_WARNING_TIME?: string;
    };
  }
}

// Get runtime config from window object (injected by script) or fall back to process.env
export function getRuntimeConfig() {
  if (typeof window !== 'undefined' && window.__RUNTIME_CONFIG__) {
    return window.__RUNTIME_CONFIG__;
  }
  
  // Fallback to build-time env vars for non-Docker environments
  return {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
    NEXT_PUBLIC_WS_BASE_URL: process.env.NEXT_PUBLIC_WS_BASE_URL,
    NEXT_PUBLIC_INACTIVITY_TIMEOUT: process.env.NEXT_PUBLIC_INACTIVITY_TIMEOUT,
    NEXT_PUBLIC_INACTIVITY_WARNING_TIME: process.env.NEXT_PUBLIC_INACTIVITY_WARNING_TIME,
  };
}

export function getApiBaseUrl(): string {
  const config = getRuntimeConfig();
  return config.NEXT_PUBLIC_API_BASE_URL!;
}

export function getWsBaseUrl(): string {
  const config = getRuntimeConfig();
  return config.NEXT_PUBLIC_WS_BASE_URL!;
}

export function getInactivityTimeout(): number {
  const config = getRuntimeConfig();
  return parseInt(config.NEXT_PUBLIC_INACTIVITY_TIMEOUT || '1800000');
}

export function getInactivityWarningTime(): number {
  const config = getRuntimeConfig();
  return parseInt(config.NEXT_PUBLIC_INACTIVITY_WARNING_TIME || '300000');
} 