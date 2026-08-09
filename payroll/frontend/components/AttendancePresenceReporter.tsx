'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { resolvePayrollApiUrl } from '@/lib/runtimeConfig';

const APP_ID = 'payroll';
const TOKEN_KEY = 'accessToken';
const HEARTBEAT_MS = 120_000;

function apiBase() {
  return resolvePayrollApiUrl().replace(/\/$/, '');
}

function safeFeature(path: string) {
  return `${APP_ID}.${path.replace(/[^a-zA-Z0-9/_-]/g, '').replaceAll('/', '.').replace(/^\.+/, '') || 'home'}`.slice(0, 80);
}

export default function AttendancePresenceReporter() {
  const pathname = usePathname();
  const reportingAllowed = !pathname.startsWith('/login') && !pathname.startsWith('/api/');
  const sessionId = useRef<string | null>(null);
  const lastActionAt = useRef(0);

  useEffect(() => {
    if (!reportingAllowed) return;
    let stopped = false;
    let retry: number | undefined;
    const clientSessionId = sessionStorage.getItem(`presence:${APP_ID}:tab`) || crypto.randomUUID();
    sessionStorage.setItem(`presence:${APP_ID}:tab`, clientSessionId);
    const send = async (path: string, body: object) => {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) throw new Error('not authenticated');
      return fetch(`${apiBase()}/presence${path}`, {
        method: 'POST', credentials: 'include', keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    };
    const start = async () => {
      try {
        const response = await send('/sessions', { clientSessionId, visible: document.visibilityState === 'visible', appVersion: process.env.NEXT_PUBLIC_APP_VERSION || 'web' });
        if (!response.ok) throw new Error('presence unavailable');
        const data = await response.json();
        if (!stopped) sessionId.current = data.sessionId || data.session?._id;
      } catch { if (!stopped) retry = window.setTimeout(start, 10_000); }
    };
    retry = window.setTimeout(start, 1000);
    const heartbeat = () => sessionId.current && document.visibilityState === 'visible' && void send(`/sessions/${sessionId.current}/heartbeat`, { visible: true }).catch(() => undefined);
    const visibility = () => sessionId.current && void send(`/sessions/${sessionId.current}/heartbeat`, { visible: document.visibilityState === 'visible' }).catch(() => undefined);
    const action = () => {
      if (!sessionId.current || Date.now() - lastActionAt.current < 30_000) return;
      lastActionAt.current = Date.now();
      void send(`/sessions/${sessionId.current}/activity`, { activityKind: 'action', featureCode: safeFeature(window.location.pathname) }).catch(() => undefined);
    };
    const interval = window.setInterval(heartbeat, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('click', action, { passive: true });
    return () => {
      stopped = true; if (retry) window.clearTimeout(retry); window.clearInterval(interval);
      document.removeEventListener('visibilitychange', visibility); document.removeEventListener('click', action);
      if (sessionId.current) void send(`/sessions/${sessionId.current}/end`, { reason: 'client_unmount' }).catch(() => undefined);
      sessionId.current = null;
    };
  }, [reportingAllowed]);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!sessionId.current || !token) return;
    void fetch(`${apiBase()}/presence/sessions/${sessionId.current}/activity`, {
      method: 'POST', credentials: 'include', keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ activityKind: 'navigation', featureCode: safeFeature(pathname) }),
    }).catch(() => undefined);
  }, [pathname]);
  return null;
}
