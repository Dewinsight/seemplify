'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { format, isValid, parseISO } from 'date-fns';
import { AlertTriangle, CalendarDays, Check, CheckCircle2, ChevronRight, History, Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import { approvalsApi } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';
import { cn, formatDuration } from '@/lib/utils';

const safeFormatDate = (dateValue: any, formatStr: string, fallback = '—'): string => {
    if (!dateValue) return fallback;
    try {
        const date = typeof dateValue === 'string' ? parseISO(dateValue) : new Date(dateValue);
        return isValid(date) ? format(date, formatStr) : fallback;
    } catch {
        return fallback;
    }
};

function initials(name?: string) {
    return String(name || 'Unknown user').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function itemSummary(item: any) {
    const hours = Number(item.summary?.totalHours ?? item.totalHours ?? 0);
    const days = Number(item.summary?.daysWorked ?? item.daysWorked ?? 0);
    const overtime = Number(item.summary?.overtimeHours ?? item.overtimeHours ?? 0);
    return { hours, days, overtime };
}

function exceptionHref(item: any) {
    const params = new URLSearchParams({
        userId: String(item.userId),
        timesheetId: String(item._id),
    });
    if (item.startDate) params.set('start', new Date(item.startDate).toISOString());
    if (item.endDate) params.set('end', new Date(item.endDate).toISOString());
    params.set('returnTo', `/timesheets/${item._id}?review=1`);
    return `/exceptions?${params.toString()}`;
}

export default function ApprovalsPage() {
    const [approvals, setApprovals] = useState<any[]>([]);
    const [history, setHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState<string | null>(null);
    const [actionError, setActionError] = useState<{ id: string; code?: string; message: string } | null>(null);
    const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            try {
                if (activeTab === 'pending') setApprovals(await approvalsApi.getPending());
                else setHistory(await approvalsApi.getHistory());
            } catch (error) {
                console.error(`Failed to fetch approval ${activeTab}`, error);
            } finally {
                setLoading(false);
            }
        };
        void load();
    }, [activeTab]);

    const handleAction = async (id: string, action: 'approve' | 'reject') => {
        const reason = action === 'reject' ? prompt('Please provide a reason for rejection:') : null;
        if (action === 'reject' && !reason) return;
        try {
            setSubmitting(id);
            setActionError(null);
            if (action === 'approve') await approvalsApi.approve(id);
            else await approvalsApi.reject(id, reason!);
            setApprovals(current => current.filter(item => item._id !== id));
        } catch (error: any) {
            const status = error?.response?.status;
            const data = error?.response?.data || {};
            if (status === 409 && data.code === 'INCOMPLETE_ATTENDANCE') {
                const count = Number(data.incompleteEntries || 0);
                setApprovals(current => current.map(item => item._id === id
                    ? {
                        ...item,
                        summary: { ...(item.summary || {}), incompleteEntries: count },
                        approvalReadiness: data.approvalReadiness || item.approvalReadiness,
                    }
                    : item));
                setActionError({
                    id,
                    code: data.code,
                    message: `${count || 'One or more'} incomplete or unpaired attendance ${count === 1 ? 'entry must' : 'entries must'} be corrected before this timesheet can be approved.`,
                });
            } else if (status === 404) {
                setApprovals(current => current.filter(item => item._id !== id));
                setActionError({ id: '', code: 'STALE_REQUEST', message: 'This approval request was already processed or recalled. The queue has been refreshed.' });
            } else {
                console.error('Approval action failed', error);
                setActionError({ id, code: data.code, message: data.error || 'The approval action could not be completed. Please try again.' });
            }
        } finally {
            setSubmitting(null);
        }
    };

    const handleRevert = async (item: any) => {
        const reason = prompt(`Reopen ${item.userName}'s Week ${item.weekNumber} timesheet as a draft?\n\nProvide a reason:`);
        if (!reason || reason.trim().length < 5) {
            if (reason !== null) alert('Reason must be at least 5 characters.');
            return;
        }
        try {
            setSubmitting(item._id);
            await approvalsApi.revert(item._id, reason);
            setHistory(current => current.filter(row => row._id !== item._id));
        } catch (error: any) {
            console.error('Reopen failed', error);
            alert(error.response?.data?.error || 'Failed to reopen timesheet.');
        } finally {
            setSubmitting(null);
        }
    };

    const handleDelete = async (item: any) => {
        if (!confirm(`Delete ${item.userName}'s Week ${item.weekNumber} timesheet permanently?`)) return;
        const reason = prompt('Provide a reason for deletion:');
        if (!reason || reason.trim().length < 5) {
            if (reason !== null) alert('Reason must be at least 5 characters.');
            return;
        }
        try {
            setSubmitting(item._id);
            await approvalsApi.delete(item._id, reason);
            setHistory(current => current.filter(row => row._id !== item._id));
        } catch (error: any) {
            console.error('Delete failed', error);
            alert(error.response?.data?.error || 'Failed to delete timesheet.');
        } finally {
            setSubmitting(null);
        }
    };

    return <div className="mx-auto max-w-6xl space-y-5">
        <div>
            <h1 className="text-2xl font-semibold text-white">Approvals</h1>
            <p className="mt-1 text-sm text-zinc-400">Review submitted timesheets and recent decisions.</p>
        </div>

        <div className="flex border-b border-zinc-800" role="tablist" aria-label="Approval views">
            <button role="tab" aria-selected={activeTab === 'pending'} onClick={() => setActiveTab('pending')} className={cn('border-b-2 px-1 pb-3 pt-1 text-sm font-medium', activeTab === 'pending' ? 'border-teal-500 text-teal-400' : 'border-transparent text-zinc-500 hover:text-zinc-300')}>Pending <span className="ml-1 text-xs">{approvals.length}</span></button>
            <button role="tab" aria-selected={activeTab === 'history'} onClick={() => setActiveTab('history')} className={cn('ml-6 flex items-center gap-2 border-b-2 px-1 pb-3 pt-1 text-sm font-medium', activeTab === 'history' ? 'border-teal-500 text-teal-400' : 'border-transparent text-zinc-500 hover:text-zinc-300')}><History className="h-4 w-4" />History</button>
        </div>

        {actionError?.id === '' && <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">{actionError.message}</div>}

        {loading ? <LoadingState /> : activeTab === 'pending'
            ? <PendingList items={approvals} submitting={submitting} actionError={actionError} onAction={handleAction} />
            : <HistoryList items={history} submitting={submitting} onRevert={handleRevert} onDelete={handleDelete} />}
    </div>;
}

function LoadingState() {
    return <div className="flex min-h-48 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/40 text-sm text-zinc-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading timesheets…</div>;
}

function EmptyState({ history = false }: { history?: boolean }) {
    return <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-6 py-12 text-center"><CheckCircle2 className="mx-auto h-7 w-7 text-zinc-600" /><h2 className="mt-3 text-base font-semibold text-white">{history ? 'No approval history' : 'All caught up!'}</h2><p className="mt-1 text-sm text-zinc-500">{history ? 'Completed decisions will appear here.' : 'There are no timesheets waiting for your review.'}</p></div>;
}

function PendingList({ items, submitting, actionError, onAction }: { items: any[]; submitting: string | null; actionError: { id: string; code?: string; message: string } | null; onAction: (id: string, action: 'approve' | 'reject') => void }) {
    if (!items.length) return <EmptyState />;
    return <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
        <div className="hidden grid-cols-[minmax(220px,1.25fr)_minmax(180px,1fr)_170px_280px] gap-5 border-b border-zinc-800 px-5 py-3 text-xs font-medium text-zinc-500 md:grid"><span>Employee</span><span>Period</span><span>Recorded</span><span className="text-right">Actions</span></div>
        <div className="divide-y divide-zinc-800">{items.map(item => {
            const summary = itemSummary(item);
            const readiness = item.approvalReadiness || {};
            const incompleteEntries = Number(readiness.incompleteEntries ?? item.summary?.incompleteEntries ?? 0);
            const blockingExceptions = Array.isArray(readiness.blockingExceptions) ? readiness.blockingExceptions : [];
            const approvalBlocked = readiness.canApprove === false || incompleteEntries > 0;
            const blocker = actionError?.id === item._id ? actionError : incompleteEntries > 0 ? {
                code: 'INCOMPLETE_ATTENDANCE',
                message: `${incompleteEntries} incomplete or unpaired attendance ${incompleteEntries === 1 ? 'entry must' : 'entries must'} be corrected before this timesheet can be approved.`,
            } : blockingExceptions.length ? {
                code: 'ATTENDANCE_REVIEW_REQUIRED',
                message: `${blockingExceptions.length} attendance ${blockingExceptions.length === 1 ? 'issue requires' : 'issues require'} a decision or correction before approval.`,
            } : null;
            return <div key={item._id} data-testid="approval-row" data-timesheet-id={item._id} className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(220px,1.25fr)_minmax(180px,1fr)_170px_280px] md:items-center md:gap-5">
                <EmployeeCell item={item} />
                <PeriodCell item={item} />
                <div className="text-sm text-zinc-300"><span className="font-medium text-white">{formatDuration(summary.hours * 60)}</span><span className="mx-2 text-zinc-700">·</span>{summary.days} {summary.days === 1 ? 'day' : 'days'}{summary.overtime > 0 && <div className="mt-1 text-xs text-amber-400">{formatDuration(summary.overtime * 60)} overtime</div>}</div>
                <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
                    <Link href={`/timesheets/${item._id}?review=1`} className="inline-flex items-center gap-1 px-2 py-2 text-sm font-medium text-zinc-400 hover:text-white">Review<ChevronRight className="h-4 w-4" /></Link>
                    <button onClick={() => onAction(item._id, 'reject')} disabled={submitting === item._id} className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"><X className="h-4 w-4" />Reject</button>
                    <button onClick={() => onAction(item._id, 'approve')} disabled={submitting === item._id || approvalBlocked} title={approvalBlocked ? 'Review and resolve the attendance issues before approving' : undefined} className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"><Check className="h-4 w-4" />Approve</button>
                </div>
                {blocker && <div role="alert" className="flex flex-col gap-3 rounded-md border border-amber-500/30 bg-amber-500/[0.08] px-4 py-3 md:col-span-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-2.5"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" /><div><p className="text-sm font-medium text-amber-900 dark:text-amber-200">Approval blocked</p><p className="mt-0.5 text-sm text-amber-800 dark:text-amber-300">{blocker.message}</p>{blockingExceptions.slice(0, 3).map((issue: any) => <p key={issue.id} className="mt-1 text-xs text-amber-800/90 dark:text-amber-300/90">{safeFormatDate(issue.occurrenceDate, 'EEE, MMM d')} · {String(issue.type || 'attendance issue').replaceAll('_', ' ')}</p>)}</div></div>
                    <div className="flex shrink-0 gap-3 pl-6 sm:pl-0"><Link href={`/timesheets/${item._id}?review=1`} className="text-sm font-semibold text-[var(--suite-ink)] hover:underline">Review timesheet</Link><Link href={exceptionHref(item)} className="text-sm font-semibold text-[var(--suite-ink)] hover:underline">View exceptions{readiness.openExceptionCount ? ` (${readiness.openExceptionCount})` : ''}</Link></div>
                </div>}
            </div>;
        })}</div>
    </section>;
}

