const LOCAL_API_URL = 'http://localhost:5004/api';
const LOCAL_WS_URL = 'ws://localhost:5004/ws';
const PRODUCTION_HOST = 'performance.seemplifyai.com';
const PRODUCTION_API_URL = 'https://api-performance.seemplifyai.com/api';
const PRODUCTION_WS_URL = 'wss://api-performance.seemplifyai.com/ws';

function trimTrailingSlash(value: string): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isProductionBrowser(): boolean {
  return typeof window !== 'undefined' &&
    String(window.location.hostname || '').trim().toLowerCase() === PRODUCTION_HOST;
}

export function resolvePerformanceApiUrl(): string {
  if (isProductionBrowser()) return PRODUCTION_API_URL;
  return trimTrailingSlash(process.env.NEXT_PUBLIC_API_URL || '') || LOCAL_API_URL;
}

export function resolvePerformanceWebSocketUrl(): string {
  if (isProductionBrowser()) return PRODUCTION_WS_URL;
  return trimTrailingSlash(process.env.NEXT_PUBLIC_WS_URL || '') || LOCAL_WS_URL;
}
