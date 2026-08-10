'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { authApi, isAuthenticated } from '@/lib/api';
import { usePayrollCurrencies } from '@/lib/usePayrollCurrencies';
import Link from 'next/link';
import {
    FileText,
    Plus,
    Clock,
    CheckCircle,
    XCircle,
    Loader2,
    Calendar,
    DollarSign,
    ArrowLeft
} from 'lucide-react';

const overtimeActivityLabels: Record<string, string> = {
    external_meeting: 'External meeting',
    field_sales: 'Field sales',
    client_site: 'Client-site work',
    travel: 'Work-related travel',
    event_support: 'Event support',
    after_hours_support: 'After-hours support',
    weekend_work: 'Weekend work',
    other: 'Other off-system work',
};

const emptyRequest = () => ({
    type: 'overtime',
    amount: '',
    currency: 'USD',
    overtimeHours: '',
    overtimeMultiplier: '1.5',
    reason: '',
    effectiveDate: new Date().toISOString().split('T')[0],
    activityType: 'external_meeting',
    startedAt: '',
    endedAt: '',
    workLocation: '',
    clientOrProject: '',
    evidenceReference: '',
    confirmedNotInTimesheet: false,
});

/* 
  Request Status Badge Component 
*/
const StatusBadge = ({ status }: { status: string }) => {
    switch (status) {
        case 'processed':
        case 'approved':
        case 'approved_l1':
        case 'approved_l2':
            return (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Approved
                </span>
            );
        case 'rejected':
            return (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                    <XCircle className="w-3.5 h-3.5" />
                    Rejected
                </span>
            );
        case 'pending':
        default:
            return (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <Clock className="w-3.5 h-3.5" />
                    Pending
                </span>
            );
    }
};

