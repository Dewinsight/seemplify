'use client';

import { useState, useEffect } from 'react';
import { Play, Square, Coffee, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
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

    // Update elapsed time every second
    useEffect(() => {
        let interval: NodeJS.Timeout;

        // Use lastClockEntry from API (not lastEntry)
        const lastClockEntry = (status as any).lastClockEntry || status.lastEntry;

        if (status.isClockedIn && !status.isOnBreak && lastClockEntry) {
            const startTime = new Date(lastClockEntry.timestamp).getTime();

            // Calculate initial offset based on previously worked time today
            // This is a simplified estimation for the UI timer
            // The backend remains the source of truth

            const updateTimer = () => {
                const now = Date.now();
                const currentSessionMs = now - startTime;

                // Convert total worked minutes to ms and add current session
                const totalMs = (status.timeWorked?.minutes || 0) * 60 * 1000 + currentSessionMs;

                const h = Math.floor(totalMs / (1000 * 60 * 60));
                const m = Math.floor((totalMs % (1000 * 60 * 60)) / (1000 * 60));
                const s = Math.floor((totalMs % (1000 * 60)) / 1000);

                setElapsedTime(
                    `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
                );
            };

            updateTimer();
            interval = setInterval(updateTimer, 1000);
        } else {
            // Static display if not running
            const totalMinutes = status.timeWorked?.minutes || 0;
            const h = Math.floor(totalMinutes / 60);
            const m = Math.round(totalMinutes % 60);
            setElapsedTime(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00`);
        }

        return () => clearInterval(interval);
    }, [status]);

    // Fetch current status from server
    const refreshStatus = async () => {
        try {
            const newStatus = await clockApi.getStatus();
            setStatus(newStatus);
        } catch (error) {
            console.error('Failed to refresh status', error);
        }
    };

    // Initial fetch on mount
    useEffect(() => {
        refreshStatus();
    }, []);

    const handleClockIn = async () => {
        try {
            setLoading(true);
            await clockApi.clockIn();
            await refreshStatus(); // Refresh status after action
            if (onStatusChange) onStatusChange();
        } catch (error) {
            console.error('Clock in failed', error);
        } finally {
            setLoading(false);
        }
    };

    const handleClockOut = async () => {
        try {
            setLoading(true);
            await clockApi.clockOut();
            await refreshStatus(); // Refresh status after action
            if (onStatusChange) onStatusChange();
        } catch (error) {
            console.error('Clock out failed', error);
        } finally {
            setLoading(false);
        }
    };

    const handleBreak = async () => {
        try {
            setLoading(true);
            if (status.isOnBreak) {
                await clockApi.endBreak();
            } else {
                await clockApi.startBreak();
            }
            await refreshStatus(); // Refresh status after action
            if (onStatusChange) onStatusChange();
        } catch (error) {
            console.error('Break toggle failed', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative group w-full max-w-md mx-auto">
            {/* Background Glow */}
            <div className={cn(
                "absolute inset-0 rounded-2xl blur-xl transition-all duration-500 opacity-50",
                status.isClockedIn && !status.isOnBreak
                    ? "bg-gradient-to-r from-teal-500/30 to-emerald-500/30 group-hover:from-teal-500/40 group-hover:to-emerald-500/40"
                    : status.isOnBreak
                        ? "bg-gradient-to-r from-amber-500/20 to-orange-500/20"
                        : "bg-gradient-to-r from-zinc-800 to-zinc-700 opacity-20"
            )} />

            <div className="relative bg-zinc-900/80 backdrop-blur-xl border border-white/5 rounded-2xl p-8 shadow-2xl">
                {/* Header Status */}
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                        <div className={cn(
                            "h-3 w-3 rounded-full shadow-[0_0_10px_currentColor]",
                            status.isClockedIn && !status.isOnBreak ? "bg-emerald-500 text-emerald-500 animate-pulse" :
                                status.isOnBreak ? "bg-amber-500 text-amber-500" :
                                    "bg-zinc-600 text-zinc-600"
                        )} />
                        <span className="font-medium text-zinc-300">
                            {status.isOnBreak ? 'On Break' :
                                status.isClockedIn ? 'Currently Working' : 'Not Clocked In'}
                        </span>
                    </div>
                    <div className="text-xs text-zinc-500 font-mono">
                        {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </div>
                </div>

                {/* Timer Display */}
                <div className="text-center mb-10">
                    <div className={cn(
                        "text-6xl font-bold font-mono tracking-wider bg-clip-text text-transparent transition-all duration-300",
                        status.isClockedIn && !status.isOnBreak
                            ? "bg-gradient-to-r from-teal-400 to-emerald-400 drop-shadow-[0_0_15px_rgba(45,212,191,0.3)]"
                            : status.isOnBreak
                                ? "bg-gradient-to-r from-amber-400 to-orange-400"
                                : "bg-zinc-700 from-zinc-500 to-zinc-600"
                    )}>
                        {elapsedTime}
                    </div>
                    <p className="text-sm text-zinc-500 mt-2">Total time today</p>
                </div>

                {/* Action Buttons */}
                <div className="grid grid-cols-2 gap-4">
                    {!status.isClockedIn ? (
                        <button
                            onClick={handleClockIn}
                            disabled={loading}
                            className="col-span-2 py-4 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-400 hover:to-emerald-500 text-white font-bold text-lg shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3"
                        >
                            <Play className="h-5 w-5 fill-current" />
                            Clock In
                        </button>
                    ) : (
                        <>
                            <button
                                onClick={handleClockOut}
                                disabled={loading}
                                className="py-4 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-400 hover:to-rose-500 text-white font-bold shadow-lg shadow-red-500/20 hover:shadow-red-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                            >
                                <Square className="h-5 w-5 fill-current" />
                                Clock Out
                            </button>

                            <button
                                onClick={handleBreak}
                                disabled={loading}
                                className={cn(
                                    "py-4 rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98]",
                                    status.isOnBreak
                                        ? "bg-zinc-800 text-white hover:bg-zinc-700 border border-zinc-700"
                                        : "bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-amber-500/20 hover:shadow-amber-500/40"
                                )}
                            >
                                {status.isOnBreak ? (
                                    <>
                                        <Play className="h-5 w-5 fill-current" />
                                        Resume
                                    </>
                                ) : (
                                    <>
                                        <Coffee className="h-5 w-5" />
                                        Take Break
                                    </>
                                )}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
