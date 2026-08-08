export const CENTRAL_LOGOUT_COOKIE = 'seemplify_logout_at';
export const CENTRAL_SESSION_STARTED_AT = 'seemplify_session_started_at';

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

function readSessionStartedAt(): number {
  if (typeof window === 'undefined') return 0;
  return Number(window.localStorage.getItem(CENTRAL_SESSION_STARTED_AT) || 0);
}

export function markCentralSessionEstablished(): void {
  if (typeof window === 'undefined') return;
  const establishedAt = Math.max(Date.now(), readCentralLogoutAt() + 1);
  window.localStorage.setItem(CENTRAL_SESSION_STARTED_AT, String(establishedAt));
}

export function isInvalidatedByCentralLogout(token: string | null): boolean {
  if (!token) return false;
  const logoutAt = readCentralLogoutAt();
  if (!logoutAt) return false;
  const issuedAt = readIssuedAt(token);
  const sessionStartedAt = issuedAt || readSessionStartedAt();
  const jwtClockSkew = issuedAt ? 1000 : 0;
  return !sessionStartedAt || sessionStartedAt + jwtClockSkew <= logoutAt;
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
