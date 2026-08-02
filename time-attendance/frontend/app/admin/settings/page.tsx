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
    XCircle
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
                    notifications: {
                        ...(data.policy.notifications || {}),
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
