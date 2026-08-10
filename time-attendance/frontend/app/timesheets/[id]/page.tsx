'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { timesheetApi } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDuration } from '@/lib/utils';
import { format, parseISO, isValid, startOfWeek, endOfWeek, getISOWeek } from 'date-fns';
import {
    ArrowLeft,
    Clock,
    Send,
    Download,
    AlertTriangle,
    FileText,
    History,
    CheckCircle2,
    XCircle,
    MapPin,
    PenLine
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Safe date parsing - handles ISO strings, Date objects, and invalid dates
const safeParseDate = (dateValue: any): Date | null => {
    if (!dateValue) return null;
    try {
        const date = typeof dateValue === 'string' ? parseISO(dateValue) : new Date(dateValue);
        return isValid(date) ? date : null;
    } catch {
        return null;
    }
};

const safeFormatDate = (dateValue: any, formatStr: string, fallback = '--'): string => {
    const date = safeParseDate(dateValue);
    return date ? format(date, formatStr) : fallback;
};

// Calculate week dates from weekNumber and year
const getWeekDatesFromWeekNumber = (weekNumber: number, year: number): { startDate: Date; endDate: Date } | null => {
    if (!weekNumber || !year) return null;
    try {
        // Create a date in the given year and week
        const jan4 = new Date(year, 0, 4); // January 4 is always in week 1
        const jan4Week = getISOWeek(jan4);
        const weekDiff = weekNumber - jan4Week;
        const dateInWeek = new Date(jan4);
        dateInWeek.setDate(jan4.getDate() + (weekDiff * 7));
        
        const start = startOfWeek(dateInWeek, { weekStartsOn: 1 }); // Monday
        const end = endOfWeek(dateInWeek, { weekStartsOn: 1 });
        
        return { startDate: start, endDate: end };
    } catch {
        return null;
    }
};

export default function TimesheetDetailPage() {
    const { id } = useParams();
    const router = useRouter();
    const [timesheet, setTimesheet] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [exporting, setExporting] = useState(false);

    const fetchCurrentTimesheet = useCallback(async () => {
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
    }, [router]);

    const fetchTimesheet = useCallback(async (timesheetId: string) => {
        try {
            setLoading(true);
            const data = await timesheetApi.getById(timesheetId);
            // Handle API response structure - could be { timesheet } or direct timesheet object
            const timesheetData = data.timesheet || data;
            
            // If startDate/endDate are missing, calculate from weekNumber
            if (timesheetData && (!timesheetData.startDate || !timesheetData.endDate)) {
                if (timesheetData.weekNumber && timesheetData.year) {
                    const weekDates = getWeekDatesFromWeekNumber(timesheetData.weekNumber, timesheetData.year);
                    if (weekDates) {
                        timesheetData.startDate = weekDates.startDate;
                        timesheetData.endDate = weekDates.endDate;
                    }
                }
            }
            
            setTimesheet(timesheetData);
        } catch (error) {
            console.error('Failed to fetch timesheet details', error);
            // router.push('/timesheets'); // Redirect on error?
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!id) return;
        if (id === 'current') void fetchCurrentTimesheet();
        else void fetchTimesheet(id as string);
    }, [fetchCurrentTimesheet, fetchTimesheet, id]);

    const handleSubmit = async () => {
        if (!confirm('Are you sure you want to submit this timesheet for approval? You won\'t be able to edit entries while it is pending.')) return;

        const timesheetId = timesheet._id || timesheet.id || id as string;
        if (!timesheetId) {
            alert('Unable to submit: timesheet ID not found');
            return;
        }

        try {
            setSubmitting(true);
            await timesheetApi.submit(timesheetId);
            await fetchTimesheet(timesheetId); // Refresh data
        } catch (error) {
            console.error('Failed to submit timesheet', error);
            alert('Failed to submit timesheet. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    const handleRecall = async () => {
        if (!confirm('Are you sure you want to recall this timesheet? This will return it to Draft status.')) return;

        const timesheetId = timesheet._id || timesheet.id || id as string;
        if (!timesheetId) {
            alert('Unable to recall: timesheet ID not found');
            return;
        }

        try {
            setSubmitting(true);
            await timesheetApi.recall(timesheetId);
            await fetchTimesheet(timesheetId);
        } catch (error) {
            console.error('Recall failed', error);
            alert('Failed to recall timesheet.');
        } finally {
            setSubmitting(false);
        }
    }

    const handleExportExcel = async () => {
        const timesheetId = timesheet?._id || timesheet?.id || id as string;
        if (!timesheetId) {
            alert('Unable to export: timesheet ID not found');
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
            alert('Failed to export timesheet. Please try again.');
        } finally {
            setExporting(false);
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

    const dailyEntries = Array.isArray(timesheet.dailyEntries) ? timesheet.dailyEntries : [];
    const calculatedHours = dailyEntries.reduce((total: number, entry: any) => total + Number(entry.totalHours || 0), 0);
    const storedHours = Number(timesheet.summary?.totalHours ?? timesheet.totalHours ?? 0);
    const totalHours = storedHours > 0 || calculatedHours === 0 ? storedHours : calculatedHours;
    const calculatedDays = dailyEntries.filter((entry: any) => Number(entry.totalHours || 0) > 0 || entry.clockIn).length;
    const storedDays = Number(timesheet.summary?.daysWorked ?? timesheet.daysWorked ?? 0);
    const daysWorked = storedDays > 0 || calculatedDays === 0 ? storedDays : calculatedDays;

    return (
        <div className="timesheet-detail space-y-6">
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
                            {(() => {
                                const startDate = safeParseDate(timesheet.startDate);
                                const endDate = safeParseDate(timesheet.endDate);
                                
                                if (startDate && endDate) {
                                    return `${format(startDate, 'MMMM d')} - ${format(endDate, 'MMMM d, yyyy')}`;
                                }
                                
                                // Fallback: try to calculate from weekNumber
                                if (timesheet.weekNumber && timesheet.year) {
                                    const weekDates = getWeekDatesFromWeekNumber(timesheet.weekNumber, timesheet.year);
                                    if (weekDates) {
                                        return `${format(weekDates.startDate, 'MMMM d')} - ${format(weekDates.endDate, 'MMMM d, yyyy')}`;
                                    }
                                }
                                
                                // Final fallback
                                return timesheet.weekNumber ? `Week ${timesheet.weekNumber}, ${timesheet.year || ''}` : 'Date range unavailable';
                            })()}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={handleExportExcel}
                        disabled={exporting}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg font-medium transition-colors border border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Download className="h-4 w-4" />
                        {exporting ? 'Exporting...' : 'Export Excel'}
                    </button>

                    {(!timesheet.status || timesheet.status === 'draft') && (
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

            <dl className="timesheet-summary grid overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40 sm:grid-cols-3">
                <div className="border-b border-zinc-800 px-5 py-4 sm:border-b-0"><dt className="flex items-center gap-2 text-sm text-zinc-500"><Clock className="h-4 w-4" />Total worked</dt><dd className="mt-2 text-xl font-semibold tabular-nums text-white">{formatDuration(totalHours * 60)}</dd></div>
                <div className="border-b border-zinc-800 px-5 py-4 sm:border-b-0"><dt className="flex items-center gap-2 text-sm text-zinc-500"><CheckCircle2 className="h-4 w-4" />Days worked</dt><dd className="mt-2 text-xl font-semibold tabular-nums text-white">{daysWorked}<span className="ml-1 text-sm font-normal text-zinc-500">of {timesheet.expectedWorkDays || 5}</span></dd></div>
                <div className="px-5 py-4"><dt className="flex items-center gap-2 text-sm text-zinc-500"><FileText className="h-4 w-4" />Period days</dt><dd className="mt-2 text-xl font-semibold tabular-nums text-white">{dailyEntries.length}</dd></div>
            </dl>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">

                {/* Daily Entries List */}
                <div className="space-y-3">
                    <h2 className="text-lg font-semibold text-white">Daily Breakdown</h2>
                    <div className="timesheet-days overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
                        {timesheet.dailyEntries?.length === 0 ? (
                            <div className="p-8 text-center text-zinc-500">
                                No entries recorded for this week.
                            </div>
                        ) : (
                            <div className="divide-y divide-zinc-800/50">
                                {dailyEntries.map((entry: any, index: number) => {
                                    const date = safeParseDate(entry.date) || new Date();
                                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;

                                    return (
                                        <div key={index} className="timesheet-day p-4 transition-colors">
                                            <div className="flex items-center justify-between mb-3">
                                                <div className="flex items-center gap-3">
                                                    <div className={cn(
                                                        "timesheet-date",
                                                        "w-10 h-10 rounded-lg flex flex-col items-center justify-center text-xs font-medium border relative",
                                                        isWeekend ? "bg-zinc-900/60 border-zinc-800 text-zinc-500" : "bg-zinc-800 border-zinc-700 text-zinc-300"
                                                    )}>
                                                        <span>{format(date, 'EEE')}</span>
                                                        <span className="font-bold">{format(date, 'd')}</span>
                                                        {/* Manual entry indicator */}
                                                        {entry.exceptions?.some((e: any) => e.type === 'manual_entry') && (
                                                            <div className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center" title="Contains manual entry">
                                                                <PenLine className="h-2.5 w-2.5 text-white" />
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-sm font-medium text-white">{format(date, 'MMMM d, yyyy')}</span>
                                                            {/* Exception badges */}
                                                            {entry.exceptions?.map((exc: any, i: number) => (
                                                                <span
                                                                    key={i}
                                                                    data-exception={exc.type}
                                                                    className={cn(
                                                                        "timesheet-exception px-1.5 py-0.5 text-[10px] font-medium rounded",
                                                                        exc.type === 'manual_entry' ? "bg-amber-500/20 text-amber-400" :
                                                                        exc.type === 'no_clock_out' ? "bg-red-500/20 text-red-400" :
                                                                        exc.type === 'late_arrival' ? "bg-orange-500/20 text-orange-400" :
                                                                        "bg-zinc-700 text-zinc-400"
                                                                    )}
                                                                    title={exc.description}
                                                                >
                                                                    {exc.type === 'manual_entry' ? 'Manual' :
                                                                     exc.type === 'no_clock_out' ? 'Missing Out' :
                                                                     exc.type === 'late_arrival' ? 'Late' :
                                                                     exc.type}
                                                                </span>
                                                            ))}
                                                        </div>
                                                        <div className="text-xs text-zinc-500">{entry.clockIn ? 'Present' : 'Absent/Off'}</div>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="font-mono text-sm font-semibold tabular-nums text-white">
                                                        {formatDuration(Number(entry.totalHours || 0) * 60)}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Detailed timeline bar if needed, or simple text for now */}
                                            <div className="flex flex-wrap gap-x-5 gap-y-2 pl-[3.25rem] text-xs text-zinc-400">
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                                                    In: <span className="text-white font-mono">{safeFormatDate(entry.clockIn, 'HH:mm', '--:--')}</span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                                                    Out: <span className="text-white font-mono">{safeFormatDate(entry.clockOut, 'HH:mm', '--:--')}</span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>
                                                    Breaks: <span className="text-white font-mono">{entry.breakDuration}m</span>
                                                </div>
                                            </div>

                                            {/* Location Display */}
                                            {(entry.clockInLocation?.latitude || entry.clockOutLocation?.latitude) && (
                                                <div className="timesheet-location-grid mt-3 grid gap-4 border-t border-zinc-800 pt-3 pl-[3.25rem] sm:grid-cols-2">
                                                    {entry.clockInLocation?.latitude && entry.clockInLocation?.longitude && (
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-2 text-xs mb-1.5">
                                                                <MapPin className="h-3.5 w-3.5 shrink-0 text-teal-400" />
                                                                <span className="font-medium text-zinc-300">Clock in location</span>
                                                                {entry.clockInLocation.verified !== undefined && (
                                                                    entry.clockInLocation.verified ? (
                                                                        <span className="flex items-center gap-1 text-green-400">
                                                                            <CheckCircle2 className="h-3 w-3" />
                                                                            <span className="text-[10px]">Verified</span>
                                                                        </span>
                                                                    ) : (
                                                                        <span className="flex items-center gap-1 text-amber-400">
                                                                            <XCircle className="h-3 w-3" />
                                                                            <span className="text-[10px]">Outside geofence</span>
                                                                        </span>
                                                                    )
                                                                )}
                                                            </div>
                                                            <div className="space-y-1 text-xs pl-5">
                                                                {/* Coordinates */}
                                                                <div className="flex flex-wrap items-center gap-2 text-zinc-500">
                                                                    <span className="sr-only">Coordinates:</span>
                                                                    <a
                                                                        href={`https://www.google.com/maps?q=${entry.clockInLocation.latitude},${entry.clockInLocation.longitude}`}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="font-medium text-teal-400 hover:text-teal-300 hover:underline"
                                                                    >
                                                                        View map
                                                                    </a>
                                                                    {entry.clockInLocation.accuracy && (
                                                                        <span className="text-zinc-500">±{Math.round(entry.clockInLocation.accuracy)}m accuracy</span>
                                                                    )}
                                                                </div>
                                                                {/* Address */}
                                                                {entry.clockInLocation.address && (
                                                                    <div className="flex items-start gap-2">
                                                                        <span className="sr-only">Address:</span>
                                                                        <span className="truncate text-zinc-300" title={entry.clockInLocation.address}>{entry.clockInLocation.address}</span>
                                                                    </div>
                                                                )}
                                                                {/* Area/City */}
                                                                {(entry.clockInLocation.area || entry.clockInLocation.city) && (
                                                                    <div className="hidden">
                                                                        <span className="text-zinc-500 w-20 shrink-0">Area:</span>
                                                                        <span className="text-zinc-300">
                                                                            {[entry.clockInLocation.area, entry.clockInLocation.city, entry.clockInLocation.state, entry.clockInLocation.country].filter(Boolean).join(', ')}
                                                                        </span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                    {entry.clockOutLocation?.latitude && entry.clockOutLocation?.longitude && (
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-2 text-xs mb-1.5">
                                                                <MapPin className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                                                                <span className="font-medium text-zinc-300">Clock out location</span>
                                                                {entry.clockOutLocation.verified !== undefined && (
                                                                    entry.clockOutLocation.verified ? (
                                                                        <span className="flex items-center gap-1 text-green-400">
                                                                            <CheckCircle2 className="h-3 w-3" />
                                                                            <span className="text-[10px]">Verified</span>
                                                                        </span>
                                                                    ) : (
                                                                        <span className="flex items-center gap-1 text-amber-400">
                                                                            <XCircle className="h-3 w-3" />
                                                                            <span className="text-[10px]">Outside geofence</span>
                                                                        </span>
                                                                    )
                                                                )}
                                                            </div>
                                                            <div className="space-y-1 text-xs pl-5">
                                                                {/* Coordinates */}
                                                                <div className="flex flex-wrap items-center gap-2 text-zinc-500">
                                                                    <span className="sr-only">Coordinates:</span>
                                                                    <a
                                                                        href={`https://www.google.com/maps?q=${entry.clockOutLocation.latitude},${entry.clockOutLocation.longitude}`}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="font-medium text-teal-400 hover:text-teal-300 hover:underline"
                                                                    >
                                                                        View map
                                                                    </a>
                                                                    {entry.clockOutLocation.accuracy && (
                                                                        <span className="text-zinc-500">±{Math.round(entry.clockOutLocation.accuracy)}m accuracy</span>
                                                                    )}
                                                                </div>
                                                                {/* Address */}
                                                                {entry.clockOutLocation.address && (
                                                                    <div className="flex items-start gap-2">
                                                                        <span className="sr-only">Address:</span>
                                                                        <span className="truncate text-zinc-300" title={entry.clockOutLocation.address}>{entry.clockOutLocation.address}</span>
                                                                    </div>
                                                                )}
                                                                {/* Area/City */}
                                                                {(entry.clockOutLocation.area || entry.clockOutLocation.city) && (
                                                                    <div className="hidden">
                                                                        <span className="text-zinc-500 w-20 shrink-0">Area:</span>
                                                                        <span className="text-zinc-300">
                                                                            {[entry.clockOutLocation.area, entry.clockOutLocation.city, entry.clockOutLocation.state, entry.clockOutLocation.country].filter(Boolean).join(', ')}
                                                                        </span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* Manual Entry Note */}
                                            {entry.exceptions?.some((e: any) => e.type === 'manual_entry') && (
                                                <div className="mt-3 pl-[3.25rem]">
                                                    <div className="timesheet-manual-note flex items-start gap-2 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
                                                        <PenLine className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                                                        <div>
                                                            <span className="text-amber-400 font-medium">Manual Entry: </span>
                                                            <span className="text-amber-200/80">
                                                                {entry.exceptions?.find((e: any) => e.type === 'manual_entry')?.description || 'Time was manually adjusted'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* Sidebar Info */}
                <div className="space-y-4">
                    <div className="timesheet-approval rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
                        <h3 className="text-sm font-semibold text-white">Approval</h3>
                        <div className="mt-4 space-y-4">
                            <div className="grid grid-cols-[16px_1fr] gap-3">
                                <CheckCircle2 className={cn('mt-0.5 h-4 w-4', timesheet.submittedAt ? 'text-teal-400' : 'text-zinc-700')} />
                                <div><p className="text-sm font-medium text-zinc-200">Submitted</p><p className="mt-0.5 text-xs text-zinc-500">{timesheet.submittedAt ? safeFormatDate(timesheet.submittedAt, 'MMM d, yyyy · HH:mm') : 'Not submitted yet'}</p></div>
                            </div>
                            <div className="grid grid-cols-[16px_1fr] gap-3 border-t border-zinc-800 pt-4">
                                {timesheet.status === 'rejected' ? <XCircle className="mt-0.5 h-4 w-4 text-red-400" /> : <CheckCircle2 className={cn('mt-0.5 h-4 w-4', timesheet.status === 'approved' ? 'text-emerald-400' : 'text-zinc-700')} />}
                                <div><p className="text-sm font-medium text-zinc-200">{timesheet.approvedBy?.userName || 'Line manager'}</p><p className="mt-0.5 text-xs text-zinc-500">{timesheet.status === 'approved' ? `Approved ${safeFormatDate(timesheet.approvedBy?.approvedAt || timesheet.updatedAt, 'MMM d, yyyy')}` : timesheet.status === 'rejected' ? `Rejected ${safeFormatDate(timesheet.rejectedBy?.rejectedAt || timesheet.updatedAt, 'MMM d, yyyy')}` : ['submitted', 'pending'].includes(timesheet.status) ? 'Awaiting review' : 'Waiting for submission'}</p></div>
                            </div>
                        </div>
                    </div>

                    {/* Rejection Note if applicable */}
                    {timesheet.rejectionReason && (
                        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-5">
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
