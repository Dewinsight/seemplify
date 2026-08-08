'use client';

import { useCallback, useEffect, useState } from 'react';
import { Coffee, Loader2, Play, Square } from 'lucide-react';
import { clockApi } from '@/lib/api';

interface ClockWidgetProps {
    initialStatus?: {
        isClockedIn: boolean;
        isOnBreak: boolean;
        lastEntry?: any;
        timeWorked?: { hours: number; minutes: number };
    };
    onStatusChange?: () => void;
}

export default function ClockWidget({ initialStatus, onStatusChange }: ClockWidgetProps) {
    const [status, setStatus] = useState(initialStatus || {
        isClockedIn: false,
        isOnBreak: false,
        timeWorked: { hours: 0, minutes: 0 },
    });
    const [loading, setLoading] = useState(false);
    const [elapsedTime, setElapsedTime] = useState('00:00:00');
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const refreshStatus = useCallback(async () => {
        try {
            const next = await clockApi.getStatus();
            setStatus({ ...next, _receivedAt: Date.now() } as any);
        } catch (refreshError) {
            console.error('Failed to refresh status', refreshError);
        }
    }, []);

    useEffect(() => {
        refreshStatus();
        return clockApi.subscribe(refreshStatus);
    }, [refreshStatus]);

    useEffect(() => {
        let interval: NodeJS.Timeout | undefined;
        const update = () => {
            const baseSeconds = (status.timeWorked as any)?.seconds ?? (status.timeWorked?.minutes || 0) * 60;
            const liveSeconds = status.isClockedIn && !status.isOnBreak
                ? Math.max(0, Math.floor((Date.now() - ((status as any)._receivedAt || Date.now())) / 1000))
                : 0;
            const total = baseSeconds + liveSeconds;
            const hours = Math.floor(total / 3600);
            const minutes = Math.floor((total % 3600) / 60);
            const seconds = total % 60;
            setElapsedTime(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
        };
        update();
        if (status.isClockedIn && !status.isOnBreak) interval = setInterval(update, 1000);
        return () => { if (interval) clearInterval(interval); };
    }, [status]);

    const getLocation = () => new Promise<{ latitude: number; longitude: number; accuracy: number } | null>((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition(
            ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }),
            () => resolve(null),
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    });

    const run = async (label: string, action: (location: any) => Promise<any>, success: string) => {
        try {
            setLoading(true);
            setError(null);
            setMessage(label);
            const location = await getLocation();
            await action(location);
            await refreshStatus();
            setMessage(success);
            onStatusChange?.();
            setTimeout(() => setMessage(null), 2400);
        } catch (actionError: any) {
            const payload = actionError.response?.data;
            setError(payload?.details?.reason || payload?.error || 'The clock could not be updated.');
            setMessage(null);
        } finally {
            setLoading(false);
        }
    };

    const clockIn = () => run('Confirming your location…', (location) => clockApi.clockIn(undefined, location), 'You are clocked in.');
    const clockOut = () => run('Closing today’s session…', (location) => clockApi.clockOut(undefined, location), 'You are clocked out.');
    const toggleBreak = async () => {
        try {
            setLoading(true);
            setError(null);
            setMessage(status.isOnBreak ? 'Ending break…' : 'Starting break…');
            if (status.isOnBreak) await clockApi.endBreak(); else await clockApi.startBreak();
            await refreshStatus();
            setMessage(status.isOnBreak ? 'Break ended.' : 'Break started.');
            onStatusChange?.();
            setTimeout(() => setMessage(null), 2400);
        } catch (actionError: any) {
            setError(actionError.response?.data?.error || 'The break status could not be updated.');
        } finally {
            setLoading(false);
        }
    };

    const statusLabel = status.isOnBreak ? 'On break' : status.isClockedIn ? 'Currently working' : 'Not clocked in';

    return (
        <div className="suite-panel flex min-h-[410px] flex-col p-6 sm:p-7">
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: status.isOnBreak ? 'var(--suite-warning)' : status.isClockedIn ? 'var(--suite-positive)' : 'var(--suite-subtle)' }} />
                    <p className="text-sm font-semibold">{statusLabel}</p>
                </div>
                <p className="text-xs" style={{ color: 'var(--suite-muted)' }}>
                    {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </p>
            </div>

            <div className="flex flex-1 flex-col items-center justify-center py-10">
                <p className="font-mono text-[clamp(2.65rem,5vw,4.25rem)] font-semibold tracking-[-0.06em]" style={{ color: status.isClockedIn ? 'var(--suite-accent)' : 'var(--suite-ink)' }}>
                    {elapsedTime}
                </p>
                <p className="mt-2 text-sm" style={{ color: 'var(--suite-muted)' }}>Recorded today</p>
            </div>

            {(message || error) && (
                <div className="mb-4 rounded-lg border px-3 py-2.5 text-sm" style={{ borderColor: error ? 'var(--suite-danger)' : 'var(--suite-line)', color: error ? 'var(--suite-danger)' : 'var(--suite-muted)', background: 'var(--suite-surface-muted)' }}>
                    {loading && <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />}{error || message}
                </div>
            )}

            {!status.isClockedIn ? (
                <button onClick={clockIn} disabled={loading} className="suite-button h-11 w-full disabled:opacity-50">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Clock in
                </button>
            ) : (
                <div className="grid grid-cols-2 gap-3">
                    <button onClick={clockOut} disabled={loading} className="suite-button h-11 disabled:opacity-50">
                        <Square className="h-4 w-4" /> Clock out
                    </button>
                    <button onClick={toggleBreak} disabled={loading} className="suite-button-secondary h-11 disabled:opacity-50">
                        {status.isOnBreak ? <Play className="h-4 w-4" /> : <Coffee className="h-4 w-4" />}
                        {status.isOnBreak ? 'Resume' : 'Take break'}
                    </button>
                </div>
            )}
        </div>
    );
}
