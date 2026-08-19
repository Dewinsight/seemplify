'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { Coffee, Loader2, Play, Square } from 'lucide-react';
import { clockApi } from '@/lib/api';
import { getApiErrorMessage } from '@/lib/apiError';

interface ClockStatus {
    isClockedIn: boolean;
    isOnBreak: boolean;
    lastEntry?: any;
    timeWorked?: { hours: number; minutes: number; seconds?: number };
    policy?: { requireNote?: boolean; locationEnabled?: boolean; locationRequired?: boolean; maximumLocationAccuracyMeters?: number };
    _receivedAt?: number;
}

interface ClockWidgetProps {
    initialStatus?: ClockStatus;
    onStatusChange?: () => void;
}

const NOTE_REQUIRED_ERROR = 'Add a clock-in note before continuing.';

export default function ClockWidget({ initialStatus, onStatusChange }: ClockWidgetProps) {
    const noteId = useId();
    const noteHelpId = `${noteId}-help`;
    const [status, setStatus] = useState<ClockStatus>(initialStatus || {
        isClockedIn: false,
        isOnBreak: false,
        timeWorked: { hours: 0, minutes: 0 },
    });
    const [policyLoaded, setPolicyLoaded] = useState(Boolean(initialStatus?.policy));
    const [clockInNote, setClockInNote] = useState('');
    const [loading, setLoading] = useState(false);
    const [elapsedTime, setElapsedTime] = useState('00:00:00');
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const refreshStatus = useCallback(async () => {
        try {
            const next = await clockApi.getStatus();
            setStatus({ ...next, _receivedAt: Date.now() });
            setPolicyLoaded(true);
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
            const baseSeconds = status.timeWorked?.seconds ?? (status.timeWorked?.minutes || 0) * 60;
            const liveSeconds = status.isClockedIn && !status.isOnBreak
                ? Math.max(0, Math.floor((Date.now() - (status._receivedAt || Date.now())) / 1000))
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
            // Location recording is independent from geofence enforcement.
            // A disabled geofence must not stop us from retaining the location
            // snapshot that employees and reviewers expect on the timesheet.
            const location = await getLocation();
            await action(location);
            await refreshStatus();
            setMessage(location ? success : `${success} Location was not available.`);
            onStatusChange?.();
            setTimeout(() => setMessage(null), 2400);
            return true;
        } catch (actionError: any) {
            setError(getApiErrorMessage(actionError, 'The clock could not be updated.'));
            setMessage(null);
            return false;
        } finally {
            setLoading(false);
        }
    };

    const noteRequired = Boolean(status.policy?.requireNote);
    const clockIn = async () => {
        const note = clockInNote.trim();
        if (noteRequired && !note) {
            setMessage(null);
            setError(NOTE_REQUIRED_ERROR);
            return;
        }

        const succeeded = await run(
            'Recording your location…',
            (location) => clockApi.clockIn(note || undefined, location),
            'You are clocked in.',
        );
        if (succeeded) setClockInNote('');
    };
    const clockOut = () => run('Recording your location…', (location) => clockApi.clockOut(undefined, location), 'You are clocked out.');
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
            setError(getApiErrorMessage(actionError, 'The break status could not be updated.'));
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

            {!status.isClockedIn && noteRequired && (
                <div className="mb-4">
                    <div className="mb-2 flex items-baseline justify-between gap-3">
                        <label htmlFor={noteId} className="text-sm font-medium" style={{ color: 'var(--suite-ink)' }}>
                            Clock-in note
                        </label>
                        <span className="text-xs tabular-nums" style={{ color: 'var(--suite-subtle)' }}>
                            {clockInNote.length}/500
                        </span>
                    </div>
                    <textarea
                        id={noteId}
                        value={clockInNote}
                        onChange={(event) => {
                            setClockInNote(event.target.value);
                            if (error === NOTE_REQUIRED_ERROR) setError(null);
                        }}
                        maxLength={500}
                        rows={2}
                        required
                        disabled={loading}
                        aria-describedby={noteHelpId}
                        aria-invalid={error === NOTE_REQUIRED_ERROR}
                        placeholder="What are you working on today?"
                        className="block w-full resize-none rounded-lg border px-3 py-2.5 text-sm leading-5 outline-none transition-colors focus:ring-2 focus:ring-[var(--suite-accent)] disabled:cursor-wait disabled:opacity-60"
                        style={{
                            borderColor: error === NOTE_REQUIRED_ERROR ? 'var(--suite-danger)' : 'var(--suite-line-strong)',
                            background: 'var(--suite-surface-muted)',
                            color: 'var(--suite-ink)',
                        }}
                    />
                    <p id={noteHelpId} className="mt-1.5 text-xs" style={{ color: 'var(--suite-muted)' }}>
                        Required by your attendance policy.
                    </p>
                </div>
            )}

            {(message || error) && (
                <div role={error ? 'alert' : 'status'} className="mb-4 rounded-lg border px-3 py-2.5 text-sm" style={{ borderColor: error ? 'var(--suite-danger)' : 'var(--suite-line)', color: error ? 'var(--suite-danger)' : 'var(--suite-muted)', background: 'var(--suite-surface-muted)' }}>
                    {loading && <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />}{error || message}
                </div>
            )}

            {!status.isClockedIn ? (
                <button onClick={clockIn} disabled={loading || !policyLoaded} className="suite-button h-11 w-full disabled:cursor-wait disabled:opacity-50">
                    {loading || !policyLoaded ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    {policyLoaded ? 'Clock in' : 'Checking policy'}
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
