'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { timesheetApi } from '@/lib/api';
import { format } from 'date-fns';
import {
    ChevronRight,
    Search,
    Calendar as CalendarIcon,
    Filter,
    Download
} from 'lucide-react';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDuration } from '@/lib/utils';

export default function TimesheetsPage() {
    const [timesheets, setTimesheets] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState(false);

    // Future implementation: Add pagination and filters
    // const [page, setPage] = useState(1);
    // const [filters, setFilters] = useState({});

    useEffect(() => {
        fetchTimesheets();
    }, []);

    const fetchTimesheets = async () => {
        try {
            setLoading(true);
            // Currently fetching all, pagination to be added in API
            const response = await timesheetApi.list();
            setTimesheets(response.timesheets);
        } catch (error) {
            console.error('Failed to fetch timesheets', error);
        } finally {
            setLoading(false);
        }
    };

    const handleQuickExport = async () => {
        if (!timesheets.length) {
            alert('No timesheets available to export.');
            return;
        }

        const latestTimesheet = timesheets[0];
        const timesheetId = latestTimesheet?._id || latestTimesheet?.id;
        if (!timesheetId) {
            alert('Unable to export: timesheet ID not found.');
            return;
        }

        try {
            setExporting(true);
            const { blob, filename } = await timesheetApi.exportExcel(timesheetId);
            const fileUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = fileUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(fileUrl);
        } catch (error) {
            console.error('Failed to export timesheet', error);
            alert('Failed to export timesheet.');
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white">My Timesheets</h1>
                    <p className="text-zinc-400">View and manage your weekly timesheet submissions</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleQuickExport}
                        disabled={loading || exporting}
                        title="Export latest timesheet to Excel"
                        className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Download className="h-5 w-5" />
                    </button>
                </div>
            </div>

            {/* Filters Bar - Visual only for v1 */}
            <div className="flex items-center gap-4 p-4 bg-zinc-900/50 border border-white/5 rounded-xl">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                    <input
                        type="text"
                        placeholder="Search by date..."
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                    />
                </div>
                <button className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-zinc-400 hover:text-white bg-zinc-950 border border-zinc-800 hover:bg-zinc-900 rounded-lg transition-colors">
                    <Filter className="h-4 w-4" />
                    Filter
                </button>
                <button className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-zinc-400 hover:text-white bg-zinc-950 border border-zinc-800 hover:bg-zinc-900 rounded-lg transition-colors ml-auto">
                    <CalendarIcon className="h-4 w-4" />
                    2024
                </button>
            </div>

            {/* Timesheets List */}
            <div className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center p-12">
                        <div className="animate-spin h-8 w-8 border-2 border-teal-500 rounded-full border-t-transparent"></div>
                    </div>
                ) : timesheets.length === 0 ? (
                    <div className="text-center p-12">
                        <div className="bg-zinc-800/50 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                            <CalendarIcon className="h-8 w-8 text-zinc-500" />
                        </div>
                        <h3 className="text-lg font-medium text-white">No timesheets found</h3>
                        <p className="text-zinc-500">You haven't generated any timesheets yet.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-zinc-800/50">
                        {timesheets.map((sheet) => (
                            <Link
                                key={sheet._id}
                                href={`/timesheets/${sheet._id}`}
                                className="group flex items-center justify-between p-4 hover:bg-zinc-800/30 transition-colors"
                            >
                                <div className="flex items-center gap-4">
                                    <div className="p-3 rounded-xl bg-zinc-800/50 text-zinc-400 group-hover:bg-teal-500/10 group-hover:text-teal-400 transition-colors">
                                        <CalendarIcon className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <div className="font-medium text-white group-hover:text-teal-400 transition-colors">
                                            {format(new Date(sheet.startDate), 'MMM d, yyyy')} - {format(new Date(sheet.endDate), 'MMM d, yyyy')}
                                        </div>
                                        <div className="text-sm text-zinc-500">
                                            Week {sheet.weekNumber} • {sheet.totalHours ? formatDuration(sheet.totalHours * 60) : '0h 0m'}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-6">
                                    <div className="flex flex-col items-end gap-1">
                                        <StatusBadge status={sheet.status} />
                                        <span className="text-xs text-zinc-500">
                                            {sheet.submittedAt ? `Submitted ${format(new Date(sheet.submittedAt), 'MMM d')}` : 'Not submitted'}
                                        </span>
                                    </div>
                                    <ChevronRight className="h-5 w-5 text-zinc-600 group-hover:text-zinc-300 transition-colors" />
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
