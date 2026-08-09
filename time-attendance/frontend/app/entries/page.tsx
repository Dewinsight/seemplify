'use client';

import { useState, useEffect } from 'react';
import { Clock, Play, Square, Coffee, Calendar, Filter, Plus, MapPin, CheckCircle2, XCircle } from 'lucide-react';
import { clockApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import ManualEntryModal from '@/components/ManualEntryModal';

interface TimeEntry {
    _id: string;
    entryType: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
    timestamp: string;
    note?: string;
    source: string;
    isManualEntry?: boolean;
    location?: {
        latitude?: number;
        longitude?: number;
        address?: string;
        accuracy?: number;
        verified?: boolean;
    };
}

export default function PunchLogPage() {
    const { user } = useAuth();
    const [entries, setEntries] = useState<TimeEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [dateFilter, setDateFilter] = useState('today');
    const [showManualEntryModal, setShowManualEntryModal] = useState(false);

    // Check if user can add manual entries (HR admin or manager)
    // Check both organization role and team roles (same logic as AppShell)
    const currentOrgRole = user?.currentOrganization?.role;
    const isManager = user?.teams?.some((t: any) =>
        t.organizationId === user?.currentOrganization?.id &&
        ['line_manager', 'team_lead'].includes(t.role)
    );
    const isAdmin = currentOrgRole && ['owner', 'admin', 'hr_manager', 'manager'].includes(currentOrgRole);
    const canAddManualEntry = isAdmin || isManager;

    useEffect(() => {
        fetchEntries();
    }, [dateFilter]);

    const fetchEntries = async () => {
        try {
            setLoading(true);
            const now = new Date();
            let startDate: string;
            const endDate: string = now.toISOString();

            switch (dateFilter) {
                case 'today':
                    startDate = new Date(now.setHours(0, 0, 0, 0)).toISOString();
                    break;
                case 'week':
                    const weekAgo = new Date();
                    weekAgo.setDate(weekAgo.getDate() - 7);
                    startDate = weekAgo.toISOString();
                    break;
                case 'month':
                    const monthAgo = new Date();
                    monthAgo.setMonth(monthAgo.getMonth() - 1);
                    startDate = monthAgo.toISOString();
                    break;
                default:
                    startDate = new Date(now.setHours(0, 0, 0, 0)).toISOString();
            }

            const response = await clockApi.getEntries(startDate, endDate);
            setEntries(response.entries || []);
        } catch (error) {
            console.error('Failed to fetch entries:', error);
        } finally {
            setLoading(false);
        }
    };

    const getEntryIcon = (type: string) => {
        switch (type) {
            case 'clock_in':
                return <Play className="h-4 w-4 fill-current text-emerald-400" />;
            case 'clock_out':
                return <Square className="h-4 w-4 fill-current text-red-400" />;
            case 'break_start':
                return <Coffee className="h-4 w-4 text-amber-400" />;
            case 'break_end':
                return <Play className="h-4 w-4 fill-current text-amber-400" />;
            default:
                return <Clock className="h-4 w-4 text-zinc-400" />;
        }
    };

    const getEntryLabel = (type: string) => {
        switch (type) {
            case 'clock_in':
                return 'Clocked In';
            case 'clock_out':
                return 'Clocked Out';
            case 'break_start':
                return 'Break Started';
            case 'break_end':
                return 'Break Ended';
            default:
                return type;
        }
    };

    const getEntryColor = (type: string) => {
        switch (type) {
            case 'clock_in':
                return 'border-emerald-500/30 bg-emerald-500/5';
            case 'clock_out':
                return 'border-red-500/30 bg-red-500/5';
            case 'break_start':
            case 'break_end':
                return 'border-amber-500/30 bg-amber-500/5';
            default:
                return 'border-zinc-700 bg-zinc-800/50';
        }
    };

    const formatTime = (timestamp: string) => {
        return new Date(timestamp).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
        });
    };

    const formatDate = (timestamp: string) => {
        return new Date(timestamp).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
        });
    };

    // Group entries by date
    const groupedEntries = entries.reduce((groups: Record<string, TimeEntry[]>, entry) => {
        const date = formatDate(entry.timestamp);
        if (!groups[date]) {
            groups[date] = [];
        }
        groups[date].push(entry);
        return groups;
    }, {});

    return (
        <div className="max-w-4xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-white">Punch Log</h1>
                    <p className="text-zinc-400 mt-1">View your clock in/out history</p>
                </div>

                <div className="flex items-center gap-3">
                    {/* Filter Buttons */}
                    <div className="flex items-center gap-2 bg-zinc-800/50 rounded-lg p-1">
                        {['today', 'week', 'month'].map((filter) => (
                            <button
                                key={filter}
                                onClick={() => setDateFilter(filter)}
                                className={cn(
                                    'px-4 py-2 rounded-md text-sm font-medium transition-all',
                                    dateFilter === filter
                                        ? 'bg-teal-500 text-white'
                                        : 'text-zinc-400 hover:text-white hover:bg-zinc-700'
                                )}
                            >
                                {filter.charAt(0).toUpperCase() + filter.slice(1)}
                            </button>
                        ))}
                    </div>

                    {/* Add Manual Entry Button */}
                    {canAddManualEntry && (
                        <button
                            onClick={() => setShowManualEntryModal(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg font-medium transition-colors"
                        >
                            <Plus className="h-4 w-4" />
                            Add Manual Entry
                        </button>
                    )}
                </div>
            </div>

            {/* Entries List */}
            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-teal-500" />
                </div>
            ) : entries.length === 0 ? (
                <div className="text-center py-20">
                    <Clock className="h-12 w-12 text-zinc-600 mx-auto mb-4" />
                    <p className="text-zinc-400">No punch entries found for this period</p>
                </div>
            ) : (
                <div className="space-y-6">
                    {Object.entries(groupedEntries).map(([date, dayEntries]) => (
                        <div key={date}>
                            <h3 className="text-sm font-medium text-zinc-500 mb-3 flex items-center gap-2">
                                <Calendar className="h-4 w-4" />
                                {date}
                            </h3>
                            <div className="space-y-2">
                                {dayEntries.map((entry) => (
                                    <div
                                        key={entry._id}
                                        className={cn(
                                            'flex items-center justify-between p-4 rounded-xl border transition-all hover:scale-[1.01]',
                                            getEntryColor(entry.entryType)
                                        )}
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="p-2 rounded-lg bg-zinc-800/80">
                                                {getEntryIcon(entry.entryType)}
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <p className="font-medium text-white">
                                                        {getEntryLabel(entry.entryType)}
                                                    </p>
                                                    {entry.isManualEntry && (
                                                        <span className="px-2 py-0.5 text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded">
                                                            Manual
                                                        </span>
                                                    )}
                                                </div>
                                                {entry.note && (
                                                    <p className="text-sm text-zinc-400 mt-1">
                                                        {entry.note}
                                                    </p>
                                                )}
                                                {/* Location Display */}
                                                {entry.location?.latitude && entry.location?.longitude && (
                                                    <div className="flex items-center gap-2 mt-2">
                                                        <MapPin className="h-3.5 w-3.5 text-zinc-500" />
                                                        <div className="flex items-center gap-2">
                                                            <a
                                                                href={`https://www.google.com/maps?q=${entry.location.latitude},${entry.location.longitude}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="text-xs text-teal-400 hover:text-teal-300 underline"
                                                            >
                                                                {entry.location.address || `${entry.location.latitude.toFixed(6)}, ${entry.location.longitude.toFixed(6)}`}
                                                            </a>
                                                            {entry.location.verified !== undefined && (
                                                                entry.location.verified ? (
                                                                    <CheckCircle2 className="h-3.5 w-3.5 text-green-400" aria-label="Location verified within geofence" />
                                                                ) : (
                                                                    <XCircle className="h-3.5 w-3.5 text-amber-400" aria-label="Location outside geofence" />
                                                                )
                                                            )}
                                                            {entry.location.accuracy && (
                                                                <span className="text-xs text-zinc-500">
                                                                    (±{Math.round(entry.location.accuracy)}m)
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-lg font-mono text-white">
                                                {formatTime(entry.timestamp)}
                                            </p>
                                            <p className="text-xs text-zinc-500 capitalize">
                                                via {entry.source}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Manual Entry Modal */}
            <ManualEntryModal
                isOpen={showManualEntryModal}
                onClose={() => setShowManualEntryModal(false)}
                onSuccess={() => {
                    fetchEntries();
                }}
            />
        </div>
    );
}
