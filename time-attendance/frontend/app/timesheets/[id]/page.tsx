'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { timesheetApi } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDuration } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import {
    ArrowLeft,
    Clock,
    Send,
    AlertTriangle,
    FileText,
    History,
    CheckCircle2,
    XCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function TimesheetDetailPage() {
    const { id } = useParams();
    const router = useRouter();
    const [timesheet, setTimesheet] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (id) {
            if (id === 'current') {
                // Special handle for 'current' ID if we want to link directly to current week
                // Ideally the API or list page should resolve this ID first, 
                // but for now let's assume valid ID is passed or handle 'current' by redirecting/fetching current
                fetchCurrentTimesheet();
            } else {
                fetchTimesheet(id as string);
            }
        }
    }, [id]);

    const fetchCurrentTimesheet = async () => {
        try {
            const response = await timesheetApi.list();
            // Naive logic: grab the last one or the one with draft status
            // A better API endpoint `GET /timesheets/current` would be ideal
            const current = response.timesheets[0];
            if (current) {
                router.replace(`/timesheets/${current._id}`);
            } else {
                console.error('No current timesheet found');
                // Handle error state
            }
        } catch (err) {
            console.error(err)
        }
    }

    const fetchTimesheet = async (timesheetId: string) => {
        try {
            setLoading(true);
            const data = await timesheetApi.getById(timesheetId);
            setTimesheet(data);
        } catch (error) {
            console.error('Failed to fetch timesheet details', error);
            // router.push('/timesheets'); // Redirect on error?
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async () => {
        if (!confirm('Are you sure you want to submit this timesheet for approval? You won\'t be able to edit entries while it is pending.')) return;

        try {
            setSubmitting(true);
            await timesheetApi.submit(timesheet._id);
            await fetchTimesheet(timesheet._id); // Refresh data
        } catch (error) {
            console.error('Failed to submit timesheet', error);
            alert('Failed to submit timesheet. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    const handleRecall = async () => {
        if (!confirm('Are you sure you want to recall this timesheet? This will return it to Draft status.')) return;

        try {
            setSubmitting(true);
            await timesheetApi.recall(timesheet._id);
            await fetchTimesheet(timesheet._id);
        } catch (error) {
            console.error('Recall failed', error);
            alert('Failed to recall timesheet.');
        } finally {
            setSubmitting(false);
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <div className="animate-spin h-8 w-8 border-2 border-teal-500 rounded-full border-t-transparent"></div>
            </div>
        );
    }

    if (!timesheet) return null;

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => router.back()}
                        className="p-2 -ml-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </button>
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl font-bold text-white">
                                Week {timesheet.weekNumber}
                            </h1>
                            <StatusBadge status={timesheet.status} />
                        </div>
                        <p className="text-zinc-400">
                            {format(parseISO(timesheet.startDate), 'MMMM d')} - {format(parseISO(timesheet.endDate), 'MMMM d, yyyy')}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {timesheet.status === 'draft' && (
                        <button
                            onClick={handleSubmit}
                            disabled={submitting}
                            className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-teal-500/20"
                        >
                            <Send className="h-4 w-4" />
                            {submitting ? 'Submitting...' : 'Submit for Approval'}
                        </button>
                    )}

                    {(timesheet.status === 'submitted' || timesheet.status === 'pending') && (
                        <button
                            onClick={handleRecall}
                            disabled={submitting}
                            className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg font-medium transition-colors border border-zinc-700"
                        >
                            <History className="h-4 w-4" />
                            Recall
                        </button>
                    )}
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-5">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 rounded-lg bg-teal-500/10 text-teal-400">
                            <Clock className="h-4 w-4" />
                        </div>
                        <span className="text-sm font-medium text-zinc-400">Total Hours</span>
                    </div>
                    <div className="text-2xl font-bold text-white pl-1">
                        {formatDuration((timesheet.totalHours || 0) * 60)}
                    </div>
                </div>

                <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-5">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                            <CheckCircle2 className="h-4 w-4" />
                        </div>
                        <span className="text-sm font-medium text-zinc-400">Days Worked</span>
                    </div>
                    <div className="text-2xl font-bold text-white pl-1">
                        {timesheet.daysWorked || 0} <span className="text-sm font-normal text-zinc-500">/ 5</span>
                    </div>
                </div>

                <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-5">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                            <FileText className="h-4 w-4" />
                        </div>
                        <span className="text-sm font-medium text-zinc-400">Entries</span>
                    </div>
                    <div className="text-2xl font-bold text-white pl-1">
                        {timesheet.dailyEntries?.length || 0}
                    </div>
                </div>
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Daily Entries List */}
                <div className="lg:col-span-2 space-y-4">
                    <h2 className="text-lg font-semibold text-white">Daily Breakdown</h2>
                    <div className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden">
                        {timesheet.dailyEntries?.length === 0 ? (
                            <div className="p-8 text-center text-zinc-500">
                                No entries recorded for this week.
                            </div>
                        ) : (
                            <div className="divide-y divide-zinc-800/50">
                                {timesheet.dailyEntries?.map((entry: any, index: number) => {
                                    const date = parseISO(entry.date);
                                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;

                                    return (
                                        <div key={index} className={cn("p-4 transition-colors", isWeekend ? "bg-zinc-900/30" : "hover:bg-zinc-800/30")}>
                                            <div className="flex items-center justify-between mb-3">
                                                <div className="flex items-center gap-3">
                                                    <div className={cn(
                                                        "w-10 h-10 rounded-lg flex flex-col items-center justify-center text-xs font-medium border",
                                                        isWeekend ? "bg-zinc-900 border-zinc-800 text-zinc-600" : "bg-zinc-800 border-zinc-700 text-zinc-300"
                                                    )}>
                                                        <span>{format(date, 'EEE')}</span>
                                                        <span className="font-bold">{format(date, 'd')}</span>
                                                    </div>
                                                    <div>
                                                        <div className="text-sm font-medium text-white">{format(date, 'MMMM d, yyyy')}</div>
                                                        <div className="text-xs text-zinc-500">{entry.clockIn ? 'Present' : 'Absent/Off'}</div>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-lg font-mono font-medium text-white">
                                                        {formatDuration(entry.totalHours * 60)}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Detailed timeline bar if needed, or simple text for now */}
                                            <div className="flex gap-4 text-xs text-zinc-400 pl-[3.25rem]">
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                                                    In: <span className="text-white font-mono">{entry.startTime ? format(parseISO(entry.startTime), 'HH:mm') : '--:--'}</span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                                                    Out: <span className="text-white font-mono">{entry.endTime ? format(parseISO(entry.endTime), 'HH:mm') : '--:--'}</span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>
                                                    Breaks: <span className="text-white font-mono">{entry.breakDuration}m</span>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* Sidebar Info */}
                <div className="space-y-6">
                    <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6">
                        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4">Approval Chain</h3>
                        <div className="relative pl-4 border-l border-zinc-800 space-y-6">
                            {/* Submitter */}
                            <div className="relative">
                                <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-teal-500 ring-4 ring-zinc-900" />
                                <div className="text-sm font-medium text-white">You</div>
                                <div className="text-xs text-zinc-500">Submitted on {timesheet.submittedAt ? format(parseISO(timesheet.submittedAt), 'MMM d, HH:mm') : 'Not yet submitted'}</div>
                            </div>

                            {/* Approver */}
                            <div className="relative">
                                <div className={cn(
                                    "absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ring-4 ring-zinc-900",
                                    timesheet.status === 'approved' ? 'bg-emerald-500' :
                                        timesheet.status === 'rejected' ? 'bg-red-500' :
                                            'bg-zinc-700'
                                )} />
                                <div className="text-sm font-medium text-white">Line Manager</div>
                                <div className="text-xs text-zinc-500">
                                    {timesheet.status === 'approved' ? `Approved on ${format(parseISO(timesheet.updatedAt), 'MMM d')}` :
                                        timesheet.status === 'pending' ? 'Pending Review' :
                                            'Waiting for submission'}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Rejection Note if applicable */}
                    {timesheet.rejectionReason && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6">
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
                                <div>
                                    <h3 className="text-sm font-bold text-red-500 mb-1">Rejection Reason</h3>
                                    <p className="text-sm text-red-200/80 leading-relaxed">
                                        {timesheet.rejectionReason}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}
