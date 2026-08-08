'use client';

import { useState, useEffect, useCallback } from 'react';
import { Play, Square, Coffee, Loader2, Sparkles, Zap, Trophy, Sun, Moon, PartyPopper } from 'lucide-react';
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

// Confetti particle component
const Particle = ({ delay, color }: { delay: number; color: string }) => (
    <div
        className={cn(
            "absolute w-2 h-2 rounded-full animate-confetti",
            color
        )}
        style={{
            left: `${Math.random() * 100}%`,
            animationDelay: `${delay}ms`,
            animationDuration: `${1000 + Math.random() * 500}ms`,
        }}
    />
);

// Motivational messages
const clockInMessages = [
    "Let's crush it today! 💪",
    "Ready to make magic happen!",
    "Another great day begins!",
    "You've got this! 🚀",
    "Time to shine! ✨",
];

const clockOutMessages = [
    "Great work today! 🎉",
    "Well deserved rest!",
    "You crushed it! 💪",
    "See you tomorrow! 👋",
    "Fantastic effort! ⭐",
];

const breakMessages = [
    "Enjoy your break! ☕",
    "Recharge time! 🔋",
    "You deserve this! 🌟",
    "Take it easy! 😌",
];

export default function ClockWidget({ initialStatus, onStatusChange }: ClockWidgetProps) {
    const [status, setStatus] = useState(initialStatus || {
        isClockedIn: false,
        isOnBreak: false,
        timeWorked: { hours: 0, minutes: 0 },
    });
    const [loading, setLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
    const [loadingStep, setLoadingStep] = useState(0);
    const [elapsedTime, setElapsedTime] = useState('00:00:00');
    const [locationError, setLocationError] = useState<string | null>(null);
    const [showCelebration, setShowCelebration] = useState(false);
    const [celebrationMessage, setCelebrationMessage] = useState('');
    const [celebrationType, setCelebrationType] = useState<'clockIn' | 'clockOut' | 'break'>('clockIn');
    const [pulseEffect, setPulseEffect] = useState(false);

    // Trigger celebration
    const celebrate = useCallback((type: 'clockIn' | 'clockOut' | 'break') => {
        setCelebrationType(type);
        const messages = type === 'clockIn' ? clockInMessages : type === 'clockOut' ? clockOutMessages : breakMessages;
        setCelebrationMessage(messages[Math.floor(Math.random() * messages.length)]);
        setShowCelebration(true);
        setPulseEffect(true);
        
        setTimeout(() => setShowCelebration(false), 3000);
        setTimeout(() => setPulseEffect(false), 500);
    }, []);

    // Update elapsed time every second
    useEffect(() => {
        let interval: NodeJS.Timeout;

        if (status.isClockedIn && !status.isOnBreak) {
            const statusReceivedAt = (status as any)._receivedAt || Date.now();

            const updateTimer = () => {
                const now = Date.now();
                const currentSessionMs = now - statusReceivedAt;
                const totalMs = ((status.timeWorked as any)?.seconds ?? (status.timeWorked?.minutes || 0) * 60) * 1000 + currentSessionMs;

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
            const totalMinutes = status.timeWorked?.minutes || 0;
            const h = Math.floor(totalMinutes / 60);
            const m = Math.round(totalMinutes % 60);
            setElapsedTime(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00`);
        }

        return () => clearInterval(interval);
    }, [status]);

    const refreshStatus = async () => {
        try {
            const newStatus = await clockApi.getStatus();
            setStatus({ ...newStatus, _receivedAt: Date.now() } as any);
        } catch (error) {
            console.error('Failed to refresh status', error);
        }
    };

    useEffect(() => {
        refreshStatus();
        return clockApi.subscribe(refreshStatus);
    }, []);

    const getCurrentLocation = (): Promise<{ latitude: number; longitude: number; accuracy: number } | null> => {
        return new Promise((resolve) => {
            if (!navigator.geolocation) {
                console.warn('Geolocation not supported');
                resolve(null);
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    resolve({
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: position.coords.accuracy,
                    });
                },
                (error) => {
                    console.warn('Geolocation error:', error.message);
                    resolve(null);
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0,
                }
            );
        });
    };

    const handleClockIn = async () => {
        try {
            setLoading(true);
            setLocationError(null);
            setLoadingStep(1);
            setLoadingMessage('📍 Getting your location...');

            const location = await getCurrentLocation();

            setLoadingStep(2);
            setLoadingMessage('⚡ Clocking you in...');
            await clockApi.clockIn(undefined, location);
            
            setLoadingStep(3);
            setLoadingMessage('✨ Almost there...');
            await refreshStatus();
            
            celebrate('clockIn');
            if (onStatusChange) onStatusChange();
        } catch (error: any) {
            console.error('Clock in failed', error);
            const errorData = error.response?.data;
            
            if (errorData?.code === 'OUTSIDE_GEOFENCE') {
                setLocationError(`Clock-in blocked: ${errorData.details?.reason || 'You are outside the allowed office area'}`);
            } else {
                setLocationError(errorData?.error || 'Failed to clock in');
            }
        } finally {
            setLoading(false);
            setLoadingMessage(null);
            setLoadingStep(0);
        }
    };

    const handleClockOut = async () => {
        try {
            setLoading(true);
            setLocationError(null);
            setLoadingStep(1);
            setLoadingMessage('📍 Getting your location...');

            const location = await getCurrentLocation();

            setLoadingStep(2);
            setLoadingMessage('🏁 Wrapping up your day...');
            await clockApi.clockOut(undefined, location);
            
            setLoadingStep(3);
            setLoadingMessage('🎉 Finishing up...');
            await refreshStatus();
            
            celebrate('clockOut');
            if (onStatusChange) onStatusChange();
        } catch (error: any) {
            console.error('Clock out failed', error);
            setLocationError(error.response?.data?.error || 'Failed to clock out');
        } finally {
            setLoading(false);
            setLoadingMessage(null);
            setLoadingStep(0);
        }
    };

    const handleBreak = async () => {
        try {
            setLoading(true);
            setLoadingStep(1);
            setLoadingMessage(status.isOnBreak ? '💪 Getting back to work...' : '☕ Starting your break...');
            
            if (status.isOnBreak) {
                await clockApi.endBreak();
            } else {
                await clockApi.startBreak();
            }
            
            setLoadingStep(2);
            setLoadingMessage('✨ Updating...');
            await refreshStatus();
            
            if (!status.isOnBreak) celebrate('break');
            if (onStatusChange) onStatusChange();
        } catch (error) {
            console.error('Break toggle failed', error);
        } finally {
            setLoading(false);
            setLoadingMessage(null);
            setLoadingStep(0);
        }
    };

    const getTimeOfDayGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 12) return { text: 'Good morning', icon: Sun };
        if (hour < 17) return { text: 'Good afternoon', icon: Sun };
        return { text: 'Good evening', icon: Moon };
    };

    const greeting = getTimeOfDayGreeting();
    const GreetingIcon = greeting.icon;

    return (
        <div className="relative w-full">
            {/* Celebration Confetti */}
            {showCelebration && (
                <div className="absolute inset-0 overflow-hidden pointer-events-none z-50 rounded-2xl">
                    {[...Array(20)].map((_, i) => (
                        <Particle
                            key={i}
                            delay={i * 50}
                            color={
                                celebrationType === 'clockIn' 
                                    ? ['bg-teal-400', 'bg-emerald-400', 'bg-cyan-400'][i % 3]
                                    : celebrationType === 'clockOut'
                                        ? ['bg-purple-400', 'bg-pink-400', 'bg-indigo-400'][i % 3]
                                        : ['bg-amber-400', 'bg-orange-400', 'bg-yellow-400'][i % 3]
                            }
                        />
                    ))}
                </div>
            )}

            <div className={cn(
                "relative bg-zinc-900/80 border rounded-xl p-8 shadow-sm transition-colors duration-200",
                pulseEffect ? "border-teal-500/50" : "border-white/5"
            )}>
                {/* Celebration Message */}
                {showCelebration && (
                    <div className={cn(
                        "absolute -top-12 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-sm font-medium shadow-lg animate-bounce-in",
                        celebrationType === 'clockIn' 
                            ? "bg-gradient-to-r from-teal-500 to-emerald-500 text-white"
                            : celebrationType === 'clockOut'
                                ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white"
                                : "bg-gradient-to-r from-amber-500 to-orange-500 text-white"
                    )}>
                        <span className="flex items-center gap-2">
                            <PartyPopper className="h-4 w-4" />
                            {celebrationMessage}
                        </span>
                    </div>
                )}

                {/* Header Status */}
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                        <div className={cn(
                            "relative h-3 w-3 rounded-full",
                            status.isClockedIn && !status.isOnBreak 
                                ? "bg-emerald-500" 
                                : status.isOnBreak 
                                    ? "bg-amber-500" 
                                    : "bg-zinc-600"
                        )}>
                            {(status.isClockedIn || status.isOnBreak) && (
                                <span className={cn(
                                    "absolute inset-0 rounded-full animate-ping",
                                    status.isOnBreak ? "bg-amber-500" : "bg-emerald-500"
                                )} />
                            )}
                        </div>
                        <span className="font-medium text-zinc-300">
                            {status.isOnBreak ? 'On Break' :
                                status.isClockedIn ? 'Currently Working' : 'Not Clocked In'}
                        </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                        <GreetingIcon className="h-3.5 w-3.5" />
                        <span className="font-mono">
                            {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </span>
                    </div>
                </div>

                {/* Timer Display - Enhanced */}
                <div className="text-center mb-10">
                    <div className={cn(
                        "text-6xl font-bold font-mono tracking-wider transition-colors duration-200",
                        status.isClockedIn && !status.isOnBreak
                            ? "text-teal-400"
                            : status.isOnBreak
                                ? "text-amber-400"
                                : "text-zinc-500"
                    )}>
                        {elapsedTime}
                    </div>
                    <p className="text-sm text-zinc-500 mt-2 flex items-center justify-center gap-2">
                        {status.isClockedIn && <Zap className="h-3.5 w-3.5 text-teal-400 animate-pulse" />}
                        Total time today
                        {status.isClockedIn && <Zap className="h-3.5 w-3.5 text-teal-400 animate-pulse" />}
                    </p>
                </div>

                {/* Loading Status - Enhanced with steps */}
                {loading && loadingMessage && (
                    <div className="mb-4 p-4 bg-gradient-to-r from-teal-500/10 to-emerald-500/10 border border-teal-500/30 rounded-xl">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="relative">
                                <Loader2 className="h-5 w-5 text-teal-400 animate-spin" />
                                <Sparkles className="absolute -top-1 -right-1 h-3 w-3 text-yellow-400 animate-pulse" />
                            </div>
                            <p className="text-sm text-teal-400 font-medium">{loadingMessage}</p>
                        </div>
                        {/* Progress Steps */}
                        <div className="flex gap-2">
                            {[1, 2, 3].map((step) => (
                                <div
                                    key={step}
                                    className={cn(
                                        "h-1.5 flex-1 rounded-full transition-all duration-300",
                                        loadingStep >= step 
                                            ? "bg-gradient-to-r from-teal-400 to-emerald-400" 
                                            : "bg-zinc-700"
                                    )}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Location Error */}
                {locationError && (
                    <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl animate-shake">
                        <p className="text-sm text-red-400">{locationError}</p>
                    </div>
                )}

                {/* Action Buttons - Enhanced */}
                <div className="grid grid-cols-2 gap-4">
                    {!status.isClockedIn ? (
                        <button
                            onClick={handleClockIn}
                            disabled={loading}
                            className={cn(
                                "col-span-2 py-5 rounded-lg font-bold text-lg transition-colors duration-150 flex items-center justify-center gap-3",
                                loading 
                                    ? "bg-zinc-800 text-zinc-400 cursor-not-allowed" 
                                    : "bg-teal-600 hover:bg-teal-700 text-white"
                            )}
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="h-6 w-6 animate-spin" />
                                    <span>Processing...</span>
                                </>
                            ) : (
                                <>
                                    <Play className="h-6 w-6 fill-current" />
                                    <span>Clock In</span>
                                    <Sparkles className="h-5 w-5 animate-pulse" />
                                </>
                            )}
                        </button>
                    ) : (
                        <>
                            <button
                                onClick={handleClockOut}
                                disabled={loading}
                                className={cn(
                                    "py-4 rounded-lg font-bold transition-colors duration-150 flex items-center justify-center gap-2",
                                    loading 
                                        ? "bg-zinc-800 text-zinc-400 cursor-not-allowed" 
                                        : "bg-rose-600 hover:bg-rose-700 text-white"
                                )}
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                        <span className="text-sm">Processing...</span>
                                    </>
                                ) : (
                                    <>
                                        <Square className="h-5 w-5 fill-current" />
                                        <span>Clock Out</span>
                                        <Trophy className="h-4 w-4 animate-bounce" />
                                    </>
                                )}
                            </button>

                            <button
                                onClick={handleBreak}
                                disabled={loading}
                                className={cn(
                                    "py-4 rounded-lg font-bold transition-colors duration-150 flex items-center justify-center gap-2",
                                    loading 
                                        ? "bg-zinc-800 text-zinc-400 cursor-not-allowed border border-zinc-700"
                                        : status.isOnBreak
                                            ? "bg-zinc-700 text-white border border-zinc-600 hover:bg-zinc-600"
                                            : "bg-amber-600 hover:bg-amber-700 text-white"
                                )}
                            >
                                {loading ? (
                                    <Loader2 className="h-5 w-5 animate-spin" />
                                ) : status.isOnBreak ? (
                                    <>
                                        <Play className="h-5 w-5 fill-current animate-pulse" />
                                        <span>Resume</span>
                                    </>
                                ) : (
                                    <>
                                        <Coffee className="h-5 w-5" />
                                        <span>Break</span>
                                    </>
                                )}
                            </button>
                        </>
                    )}
                </div>

                {/* Quick Stats Hint */}
                {status.isClockedIn && !loading && (
                    <div className="mt-6 pt-4 border-t border-zinc-800/50 flex items-center justify-center gap-4 text-xs text-zinc-500">
                        <span className="flex items-center gap-1">
                            <Zap className="h-3 w-3 text-teal-400" />
                            Keep going!
                        </span>
                        <span className="text-zinc-700">•</span>
                        <span className="flex items-center gap-1">
                            <Trophy className="h-3 w-3 text-amber-400" />
                            Great progress today
                        </span>
                    </div>
                )}
            </div>

            {/* CSS for animations */}
            <style jsx>{`
                @keyframes confetti {
                    0% {
                        transform: translateY(0) rotate(0deg);
                        opacity: 1;
                    }
                    100% {
                        transform: translateY(300px) rotate(720deg);
                        opacity: 0;
                    }
                }
                .animate-confetti {
                    animation: confetti 1s ease-out forwards;
                }
                @keyframes bounce-in {
                    0% {
                        transform: translateX(-50%) scale(0);
                        opacity: 0;
                    }
                    50% {
                        transform: translateX(-50%) scale(1.1);
                    }
                    100% {
                        transform: translateX(-50%) scale(1);
                        opacity: 1;
                    }
                }
                .animate-bounce-in {
                    animation: bounce-in 0.4s ease-out forwards;
                }
                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    25% { transform: translateX(-5px); }
                    75% { transform: translateX(5px); }
                }
                .animate-shake {
                    animation: shake 0.3s ease-in-out;
                }
            `}</style>
        </div>
    );
}