function HistoryList({ items, submitting, onRevert, onDelete }: { items: any[]; submitting: string | null; onRevert: (item: any) => void; onDelete: (item: any) => void }) {
    if (!items.length) return <EmptyState history />;
    return <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
        <div className="hidden grid-cols-[minmax(220px,1.15fr)_minmax(170px,.9fr)_minmax(240px,1.25fr)_230px] gap-5 border-b border-zinc-800 px-5 py-3 text-xs font-medium text-zinc-500 md:grid"><span>Employee</span><span>Period</span><span>Decision</span><span className="text-right">Actions</span></div>
        <div className="divide-y divide-zinc-800">{items.map(item => {
            const actionDate = item.approvedBy?.approvedAt || item.rejectedBy?.rejectedAt || item.revisionRequestedBy?.requestedAt;
            const actionBy = item.approvedBy?.userName || item.rejectedBy?.userName || item.revisionRequestedBy?.userName || 'Unknown reviewer';
            const reason = item.rejectedBy?.reason || item.revisionRequestedBy?.reason;
            return <div key={item._id} className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(220px,1.15fr)_minmax(170px,.9fr)_minmax(240px,1.25fr)_230px] md:items-center md:gap-5">
                <EmployeeCell item={item} />
                <PeriodCell item={item} />
                <div className="min-w-0"><div className="flex items-center gap-2"><StatusBadge status={item.status} /><span className="truncate text-xs text-zinc-500">by {actionBy}</span></div><p className="mt-1 text-xs text-zinc-500">{safeFormatDate(actionDate, 'MMM d, yyyy · HH:mm')}</p>{reason && <p className="mt-1 truncate text-xs text-zinc-400" title={reason}>{reason}</p>}</div>
                <div className="flex flex-wrap items-center justify-start gap-1 md:justify-end">
                    <Link href={`/timesheets/${item._id}`} className="px-3 py-2 text-sm font-medium text-zinc-400 hover:text-white">View</Link>
                    <button onClick={() => onRevert(item)} disabled={submitting === item._id} className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"><RotateCcw className="h-4 w-4" />Reopen</button>
                    <button onClick={() => onDelete(item)} disabled={submitting === item._id} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-zinc-500 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"><Trash2 className="h-4 w-4" />Delete</button>
                </div>
            </div>;
        })}</div>
    </section>;
}

function EmployeeCell({ item }: { item: any }) {
    return <div className="flex min-w-0 items-center gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-xs font-semibold text-zinc-300">{initials(item.userName)}</div><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{item.userName || 'Unknown user'}</p><p className="mt-0.5 truncate text-xs text-zinc-500">{item.userEmail || `Week ${item.weekNumber}`}</p></div></div>;
}

function PeriodCell({ item }: { item: any }) {
    return <div><p className="text-sm font-medium text-zinc-200">Week {item.weekNumber}</p><p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500"><CalendarDays className="h-3.5 w-3.5" />{safeFormatDate(item.startDate, 'MMM d')} – {safeFormatDate(item.endDate, 'MMM d, yyyy')}</p></div>;
}
