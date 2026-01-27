'use client';

import { useState } from 'react';
import { X, Clock, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { clockApi } from '@/lib/api';

interface ManualEntryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export default function ManualEntryModal({ isOpen, onClose, onSuccess }: ManualEntryModalProps) {
    const [entryType, setEntryType] = useState<'clock_in' | 'clock_out' | 'break_start' | 'break_end'>('clock_in');
    const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [time, setTime] = useState(format(new Date(), 'HH:mm'));
    const [note, setNote] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        // Validation
        if (note.trim().length < 10) {
            setError('Please provide an explanation note (minimum 10 characters)');
            return;
        }

        // Combine date and time
        const timestamp = new Date(`${date}T${time}:00`);

        // Check if future
        if (timestamp > new Date()) {
            setError('Cannot add entries for future times');
            return;
        }

        setLoading(true);

        try {
            await clockApi.createManualEntry({
                entryType,
                timestamp: timestamp.toISOString(),
                note: note.trim(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });

            onSuccess();
            onClose();
            
            // Reset form
            setEntryType('clock_in');
            setDate(format(new Date(), 'yyyy-MM-dd'));
            setTime(format(new Date(), 'HH:mm'));
            setNote('');
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to create manual entry');
        } finally {
            setLoading(false);
        }
    };

    const getEntryTypeLabel = (type: string) => {
        const labels = {
            'clock_in': 'Clock In',
            'clock_out': 'Clock Out',
            'break_start': 'Break Start',
            'break_end': 'Break End',
        };
        return labels[type as keyof typeof labels] || type;
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-zinc-900 rounded-lg shadow-xl max-w-md w-full border border-zinc-800 animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-zinc-800">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-teal-500/10">
                            <Clock className="h-5 w-5 text-teal-400" />
                        </div>
                        <h2 className="text-xl font-semibold text-white">Add Manual Entry</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-zinc-800 rounded-lg transition-colors"
                    >
                        <X className="h-5 w-5 text-zinc-400" />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {/* Entry Type */}
                    <div>
                        <label className="block text-sm font-medium text-zinc-300 mb-2">
                            Entry Type
                        </label>
                        <select
                            value={entryType}
                            onChange={(e) => setEntryType(e.target.value as any)}
                            className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                        >
                            <option value="clock_in">Clock In</option>
                            <option value="clock_out">Clock Out</option>
                            <option value="break_start">Break Start</option>
                            <option value="break_end">Break End</option>
                        </select>
                    </div>

                    {/* Date */}
                    <div>
                        <label className="block text-sm font-medium text-zinc-300 mb-2">
                            Date
                        </label>
                        <div className="relative">
                            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-zinc-400" />
                            <input
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                max={format(new Date(), 'yyyy-MM-dd')}
                                required
                                className="w-full pl-10 pr-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                            />
                        </div>
                    </div>

                    {/* Time */}
                    <div>
                        <label className="block text-sm font-medium text-zinc-300 mb-2">
                            Time
                        </label>
                        <div className="relative">
                            <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-zinc-400" />
                            <input
                                type="time"
                                value={time}
                                onChange={(e) => setTime(e.target.value)}
                                required
                                className="w-full pl-10 pr-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                            />
                        </div>
                    </div>

                    {/* Note */}
                    <div>
                        <label className="block text-sm font-medium text-zinc-300 mb-2">
                            Explanation Note <span className="text-zinc-500">(required, min 10 chars)</span>
                        </label>
                        <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Explain why this manual entry is needed..."
                            rows={3}
                            required
                            minLength={10}
                            className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                        />
                        <p className="text-xs text-zinc-500 mt-1">
                            {note.length}/10 characters
                        </p>
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                            <p className="text-sm text-red-400">{error}</p>
                        </div>
                    )}

                    {/* Info Message */}
                    <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                        <p className="text-xs text-amber-400">
                            Manual entries are marked in the system and include an audit trail showing who created them and why.
                        </p>
                    </div>

                    {/* Buttons */}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={loading}
                            className="flex-1 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading || note.length < 10}
                            className="flex-1 px-4 py-2.5 bg-teal-600 hover:bg-teal-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? 'Creating...' : 'Add Entry'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
