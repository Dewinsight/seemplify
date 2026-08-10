'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
    AlertCircle,
    ArrowLeft,
    CalendarDays,
    CheckCircle2,
    Clock3,
    Edit2 as FilePenLine,
    Search,
    ShieldCheck,
    UserRound,
    X,
} from 'lucide-react';
import { exceptionsApi } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

type ExceptionStatus = 'open' | 'correction_requested' | 'resolved' | 'dismissed';

type PeriodContext = {
    timesheetId: string;
    userId: string;
    userName?: string;
    userEmail?: string;
    teamName?: string;
    weekNumber?: number;
    startDate: string;
    endDate: string;
    timezone?: string;
    status?: string;
};

type AttendanceException = {
    _id: string;
    userId: string;
    userName?: string;
    userEmail?: string;
    timesheetId: string;
    type: string;
    severity?: string;
    occurrenceDate: string;
    status: ExceptionStatus;
    description?: string;
    source?: 'system' | 'manager' | 'employee';
    approvalBlocking?: boolean;
    explanation?: { message?: string };
    rule?: { code?: string };
    ruleCode?: string;
    employee?: { userId?: string; name?: string; email?: string; teamName?: string };
    period?: PeriodContext;
    correctionRequest?: {
        explanation?: string;
        requestedAt?: string;
        decision?: 'pending' | 'accepted' | 'rejected';
        reviewedAt?: string;
        reviewNote?: string;
    };
    auditLog?: Array<{ action: string; actorName?: string; at?: string; details?: string }>;
};

const FILTERS: Array<{ value: 'all' | ExceptionStatus; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'open', label: 'Open' },
    { value: 'correction_requested', label: 'Correction requested' },
    { value: 'resolved', label: 'Resolved' },
];

const formatType = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
const formatStatus = (value: string) => value.replaceAll('_', ' ').replace(/^\w/, letter => letter.toUpperCase());
const dateKey = (value: string) => new Date(value).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
const shortDate = (value?: string, timezone = 'UTC') => value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: timezone }) : 'Date unavailable';

