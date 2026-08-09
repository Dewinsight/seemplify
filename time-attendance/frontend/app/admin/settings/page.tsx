'use client';

import { useEffect, useState } from 'react';
import { adminApi } from '@/lib/api';
import {
    Building2,
    MapPin,
    Clock,
    Save,
    BellRing,
    Mail,
    Plus,
    Trash2,
    Edit2,
    CheckCircle2,
    XCircle,
    Eye
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [policy, setPolicy] = useState<any>(null);
    const [showAddLocation, setShowAddLocation] = useState(false);
    const [newLocation, setNewLocation] = useState({
        name: '',
        address: '',
        latitude: 0,
        longitude: 0,
        radius: 100
    });

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            setLoading(true);
            const data = await adminApi.getPolicy();
            if (data?.policy) {
                const normalizedPolicy = {
                    ...data.policy,
                    timezone: data.policy.timezone || 'UTC',
                    workSchedule: {
                        ...(data.policy.workSchedule || {}),
                        defaultShift: {
                            name: 'Standard Shift',
                            startTime: data.policy.workSchedule?.defaultShift?.startTime || data.policy.workSchedule?.startTime || '09:00',
                            endTime: data.policy.workSchedule?.defaultShift?.endTime || data.policy.workSchedule?.endTime || '17:00',
                            breakDuration: data.policy.workSchedule?.defaultShift?.breakDuration ?? 60,
                        },
                    },
                    overtime: {
                        ...(data.policy.overtime || {}),
                        dailyThreshold: data.policy.overtime?.dailyThreshold ?? 8,
                        weeklyThreshold: data.policy.overtime?.weeklyThreshold ?? 40,
                    },
                    clockSettings: {
                        ...(data.policy.clockSettings || {}),
                        enforceClockInWindow: data.policy.clockSettings?.enforceClockInWindow ?? false,
                        earliestClockInMinutes: data.policy.clockSettings?.earliestClockInMinutes ?? 60,
                        latestClockInMinutes: data.policy.clockSettings?.latestClockInMinutes ?? 240,
                        nonWorkingDayClockIn: data.policy.clockSettings?.nonWorkingDayClockIn || 'warn',
                    },
                    breakRules: {
                        requiredAfterMinutes: data.policy.breakRules?.requiredAfterMinutes ?? 360,
                        minimumBreakMinutes: data.policy.breakRules?.minimumBreakMinutes ?? 20,
                        maximumContinuousWorkMinutes: data.policy.breakRules?.maximumContinuousWorkMinutes ?? 360,
                    },
                    timesheetSettings: {
                        ...(data.policy.timesheetSettings || {}),
                        periodType: data.policy.timesheetSettings?.periodType || 'weekly',
                        autoSubmit: data.policy.timesheetSettings?.autoSubmit === true,
                        autoApprove: data.policy.timesheetSettings?.autoApprove === true,
                        submissionDeadline: data.policy.timesheetSettings?.submissionDeadline ?? 2,
                        approvalDeadline: data.policy.timesheetSettings?.approvalDeadline ?? 3,
                        approvalLevels: data.policy.timesheetSettings?.approvalLevels?.length
                            ? data.policy.timesheetSettings.approvalLevels
                            : [{ name: 'Line manager', approverType: 'line_manager' }],
                    },
                    presence: {
                        enabled: data.policy.presence?.enabled !== false,
                        rawEventRetentionDays: data.policy.presence?.rawEventRetentionDays ?? 90,
                        dailySummaryRetentionDays: data.policy.presence?.dailySummaryRetentionDays ?? 730,
                    },
                    notifications: {
                        ...(data.policy.notifications || {}),
                        clockInReminder: data.policy.notifications?.clockInReminder !== false,
                        clockInReminderMinutesAfter: data.policy.notifications?.clockInReminderMinutesAfter ?? 15,
                        clockOutReminder: data.policy.notifications?.clockOutReminder !== false,
                        clockOutReminderMinutesAfter: data.policy.notifications?.clockOutReminderMinutesAfter ?? 0,
                        managerReports: {
                            enabled: data.policy.notifications?.managerReports?.enabled !== false,
                            frequency: data.policy.notifications?.managerReports?.frequency || 'weekly',
                            sendHourUtc: Number.isFinite(data.policy.notifications?.managerReports?.sendHourUtc)
                                ? data.policy.notifications.managerReports.sendHourUtc
                                : 9,
                            includeExcel: data.policy.notifications?.managerReports?.includeExcel !== false,
                        },
                    },
                };
                setPolicy(normalizedPolicy);
            }
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
        const currentDays = policy.workSchedule?.workDays || [];
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

    const handleAddLocation = async () => {
        if (!newLocation.name || !newLocation.latitude || !newLocation.longitude) {
            alert('Please fill in all required fields');
            return;
        }

        try {
            setSaving(true);
            await adminApi.addGeofenceLocation(newLocation);
            await fetchSettings(); // Refresh to get updated policy
            setShowAddLocation(false);
            setNewLocation({ name: '', address: '', latitude: 0, longitude: 0, radius: 100 });
        } catch (error: any) {
            console.error('Failed to add location', error);
            alert(error.response?.data?.error || 'Failed to add location');
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteLocation = async (index: number) => {
        if (!confirm('Are you sure you want to delete this location?')) return;

        try {
            setSaving(true);
            await adminApi.deleteGeofenceLocation(index);
            await fetchSettings();
        } catch (error: any) {
            console.error('Failed to delete location', error);
            alert(error.response?.data?.error || 'Failed to delete location');
        } finally {
            setSaving(false);
        }
    };

    const handleToggleLocation = async (index: number) => {
        const location = policy.geofencing.locations[index];
        try {
            setSaving(true);
            await adminApi.updateGeofenceLocation(index, {
                ...location,
                isActive: !location.isActive
            });
            await fetchSettings();
        } catch (error: any) {
            console.error('Failed to toggle location', error);
            alert(error.response?.data?.error || 'Failed to update location');
        } finally {
            setSaving(false);
        }
    };

    if (loading || !policy) {
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
                                    value={policy.workSchedule.defaultShift.startTime}
                                    onChange={(e) => setPolicy({ ...policy, workSchedule: { ...policy.workSchedule, defaultShift: { ...policy.workSchedule.defaultShift, startTime: e.target.value } } })}
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-zinc-400 mb-2">Default End Time</label>
                                <input
                                    type="time"
                                    value={policy.workSchedule.defaultShift.endTime}
                                    onChange={(e) => setPolicy({ ...policy, workSchedule: { ...policy.workSchedule, defaultShift: { ...policy.workSchedule.defaultShift, endTime: e.target.value } } })}
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
                                <label className="block text-sm font-medium text-zinc-400 mb-2">Daily threshold (hours)</label>
                                <input
                                    type="number"
                                    value={policy.overtime.dailyThreshold}
                                    onChange={(e) => setPolicy({ ...policy, overtime: { ...policy.overtime, dailyThreshold: Number(e.target.value) } })}
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                                />
                                <p className="text-xs text-zinc-500 mt-1">Hours worked before daily overtime begins</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-zinc-400 mb-2">Weekly threshold (hours)</label>
                                <input
                                    type="number"
                                    value={policy.overtime.weeklyThreshold}
                                    onChange={(e) => setPolicy({ ...policy, overtime: { ...policy.overtime, weeklyThreshold: Number(e.target.value) } })}
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                                />
                                <p className="text-xs text-zinc-500 mt-1">Hours worked before weekly overtime begins</p>
                            </div>
                        </div>
                    )}
                </section>

                <section className="bg-zinc-900/50 border border-white/5 rounded-xl p-6">
                    <div className="mb-5 flex items-center gap-3">
                        <Clock className="h-5 w-5 text-teal-400" />
                        <div>
                            <h2 className="text-lg font-semibold text-white">Timesheet workflow</h2>
                            <p className="text-sm text-zinc-500">Configure period boundaries and safe automation.</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                        <label className="text-sm text-zinc-400">Period
                            <select value={policy.timesheetSettings.periodType} onChange={(e) => setPolicy({ ...policy, timesheetSettings: { ...policy.timesheetSettings, periodType: e.target.value } })} className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-white">
                                <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="semi-monthly">Semi-monthly</option><option value="monthly">Monthly</option>
                            </select>
                        </label>
                        <label className="flex min-h-10 items-center gap-3 self-end text-sm text-zinc-300">
                            <input type="checkbox" checked={policy.timesheetSettings.autoSubmit} onChange={(e) => setPolicy({ ...policy, timesheetSettings: { ...policy.timesheetSettings, autoSubmit: e.target.checked } })} className="h-4 w-4 accent-teal-500" /> Auto-submit completed periods
                        </label>
                        <label className="flex min-h-10 items-center gap-3 self-end text-sm text-zinc-300">
                            <input type="checkbox" checked={policy.timesheetSettings.autoApprove} onChange={(e) => setPolicy({ ...policy, timesheetSettings: { ...policy.timesheetSettings, autoApprove: e.target.checked } })} className="h-4 w-4 accent-teal-500" /> Auto-approve valid submissions
                        </label>
                    </div>
                </section>

                <section className="bg-zinc-900/50 border border-white/5 rounded-xl p-6">
                    <div className="mb-6">
                        <h2 className="text-lg font-semibold text-white">Clock-in and break rules</h2>
                        <p className="text-sm text-zinc-500">Login never starts a shift. Employees must use an attendance clock action.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                        <label className="text-sm text-zinc-400">Timezone
                            <input value={policy.timezone} onChange={(e) => setPolicy({ ...policy, timezone: e.target.value })} placeholder="Europe/London" className="mt-2 w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white" />
                        </label>
                        <label className="text-sm text-zinc-400">Non-working day clock-in
                            <select value={policy.clockSettings.nonWorkingDayClockIn} onChange={(e) => setPolicy({ ...policy, clockSettings: { ...policy.clockSettings, nonWorkingDayClockIn: e.target.value } })} className="mt-2 w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white">
                                <option value="allow">Allow</option><option value="warn">Allow with warning</option><option value="block">Block</option>
                            </select>
                        </label>
                        <label className="flex items-center gap-3 self-end min-h-10 text-sm text-zinc-300">
                            <input type="checkbox" checked={policy.clockSettings.enforceClockInWindow} onChange={(e) => setPolicy({ ...policy, clockSettings: { ...policy.clockSettings, enforceClockInWindow: e.target.checked } })} className="h-4 w-4 accent-teal-500" /> Enforce clock-in window
                        </label>
                        <label className="text-sm text-zinc-400">Earliest clock-in (minutes before shift)
                            <input type="number" min={0} value={policy.clockSettings.earliestClockInMinutes} onChange={(e) => setPolicy({ ...policy, clockSettings: { ...policy.clockSettings, earliestClockInMinutes: Number(e.target.value) } })} className="mt-2 w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white" />
                        </label>
                        <label className="text-sm text-zinc-400">Latest clock-in (minutes after shift)
                            <input type="number" min={0} value={policy.clockSettings.latestClockInMinutes} onChange={(e) => setPolicy({ ...policy, clockSettings: { ...policy.clockSettings, latestClockInMinutes: Number(e.target.value) } })} className="mt-2 w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white" />
                        </label>
                        <label className="flex items-center gap-3 self-end min-h-10 text-sm text-zinc-300">
                            <input type="checkbox" checked={!!policy.clockSettings.requireNote} onChange={(e) => setPolicy({ ...policy, clockSettings: { ...policy.clockSettings, requireNote: e.target.checked } })} className="h-4 w-4 accent-teal-500" /> Require a clock-in note
                        </label>
                        <label className="text-sm text-zinc-400">Break required after (minutes)
                            <input type="number" min={0} value={policy.breakRules.requiredAfterMinutes} onChange={(e) => setPolicy({ ...policy, breakRules: { ...policy.breakRules, requiredAfterMinutes: Number(e.target.value) } })} className="mt-2 w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white" />
                        </label>
                        <label className="text-sm text-zinc-400">Minimum break (minutes)
                            <input type="number" min={0} value={policy.breakRules.minimumBreakMinutes} onChange={(e) => setPolicy({ ...policy, breakRules: { ...policy.breakRules, minimumBreakMinutes: Number(e.target.value) } })} className="mt-2 w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white" />
                        </label>
                        <label className="text-sm text-zinc-400">Maximum continuous work (minutes)
                            <input type="number" min={0} value={policy.breakRules.maximumContinuousWorkMinutes} onChange={(e) => setPolicy({ ...policy, breakRules: { ...policy.breakRules, maximumContinuousWorkMinutes: Number(e.target.value) } })} className="mt-2 w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white" />
                        </label>
                    </div>
                </section>

                <section className="border border-white/10 rounded-xl p-6">
                    <div className="flex items-center gap-3 mb-5">
                        <BellRing className="h-5 w-5 text-teal-400" />
                        <div>
                            <h2 className="text-lg font-semibold text-white">Clock reminders</h2>
                            <p className="text-sm text-zinc-500">Show the reminder in the hub and send the same reminder by email.</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="border border-zinc-800 rounded-lg p-4">
                            <label className="flex items-center gap-3 text-sm font-medium text-white">
                                <input type="checkbox" checked={policy.notifications.clockInReminder} onChange={(e) => setPolicy({ ...policy, notifications: { ...policy.notifications, clockInReminder: e.target.checked } })} className="h-4 w-4 accent-teal-500" />
                                Remind employees to clock in
                            </label>
                            <label className="block mt-4 text-sm text-zinc-400">Minutes after shift starts
                                <input type="number" min={0} max={240} value={policy.notifications.clockInReminderMinutesAfter} onChange={(e) => setPolicy({ ...policy, notifications: { ...policy.notifications, clockInReminderMinutesAfter: Number(e.target.value) } })} className="mt-2 w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white" />
                            </label>
                        </div>
                        <div className="border border-zinc-800 rounded-lg p-4">
                            <label className="flex items-center gap-3 text-sm font-medium text-white">
                                <input type="checkbox" checked={policy.notifications.clockOutReminder} onChange={(e) => setPolicy({ ...policy, notifications: { ...policy.notifications, clockOutReminder: e.target.checked } })} className="h-4 w-4 accent-teal-500" />
                                Remind employees to clock out
                            </label>
                            <label className="block mt-4 text-sm text-zinc-400">Minutes after shift ends
                                <input type="number" min={0} max={240} value={policy.notifications.clockOutReminderMinutesAfter} onChange={(e) => setPolicy({ ...policy, notifications: { ...policy.notifications, clockOutReminderMinutesAfter: Number(e.target.value) } })} className="mt-2 w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white" />
                            </label>
                        </div>
                    </div>
                </section>

                {/* Manager Reports */}
                <section className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-teal-500/10 text-teal-400">
                                <Mail className="h-5 w-5" />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-white">Manager Attendance Reports</h2>
                                <p className="text-sm text-zinc-500">Automated report emails to line managers</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-zinc-400">Enabled</span>
                            <button
                                onClick={() =>
                                    setPolicy({
                                        ...policy,
                                        notifications: {
                                            ...policy.notifications,
                                            managerReports: {
                                                ...policy.notifications.managerReports,
                                                enabled: !policy.notifications.managerReports.enabled,
                                            },
                                        },
                                    })
                                }
                                className={cn(
                                    "w-12 h-6 rounded-full p-1 transition-colors relative",
                                    policy.notifications?.managerReports?.enabled ? "bg-teal-500" : "bg-zinc-700"
                                )}
                            >
                                <div className={cn(
                                    "w-4 h-4 rounded-full bg-white transition-transform",
                                    policy.notifications?.managerReports?.enabled ? "translate-x-6" : "translate-x-0"
                                )} />
                            </button>
                        </div>
                    </div>

                    {policy.notifications?.managerReports?.enabled && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in slide-in-from-top-4">
                            <div>
                                <label className="block text-sm font-medium text-zinc-400 mb-2">Frequency</label>
                                <select
                                    value={policy.notifications.managerReports.frequency}
                                    onChange={(e) =>
                                        setPolicy({
                                            ...policy,
                                            notifications: {
                                                ...policy.notifications,
                                                managerReports: {
                                                    ...policy.notifications.managerReports,
                                                    frequency: e.target.value,
                                                },
                                            },
                                        })
                                    }
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                                >
                                    <option value="daily">Daily</option>
                                    <option value="weekly">Weekly (Default)</option>
                                    <option value="monthly">Monthly</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-zinc-400 mb-2">Send Hour (UTC)</label>
                                <input
                                    type="number"
                                    min={0}
                                    max={23}
                                    value={policy.notifications.managerReports.sendHourUtc}
                                    onChange={(e) =>
                                        setPolicy({
                                            ...policy,
                                            notifications: {
                                                ...policy.notifications,
                                                managerReports: {
                                                    ...policy.notifications.managerReports,
                                                    sendHourUtc: Math.max(0, Math.min(23, parseInt(e.target.value) || 0)),
                                                },
                                            },
                                        })
                                    }
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                                />
                            </div>

                            <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-800/50 border border-zinc-700 mt-7">
                                <div>
                                    <p className="text-sm font-medium text-white">Attach Excel Report</p>
                                    <p className="text-xs text-zinc-500">Include full team workbook in email</p>
                                </div>
                                <button
                                    onClick={() =>
                                        setPolicy({
                                            ...policy,
                                            notifications: {
                                                ...policy.notifications,
                                                managerReports: {
                                                    ...policy.notifications.managerReports,
                                                    includeExcel: !policy.notifications.managerReports.includeExcel,
                                                },
                                            },
                                        })
                                    }
                                    className={cn(
                                        "w-12 h-6 rounded-full p-1 transition-colors relative",
                                        policy.notifications?.managerReports?.includeExcel ? "bg-teal-500" : "bg-zinc-700"
                                    )}
                                >
                                    <div className={cn(
                                        "w-4 h-4 rounded-full bg-white transition-transform",
                                        policy.notifications?.managerReports?.includeExcel ? "translate-x-6" : "translate-x-0"
                                    )} />
                                </button>
                            </div>
                        </div>
                    )}
                </section>

                <section className="border border-white/10 rounded-xl p-6">
                    <div className="mb-5 flex items-center gap-3">
                        <Eye className="h-5 w-5 text-sky-400" />
                        <div>
                            <h2 className="text-lg font-semibold text-white">Application-presence evidence</h2>
                            <p className="text-sm text-zinc-500">Visible-session evidence only; never productivity scoring.</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                        <label className="flex min-h-10 items-center gap-3 text-sm text-zinc-300">
                            <input type="checkbox" checked={policy.presence.enabled} onChange={(e) => setPolicy({ ...policy, presence: { ...policy.presence, enabled: e.target.checked } })} className="h-4 w-4 accent-teal-500" /> Enable transparent presence reporting
                        </label>
                        <label className="text-sm text-zinc-400">Raw-event retention (days)
                            <input type="number" min={1} max={90} value={policy.presence.rawEventRetentionDays} onChange={(e) => setPolicy({ ...policy, presence: { ...policy.presence, rawEventRetentionDays: Math.min(90, Number(e.target.value)) } })} className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-white" />
                        </label>
                        <label className="text-sm text-zinc-400">Summary retention (days)
                            <input type="number" min={1} value={policy.presence.dailySummaryRetentionDays} onChange={(e) => setPolicy({ ...policy, presence: { ...policy.presence, dailySummaryRetentionDays: Number(e.target.value) } })} className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-white" />
                        </label>
                    </div>
                </section>

                {/* Geofencing */}
                <section className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
                                <MapPin className="h-5 w-5" />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-white">Geofencing</h2>
                                <p className="text-sm text-zinc-500">Restrict clock-in to specific locations</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-zinc-400">Enabled</span>
                            <button
                                onClick={() => setPolicy({ 
                                    ...policy, 
                                    geofencing: { 
                                        ...policy.geofencing, 
                                        enabled: !policy.geofencing?.enabled 
                                    } 
                                })}
                                className={cn(
                                    "w-12 h-6 rounded-full p-1 transition-colors relative",
                                    policy.geofencing?.enabled ? "bg-purple-500" : "bg-zinc-700"
                                )}
                            >
                                <div className={cn(
                                    "w-4 h-4 rounded-full bg-white transition-transform",
                                    policy.geofencing?.enabled ? "translate-x-6" : "translate-x-0"
                                )} />
                            </button>
                        </div>
                    </div>

                    {policy.geofencing?.enabled && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-4">
                            {/* Enforce Toggle */}
                            <div className="flex items-center justify-between p-4 bg-zinc-800/50 rounded-lg">
                                <div>
                                    <p className="font-medium text-white">Enforce Geofencing</p>
                                    <p className="text-sm text-zinc-400">Block clock-in if outside allowed locations</p>
                                </div>
                                <button
                                    onClick={() => setPolicy({ 
                                        ...policy, 
                                        geofencing: { 
                                            ...policy.geofencing, 
                                            enforced: !policy.geofencing?.enforced 
                                        } 
                                    })}
                                    className={cn(
                                        "w-12 h-6 rounded-full p-1 transition-colors relative",
                                        policy.geofencing?.enforced ? "bg-red-500" : "bg-zinc-700"
                                    )}
                                >
                                    <div className={cn(
                                        "w-4 h-4 rounded-full bg-white transition-transform",
                                        policy.geofencing?.enforced ? "translate-x-6" : "translate-x-0"
                                    )} />
                                </button>
                            </div>

                            {/* Locations List */}
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-sm font-medium text-zinc-300">Office Locations</h3>
                                    <button
                                        onClick={() => setShowAddLocation(!showAddLocation)}
                                        className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded-lg transition-colors"
                                    >
                                        <Plus className="h-4 w-4" />
                                        Add Location
                                    </button>
                                </div>

                                {/* Add Location Form */}
                                {showAddLocation && (
                                    <div className="p-4 bg-zinc-800/50 rounded-lg mb-4 space-y-3 border border-purple-500/30">
                                        <div className="grid grid-cols-2 gap-3">
                                            <input
                                                type="text"
                                                placeholder="Location Name *"
                                                value={newLocation.name}
                                                onChange={(e) => setNewLocation({ ...newLocation, name: e.target.value })}
                                                className="px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                            />
                                            <input
                                                type="text"
                                                placeholder="Address"
                                                value={newLocation.address}
                                                onChange={(e) => setNewLocation({ ...newLocation, address: e.target.value })}
                                                className="px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                            />
                                        </div>
                                        <div className="grid grid-cols-3 gap-3">
                                            <input
                                                type="number"
                                                step="0.000001"
                                                placeholder="Latitude *"
                                                value={newLocation.latitude || ''}
                                                onChange={(e) => setNewLocation({ ...newLocation, latitude: parseFloat(e.target.value) || 0 })}
                                                className="px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                            />
                                            <input
                                                type="number"
                                                step="0.000001"
                                                placeholder="Longitude *"
                                                value={newLocation.longitude || ''}
                                                onChange={(e) => setNewLocation({ ...newLocation, longitude: parseFloat(e.target.value) || 0 })}
                                                className="px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                            />
                                            <input
                                                type="number"
                                                placeholder="Radius (m)"
                                                value={newLocation.radius}
                                                onChange={(e) => setNewLocation({ ...newLocation, radius: parseInt(e.target.value) || 100 })}
                                                className="px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                            />
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={handleAddLocation}
                                                disabled={saving}
                                                className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
                                            >
                                                Add Location
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setShowAddLocation(false);
                                                    setNewLocation({ name: '', address: '', latitude: 0, longitude: 0, radius: 100 });
                                                }}
                                                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-sm rounded-lg transition-colors"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                        <p className="text-xs text-zinc-500">
                                            Tip: Use Google Maps to find exact coordinates. Right-click on a location and select the coordinates to copy.
                                        </p>
                                    </div>
                                )}

                                {/* Locations List */}
                                {(!policy.geofencing?.locations || policy.geofencing.locations.length === 0) ? (
                                    <div className="p-6 bg-zinc-800/30 border border-dashed border-zinc-700 rounded-lg text-center">
                                        <MapPin className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
                                        <p className="text-sm text-zinc-400">No office locations configured</p>
                                        <p className="text-xs text-zinc-500 mt-1">Add at least one location to enable geofencing</p>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {policy.geofencing.locations.map((location: any, index: number) => (
                                            <div
                                                key={index}
                                                className={cn(
                                                    "p-4 rounded-lg border transition-all",
                                                    location.isActive
                                                        ? "bg-zinc-800/50 border-zinc-700"
                                                        : "bg-zinc-800/20 border-zinc-800 opacity-50"
                                                )}
                                            >
                                                <div className="flex items-start justify-between">
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <h4 className="font-medium text-white">{location.name}</h4>
                                                            {location.isActive ? (
                                                                <CheckCircle2 className="h-4 w-4 text-green-400" />
                                                            ) : (
                                                                <XCircle className="h-4 w-4 text-zinc-600" />
                                                            )}
                                                        </div>
                                                        {location.address && (
                                                            <p className="text-sm text-zinc-400">{location.address}</p>
                                                        )}
                                                        <div className="flex items-center gap-4 mt-2 text-xs text-zinc-500">
                                                            <span>Lat: {location.latitude.toFixed(6)}</span>
                                                            <span>Lng: {location.longitude.toFixed(6)}</span>
                                                            <span className="text-purple-400">Radius: {location.radius}m</span>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => handleToggleLocation(index)}
                                                            disabled={saving}
                                                            className="p-2 hover:bg-zinc-700 rounded-lg transition-colors disabled:opacity-50"
                                                            title={location.isActive ? 'Disable' : 'Enable'}
                                                        >
                                                            {location.isActive ? (
                                                                <CheckCircle2 className="h-4 w-4 text-green-400" />
                                                            ) : (
                                                                <XCircle className="h-4 w-4 text-zinc-600" />
                                                            )}
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteLocation(index)}
                                                            disabled={saving}
                                                            className="p-2 hover:bg-red-500/10 text-red-400 rounded-lg transition-colors disabled:opacity-50"
                                                            title="Delete"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </section>

            </div>
        </div>
    );
}
