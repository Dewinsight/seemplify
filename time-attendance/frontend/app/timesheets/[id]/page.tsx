'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { approvalsApi, exceptionsApi, timesheetApi } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
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
    PenLine,
    CalendarDays
} from 'lucide-react';
import { cn } from '@/lib/utils';
import CorrectionRequestDialog, { CorrectionRequestPayload } from '@/components/CorrectionRequestDialog';
import { getApiErrorMessage } from '@/lib/apiError';

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

const getDayStatusLabel = (entry: any): string => {
    if (entry?.status === 'leave') return 'On leave';
    if (entry?.status === 'holiday') return 'Public holiday';
    if (entry?.status === 'weekend') return 'Non-working day';
    if (entry?.status === 'partial') return 'Partially worked';
    if (entry?.status === 'present' || entry?.clockIn) return 'Present';
    return 'Absent';
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
    const { user, workspaceMode, setWorkspaceMode, canAccessManagement } = useAuth();
    const [timesheet, setTimesheet] = useState<any>(null);
    const [attendanceExceptions, setAttendanceExceptions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [actionMessage, setActionMessage] = useState('');
    const [actionError, setActionError] = useState('');
    const [dayAction, setDayAction] = useState<{ mode: 'employee' | 'manager'; date: string; exceptionId?: string } | null>(null);
    const [dayActionType, setDayActionType] = useState('absence');
    const [dayActionReason, setDayActionReason] = useState('');
    const [correctionReviewerLabel, setCorrectionReviewerLabel] = useState('your line manager, HR Manager or Attendance Admin');

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
            try {
                const exceptionData = await exceptionsApi.list({ timesheetId });
                setAttendanceExceptions(exceptionData.exceptions || []);
            } catch {
                setAttendanceExceptions([]);
            }
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
            setActionError('Unable to submit: timesheet ID not found.');
            return;
        }

        try {
            setSubmitting(true);
            setActionError('');
            const result = await timesheetApi.submit(timesheetId);
            setActionMessage(result?.message || 'Timesheet submitted for approval.');
            await fetchTimesheet(timesheetId); // Refresh data
        } catch (error: any) {
            console.error('Failed to submit timesheet', error);
            setActionError(getApiErrorMessage(error, 'Failed to submit timesheet. Please try again.'));
        } finally {
            setSubmitting(false);
        }
    };

    const handleRecall = async () => {
        if (!confirm('Are you sure you want to recall this timesheet? This will return it to Draft status.')) return;

        const timesheetId = timesheet._id || timesheet.id || id as string;
        if (!timesheetId) {
            setActionError('Unable to recall: timesheet ID not found.');
            return;
        }

        try {
            setSubmitting(true);
            setActionError('');
            const result = await timesheetApi.recall(timesheetId);
            setActionMessage(result?.message || 'Timesheet returned to draft.');
            await fetchTimesheet(timesheetId);
        } catch (error: any) {
            console.error('Recall failed', error);
            setActionError(getApiErrorMessage(error, 'Failed to recall timesheet.'));
        } finally {
            setSubmitting(false);
        }
    }

    const handleExportExcel = async () => {
        const timesheetId = timesheet?._id || timesheet?.id || id as string;
        if (!timesheetId) {
            setActionError('Unable to export: timesheet ID not found.');
            return;
        }

        try {
            setExporting(true);
            setActionError('');
            const { blob, filename } = await timesheetApi.exportExcel(timesheetId);
            const fileUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = fileUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(fileUrl);
        } catch (error: any) {
            console.error('Failed to export timesheet', error);
            setActionError(getApiErrorMessage(error, 'Failed to export timesheet. Please try again.'));
        } finally {
            setExporting(false);
        }
    }

    const scopedExceptionHref = () => {
        const timesheetId = String(timesheet?._id || id);
        const params = new URLSearchParams({
            userId: String(timesheet.userId),
            timesheetId,
            start: new Date(timesheet.startDate).toISOString(),
            end: new Date(timesheet.endDate).toISOString(),
            returnTo: `/timesheets/${timesheetId}?review=1`,
        });
        return `/exceptions?${params.toString()}`;
    };

    const handleReviewDecision = async (action: 'approve' | 'reject' | 'revision') => {
        const timesheetId = String(timesheet._id || id);
        let reason = '';
        if (action !== 'approve') {
            reason = window.prompt(action === 'revision'
                ? 'Tell the employee exactly what must be corrected before resubmitting.'
                : 'Record the reason this timesheet is being rejected.')?.trim() || '';
            if (reason.length < 5) return;
        }
        try {
            setSubmitting(true);
            setActionError('');
            if (action === 'approve') await approvalsApi.approve(timesheetId);
            else if (action === 'reject') await approvalsApi.reject(timesheetId, reason);
            else await approvalsApi.requestRevision(timesheetId, reason);
            router.push('/approvals');
        } catch (error: any) {
            setActionError(getApiErrorMessage(error, 'The review decision could not be saved.'));
            if (error?.response?.data?.approvalReadiness?.blockingExceptions) {
                setAttendanceExceptions(error.response.data.approvalReadiness.blockingExceptions);
            }
        } finally {
            setSubmitting(false);
        }
    };

    const submitDayAction = async () => {
        if (!dayAction || dayAction.mode !== 'manager' || dayActionReason.trim().length < 5) return;
        const timesheetId = String(timesheet._id || id);
        try {
            setSubmitting(true);
            setActionError('');
            await exceptionsApi.flagTimesheetDay(timesheetId, {
                date: dayAction.date,
                type: dayActionType,
                explanation: dayActionReason.trim(),
            });
            setActionMessage('The issue was flagged for this employee and added to the audit history.');
            setDayAction(null);
            setDayActionReason('');
            await fetchTimesheet(timesheetId);
        } catch (error: any) {
            setActionError(getApiErrorMessage(error, 'The attendance issue could not be submitted.'));
        } finally {
            setSubmitting(false);
        }
    };

    const openEmployeeCorrection = async (date: string, exceptionId?: string) => {
        setDayAction({ mode: 'employee', date, exceptionId });
        setCorrectionReviewerLabel('your line manager, HR Manager or Attendance Admin');
        try {
            const data = await exceptionsApi.getCorrectionRoute(String(timesheet._id || id));
            if (data.routing?.fallbackLabel) setCorrectionReviewerLabel(data.routing.fallbackLabel);
        } catch {
            // Submission resolves the route again on the server.
        }
    };

    const submitEmployeeCorrection = async (payload: CorrectionRequestPayload) => {
        if (!dayAction || dayAction.mode !== 'employee') return;
        try {
            setSubmitting(true);
            setActionError('');
            const result = await exceptionsApi.requestTimesheetCorrection(String(timesheet._id || id), {
                date: dayAction.date,
                exceptionId: dayAction.exceptionId,
                ...payload,
            });
            setDayAction(null);
            setActionMessage(`Your proposed times were sent to ${result.routing?.fallbackLabel || correctionReviewerLabel}.`);
            await fetchTimesheet(String(timesheet._id || id));
        } catch (error: any) {
            setActionError(getApiErrorMessage(error, 'The correction request could not be sent.'));
        } finally {
            setSubmitting(false);
        }
    };

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
    const daysOnLeave = Number(timesheet.summary?.daysOnLeave || 0);
    const isManagementView = workspaceMode === 'management' && canAccessManagement;
    const isOwnTimesheet = String(timesheet.userId || '') === String(user?.id || '');
    const canReviewThisTimesheet = isManagementView && !isOwnTimesheet;
    const awaitingDecision = ['submitted', 'pending'].includes(timesheet.status);
    const incompleteEntries = Number(timesheet.summary?.incompleteEntries || 0);
    const blockingExceptions = attendanceExceptions.filter(item => item.approvalBlocking && ['open', 'correction_requested'].includes(item.status));
    const canApprove = incompleteEntries === 0 && blockingExceptions.length === 0;
    const rejectionReason = timesheet.rejectedBy?.reason || timesheet.rejectionReason;

    return (
        <div className="timesheet-detail space-y-6">
            {isManagementView && <section aria-labelledby="review-heading" className="rounded-lg border border-[var(--suite-line-strong)] bg-[var(--suite-surface)] p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <h1 id="review-heading" className="text-lg font-semibold text-[var(--suite-ink)]">{isOwnTimesheet ? 'Your timesheet in Management view' : `Review ${timesheet.userName || 'employee'}’s Week ${timesheet.weekNumber} timesheet`}</h1>
                        <p className="mt-1 text-sm text-[var(--suite-muted)]">{timesheet.userEmail}{timesheet.teamName ? ` · ${timesheet.teamName}` : ''}</p>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--suite-muted)]">{isOwnTimesheet
                            ? 'Admins cannot approve their own timesheet or attendance corrections. A different line manager, HR Manager or Attendance Admin must review this record.'
                            : awaitingDecision
                                ? 'Review this employee’s daily records and period exceptions, then approve, request changes or reject with a recorded reason.'
                                : ['approved', 'payroll_pending', 'payroll_exported', 'locked'].includes(timesheet.status)
                                    ? 'This review is complete. The daily records, exceptions and decision history remain available for audit.'
                                    : `This timesheet is ${String(timesheet.status || 'draft').replaceAll('_', ' ')}. You can inspect it and flag issues, but the employee must submit it before an approval decision is available.`}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Link href={scopedExceptionHref()} className="rounded-md border border-[var(--suite-line-strong)] px-3 py-2 text-sm font-medium text-[var(--suite-ink)] hover:bg-[var(--suite-surface-muted)]">Review period exceptions ({attendanceExceptions.length})</Link>
                        {isOwnTimesheet && <button type="button" onClick={() => setWorkspaceMode('employee')} className="rounded-md border border-[var(--suite-line-strong)] px-3 py-2 text-sm font-medium text-[var(--suite-ink)] hover:bg-[var(--suite-surface-muted)]">Switch to Employee view</button>}
                        {canReviewThisTimesheet && awaitingDecision && <>
                            <button type="button" onClick={() => handleReviewDecision('revision')} disabled={submitting} className="rounded-md border border-amber-600/50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-500/10 disabled:opacity-50 dark:text-amber-200">Request changes</button>
                            <button type="button" onClick={() => handleReviewDecision('reject')} disabled={submitting} className="rounded-md border border-red-500/40 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-300">Reject</button>
                            <button type="button" onClick={() => handleReviewDecision('approve')} disabled={submitting || !canApprove} title={!canApprove ? 'Resolve the listed blockers before approval' : undefined} className="rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-teal-600 dark:hover:bg-teal-500">Approve timesheet</button>
                        </>}
                    </div>
                </div>
                {canReviewThisTimesheet && awaitingDecision && !canApprove && <div className="mt-4 border-t border-amber-500/25 pt-4"><p className="text-sm font-semibold text-amber-800 dark:text-amber-200">What is blocking approval</p><ul className="mt-2 space-y-1 text-sm text-amber-800/80 dark:text-amber-100/80">{incompleteEntries > 0 && <li>{incompleteEntries} incomplete or unpaired attendance {incompleteEntries === 1 ? 'entry' : 'entries'} must be corrected.</li>}{blockingExceptions.map(issue => <li key={issue._id || issue.id}>{safeFormatDate(issue.occurrenceDate, 'EEE, MMM d')} · {String(issue.type).replaceAll('_', ' ')} · {String(issue.status).replaceAll('_', ' ')}</li>)}</ul></div>}
            </section>}

            {(actionMessage || actionError) && <div role={actionError ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${actionError ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`}>{actionError || actionMessage}</div>}
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

                    {!isManagementView && (!timesheet.status || ['draft', 'rejected', 'revision_requested', 'adjusted'].includes(timesheet.status)) && (
                        <button
                            onClick={handleSubmit}
                            disabled={submitting}
                            className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-teal-500/20"
                        >
                            <Send className="h-4 w-4" />
                            {submitting ? 'Submitting...' : 'Submit for Approval'}
                        </button>
                    )}

                    {!isManagementView && (timesheet.status === 'submitted' || timesheet.status === 'pending') && (
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

            <dl className="timesheet-summary grid overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40 sm:grid-cols-2 lg:grid-cols-4">
                <div className="border-b border-zinc-800 px-5 py-4 sm:border-b-0"><dt className="flex items-center gap-2 text-sm text-zinc-500"><Clock className="h-4 w-4" />Total worked</dt><dd className="mt-2 text-xl font-semibold tabular-nums text-white">{formatDuration(totalHours * 60)}</dd></div>
                <div className="border-b border-zinc-800 px-5 py-4 sm:border-b-0"><dt className="flex items-center gap-2 text-sm text-zinc-500"><CheckCircle2 className="h-4 w-4" />Days worked</dt><dd className="mt-2 text-xl font-semibold tabular-nums text-white">{daysWorked}<span className="ml-1 text-sm font-normal text-zinc-500">of {timesheet.expectedWorkDays || 5}</span></dd></div>
                <div className="border-b border-zinc-800 px-5 py-4 sm:border-b-0"><dt className="flex items-center gap-2 text-sm text-zinc-500"><CalendarDays className="h-4 w-4" />Leave days</dt><dd className="mt-2 text-xl font-semibold tabular-nums text-white">{daysOnLeave}</dd></div>
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
                                    const dateId = date.toISOString();
                                    const dayExceptions = attendanceExceptions.filter(item => safeFormatDate(item.occurrenceDate, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd'));
                                    const openDayException = dayExceptions.find(item => item.status === 'open');

                                    return (
                                        <div key={index} data-day-status={entry.status} className={cn('timesheet-day p-4 transition-colors', entry.status === 'leave' && 'bg-teal-500/[0.04]')}>
                                            <div className="flex items-center justify-between mb-3">
                                                <div className="flex items-center gap-3">
                                                    <div className={cn(
                                                        "timesheet-date",
                                                        "w-10 h-10 rounded-lg flex flex-col items-center justify-center text-xs font-medium border relative",
                                                        entry.status === 'leave' ? "border-teal-500/30 bg-teal-500/10 text-teal-300" :
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
                                                                        exc.type === 'leave_conflict' ? "bg-amber-500/20 text-amber-300" :
                                                                        "bg-zinc-700 text-zinc-400"
                                                                    )}
                                                                    title={exc.description}
                                                                >
                                                                    {exc.type === 'manual_entry' ? 'Manual' :
                                                                     exc.type === 'no_clock_out' ? 'Missing Out' :
                                                                     exc.type === 'late_arrival' ? 'Late' :
                                                                     exc.type === 'leave_conflict' ? 'Leave conflict' :
                                                                     exc.type}
                                                                </span>
                                                            ))}
                                                        </div>
                                                        <div className={cn('text-xs', entry.status === 'leave' ? 'font-medium text-teal-300' : 'text-zinc-500')}>{getDayStatusLabel(entry)}</div>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="font-mono text-sm font-semibold tabular-nums text-white">
                                                        {formatDuration(Number(entry.totalHours || 0) * 60)}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Detailed timeline bar if needed, or simple text for now */}
                                            {entry.status === 'leave' && !entry.clockIn ? (
                                                <div className="pl-[3.25rem] text-xs text-zinc-400">Approved leave is synced from Leave Management. No clock entry is required.</div>
                                            ) : <div className="flex flex-wrap gap-x-5 gap-y-2 pl-[3.25rem] text-xs text-zinc-400">
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
                                            </div>}

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

                                            {!isWeekend && <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-zinc-800/70 pt-3 pl-[3.25rem]">
                                                {canReviewThisTimesheet ? <>
                                                    <button type="button" onClick={() => { setDayAction({ mode: 'manager', date: dateId }); setDayActionType(entry.status === 'absent' ? 'absence' : 'manual_review'); setDayActionReason(''); }} className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-300 hover:text-amber-200"><AlertTriangle className="h-3.5 w-3.5" />Flag an issue for this day</button>
                                                    {!!dayExceptions.length && <Link href={`${scopedExceptionHref()}&exceptionId=${encodeURIComponent(dayExceptions[0]._id)}`} className="text-xs font-medium text-teal-300 hover:underline">Review {dayExceptions.length} {dayExceptions.length === 1 ? 'exception' : 'exceptions'}</Link>}
                                                </> : isManagementView ? <span className="text-xs text-zinc-500">A different authorised reviewer must decide your own record.</span> : <button type="button" onClick={() => void openEmployeeCorrection(dateId, openDayException?._id)} className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-300 hover:text-teal-200"><PenLine className="h-3.5 w-3.5" />Request a correction for this day</button>}
                                            </div>}

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
                                <div><p className="text-sm font-medium text-zinc-200">{timesheet.approvedBy?.userName || timesheet.revisionRequestedBy?.userName || 'Line manager'}</p><p className="mt-0.5 text-xs text-zinc-500">{['approved', 'payroll_pending', 'payroll_exported', 'locked'].includes(timesheet.status) ? `Approved ${safeFormatDate(timesheet.approvedBy?.approvedAt || timesheet.updatedAt, 'MMM d, yyyy')}` : timesheet.status === 'rejected' ? `Rejected ${safeFormatDate(timesheet.rejectedBy?.rejectedAt || timesheet.updatedAt, 'MMM d, yyyy')}` : timesheet.status === 'revision_requested' ? 'Changes requested' : ['submitted', 'pending'].includes(timesheet.status) ? 'Awaiting review' : 'Waiting for submission'}</p></div>
                            </div>
                        </div>
                    </div>

                    {/* Rejection Note if applicable */}
                    {rejectionReason && (
                        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-5">
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
                                <div>
                                    <h3 className="text-sm font-bold text-red-500 mb-1">Rejection Reason</h3>
                                    <p className="text-sm text-red-200/80 leading-relaxed">
                                        {rejectionReason}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                    {timesheet.revisionRequestedBy?.reason && (
                        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-5">
                            <div className="flex items-start gap-3"><AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" /><div><h3 className="text-sm font-semibold text-amber-200">Changes requested by {timesheet.revisionRequestedBy.userName || 'your reviewer'}</h3><p className="mt-1 text-sm leading-6 text-amber-100/80">{timesheet.revisionRequestedBy.reason}</p><p className="mt-2 text-xs text-amber-200/70">Correct the relevant days, then resubmit this timesheet.</p></div></div>
                        </div>
                    )}
                    {!!timesheet.auditLog?.length && <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5"><h3 className="text-sm font-semibold text-white">Decision history</h3><ol className="mt-4 space-y-3 border-l border-zinc-700 pl-4">{timesheet.auditLog.slice().reverse().map((entry: any, index: number) => <li key={`${entry.action}-${index}`} className="text-xs text-zinc-400"><p className="font-medium text-zinc-200">{String(entry.action).replaceAll('_', ' ')}{entry.performedByName ? ` by ${entry.performedByName}` : ''}</p><p className="mt-0.5">{safeFormatDate(entry.performedAt, 'MMM d, yyyy · HH:mm')}</p>{(entry.comment || entry.details) && <p className="mt-1 leading-5 text-zinc-300">{entry.comment || entry.details}</p>}</li>)}</ol></div>}
                </div>

            </div>

            {dayAction?.mode === 'manager' && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"><div role="dialog" aria-modal="true" aria-labelledby="day-action-title" className="w-full max-w-lg rounded-lg border border-[var(--suite-line-strong)] bg-[var(--suite-surface)] p-6 shadow-lg"><h2 id="day-action-title" className="text-lg font-semibold text-[var(--suite-ink)]">Flag an attendance issue</h2><p className="mt-2 text-sm leading-6 text-[var(--suite-muted)]">{safeFormatDate(dayAction.date, 'EEEE, MMMM d, yyyy')}. The employee will see the issue and your reason. This blocks approval until it is reviewed.</p><label className="mt-4 block text-sm font-medium text-[var(--suite-ink)]" htmlFor="day-issue-type">Issue type<select id="day-issue-type" value={dayActionType} onChange={event => setDayActionType(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] px-3 text-sm text-[var(--suite-ink)]"><option value="absence">Absence</option><option value="no_clock_out">Missing clock out</option><option value="late_arrival">Late arrival</option><option value="early_departure">Early departure</option><option value="missed_break">Missed break</option><option value="leave_conflict">Leave conflict</option><option value="manual_review">Other review issue</option></select></label><label className="mt-4 block text-sm font-medium text-[var(--suite-ink)]" htmlFor="day-action-reason">Reason and required action</label><textarea id="day-action-reason" autoFocus value={dayActionReason} onChange={event => setDayActionReason(event.target.value)} rows={5} className="mt-2 w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] p-3 text-sm text-[var(--suite-ink)]" /><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => { setDayAction(null); setDayActionReason(''); }} className="rounded-md px-3 py-2 text-sm font-medium text-[var(--suite-muted)] hover:bg-[var(--suite-surface-muted)]">Cancel</button><button type="button" onClick={submitDayAction} disabled={submitting || dayActionReason.trim().length < 5} className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Flag issue</button></div></div></div>}
            {dayAction?.mode === 'employee' && <CorrectionRequestDialog date={dayAction.date} reviewerLabel={correctionReviewerLabel} submitting={submitting} onCancel={() => setDayAction(null)} onSubmit={submitEmployeeCorrection} />}
        </div>
    );
}
