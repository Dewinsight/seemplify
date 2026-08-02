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
    Briefcase,
    CheckCircle,
    XCircle,
    AlertCircle,
    Loader2,
    Calendar,
    DollarSign,
    ArrowLeft
} from 'lucide-react';

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
    const { currencies } = usePayrollCurrencies();
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [requests, setRequests] = useState<any[]>([]);
    const [showNewModal, setShowNewModal] = useState(false);
    const [user, setUser] = useState<any>(null);

    // New Request Form State
    const [formData, setFormData] = useState({
        type: 'overtime',
        amount: '',
        currency: 'USD',
        overtimeHours: '',
        overtimeMultiplier: '1.5',
        reason: '',
        effectiveDate: new Date().toISOString().split('T')[0]
    });

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

        try {
            await api.post('/compensation/request', {
                userId: user.id, // Requesting for self
                userName: user.name,
                ...formData
            });

            // Refresh list
            const res = await api.get('/compensation/team?mode=my');
            setRequests(res.data);

            setShowNewModal(false);
            setFormData({
                type: 'overtime',
                amount: '',
                currency: 'USD',
                overtimeHours: '',
                overtimeMultiplier: '1.5',
                reason: '',
                effectiveDate: new Date().toISOString().split('T')[0]
            });
        } catch (error) {
            alert('Failed to submit request');
        } finally {
            setSubmitting(false);
        }
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
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative">
                        <button
                            onClick={() => setShowNewModal(false)}
                            className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-300"
                        >
                            <XCircle className="w-6 h-6" />
                        </button>

                        <h2 className="text-xl font-bold text-zinc-100 mb-6 flex items-center gap-2">
                            <Plus className="w-5 h-5 text-amber-500" />
                            New Request
                        </h2>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Request Type</label>
                                <select
                                    value={formData.type}
                                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                                    className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all"
                                >
                                    <option value="overtime">Overtime</option>
                                    <option value="reimbursement">Reimbursement / Expense</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                                    {formData.type === 'overtime' ? 'Amount (Optional)' : 'Amount'}
                                </label>
                                <div className="grid grid-cols-3 gap-3">
                                    <input
                                        type="number"
                                        required={formData.type === 'reimbursement'}
                                        min="0"
                                        step="0.01"
                                        value={formData.amount}
                                        onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                                        className="col-span-2 w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all"
                                        placeholder="0.00"
                                    />
                                    <select
                                        value={formData.currency}
                                        onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                                        className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all"
                                    >
                                        {currencies.map((currency) => (
                                            <option key={currency.code} value={currency.code}>
                                                {currency.code}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                {formData.type === 'overtime' && (
                                    <p className="text-xs text-zinc-500 mt-1.5">
                                        Recommended: fill hours below and leave amount blank. Payroll will calculate from salary rate.
                                    </p>
                                )}
                            </div>

                            {formData.type === 'overtime' && (
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">Hours</label>
                                        <input
                                            type="number"
                                            required
                                            min="0"
                                            step="0.5"
                                            value={formData.overtimeHours}
                                            onChange={(e) => setFormData({ ...formData, overtimeHours: e.target.value })}
                                            className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all"
                                            placeholder="e.g. 6"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">Multiplier</label>
                                        <select
                                            value={formData.overtimeMultiplier}
                                            onChange={(e) => setFormData({ ...formData, overtimeMultiplier: e.target.value })}
                                            className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all"
                                        >
                                            <option value="1">1.0x</option>
                                            <option value="1.5">1.5x</option>
                                            <option value="2">2.0x</option>
                                        </select>
                                    </div>
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Date</label>
                                <input
                                    type="date"
                                    required
                                    value={formData.effectiveDate}
                                    onChange={(e) => setFormData({ ...formData, effectiveDate: e.target.value })}
                                    className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Reason / Description</label>
                                <textarea
                                    required
                                    rows={3}
                                    value={formData.reason}
                                    onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                                    className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all placeholder:text-zinc-600"
                                    placeholder="e.g. Weekend support for deployment..."
                                />
                            </div>

                            <div className="pt-4 flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowNewModal(false)}
                                    className="flex-1 px-4 py-2.5 rounded-lg border border-zinc-700 text-zinc-300 font-medium hover:bg-zinc-800 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="flex-1 px-4 py-2.5 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit Request'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
