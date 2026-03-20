const LOCAL_API_URL = 'http://localhost:5006/api';
const LOCAL_IDP_URL = 'http://localhost:4000';
const PRODUCTION_PAYROLL_HOST = 'payroll.seemplifyai.com';
const PRODUCTION_API_URL = 'https://api-payroll.seemplifyai.com/api';
const PRODUCTION_IDP_URL = 'https://auth.seemplifyai.com';

function trimTrailingSlash(value: string): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

function getBrowserHostname(): string {
  if (typeof window === 'undefined') return '';
  return String(window.location.hostname || '').trim().toLowerCase();
}

export function resolvePayrollApiUrl(): string {
  const configured = trimTrailingSlash(process.env.NEXT_PUBLIC_API_URL || '');
  const hostname = getBrowserHostname();

  if (hostname === PRODUCTION_PAYROLL_HOST) {
    return PRODUCTION_API_URL;
  }

  return configured || LOCAL_API_URL;
}

export function resolvePayrollBackendOrigin(): string {
  return resolvePayrollApiUrl().replace(/\/api$/, '');
}

export function resolveIdpUrl(): string {
  const configured = trimTrailingSlash(process.env.NEXT_PUBLIC_IDP_URL || '');
  const hostname = getBrowserHostname();

  if (hostname === PRODUCTION_PAYROLL_HOST) {
    return PRODUCTION_IDP_URL;
  }

  return configured || LOCAL_IDP_URL;
}
