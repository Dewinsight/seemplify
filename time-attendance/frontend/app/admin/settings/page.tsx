'use client';

import { useEffect, useState } from 'react';
import { adminApi } from '@/lib/api';
import {
    Building2,
    MapPin,
    Clock,
    Save,
    BellRing
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [policy, setPolicy] = useState<any>({
        workSchedule: {
            workDays: [1, 2, 3, 4, 5],
            startTime: '09:00',
            endTime: '17:00'
        },
        overtime: {
            enabled: false,
            thresholdMinutes: 60,
            dailyLimitMinutes: 240
        },
        geofencing: {
            enabled: false,
            radiusMeters: 100,
            allowedLocations: []
        }
    });

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            setLoading(true);
            const data = await adminApi.getPolicy();
            if (data) setPolicy(data);
        } catch (error) {
            console.error('Failed to fetch settings', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            await adminApi.updatePolicy(policy);
            alert('Settings saved successfully');
        } catch (error) {
            console.error('Failed to save settings', error);
            alert('Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    const toggleDay = (dayIndex: number) => {
        const currentDays = policy.workSchedule.workDays || [];
        let newDays;
        if (currentDays.includes(dayIndex)) {
            newDays = currentDays.filter((d: number) => d !== dayIndex);
        } else {
            newDays = [...currentDays, dayIndex].sort();
        }
        setPolicy({
            ...policy,
            workSchedule: { ...policy.workSchedule, workDays: newDays }
        });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <div className="animate-spin h-8 w-8 border-2 border-teal-500 rounded-full border-t-transparent"></div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-500">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-white">Attendance Settings</h1>
                    <p className="text-zinc-400">Configure global policies for your organization</p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 px-6 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg font-medium transition-all shadow-lg shadow-teal-500/20 active:scale-95 disabled:opacity-50"
                >
                    <Save className="h-4 w-4" />
                    {saving ? 'Saving...' : 'Save Changes'}
                </button>
            </div>

            <div className="grid grid-cols-1 gap-8">

                {/* Work Schedule */}
                <section className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                            <Clock className="h-5 w-5" />
                        </div>
                        <h2 className="text-lg font-semibold text-white">Work Schedule</h2>
                    </div>

                    <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-zinc-400 mb-2">Default Start Time</label>
                                <input
                                    type="time"
                                    value={policy.workSchedule.startTime}
                                    onChange={(e) => setPolicy({ ...policy, workSchedule: { ...policy.workSchedule, startTime: e.target.value } })}
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-zinc-400 mb-2">Default End Time</label>
                                <input
                                    type="time"
                                    value={policy.workSchedule.endTime}
                                    onChange={(e) => setPolicy({ ...policy, workSchedule: { ...policy.workSchedule, endTime: e.target.value } })}
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-zinc-400 mb-3">Working Days</label>
                            <div className="flex flex-wrap gap-2">
                                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => (
                                    <button
                                        key={day}
                                        onClick={() => toggleDay(index)}
                                        className={cn(
                                            "w-10 h-10 rounded-lg text-sm font-medium transition-all",
                                            policy.workSchedule.workDays.includes(index)
                                                ? "bg-teal-500 text-white shadow-lg shadow-teal-500/20"
                                                : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-white"
                                        )}
                                    >
                                        {day}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                {/* Overtime Policy */}
                <section className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                                <BellRing className="h-5 w-5" />
                            </div>
                            <h2 className="text-lg font-semibold text-white">Overtime Rules</h2>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-zinc-400">Enabled</span>
                            <button
                                onClick={() => setPolicy({ ...policy, overtime: { ...policy.overtime, enabled: !policy.overtime.enabled } })}
                                className={cn(
                                    "w-12 h-6 rounded-full p-1 transition-colors relative",
                                    policy.overtime.enabled ? "bg-teal-500" : "bg-zinc-700"
                                )}
                            >
                                <div className={cn(
                                    "w-4 h-4 rounded-full bg-white transition-transform",
                                    policy.overtime.enabled ? "translate-x-6" : "translate-x-0"
                                )} />
                            </button>
                        </div>
                    </div>

                    {policy.overtime.enabled && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in slide-in-from-top-4">
                            <div>
                                <label className="block text-sm font-medium text-zinc-400 mb-2">Threshold (Minutes)</label>
                                <input
                                    type="number"
                                    value={policy.overtime.thresholdMinutes}
                                    onChange={(e) => setPolicy({ ...policy, overtime: { ...policy.overtime, thresholdMinutes: parseInt(e.target.value) } })}
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                                />
                                <p className="text-xs text-zinc-500 mt-1">Minimum extra time to count as OT</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-zinc-400 mb-2">Daily Limit (Minutes)</label>
                                <input
                                    type="number"
                                    value={policy.overtime.dailyLimitMinutes}
                                    onChange={(e) => setPolicy({ ...policy, overtime: { ...policy.overtime, dailyLimitMinutes: parseInt(e.target.value) } })}
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                                />
                                <p className="text-xs text-zinc-500 mt-1">Maximum allowed OT per day</p>
                            </div>
                        </div>
                    )}
                </section>

                {/* Geofencing */}
                <section className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6 opacity-60">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-red-500/10 text-red-400">
                                <MapPin className="h-5 w-5" />
                            </div>
                            <h2 className="text-lg font-semibold text-white">Geofencing</h2>
                        </div>
                        <span className="text-xs font-medium px-2 py-1 bg-zinc-800 rounded text-zinc-400">Coming Soon (v2)</span>
                    </div>
                    <p className="text-sm text-zinc-500">
                        Restrict clock-in capability to specific physical locations. This feature will be available in the next release.
                    </p>
                </section>

            </div>
        </div>
    );
}
