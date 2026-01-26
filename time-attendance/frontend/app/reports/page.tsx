'use client';

import { useEffect, useState } from 'react';
import { reportsApi } from '@/lib/api';
import {
    BarChart3,
    Download,
    Calendar,
    Users,
    Clock,
    AlertTriangle
} from 'lucide-react';
import { format } from 'date-fns';

export default function ReportsPage() {
    const [activeTab, setActiveTab] = useState<'attendance' | 'overtime' | 'lateness'>('attendance');
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [month, setMonth] = useState(new Date());

    useEffect(() => {
        fetchReport();
    }, [activeTab, month]);

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
            }
            setData(response);
        } catch (error) {
            console.error('Failed to fetch report', error);
        } finally {
            setLoading(false);
        }
    };

    const handleExport = () => {
        // In a real app, this would trigger a CSV/PDF download
        alert('Report export started...');
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
                <div className="flex bg-zinc-950 p-1 rounded-lg border border-zinc-800 w-full sm:w-auto">
                    {(['attendance', 'overtime', 'lateness'] as const).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`flex-1 sm:flex-none px-4 py-1.5 rounded-md text-sm font-medium transition-all capitalize ${activeTab === tab
                                    ? 'bg-zinc-800 text-white shadow-sm'
                                    : 'text-zinc-400 hover:text-white'
                                }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
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
                ) : !data || (Array.isArray(data) && data.length === 0) ? (
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
                                        {data.map((row: any, i: number) => (
                                            <tr key={i} className="hover:bg-zinc-800/30">
                                                <td className="px-4 py-3 font-medium text-white">{row.user?.name || 'Unknown'}</td>
                                                <td className="px-4 py-3 text-zinc-400">{row.user?.department || 'N/A'}</td>
                                                <td className="px-4 py-3 text-right text-emerald-400">{row.presentDays}</td>
                                                <td className="px-4 py-3 text-right text-zinc-300">{row.avgStartTime || '--:--'}</td>
                                                <td className="px-4 py-3 text-right text-zinc-300">{row.avgEndTime || '--:--'}</td>
                                                <td className="px-4 py-3 text-right font-mono text-white">{Math.round(row.totalMinutes / 60)}h</td>
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
                                        {data.map((row: any, i: number) => (
                                            <tr key={i} className="hover:bg-zinc-800/30">
                                                <td className="px-4 py-3 font-medium text-white">{row.user?.name}</td>
                                                <td className="px-4 py-3 text-right text-amber-400 font-bold">{Math.round(row.totalOvertimeMinutes / 60)}h</td>
                                                <td className="px-4 py-3 text-right text-zinc-300">{row.overtimeDays}</td>
                                                <td className="px-4 py-3 text-right text-zinc-300">{Math.round(row.maxOvertimeMinutes / 60)}h</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {activeTab === 'lateness' && (
                            <div className="grid grid-cols-1 gap-4">
                                {data.map((row: any, i: number) => (
                                    <div key={i} className="flex items-center justify-between p-4 bg-zinc-950/50 border border-zinc-800 rounded-lg">
                                        <div className="flex items-center gap-4">
                                            <div className="p-2 bg-red-500/10 text-red-500 rounded-lg">
                                                <Clock className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <div className="font-medium text-white">{row.user?.name}</div>
                                                <div className="text-xs text-zinc-500">{row.lateDays} Late Arrivals</div>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-lg font-bold text-red-400">{row.totalLateMinutes}m</div>
                                            <div className="text-xs text-zinc-500">Total Delay</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                    </div>
                )}
            </div>
        </div>
    );
}
