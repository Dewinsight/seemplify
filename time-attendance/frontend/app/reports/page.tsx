'use client';

import { useEffect, useState } from 'react';
import { reportsApi } from '@/lib/api';
import {
    BarChart3,
    Download,
    Calendar,
    Users,
    Clock,
    AlertTriangle,
    MapPin,
    Shield,
    TrendingUp
} from 'lucide-react';
import { format } from 'date-fns';

export default function ReportsPage() {
    const [activeTab, setActiveTab] = useState<'attendance' | 'overtime' | 'lateness' | 'geofence-violations' | 'location-accuracy' | 'location-history' | 'analytics' | 'capacity'>('attendance');
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [month, setMonth] = useState(new Date());
    const [selectedUserId, setSelectedUserId] = useState<string>('');

    useEffect(() => {
        fetchReport();
    }, [activeTab, month, selectedUserId]);

    const fetchReport = async () => {
        try {
            setLoading(true);
            const start = new Date(month.getFullYear(), month.getMonth(), 1).toISOString();
            const end = new Date(month.getFullYear(), month.getMonth() + 1, 0).toISOString();

            let response;
            switch (activeTab) {
                case 'attendance':
                    response = await reportsApi.getMonthlyAttendance(start, end);
                    break;
                case 'overtime':
                    response = await reportsApi.getOvertime(start, end);
                    break;
                case 'lateness':
                    response = await reportsApi.getLateness(start, end);
                    break;
                case 'geofence-violations':
                    response = await reportsApi.getGeofenceViolations(start, end, selectedUserId || undefined);
                    break;
                case 'location-accuracy':
                    response = await reportsApi.getLocationAccuracy(start, end);
                    break;
                case 'location-history':
                    if (!selectedUserId) {
                        setData(null);
                        return;
                    }
                    response = await reportsApi.getLocationHistory(selectedUserId, start, end);
                    break;
                case 'analytics':
                    response = await reportsApi.getAnalytics(start, end);
                    break;
                case 'capacity':
                    response = await reportsApi.getCapacityForecast(start, end);
                    break;
            }
            setData(response);
        } catch (error) {
            console.error('Failed to fetch report', error);
        } finally {
            setLoading(false);
        }
    };

    const handleExport = async () => {
        try {
            const start = new Date(month.getFullYear(), month.getMonth(), 1).toISOString();
            const end = new Date(month.getFullYear(), month.getMonth() + 1, 0).toISOString();
            const { blob, filename } = await reportsApi.exportAttendance(start, end);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Failed to export attendance report', error);
            alert('Attendance export could not be generated.');
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white">Reports & Analytics</h1>
                    <p className="text-zinc-400">Generate insights on attendance, overtime, and punctuality</p>
                </div>
                <button
                    onClick={handleExport}
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors border border-zinc-700"
                >
                    <Download className="h-4 w-4" />
                    Export CSV
                </button>
            </div>

            {/* Controls */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-zinc-900/50 border border-white/5 p-2 rounded-xl">
                <div className="flex bg-zinc-950 p-1 rounded-lg border border-zinc-800 w-full sm:w-auto overflow-x-auto">
                    {([
                        { key: 'attendance', label: 'Attendance', icon: undefined },
                        { key: 'overtime', label: 'Overtime', icon: undefined },
                        { key: 'lateness', label: 'Lateness', icon: undefined },
                        { key: 'geofence-violations', label: 'Geofence Violations', icon: Shield },
                        { key: 'location-accuracy', label: 'Location Accuracy', icon: TrendingUp },
                        { key: 'location-history', label: 'Location History', icon: MapPin },
                        { key: 'analytics', label: 'Operations', icon: BarChart3 },
                        { key: 'capacity', label: 'Capacity', icon: TrendingUp },
                    ] as const).map(({ key, label, icon: Icon }) => (
                        <button
                            key={key}
                            onClick={() => setActiveTab(key as any)}
                            className={`flex items-center gap-1.5 flex-1 sm:flex-none px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === key
                                    ? 'bg-zinc-800 text-white shadow-sm'
                                    : 'text-zinc-400 hover:text-white'
                                }`}
                        >
                            {Icon && <Icon className="h-3.5 w-3.5" />}
                            <span className="whitespace-nowrap">{label}</span>
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                    {activeTab === 'location-history' && (
                        <input
                            type="text"
                            placeholder="User ID (required)"
                            value={selectedUserId}
                            onChange={(e) => setSelectedUserId(e.target.value)}
                            className="w-full sm:w-auto bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                        />
                    )}
                    <div className="relative w-full sm:w-auto">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                        <input
                            type="month"
                            value={format(month, 'yyyy-MM')}
                            onChange={(e) => setMonth(new Date(e.target.value))}
                            className="w-full sm:w-auto bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-4 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                        />
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6 min-h-[400px]">
                {loading ? (
                    <div className="flex items-center justify-center h-full min-h-[300px]">
                        <div className="animate-spin h-8 w-8 border-2 border-teal-500 rounded-full border-t-transparent"></div>
                    </div>
                ) : !data || (Array.isArray(data) && data.length === 0) || (data.report && data.report.length === 0) || (data.violations && data.violations.length === 0) ? (
                    <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-zinc-500 gap-4">
                        <div className="p-4 rounded-full bg-zinc-800/50">
                            <BarChart3 className="h-8 w-8 text-zinc-600" />
                        </div>
                        <p>No data available for this period</p>
                    </div>
                ) : (
                    <div className="space-y-6">

                        {/* Conditional Rendering based on Report Type */}
                        {activeTab === 'attendance' && (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs text-zinc-500 uppercase bg-zinc-950/50 border-b border-zinc-800">
                                        <tr>
                                            <th className="px-4 py-3">Employee</th>
                                            <th className="px-4 py-3">Department</th>
                                            <th className="px-4 py-3 text-right">Present Days</th>
                                            <th className="px-4 py-3 text-right">Avg Start</th>
                                            <th className="px-4 py-3 text-right">Avg End</th>
                                            <th className="px-4 py-3 text-right">Total Hours</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-800/50">
                                        {(data.report || data || []).map((row: any, i: number) => (
                                            <tr key={i} className="hover:bg-zinc-800/30">
                                                <td className="px-4 py-3 font-medium text-white">{row.userName || row.user?.name || 'Unknown'}</td>
                                                <td className="px-4 py-3 text-zinc-400">{row.teamName || row.user?.department || 'N/A'}</td>
                                                <td className="px-4 py-3 text-right text-emerald-400">{row.daysWorked ?? row.presentDays ?? 0}</td>
                                                <td className="px-4 py-3 text-right text-zinc-300">{row.avgStartTime || '--:--'}</td>
                                                <td className="px-4 py-3 text-right text-zinc-300">{row.avgEndTime || '--:--'}</td>
                                                <td className="px-4 py-3 text-right font-mono text-white">{Number(row.totalHours ?? Number(row.totalMinutes || 0) / 60).toFixed(2)}h</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {activeTab === 'overtime' && (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs text-zinc-500 uppercase bg-zinc-950/50 border-b border-zinc-800">
                                        <tr>
                                            <th className="px-4 py-3">Employee</th>
                                            <th className="px-4 py-3 text-right">OT Hours</th>
                                            <th className="px-4 py-3 text-right">Days with OT</th>
                                            <th className="px-4 py-3 text-right">Max OT (Single Day)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-800/50">
                                        {(data.report || data || []).map((row: any, i: number) => (
                                            <tr key={i} className="hover:bg-zinc-800/30">
                                                <td className="px-4 py-3 font-medium text-white">{row.userName || row.user?.name || 'Unknown'}</td>
                                                <td className="px-4 py-3 text-right text-amber-400 font-bold">{Number(row.totalOvertimeHours ?? Number(row.totalOvertimeMinutes || 0) / 60).toFixed(2)}h</td>
                                                <td className="px-4 py-3 text-right text-zinc-300">{row.occurrences ?? row.overtimeDays ?? 0}</td>
                                                <td className="px-4 py-3 text-right text-zinc-300">—</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {activeTab === 'lateness' && (
                            <div className="grid grid-cols-1 gap-4">
                                {(data.report || data || []).map((row: any, i: number) => (
                                    <div key={i} className="flex items-center justify-between p-4 bg-zinc-950/50 border border-zinc-800 rounded-lg">
                                        <div className="flex items-center gap-4">
                                            <div className="p-2 bg-red-500/10 text-red-500 rounded-lg">
                                                <Clock className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <div className="font-medium text-white">{row.userName || row.user?.name || 'Unknown'}</div>
                                                <div className="text-xs text-zinc-500">{row.lateDays} Late Arrivals</div>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-lg font-bold text-red-400">{row.lateDays || 0}</div>
                                            <div className="text-xs text-zinc-500">Late days</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {activeTab === 'geofence-violations' && data && (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                                    <div>
                                        <div className="text-sm font-medium text-amber-400">Total Violations</div>
                                        <div className="text-2xl font-bold text-white mt-1">{data.totalViolations || 0}</div>
                                    </div>
                                    <Shield className="h-8 w-8 text-amber-400" />
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left">
                                        <thead className="text-xs text-zinc-500 uppercase bg-zinc-950/50 border-b border-zinc-800">
                                            <tr>
                                                <th className="px-4 py-3">Employee</th>
                                                <th className="px-4 py-3">Team</th>
                                                <th className="px-4 py-3 text-right">Violations</th>
                                                <th className="px-4 py-3">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-800/50">
                                            {data.violations?.map((violation: any, i: number) => (
                                                <tr key={i} className="hover:bg-zinc-800/30">
                                                    <td className="px-4 py-3 font-medium text-white">{violation.userName || violation.userEmail}</td>
                                                    <td className="px-4 py-3 text-zinc-400">{violation.teamName || 'N/A'}</td>
                                                    <td className="px-4 py-3 text-right text-amber-400 font-bold">{violation.violationCount}</td>
                                                    <td className="px-4 py-3">
                                                        <button
                                                            onClick={() => {
                                                                setSelectedUserId(violation._id);
                                                                setActiveTab('location-history');
                                                            }}
                                                            className="text-xs text-teal-400 hover:text-teal-300 underline"
                                                        >
                                                            View Details
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {activeTab === 'location-accuracy' && data && (
                            <div className="space-y-6">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="bg-zinc-950/50 border border-zinc-800 rounded-lg p-4">
                                        <div className="text-xs text-zinc-500 mb-1">Total Entries</div>
                                        <div className="text-xl font-bold text-white">{data.summary?.totalEntries || 0}</div>
                                    </div>
                                    <div className="bg-zinc-950/50 border border-zinc-800 rounded-lg p-4">
                                        <div className="text-xs text-zinc-500 mb-1">Avg Accuracy</div>
                                        <div className="text-xl font-bold text-white">{data.summary?.avgAccuracy ? `${Math.round(data.summary.avgAccuracy)}m` : 'N/A'}</div>
                                    </div>
                                    <div className="bg-zinc-950/50 border border-zinc-800 rounded-lg p-4">
                                        <div className="text-xs text-zinc-500 mb-1">Poor Accuracy</div>
                                        <div className="text-xl font-bold text-red-400">{data.summary?.poorAccuracyCount || 0}</div>
                                    </div>
                                    <div className="bg-zinc-950/50 border border-zinc-800 rounded-lg p-4">
                                        <div className="text-xs text-zinc-500 mb-1">Verified</div>
                                        <div className="text-xl font-bold text-green-400">{data.summary?.verifiedCount || 0}</div>
                                    </div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left">
                                        <thead className="text-xs text-zinc-500 uppercase bg-zinc-950/50 border-b border-zinc-800">
                                            <tr>
                                                <th className="px-4 py-3">Employee</th>
                                                <th className="px-4 py-3 text-right">Avg Accuracy</th>
                                                <th className="px-4 py-3 text-right">Entries</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-800/50">
                                            {data.byUser?.map((user: any, i: number) => (
                                                <tr key={i} className="hover:bg-zinc-800/30">
                                                    <td className="px-4 py-3 font-medium text-white">{user.userName || user.userEmail}</td>
                                                    <td className="px-4 py-3 text-right text-zinc-300">{Math.round(user.avgAccuracy)}m</td>
                                                    <td className="px-4 py-3 text-right text-zinc-400">{user.entryCount}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {activeTab === 'location-history' && data && (
                            <div className="space-y-4">
                                <div className="text-sm text-zinc-400">
                                    Showing {data.totalEntries} location entries
                                </div>
                                <div className="space-y-2">
                                    {Object.entries(data.groupedByDate || {}).map(([date, entries]: [string, any]) => (
                                        <div key={date} className="bg-zinc-950/50 border border-zinc-800 rounded-lg p-4">
                                            <div className="text-sm font-medium text-zinc-300 mb-3">{format(new Date(date), 'MMMM d, yyyy')}</div>
                                            <div className="space-y-2">
                                                {entries.map((entry: any, i: number) => (
                                                    <div key={i} className="flex items-center justify-between p-2 bg-zinc-900/50 rounded">
                                                        <div className="flex items-center gap-3">
                                                            <MapPin className="h-4 w-4 text-teal-400" />
                                                            <div>
                                                                <div className="text-sm text-white capitalize">{entry.entryType.replace('_', ' ')}</div>
                                                                {entry.location?.address && (
                                                                    <div className="text-xs text-zinc-400">{entry.location.address}</div>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <a
                                                                href={`https://www.google.com/maps?q=${entry.location?.latitude},${entry.location?.longitude}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="text-xs text-teal-400 hover:text-teal-300 underline"
                                                            >
                                                                {entry.location?.latitude?.toFixed(6)}, {entry.location?.longitude?.toFixed(6)}
                                                            </a>
                                                            <div className="text-xs text-zinc-500 mt-1">
                                                                {format(new Date(entry.timestamp), 'HH:mm')}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {activeTab === 'analytics' && data && (
                            <div className="grid gap-6 lg:grid-cols-2">
                                <div><h3 className="text-sm font-semibold text-white">Exception queue</h3><div className="mt-3 space-y-2">{data.exceptions?.map((row: any) => <div key={`${row._id.type}-${row._id.status}`} className="flex justify-between rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm"><span className="capitalize text-zinc-300">{row._id.type.replaceAll('_', ' ')} · {row._id.status.replaceAll('_', ' ')}</span><span className="text-zinc-500">{row.count}</span></div>)}</div></div>
                                <div><h3 className="text-sm font-semibold text-white">Timesheet aging</h3><div className="mt-3 space-y-2">{data.timesheetAging?.slice(0, 12).map((row: any) => <div key={row._id} className="flex justify-between rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm"><span className="text-zinc-300">{row.userName || row.userId} · {row.status}</span><span className={row.ageDays > 7 ? 'text-amber-400' : 'text-zinc-500'}>{row.ageDays} days</span></div>)}</div></div>
                                <div><h3 className="text-sm font-semibold text-white">Payroll transfer</h3><div className="mt-3 flex flex-wrap gap-3">{data.payrollTransfers?.map((row: any) => <div key={row._id || 'unknown'} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3"><div className="text-xs text-zinc-500">{row._id || 'not queued'}</div><div className="mt-1 text-lg font-semibold text-white">{row.count}</div></div>)}</div></div>
                                <div><h3 className="text-sm font-semibold text-white">Presence evidence health</h3><p className="mt-1 text-xs text-zinc-500">Availability only—never productivity scoring.</p><div className="mt-3 space-y-2">{data.presenceEvidenceHealth?.map((row: any) => <div key={`${row._id.appId}-${row._id.status}`} className="flex justify-between text-sm"><span className="text-zinc-300">{row._id.appId} · {row._id.status}</span><span className="text-zinc-500">{row.sessions} sessions</span></div>)}</div></div>
                            </div>
                        )}

                        {activeTab === 'capacity' && data && (
                            <div><div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-950/50 p-4 text-sm text-zinc-400">{data.explanation}</div><div className="space-y-2">{data.rows?.map((row: any) => <div key={row._id} className="flex items-center justify-between rounded-lg border border-zinc-800 px-4 py-3"><div><div className="text-sm font-medium text-white">{row._id}</div><div className="mt-1 text-xs text-zinc-500">{row.shiftCount} shifts · threshold {Number(data.thresholdHours).toFixed(1)}h</div></div><div className={`text-sm font-semibold ${row.warning ? 'text-amber-400' : 'text-teal-400'}`}>{Number(row.scheduledHours).toFixed(1)}h{row.warning ? ` (+${Number(row.excessHours).toFixed(1)}h)` : ''}</div></div>)}</div></div>
                        )}

                    </div>
                )}
            </div>
        </div>
    );
}
