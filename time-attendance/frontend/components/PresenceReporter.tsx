'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

const HEARTBEAT_MS = 120_000;

function featureCode(pathname: string) {
    const value = pathname.replace(/[^a-zA-Z0-9/_-]/g, '').replaceAll('/', '.').replace(/^\.+/, '');
    return `time-attendance.${value || 'home'}`.slice(0, 80);
}

export default function PresenceReporter() {
    const pathname = usePathname();
    const { user, isAuthenticated } = useAuth();
    const sessionId = useRef<string | null>(null);
    const lastActionAt = useRef(0);

    useEffect(() => {
        if (!isAuthenticated || !user || pathname.startsWith('/login') || pathname.startsWith('/oidc/')) return;
        let stopped = false;
        const clientSessionId = sessionStorage.getItem('presence:time-attendance:tab') || crypto.randomUUID();
        sessionStorage.setItem('presence:time-attendance:tab', clientSessionId);

        const start = async () => {
            try {
                const response = await api.post('/v1/presence/sessions', {
                    appId: 'time-attendance', clientSessionId, visible: document.visibilityState === 'visible',
                    appVersion: process.env.NEXT_PUBLIC_APP_VERSION || 'web',
                });
                if (!stopped) sessionId.current = response.data.session._id;
            } catch {
                // Presence is supporting evidence; reporting failure must never block attendance work.
            }
        };
        void start();

        const heartbeat = () => {
            if (!sessionId.current || document.visibilityState !== 'visible') return;
            void api.post(`/v1/presence/sessions/${sessionId.current}/heartbeat`, { visible: true }).catch(() => undefined);
        };
        const visibility = () => {
            if (!sessionId.current) return;
            void api.post(`/v1/presence/sessions/${sessionId.current}/heartbeat`, {
                visible: document.visibilityState === 'visible',
            }).catch(() => undefined);
        };
        const meaningfulAction = () => {
            if (!sessionId.current || Date.now() - lastActionAt.current < 30_000) return;
            lastActionAt.current = Date.now();
            void api.post(`/v1/presence/sessions/${sessionId.current}/activity`, {
                activityKind: 'action', featureCode: featureCode(window.location.pathname),
            }).catch(() => undefined);
        };
        const interval = window.setInterval(heartbeat, HEARTBEAT_MS);
        document.addEventListener('visibilitychange', visibility);
        document.addEventListener('click', meaningfulAction, { passive: true });
        return () => {
            stopped = true;
            window.clearInterval(interval);
            document.removeEventListener('visibilitychange', visibility);
            document.removeEventListener('click', meaningfulAction);
            if (sessionId.current) {
                void api.post(`/v1/presence/sessions/${sessionId.current}/end`, { reason: 'client_unmount' }).catch(() => undefined);
                sessionId.current = null;
            }
        };
    }, [isAuthenticated, user?.id, user?.currentOrganization?.id]);

    useEffect(() => {
        if (!sessionId.current || !isAuthenticated) return;
        void api.post(`/v1/presence/sessions/${sessionId.current}/activity`, {
            activityKind: 'navigation', featureCode: featureCode(pathname),
        }).catch(() => undefined);
    }, [pathname, isAuthenticated]);

    return null;
}
