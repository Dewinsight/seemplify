'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { getApiBaseUrl } from '@/utils/env';

const APP_ID = 'recruiter'; const TOKEN_KEY = 'jwt'; const HEARTBEAT_MS = 120_000;
const base = () => { const configured = getApiBaseUrl().replace(/\/$/, ''); return configured.endsWith('/api') ? configured : `${configured}/api`; };
const feature = (path: string) => `${APP_ID}.${path.replace(/[^a-zA-Z0-9/_-]/g, '').replaceAll('/', '.').replace(/^\.+/, '') || 'home'}`.slice(0, 80);

export default function AttendancePresenceReporter() {
  const pathname = usePathname(); const session = useRef<string | null>(null); const lastAction = useRef(0);
  useEffect(() => {
    // This component is mounted only inside the authenticated staff shell. Candidate and public routes never mount it.
    let stopped = false; let retry: number | undefined;
    const clientSessionId = sessionStorage.getItem(`presence:${APP_ID}:staff-tab`) || crypto.randomUUID(); sessionStorage.setItem(`presence:${APP_ID}:staff-tab`, clientSessionId);
    const send = async (path: string, body: object) => { const token = localStorage.getItem(TOKEN_KEY); if (!token) throw new Error('not authenticated'); return fetch(`${base()}/presence${path}`, { method: 'POST', credentials: 'include', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }); };
    const start = async () => { try { const response = await send('/sessions', { clientSessionId, visible: document.visibilityState === 'visible', appVersion: process.env.NEXT_PUBLIC_APP_VERSION || 'web' }); if (!response.ok) throw new Error(); const data = await response.json(); if (!stopped) session.current = data.sessionId || data.session?._id; } catch { if (!stopped) retry = window.setTimeout(start, 10_000); } };
    retry = window.setTimeout(start, 1000);
    const beat = () => session.current && document.visibilityState === 'visible' && void send(`/sessions/${session.current}/heartbeat`, { visible: true }).catch(() => undefined);
    const visibility = () => session.current && void send(`/sessions/${session.current}/heartbeat`, { visible: document.visibilityState === 'visible' }).catch(() => undefined);
    const action = () => { if (!session.current || Date.now() - lastAction.current < 30_000) return; lastAction.current = Date.now(); void send(`/sessions/${session.current}/activity`, { activityKind: 'action', featureCode: feature(location.pathname) }).catch(() => undefined); };
    const interval = window.setInterval(beat, HEARTBEAT_MS); document.addEventListener('visibilitychange', visibility); document.addEventListener('click', action, { passive: true });
    return () => { stopped = true; if (retry) clearTimeout(retry); clearInterval(interval); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('click', action); if (session.current) void send(`/sessions/${session.current}/end`, { reason: 'client_unmount' }).catch(() => undefined); session.current = null; };
  }, []);
  useEffect(() => { const token = localStorage.getItem(TOKEN_KEY); if (!session.current || !token) return; void fetch(`${base()}/presence/sessions/${session.current}/activity`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ activityKind: 'navigation', featureCode: feature(pathname) }) }).catch(() => undefined); }, [pathname]);
  return null;
}
