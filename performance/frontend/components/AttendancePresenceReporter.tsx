'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { createPresenceSession } from '@/lib/presence-session';

const APP_ID = 'performance'; const TOKEN_KEY = 'accessToken'; const HEARTBEAT_MS = 120_000;
const base = () => (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5004/api').replace(/\/$/, '');
const feature = (path: string) => `${APP_ID}.${path.replace(/[^a-zA-Z0-9/_-]/g, '').replaceAll('/', '.').replace(/^\.+/, '') || 'home'}`.slice(0, 80);

export default function AttendancePresenceReporter() {
  const { isAuthenticated, isLoading, user, currentOrganization } = useAuth();
  const pathname = usePathname();
  const reporter = useRef<ReturnType<typeof createPresenceSession> | null>(null);
  const userId = user?.sub || user?.id;
  const organizationId = currentOrganization?.id || currentOrganization?._id;
  const reportingAllowed = !isLoading && isAuthenticated && Boolean(userId && organizationId) && !pathname.startsWith('/login') && !pathname.startsWith('/api/');
  useEffect(() => {
    if (!reportingAllowed) return;
    const clientSessionId = sessionStorage.getItem(`presence:${APP_ID}:tab`) || crypto.randomUUID(); sessionStorage.setItem(`presence:${APP_ID}:tab`, clientSessionId);
    const send = async (path: string, body: object) => { const token = localStorage.getItem(TOKEN_KEY); if (!token) throw new Error('not authenticated'); return fetch(`${base()}/presence${path}`, { method: 'POST', credentials: 'include', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }); };
    const current = createPresenceSession(send, () => ({ clientSessionId, visible: document.visibilityState === 'visible', appVersion: process.env.NEXT_PUBLIC_APP_VERSION || 'web' }));
    reporter.current = current;
    const initial = window.setTimeout(() => void current.start(), 1000);
    const retry = window.setInterval(() => void current.start(), 10_000);
    const beat = () => { if (document.visibilityState === 'visible') void current.report('heartbeat', { visible: true }); };
    const visibility = () => void current.report('heartbeat', { visible: document.visibilityState === 'visible' });
    let lastAction = 0;
    const action = () => { if (Date.now() - lastAction < 30_000) return; lastAction = Date.now(); void current.report('activity', { activityKind: 'action', featureCode: feature(location.pathname) }); };
    const interval = window.setInterval(beat, HEARTBEAT_MS); document.addEventListener('visibilitychange', visibility); document.addEventListener('click', action, { passive: true });
    return () => { clearTimeout(initial); clearInterval(retry); clearInterval(interval); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('click', action); current.stop(); if (reporter.current === current) reporter.current = null; };
  }, [reportingAllowed, userId, organizationId]);
  useEffect(() => { if (reportingAllowed) void reporter.current?.report('activity', { activityKind: 'navigation', featureCode: feature(pathname) }); }, [pathname, reportingAllowed, userId, organizationId]);
  return null;
}
