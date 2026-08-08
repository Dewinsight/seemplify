export const CENTRAL_LOGOUT_COOKIE = 'seemplify_logout_at';

function readCentralLogoutAt(): number {
  if (typeof document === 'undefined') return 0;
  const value = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${CENTRAL_LOGOUT_COOKIE}=`))
    ?.split('=')[1];
  return Number(value || 0);
}

function readIssuedAt(token: string): number {
  try {
    const encoded = token.split('.')[1];
    if (!encoded) return 0;
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(normalized));
    return Number(payload.iat || 0) * 1000;
  } catch {
    return 0;
  }
}

export function isInvalidatedByCentralLogout(token: string | null): boolean {
  if (!token) return false;
  const logoutAt = readCentralLogoutAt();
  if (!logoutAt) return false;
  const issuedAt = readIssuedAt(token);
  return !issuedAt || issuedAt + 1000 <= logoutAt;
}

export function watchForCentralLogout(getToken: () => string | null, onLogout: () => void): () => void {
  const check = () => {
    if (isInvalidatedByCentralLogout(getToken())) onLogout();
  };
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', check);
  return () => {
    window.removeEventListener('focus', check);
    document.removeEventListener('visibilitychange', check);
  };
}