function Status({ value }: { value: ExceptionStatus }) {
    const styles = value === 'resolved'
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
        : value === 'correction_requested'
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'
            : 'border-[var(--suite-line-strong)] bg-[var(--suite-surface-muted)] text-[var(--suite-muted)]';
    return <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${styles}`}>{formatStatus(value)}</span>;
}

export default function ExceptionsPage() {
    const params = useSearchParams();
    const { user } = useAuth();
    const [items, setItems] = useState<AttendanceException[]>([]);
    const [context, setContext] = useState<PeriodContext | null>(null);
    const [disclaimer, setDisclaimer] = useState('');
    const [filter, setFilter] = useState<'all' | ExceptionStatus>('all');
    const [query, setQuery] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [editing, setEditing] = useState<AttendanceException | null>(null);
    const [explanation, setExplanation] = useState('');
    const [reviewing, setReviewing] = useState<{ item: AttendanceException; accepted: boolean } | null>(null);
    const [reviewNote, setReviewNote] = useState('');
    const targetUserId = params.get('userId') || undefined;
    const timesheetId = params.get('timesheetId') || undefined;
    const focusedExceptionId = params.get('exceptionId') || undefined;
    const start = params.get('start') || undefined;
    const end = params.get('end') || undefined;
    const returnToValue = params.get('returnTo');
    const returnTo = returnToValue?.startsWith('/') && !returnToValue.startsWith('//') ? returnToValue : undefined;

    const load = useCallback(async () => {
        const data = await exceptionsApi.list({ userId: targetUserId, timesheetId, start, end });
        setItems(data.exceptions || []);
        setContext(data.context || null);
        setDisclaimer(data.disclaimer);
    }, [end, start, targetUserId, timesheetId]);

    useEffect(() => {
        void load().catch((requestError: any) => setError(requestError?.response?.data?.error || 'Exceptions could not be loaded.'));
    }, [load]);

    const counts = useMemo(() => ({
        all: items.length,
        open: items.filter(item => item.status === 'open').length,
        correction_requested: items.filter(item => item.status === 'correction_requested').length,
        resolved: items.filter(item => item.status === 'resolved').length,
    }), [items]);

    const groupedItems = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        const visible = items.filter(item => {
            if (filter !== 'all' && item.status !== filter) return false;
            if (!normalizedQuery) return true;
            return [
                item.type, item.description, item.explanation?.message, item.rule?.code, item.ruleCode,
                item.employee?.name, item.employee?.email, item.employee?.teamName,
                item.correctionRequest?.explanation, item.correctionRequest?.reviewNote,
            ].filter(Boolean).some(value => String(value).toLowerCase().includes(normalizedQuery));
        });
        return visible.reduce<Array<{ date: string; items: AttendanceException[] }>>((groups, item) => {
            const date = dateKey(item.occurrenceDate);
            const existing = groups.find(group => group.date === date);
            if (existing) existing.items.push(item);
            else groups.push({ date, items: [item] });
            return groups;
        }, []);
    }, [filter, items, query]);

    const submit = async () => {
        if (!editing || !explanation.trim()) return;
        try {
            setError('');
            await exceptionsApi.requestCorrection(editing._id, { explanation, evidence: [] });
            setEditing(null);
            setExplanation('');
            setMessage('Correction request submitted with a full audit trail.');
            await load();
        } catch (requestError: any) {
            setError(requestError?.response?.data?.error || 'The correction request could not be submitted.');
        }
    };

    const review = async () => {
        if (!reviewing || reviewNote.trim().length < 3) return;
        try {
            setError('');
            await exceptionsApi.review(reviewing.item._id, reviewing.accepted, reviewNote.trim());
            setMessage(reviewing.accepted ? 'The correction was accepted and the reason was recorded.' : 'The correction was not accepted; the reason was shared with the employee.');
            setReviewing(null);
            setReviewNote('');
            await load();
        } catch (requestError: any) {
            setError(requestError?.response?.data?.error || 'The exception decision could not be saved.');
        }
    };

    const visibleCount = groupedItems.reduce((total, group) => total + group.items.length, 0);

    return <div className="space-y-6">
        <div>
            <h1 className="text-2xl font-semibold text-[var(--suite-ink)]">Attendance exceptions</h1>
            <p className="mt-1 text-sm text-[var(--suite-muted)]">See who an issue belongs to, the exact period and day, and every correction decision.</p>
        </div>

        {context && <section aria-label="Selected timesheet context" className="rounded-lg border border-[var(--suite-line-strong)] bg-[var(--suite-surface)] px-5 py-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--suite-subtle)]">Filtered timesheet review</p>
                    <h2 className="mt-1 text-base font-semibold text-[var(--suite-ink)]">{context.userName || 'Employee'} · Week {context.weekNumber || '—'}</h2>
                    <p className="mt-1 text-sm text-[var(--suite-muted)]">{context.userEmail}{context.teamName ? ` · ${context.teamName}` : ''}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-[var(--suite-muted)]"><CalendarDays className="h-4 w-4" />{shortDate(context.startDate, context.timezone)} – {shortDate(context.endDate, context.timezone)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {returnTo && <Link href={returnTo} className="inline-flex items-center gap-2 rounded-md border border-[var(--suite-line-strong)] px-3 py-2 text-sm font-medium text-[var(--suite-ink)] hover:bg-[var(--suite-surface-muted)]"><ArrowLeft className="h-4 w-4" />Back to review</Link>}
                    <Link href={`/timesheets/${context.timesheetId}?review=1`} className="rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500">Open timesheet</Link>
                </div>
            </div>
        </section>}

        <div className="flex items-start gap-3 rounded-lg border border-[var(--suite-line)] bg-[var(--suite-surface)] px-4 py-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
            <p className="text-sm leading-6 text-[var(--suite-muted)]">{disclaimer || 'Exceptions are review flags only and never make automatic employment decisions.'}</p>
        </div>

        {(message || error) && <div role={error ? 'alert' : 'status'} className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm font-medium ${error ? 'border-red-600/30 bg-red-500/10 text-red-800 dark:text-red-200' : 'border-emerald-600/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'}`}>
            <span>{error || message}</span>
            <button type="button" onClick={() => { setMessage(''); setError(''); }} aria-label="Dismiss message" className="rounded-md p-1 text-current hover:bg-black/5"><X className="h-4 w-4" /></button>
        </div>}

        <div className="border-b border-[var(--suite-line)]">
            <div className="flex flex-col gap-4 pb-3 sm:flex-row sm:items-end sm:justify-between">
                <div role="tablist" aria-label="Exception status" className="flex min-w-0 gap-5 overflow-x-auto">
                    {FILTERS.map(option => <button key={option.value} type="button" role="tab" aria-selected={filter === option.value} onClick={() => setFilter(option.value)} className={`whitespace-nowrap border-b-2 pb-3 text-sm font-medium transition-colors ${filter === option.value ? 'border-teal-500 text-[var(--suite-ink)]' : 'border-transparent text-[var(--suite-muted)] hover:text-[var(--suite-ink)]'}`}>{option.label} <span className="ml-1 text-xs tabular-nums text-[var(--suite-subtle)]">{counts[option.value]}</span></button>)}
                </div>
                <label className="relative block w-full sm:w-72">
                    <span className="sr-only">Search exceptions or employees</span>
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--suite-subtle)]" />
                    <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search employee or exception" className="h-9 w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-surface)] pl-9 pr-3 text-sm text-[var(--suite-ink)] outline-none placeholder:text-[var(--suite-subtle)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15" />
                </label>
            </div>
        </div>

        <div className="flex items-center justify-between text-sm text-[var(--suite-muted)]"><span>{visibleCount} {visibleCount === 1 ? 'exception' : 'exceptions'}</span>{query && <button type="button" onClick={() => setQuery('')} className="font-medium text-[var(--suite-ink)] hover:underline">Clear search</button>}</div>

        {groupedItems.length ? <section aria-label="Exception list" className="overflow-hidden rounded-lg border border-[var(--suite-line-strong)] bg-[var(--suite-surface)]">
            {groupedItems.map((group, groupIndex) => <div key={group.date}>
                <div className={`flex items-center justify-between bg-[var(--suite-surface-muted)] px-5 py-2.5 ${groupIndex ? 'border-t border-[var(--suite-line-strong)]' : ''}`}><h2 className="text-sm font-semibold text-[var(--suite-ink)]">{group.date}</h2><span className="text-xs tabular-nums text-[var(--suite-muted)]">{group.items.length}</span></div>
                {group.items.map(item => {
                    const isOwn = String(item.userId || item.employee?.userId) === String(user?.id);
                    const employeeName = item.employee?.name || item.userName || 'Unknown employee';
                    const employeeEmail = item.employee?.email || item.userEmail;
                    const period = item.period;
                    return <article key={item._id} id={`exception-${item._id}`} data-testid="exception-row" className={`border-t border-[var(--suite-line)] px-5 py-4 first:border-t-0 ${focusedExceptionId === item._id ? 'bg-amber-500/[0.06]' : ''}`}>
                        <div className="grid gap-4 md:grid-cols-[minmax(170px,.8fr)_minmax(0,1.6fr)_auto] md:items-start">
                            <div className="flex min-w-0 gap-2.5">
                                <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-[var(--suite-muted)]" />
                                <div className="min-w-0"><p className="truncate text-sm font-semibold text-[var(--suite-ink)]">{employeeName}</p>{employeeEmail && <p className="mt-0.5 truncate text-xs text-[var(--suite-subtle)]">{employeeEmail}</p>}<p className="mt-1 text-xs text-[var(--suite-muted)]">{item.employee?.teamName || 'Team not recorded'}</p></div>
                            </div>
                            <div className="flex min-w-0 gap-3">
                                {item.status === 'resolved' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" /> : item.status === 'correction_requested' ? <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" /> : <AlertCircle className={`mt-0.5 h-4 w-4 shrink-0 ${item.severity === 'high' ? 'text-red-600 dark:text-red-400' : 'text-[var(--suite-muted)]'}`} />}
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-[var(--suite-ink)]">{formatType(item.type)}</h3><Status value={item.status} />{item.approvalBlocking && <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Blocks approval</span>}</div>
                                    <p className="mt-1 text-sm leading-6 text-[var(--suite-muted)]">{item.explanation?.message || item.description || 'This attendance record matched the configured exception rule.'}</p>
                                    <p className="mt-1.5 text-xs text-[var(--suite-subtle)]">{period ? `Week ${period.weekNumber || '—'} · ${shortDate(period.startDate, period.timezone)} – ${shortDate(period.endDate, period.timezone)} · ` : ''}Rule {item.rule?.code || item.ruleCode || 'configured policy'}</p>
                                </div>
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
                                {period?.timesheetId && <Link href={`/timesheets/${period.timesheetId}?review=${isOwn ? '0' : '1'}`} className="rounded-md border border-[var(--suite-line-strong)] px-3 py-1.5 text-xs font-medium text-[var(--suite-ink)] hover:bg-[var(--suite-surface-muted)]">View day</Link>}
                                {isOwn && item.status === 'open' && <button onClick={() => setEditing(item)} className="inline-flex items-center gap-2 rounded-md border border-[var(--suite-line-strong)] px-3 py-1.5 text-xs font-medium text-[var(--suite-ink)] hover:bg-[var(--suite-surface-muted)]"><FilePenLine className="h-3.5 w-3.5" />Request correction</button>}
                                {!isOwn && item.status === 'correction_requested' && <><button onClick={() => setReviewing({ item, accepted: true })} className="rounded-md border border-teal-600/40 px-3 py-1.5 text-xs font-medium text-teal-700 dark:text-teal-300">Accept</button><button onClick={() => setReviewing({ item, accepted: false })} className="rounded-md border border-[var(--suite-line-strong)] px-3 py-1.5 text-xs font-medium text-[var(--suite-muted)]">Do not accept</button></>}
                            </div>
                        </div>
                        {item.correctionRequest?.explanation && <div data-testid="employee-explanation" className="mt-4 rounded-md border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3 md:ml-[calc(170px+1rem)]">
                            <div className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300"><Clock3 className="h-3.5 w-3.5" />Employee correction request · {item.correctionRequest.decision === 'pending' || !item.correctionRequest.decision ? 'Awaiting review' : formatStatus(item.correctionRequest.decision)}</div>
                            <p className="mt-1.5 text-sm leading-6 text-[var(--suite-ink)]">{item.correctionRequest.explanation}</p>
                            {item.correctionRequest.reviewNote && <div className="mt-3 border-t border-amber-500/20 pt-3"><p className="text-xs font-semibold text-[var(--suite-ink)]">Reviewer decision reason</p><p className="mt-1 text-sm text-[var(--suite-muted)]">{item.correctionRequest.reviewNote}</p></div>}
                        </div>}
                        {!!item.auditLog?.length && <details className="mt-3 text-xs text-[var(--suite-muted)] md:ml-[calc(170px+1rem)]"><summary className="cursor-pointer font-medium text-[var(--suite-ink)]">View audit history ({item.auditLog.length})</summary><ol className="mt-2 space-y-2 border-l border-[var(--suite-line-strong)] pl-3">{item.auditLog.map((entry, index) => <li key={`${entry.action}-${index}`}><span className="font-medium">{formatType(entry.action)}</span>{entry.actorName ? ` by ${entry.actorName}` : ''}{entry.at ? ` · ${shortDate(entry.at)}` : ''}{entry.details ? <p className="mt-0.5">{entry.details}</p> : null}</li>)}</ol></details>}
                    </article>;
                })}
            </div>)}
        </section> : <div className="rounded-lg border border-dashed border-[var(--suite-line-strong)] bg-[var(--suite-surface)] px-6 py-12 text-center"><p className="text-sm font-medium text-[var(--suite-ink)]">No exceptions found</p><p className="mt-1 text-sm text-[var(--suite-muted)]">This employee and period have no exceptions matching the selected status.</p></div>}

        {editing && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"><div role="dialog" aria-modal="true" aria-labelledby="correction-title" className="w-full max-w-lg rounded-lg border border-[var(--suite-line-strong)] bg-[var(--suite-surface)] p-6 shadow-lg"><h2 id="correction-title" className="text-base font-semibold text-[var(--suite-ink)]">Explain the correction</h2><p className="mt-2 text-sm leading-6 text-[var(--suite-muted)]">Describe what happened on {dateKey(editing.occurrenceDate)} and the change you are requesting. Your manager’s decision and reason will remain visible here.</p><label className="mt-4 block text-sm font-medium text-[var(--suite-ink)]" htmlFor="correction-explanation">Employee explanation</label><textarea id="correction-explanation" autoFocus value={explanation} onChange={event => setExplanation(event.target.value)} rows={6} className="mt-2 w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] p-3 text-sm text-[var(--suite-ink)] outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15" /><div className="mt-4 flex justify-end gap-2"><button onClick={() => setEditing(null)} className="rounded-md px-3 py-2 text-sm font-medium text-[var(--suite-muted)] hover:bg-[var(--suite-surface-muted)]">Cancel</button><button onClick={submit} disabled={!explanation.trim()} className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-teal-600 dark:hover:bg-teal-500">Submit request</button></div></div></div>}

        {reviewing && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"><div role="dialog" aria-modal="true" aria-labelledby="review-title" className="w-full max-w-lg rounded-lg border border-[var(--suite-line-strong)] bg-[var(--suite-surface)] p-6 shadow-lg"><h2 id="review-title" className="text-base font-semibold text-[var(--suite-ink)]">{reviewing.accepted ? 'Accept correction request' : 'Do not accept correction request'}</h2><p className="mt-2 text-sm leading-6 text-[var(--suite-muted)]">Record why you made this decision. The employee will see this reason and it will be kept in the audit history.</p><div className="mt-4 rounded-md border border-[var(--suite-line)] bg-[var(--suite-surface-muted)] px-3 py-2 text-sm text-[var(--suite-ink)]">{reviewing.item.correctionRequest?.explanation}</div><label className="mt-4 block text-sm font-medium text-[var(--suite-ink)]" htmlFor="review-note">Decision reason</label><textarea id="review-note" autoFocus value={reviewNote} onChange={event => setReviewNote(event.target.value)} rows={4} className="mt-2 w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] p-3 text-sm text-[var(--suite-ink)] outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15" /><div className="mt-4 flex justify-end gap-2"><button onClick={() => { setReviewing(null); setReviewNote(''); }} className="rounded-md px-3 py-2 text-sm font-medium text-[var(--suite-muted)] hover:bg-[var(--suite-surface-muted)]">Cancel</button><button onClick={review} disabled={reviewNote.trim().length < 3} className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-teal-600 dark:hover:bg-teal-500">Save decision</button></div></div></div>}
    </div>;
}
