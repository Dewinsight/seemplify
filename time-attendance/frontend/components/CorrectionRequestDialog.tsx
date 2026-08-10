'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clock3, Route } from 'lucide-react';

export type CorrectionRequestPayload = {
    explanation: string;
    evidence: never[];
    requestedChanges: {
        workDate: string;
        timezone: string;
        clockIn: string;
        clockOut: string;
        breakStart?: string;
        breakEnd?: string;
    };
};

type Props = {
    date: string;
    reviewerLabel: string;
    submitting?: boolean;
    onCancel: () => void;
    onSubmit: (payload: CorrectionRequestPayload) => Promise<void> | void;
};

export default function CorrectionRequestDialog({ date, reviewerLabel, submitting = false, onCancel, onSubmit }: Props) {
    const workDate = useMemo(() => {
        const value = new Date(date);
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day = String(value.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }, [date]);
    const [clockIn, setClockIn] = useState('09:00');
    const [clockOut, setClockOut] = useState('17:00');
    const [includeBreak, setIncludeBreak] = useState(false);
    const [breakStart, setBreakStart] = useState('13:00');
    const [breakEnd, setBreakEnd] = useState('13:30');
    const [explanation, setExplanation] = useState('');
    const [validation, setValidation] = useState('');

    useEffect(() => {
        setClockIn('09:00');
        setClockOut('17:00');
        setIncludeBreak(false);
        setBreakStart('13:00');
        setBreakEnd('13:30');
        setExplanation('');
        setValidation('');
    }, [date]);

    const buildTimestamp = (time: string) => new Date(`${workDate}T${time}:00`).toISOString();
    const submit = async () => {
        const start = new Date(`${workDate}T${clockIn}:00`);
        const end = new Date(`${workDate}T${clockOut}:00`);
        if (!clockIn || !clockOut || end <= start) return setValidation('Clock-out must be after clock-in.');
        if (includeBreak) {
            const breakStartDate = new Date(`${workDate}T${breakStart}:00`);
            const breakEndDate = new Date(`${workDate}T${breakEnd}:00`);
            if (!breakStart || !breakEnd || breakStartDate <= start || breakEndDate >= end || breakEndDate <= breakStartDate) {
                return setValidation('Break times must be in order and inside the work session.');
            }
        }
        if (explanation.trim().length < 5) return setValidation('Add a short explanation of why these times should replace the current record.');
        setValidation('');
        await onSubmit({
            explanation: explanation.trim(),
            evidence: [],
            requestedChanges: {
                workDate,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
                clockIn: buildTimestamp(clockIn),
                clockOut: buildTimestamp(clockOut),
                ...(includeBreak ? { breakStart: buildTimestamp(breakStart), breakEnd: buildTimestamp(breakEnd) } : {}),
            },
        });
    };

    return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
        <div role="dialog" aria-modal="true" aria-labelledby="correction-request-title" className="w-full max-w-xl rounded-lg border border-[var(--suite-line-strong)] bg-[var(--suite-surface)] p-6 shadow-lg">
            <h2 id="correction-request-title" className="text-lg font-semibold text-[var(--suite-ink)]">Request a time correction</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--suite-muted)]">Enter the times that should replace the current record for this day.</p>

            <div className="mt-4 flex items-start gap-3 rounded-md border border-[var(--suite-line)] bg-[var(--suite-surface-muted)] px-3 py-3">
                <Route className="mt-0.5 h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                <div><p className="text-sm font-medium text-[var(--suite-ink)]">Sent to {reviewerLabel}</p><p className="mt-0.5 text-xs leading-5 text-[var(--suite-muted)]">The reviewer must approve or reject it. You cannot approve your own request, even if you also have admin access.</p></div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-3">
                <label className="text-sm font-medium text-[var(--suite-ink)]">Work date<input type="date" value={workDate} readOnly className="mt-2 h-10 w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-surface-muted)] px-3 text-sm text-[var(--suite-muted)]" /></label>
                <label className="text-sm font-medium text-[var(--suite-ink)]">Clock in<input type="time" value={clockIn} onChange={event => setClockIn(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] px-3 text-sm text-[var(--suite-ink)]" /></label>
                <label className="text-sm font-medium text-[var(--suite-ink)]">Clock out<input type="time" value={clockOut} onChange={event => setClockOut(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] px-3 text-sm text-[var(--suite-ink)]" /></label>
            </div>

            <label className="mt-4 flex items-center gap-2 text-sm text-[var(--suite-ink)]"><input type="checkbox" checked={includeBreak} onChange={event => setIncludeBreak(event.target.checked)} className="h-4 w-4 accent-teal-600" />Include a corrected break</label>
            {includeBreak && <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-[var(--suite-ink)]">Break start<input type="time" value={breakStart} onChange={event => setBreakStart(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] px-3 text-sm text-[var(--suite-ink)]" /></label>
                <label className="text-sm font-medium text-[var(--suite-ink)]">Break end<input type="time" value={breakEnd} onChange={event => setBreakEnd(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] px-3 text-sm text-[var(--suite-ink)]" /></label>
            </div>}

            <label className="mt-4 block text-sm font-medium text-[var(--suite-ink)]" htmlFor="correction-request-explanation">Why should this be corrected?</label>
            <textarea id="correction-request-explanation" value={explanation} onChange={event => setExplanation(event.target.value)} rows={4} placeholder="Explain what happened and why these times are accurate." className="mt-2 w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] p-3 text-sm text-[var(--suite-ink)] outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15" />
            {validation && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{validation}</p>}

            <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={onCancel} disabled={submitting} className="rounded-md px-3 py-2 text-sm font-medium text-[var(--suite-muted)] hover:bg-[var(--suite-surface-muted)]">Cancel</button>
                <button type="button" onClick={submit} disabled={submitting} className="inline-flex items-center gap-2 rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-teal-600 dark:hover:bg-teal-500"><Clock3 className="h-4 w-4" />{submitting ? 'Sending…' : 'Send correction request'}</button>
            </div>
        </div>
    </div>;
}
