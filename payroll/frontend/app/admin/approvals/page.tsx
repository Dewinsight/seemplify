'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, XCircle, Clock, DollarSign, TrendingUp, AlertTriangle } from 'lucide-react';
import api, { isAuthenticated } from '@/lib/api';
import { formatPayrollMoney } from '@/lib/payrollMoney';

interface ApprovalRequest {
    _id: string;
    userId: string;
    userName: string;
    type: string;
    amount?: number;
    currency?: string;
    overtimeHours?: number;
    overtimeMultiplier?: number;
    reason: string;
    status: string;
    createdAt: string;
    approvals: Array<{
        approvedBy: string;
        approverName: string;
        status: 'approved' | 'rejected';
        notes: string;
        approvedAt: string;
    }>;
}

const getTypeIcon = (type: string) => {
    switch (type) {
        case 'salary_revision': return TrendingUp;
        case 'bonus': return DollarSign;
        case 'overtime': return Clock;
        case 'reimbursement': return DollarSign;
        case 'commission': return DollarSign;
        case 'incentive': return DollarSign;
        case 'allowance': return DollarSign;
        default: return DollarSign;
    }
};

const getTypeLabel = (type: string) => {
    switch (type) {
        case 'salary_revision': return 'Salary Revision';
        case 'bonus': return 'Bonus';
        case 'overtime': return 'Overtime';
        case 'allowance': return 'Allowance';
        case 'reimbursement': return 'Reimbursement';
        case 'commission': return 'Commission';
        case 'incentive': return 'Incentive';
        default: return type;
    }
};

const isPendingStatus = (status: string) => ['pending', 'approved_l1', 'approved_l2'].includes(status);
const isApprovedStatus = (status: string) => ['approved', 'processed'].includes(status);

const getStatusBadge = (status: string) => {
    switch (status) {
        case 'pending':
        case 'approved_l1':
        case 'approved_l2':
            return <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-yellow-500/20 text-yellow-400 text-xs font-medium"><Clock className="h-3 w-3" /> Pending</span>;
        case 'approved':
        case 'processed':
            return <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-500/20 text-green-400 text-xs font-medium"><CheckCircle className="h-3 w-3" /> Approved</span>;
        case 'rejected':
            return <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/20 text-red-400 text-xs font-medium"><XCircle className="h-3 w-3" /> Rejected</span>;
        default:
            return null;
    }
};

export default function ApprovalsPage() {
    const router = useRouter();
    const [requests, setRequests] = useState<ApprovalRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
    const [processingId, setProcessingId] = useState<string | null>(null);

    useEffect(() => {
        if (!isAuthenticated()) {
            router.push('/login');
            return;
        }
        fetchApprovals();
    }, [router]);

    const fetchApprovals = async () => {
        try {
            setLoading(true);
            const res = await api.get('/compensation/approvals');
            const data = res.data;
            setRequests(Array.isArray(data) ? data : data.requests || []);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleApprove = async (requestId: string) => {
        setProcessingId(requestId);
        try {
            await api.post(`/compensation/${requestId}/action`, {
                action: 'approve',
                comment: 'Approved by HR Admin'
            });
            await fetchApprovals();
        } catch (err: any) {
            alert(err.message);
        } finally {
            setProcessingId(null);
        }
    };

    const handleReject = async (requestId: string) => {
        const notes = prompt('Reason for rejection:');
        if (!notes) return;

        setProcessingId(requestId);
        try {
            await api.post(`/compensation/${requestId}/action`, {
                action: 'reject',
                comment: notes
            });
            await fetchApprovals();
        } catch (err: any) {
            alert(err.message);
        } finally {
            setProcessingId(null);
        }
    };

    const filteredRequests = requests.filter((r) => {
        if (filter === 'all') return true;
        if (filter === 'pending') return isPendingStatus(r.status);
        if (filter === 'approved') return isApprovedStatus(r.status);
        if (filter === 'rejected') return r.status === 'rejected';
        return true;
    });

    const pendingCount = requests.filter(r => isPendingStatus(r.status)).length;

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white">Approvals</h1>
                    <p className="text-zinc-400 text-sm mt-1">
                        Review and approve compensation requests
                    </p>
                </div>
                {pendingCount > 0 && (
                    <div className="flex items-center gap-2 px-4 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                        <AlertTriangle className="h-4 w-4 text-yellow-500" />
                        <span className="text-yellow-400 text-sm font-medium">{pendingCount} pending requests</span>
                    </div>
                )}
            </div>

            {/* Filter Tabs */}
            <div className="flex gap-2">
                {(['pending', 'all', 'approved', 'rejected'] as const).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setFilter(tab)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filter === tab
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                            }`}
                    >
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        {tab === 'pending' && pendingCount > 0 && (
                            <span className="ml-2 px-1.5 py-0.5 bg-amber-500/30 rounded text-xs">{pendingCount}</span>
                        )}
                    </button>
                ))}
            </div>

            {/* Requests List */}
            {error ? (
                <div className="text-center py-12 text-red-400">{error}</div>
            ) : filteredRequests.length === 0 ? (
                <div className="text-center py-12 text-zinc-500">
                    <CheckCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No {filter === 'all' ? '' : filter} requests found</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {filteredRequests.map((request) => {
                        const Icon = getTypeIcon(request.type);
                        return (
                            <div
                                key={request._id}
                                className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 hover:border-zinc-700 transition-colors"
                            >
                                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                                    <div className="flex items-start gap-4">
                                        <div className="p-3 rounded-lg bg-amber-500/10">
                                            <Icon className="h-5 w-5 text-amber-400" />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-3">
                                                <h3 className="font-semibold text-white">{getTypeLabel(request.type)}</h3>
                                                {getStatusBadge(request.status)}
                                            </div>
                                            <p className="text-zinc-400 text-sm mt-1">
                                                Requested by <span className="text-zinc-300">{request.userName || 'Unknown'}</span>
                                            </p>
                                            <p className="text-zinc-500 text-sm mt-1">{request.reason}</p>
                                            <p className="text-zinc-500 text-xs mt-2">
                                                {new Date(request.createdAt).toLocaleDateString('en-US', {
                                                    year: 'numeric',
                                                    month: 'short',
                                                    day: 'numeric',
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4">
                                        <div className="text-right">
                                            <div className="text-2xl font-bold text-white">
                                                {request.type === 'overtime' && request.overtimeHours
                                                    ? `${request.overtimeHours}h @ ${request.overtimeMultiplier || 1.5}x`
                                                    : formatPayrollMoney(request.amount || 0, request.currency || 'USD')}
                                            </div>
                                            <div className="text-xs text-zinc-500">Requested Amount</div>
                                        </div>

                                        {request.status === 'pending' && (
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleApprove(request._id)}
                                                    disabled={processingId === request._id}
                                                    className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                                                >
                                                    <CheckCircle className="h-4 w-4" />
                                                    Approve
                                                </button>
                                                <button
                                                    onClick={() => handleReject(request._id)}
                                                    disabled={processingId === request._id}
                                                    className="flex items-center gap-2 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                                                >
                                                    <XCircle className="h-4 w-4" />
                                                    Reject
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