export default function MyRequestsPage() {
    const router = useRouter();
    const { paymentCurrencies: currencies } = usePayrollCurrencies();
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [requests, setRequests] = useState<any[]>([]);
    const [showNewModal, setShowNewModal] = useState(false);
    const [user, setUser] = useState<any>(null);
    const [submitError, setSubmitError] = useState('');

    // New Request Form State
    const [formData, setFormData] = useState(emptyRequest);

    useEffect(() => {
        if (currencies.length > 0 && !currencies.some((currency) => currency.code === formData.currency)) {
            setFormData((current) => ({ ...current, currency: currencies[0].code }));
        }
    }, [currencies, formData.currency]);

    useEffect(() => {
        if (!isAuthenticated()) {
            router.push('/login');
            return;
        }

        const fetchData = async () => {
            try {
                const userRes = await authApi.getMe();
                setUser(userRes.user);

                // Fetch My Requests
                const requestsRes = await api.get('/compensation/team?mode=my');
                setRequests(requestsRes.data);
            } catch (error) {
                console.error('Failed to fetch data:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setSubmitError('');

        try {
            const isOvertime = formData.type === 'overtime';
            const startedAt = isOvertime && formData.startedAt
                ? new Date(`${formData.effectiveDate}T${formData.startedAt}:00`).toISOString()
                : undefined;
            const endedAt = isOvertime && formData.endedAt
                ? new Date(`${formData.effectiveDate}T${formData.endedAt}:00`).toISOString()
                : undefined;
            await api.post('/compensation/request', {
                userId: user.id, // Requesting for self
                userName: user.name,
                type: formData.type,
                amount: formData.amount,
                currency: formData.currency,
                overtimeHours: formData.overtimeHours,
                overtimeMultiplier: formData.overtimeMultiplier,
                reason: formData.reason,
                effectiveDate: formData.effectiveDate,
                overtimeContext: isOvertime ? {
                    captureMethod: 'manual_external_work',
                    activityType: formData.activityType,
                    startedAt,
                    endedAt,
                    workLocation: formData.workLocation,
                    clientOrProject: formData.clientOrProject,
                    evidenceReference: formData.evidenceReference,
                    confirmedNotInTimesheet: formData.confirmedNotInTimesheet,
                } : undefined,
            });

            // Refresh list
            const res = await api.get('/compensation/team?mode=my');
            setRequests(res.data);

            setShowNewModal(false);
            setFormData(emptyRequest());
        } catch (error: any) {
            setSubmitError(error?.response?.data?.error || 'Failed to submit request.');
        } finally {
            setSubmitting(false);
        }
    };

    const updateOvertimeTime = (field: 'startedAt' | 'endedAt', value: string) => {
        setFormData((current) => {
            const next = { ...current, [field]: value };
            if (next.startedAt && next.endedAt) {
                const start = new Date(`${next.effectiveDate}T${next.startedAt}:00`);
                const end = new Date(`${next.effectiveDate}T${next.endedAt}:00`);
                const elapsed = (end.getTime() - start.getTime()) / 3600000;
                if (elapsed > 0) next.overtimeHours = String(Math.round(elapsed * 4) / 4);
            }
            return next;
        });
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-200 p-8 pb-20">
            {/* Header */}
            <div className="max-w-5xl mx-auto mb-8 flex items-center justify-between">
                <div>
                    <Link
                        href="/dashboard"
                        className="inline-flex items-center text-sm text-zinc-400 hover:text-amber-400 mb-2 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4 mr-1" />
                        Back to Dashboard
                    </Link>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
                        My Requests
                    </h1>
                    <p className="text-zinc-500 mt-1">Manage your overtime and reimbursement claims</p>
                </div>

                <button
                    onClick={() => setShowNewModal(true)}
                    className="flex items-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white px-4 py-2.5 rounded-lg font-medium shadow-lg shadow-amber-500/20 hover:scale-105 transition-all"
                >
                    <Plus className="w-4 h-4" />
                    New Request
                </button>
            </div>

            {/* Requests List */}
            <div className="max-w-5xl mx-auto space-y-4">
                {requests.length === 0 ? (
                    <div className="text-center py-20 bg-zinc-900/50 border border-zinc-800 rounded-2xl">
                        <div className="w-16 h-16 bg-zinc-800/50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                            <FileText className="w-8 h-8 text-zinc-600" />
                        </div>
                        <h3 className="text-zinc-300 font-medium mb-1">No requests yet</h3>
                        <p className="text-zinc-500 text-sm">Create a request to claim overtime or expenses.</p>
                    </div>
                ) : (
                    requests.map((req) => (
                        <div
                            key={req._id}
                            className="bg-zinc-900/80 border border-zinc-800/50 rounded-xl p-5 flex items-center justify-between hover:border-zinc-700 transition-colors"
                        >
                            <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${req.type === 'overtime' ? 'bg-amber-500/10 text-amber-500' : 'bg-blue-500/10 text-blue-500'
                                    }`}>
                                    {req.type === 'overtime' ? <Clock className="w-6 h-6" /> : <DollarSign className="w-6 h-6" />}
                                </div>
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <h3 className="font-semibold text-zinc-200 capitalize">{req.type.replace('_', ' ')} Request</h3>
                                        <StatusBadge status={req.status} />
                                    </div>
                                    <p className="text-sm text-zinc-400 flex items-center gap-3">
                                        <span className="flex items-center gap-1">
                                            <Calendar className="w-3.5 h-3.5" />
                                            {new Date(req.effectiveDate).toLocaleDateString()}
                                        </span>
                                        <span className="w-1 h-1 bg-zinc-700 rounded-full" />
                                        <span>{req.reason}</span>
                                    </p>
                                    {req.overtimeContext?.activityType && (
                                        <p className="mt-1 text-xs text-zinc-500">
                                            {overtimeActivityLabels[req.overtimeContext.activityType] || 'Off-system work'}
                                            {req.overtimeContext.clientOrProject ? ` · ${req.overtimeContext.clientOrProject}` : ''}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-xl font-bold text-zinc-100">
                                    {req.type === 'overtime' && req.overtimeHours
                                        ? `${req.overtimeHours}h @ ${req.overtimeMultiplier || 1.5}x`
                                        : `${req.currency || 'USD'} ${Number(req.amount || 0).toFixed(2)}`}
                                </p>
                                <p className="text-xs text-zinc-500 mt-1">{req.type === 'overtime' ? 'Hours' : 'Amount'}</p>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* New Request Modal */}
            {showNewModal && (
                <div className="payroll-dialog-shell" role="presentation">
                    <div className="payroll-dialog max-h-[90vh] max-w-2xl overflow-y-auto p-6" role="dialog" aria-modal="true" aria-labelledby="new-request-title">
                        <button
                            onClick={() => setShowNewModal(false)}
                            className="payroll-dialog-close absolute right-4 top-4"
                            aria-label="Close new request"
                        >
                            <XCircle className="h-5 w-5" />
                        </button>

                        <h2 id="new-request-title" className="payroll-dialog-title mb-6 flex items-center gap-2 pr-10 text-xl font-semibold">
                            <Plus className="h-5 w-5" style={{ color: 'var(--payroll-popup-accent)' }} />
                            New Request
                        </h2>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="payroll-field-label">Request Type</label>
                                <select
                                    value={formData.type}
                                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                                    className="payroll-field"
                                >
                                    <option value="overtime">Overtime</option>
                                    <option value="reimbursement">Reimbursement / Expense</option>
                                </select>
                            </div>

                            {formData.type !== 'overtime' && <div>
                                <label className="payroll-field-label">
                                    Amount
                                </label>
                                <div className="grid grid-cols-3 gap-3">
                                    <input
                                        type="number"
                                        required
                                        min="0"
                                        step="0.01"
                                        value={formData.amount}
                                        onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                                        className="payroll-field col-span-2"
                                        placeholder="0.00"
                                    />
                                    <select
                                        value={formData.currency}
                                        onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                                        className="payroll-field"
                                    >
                                        {currencies.map((currency) => (
                                            <option key={currency.code} value={currency.code}>
                                                {currency.code}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>}

                            {formData.type === 'overtime' && (
                                <div className="space-y-4 border-t border-[var(--suite-line)] pt-4">
                                    <div>
                                        <label htmlFor="overtime-activity" className="payroll-field-label">Work activity</label>
                                        <select id="overtime-activity" value={formData.activityType} onChange={(e) => setFormData({ ...formData, activityType: e.target.value })} className="payroll-field">
                                            {Object.entries(overtimeActivityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                        </select>
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-3">
                                        <div>
                                            <label htmlFor="overtime-date" className="payroll-field-label">Date</label>
                                            <input id="overtime-date" type="date" required max={new Date().toISOString().split('T')[0]} value={formData.effectiveDate} onChange={(e) => setFormData({ ...formData, effectiveDate: e.target.value })} className="payroll-field" />
                                        </div>
                                        <div>
                                            <label htmlFor="overtime-start" className="payroll-field-label">Started</label>
                                            <input id="overtime-start" type="time" required value={formData.startedAt} onChange={(e) => updateOvertimeTime('startedAt', e.target.value)} className="payroll-field" />
                                        </div>
                                        <div>
                                            <label htmlFor="overtime-end" className="payroll-field-label">Ended</label>
                                            <input id="overtime-end" type="time" required value={formData.endedAt} onChange={(e) => updateOvertimeTime('endedAt', e.target.value)} className="payroll-field" />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label htmlFor="overtime-hours" className="payroll-field-label">Payable hours</label>
                                        <input
                                            id="overtime-hours"
                                            type="number"
                                            required
                                            min="0.25"
                                            max="24"
                                            step="0.25"
                                            value={formData.overtimeHours}
                                            onChange={(e) => setFormData({ ...formData, overtimeHours: e.target.value })}
                                            className="payroll-field"
                                            placeholder="e.g. 2"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="overtime-multiplier" className="payroll-field-label">Multiplier</label>
                                        <select
                                            id="overtime-multiplier"
                                            value={formData.overtimeMultiplier}
                                            onChange={(e) => setFormData({ ...formData, overtimeMultiplier: e.target.value })}
                                            className="payroll-field"
                                        >
                                            <option value="1">1.0x</option>
                                            <option value="1.5">1.5x</option>
                                            <option value="2">2.0x</option>
                                        </select>
                                    </div>
                                    </div>
                                    <p className="payroll-field-help text-xs">Payroll calculates the amount from the worker&apos;s configured rate and the approved multiplier.</p>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div>
                                            <label htmlFor="overtime-project" className="payroll-field-label">Client or project</label>
                                            <input id="overtime-project" value={formData.clientOrProject} onChange={(e) => setFormData({ ...formData, clientOrProject: e.target.value })} className="payroll-field" placeholder="Client, opportunity, or project" maxLength={200} />
                                        </div>
                                        <div>
                                            <label htmlFor="overtime-location" className="payroll-field-label">Work location</label>
                                            <input id="overtime-location" value={formData.workLocation} onChange={(e) => setFormData({ ...formData, workLocation: e.target.value })} className="payroll-field" placeholder="Customer office, venue, or area" maxLength={200} />
                                        </div>
                                    </div>
                                    <div>
                                        <label htmlFor="overtime-evidence" className="payroll-field-label">Supporting reference</label>
                                        <input id="overtime-evidence" value={formData.evidenceReference} onChange={(e) => setFormData({ ...formData, evidenceReference: e.target.value })} className="payroll-field" placeholder="Calendar event, CRM activity, ticket, or document reference" maxLength={500} />
                                    </div>
                                    <label className="flex items-start gap-3 rounded-md border border-[var(--suite-line)] p-3 text-sm text-[var(--suite-muted)]">
                                        <input type="checkbox" required checked={formData.confirmedNotInTimesheet} onChange={(e) => setFormData({ ...formData, confirmedNotInTimesheet: e.target.checked })} className="mt-0.5 h-4 w-4" />
                                        <span>I confirm these hours are not already included in an approved timesheet. If they are, the timesheet should be corrected instead.</span>
                                    </label>
                                </div>
                            )}

                            {formData.type !== 'overtime' && <div>
                                <label className="payroll-field-label">Date</label>
                                <input
                                    type="date"
                                    required
                                    value={formData.effectiveDate}
                                    onChange={(e) => setFormData({ ...formData, effectiveDate: e.target.value })}
                                    className="payroll-field"
                                />
                            </div>}

                            <div>
                                <label className="payroll-field-label">Reason / Description</label>
                                <textarea
                                    required
                                    rows={3}
                                    value={formData.reason}
                                    onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                                    className="payroll-field"
                                    minLength={10}
                                    placeholder={formData.type === 'overtime' ? 'Describe the meeting, field activity, outcome, and why it occurred outside normal hours.' : 'Describe the expense and business purpose.'}
                                />
                            </div>

                            {submitError && <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{submitError}</p>}

                            <div className="pt-4 flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowNewModal(false)}
                                    className="payroll-button-secondary flex-1"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting || (formData.type === 'overtime' && !formData.confirmedNotInTimesheet)}
                                    className="payroll-button-primary flex-1"
                                >
                                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : formData.type === 'overtime' ? 'Submit overtime' : 'Submit request'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
