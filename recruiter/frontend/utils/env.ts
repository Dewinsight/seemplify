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

// Detect if running in local development environment
function isLocalDevelopment(): boolean {
  if (typeof window === 'undefined') {
    // Server-side: check NODE_ENV
    return process.env.NODE_ENV === 'development';
  }
  
  // Client-side: check hostname
  const hostname = window.location.hostname;
  return hostname === 'localhost' || 
         hostname === '127.0.0.1' || 
         hostname.startsWith('192.168.') ||
         hostname.startsWith('10.') ||
         hostname.endsWith('.local');
}

// Get runtime config from window object (injected by script) or fall back to process.env
export function getRuntimeConfig() {
  // In local development, ALWAYS use process.env values from .env.local
  // This prevents the hardcoded production URLs in __runtime_config__.js from being used
  if (isLocalDevelopment()) {
    const config = {
      NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
      NEXT_PUBLIC_WS_BASE_URL: process.env.NEXT_PUBLIC_WS_BASE_URL,
      NEXT_PUBLIC_INACTIVITY_TIMEOUT: process.env.NEXT_PUBLIC_INACTIVITY_TIMEOUT,
      NEXT_PUBLIC_INACTIVITY_WARNING_TIME: process.env.NEXT_PUBLIC_INACTIVITY_WARNING_TIME,
    };
    
    if (typeof window !== 'undefined') {
      console.log('🏠 Local development detected - using .env.local configuration:', {
        API_BASE_URL: config.NEXT_PUBLIC_API_BASE_URL,
        WS_BASE_URL: config.NEXT_PUBLIC_WS_BASE_URL,
      });
    }
    
    return config;
  }
  
  // In dev deployments, use build-time env vars instead of runtime config
  if (typeof window !== 'undefined' && window.location.hostname.includes('-dev')) {
    return {
      NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
      NEXT_PUBLIC_WS_BASE_URL: process.env.NEXT_PUBLIC_WS_BASE_URL,
      NEXT_PUBLIC_INACTIVITY_TIMEOUT: process.env.NEXT_PUBLIC_INACTIVITY_TIMEOUT,
      NEXT_PUBLIC_INACTIVITY_WARNING_TIME: process.env.NEXT_PUBLIC_INACTIVITY_WARNING_TIME,
    };
  }

  // In production, use runtime config from __runtime_config__.js if available
  if (typeof window !== 'undefined' && window.__RUNTIME_CONFIG__) {
    console.log('🌐 Production detected - using runtime configuration');
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