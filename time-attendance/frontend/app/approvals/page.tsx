'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { approvalsApi } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDuration } from '@/lib/utils';
import { format, parseISO, isValid } from 'date-fns';
import {
    CheckCircle2,
    XCircle,
    AlertCircle,
    Calendar,
    ChevronRight,
    Filter,
    History
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Safe date formatting helper
const safeFormatDate = (dateValue: any, formatStr: string, fallback = '--'): string => {
    if (!dateValue) return fallback;
    try {
        const date = typeof dateValue === 'string' ? parseISO(dateValue) : new Date(dateValue);
        return isValid(date) ? format(date, formatStr) : fallback;
    } catch {
        return fallback;
    }
};

export default function ApprovalsPage() {
    const [approvals, setApprovals] = useState<any[]>([]);
    const [history, setHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');

    useEffect(() => {
        if (activeTab === 'pending') {
            fetchApprovals();
        } else {
            fetchHistory();
        }
    }, [activeTab]);

    const fetchApprovals = async () => {
        try {
            setLoading(true);
            const response = await approvalsApi.getPending();
            setApprovals(response);
        } catch (error) {
            console.error('Failed to fetch approvals', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchHistory = async () => {
        try {
            setLoading(true);
            const response = await approvalsApi.getHistory();
            setHistory(response);
        } catch (error) {
            console.error('Failed to fetch history', error);
        } finally {
            setLoading(false);
        }
    };

    const handleAction = async (id: string, action: 'approve' | 'reject') => {
        const reason = action === 'reject' ? prompt('Please provide a reason for rejection:') : null;
        if (action === 'reject' && !reason) return;

        try {
            setSubmitting(id);
            if (action === 'approve') {
                await approvalsApi.approve(id);
            } else {
                await approvalsApi.reject(id, reason!);
            }
            // Optimistic update
            setApprovals(prev => prev.filter(t => t._id !== id));
        } catch (error) {
            console.error('Action failed', error);
            alert('Failed to process request.');
        } finally {
            setSubmitting(null);
        }
    };

    const renderPendingList = () => (
        <div className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden">
            {loading ? (
                <div className="flex items-center justify-center p-12">
                    <div className="animate-spin h-8 w-8 border-2 border-teal-500 rounded-full border-t-transparent"></div>
                </div>
            ) : approvals.length === 0 ? (
                <div className="p-12 text-center text-zinc-500">
                    <div className="w-16 h-16 bg-zinc-800/50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CheckCircle2 className="h-8 w-8 text-emerald-500/50" />
                    </div>
                    <h3 className="text-lg font-medium text-white">All caught up!</h3>
                    <p>You have no pending approvals at the moment.</p>
                </div>
            ) : (
                <div className="divide-y divide-zinc-800/50">
                    {approvals.map((item) => (
                        <div key={item._id} className="p-6 hover:bg-zinc-800/20 transition-colors">
                            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">

                                {/* User & Timesheet Info */}
                                <div className="flex items-start gap-4">
                                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-lg font-bold text-white shadow-lg shadow-indigo-500/20 shrink-0">
                                        {(item.userName || 'U').charAt(0)}
                                    </div>
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-semibold text-white">{item.userName || 'Unknown User'}</h3>
                                            <div className="px-2 py-0.5 bg-zinc-800 rounded text-[10px] text-zinc-400 uppercase tracking-wider">
                                                Week {item.weekNumber}
                                            </div>
                                        </div>
                                        <div className="text-sm text-zinc-400 flex items-center gap-2">
                                            <Calendar className="h-3.5 w-3.5" />
                                            {safeFormatDate(item.startDate, 'MMM d')} - {safeFormatDate(item.endDate, 'MMM d, yyyy')}
                                        </div>
                                        <div className="flex items-center gap-4 text-xs font-medium mt-1">
                                            <span className="text-emerald-400">{formatDuration((item.totalHours || item.summary?.totalHours || 0) * 60)} Worked</span>
                                            <span className="text-zinc-600">•</span>
                                            <span className="text-zinc-400">{item.daysWorked || item.summary?.daysWorked || 0} Days</span>
                                            {(item.overtimeHours || item.summary?.overtimeHours) > 0 && (
                                                <>
                                                    <span className="text-zinc-600">•</span>
                                                    <span className="text-amber-400">{formatDuration((item.overtimeHours || item.summary?.overtimeHours || 0) * 60)} OT</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-3">
                                    <Link
                                        href={`/timesheets/${item._id}`}
                                        className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                                    >
                                        View Details
                                    </Link>
                                    <button
                                        onClick={() => handleAction(item._id, 'reject')}
                                        disabled={submitting === item._id}
                                        className="px-4 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium transition-colors border border-red-500/20 flex items-center gap-2"
                                    >
                                        <XCircle className="h-4 w-4" />
                                        Reject
                                    </button>
                                    <button
                                        onClick={() => handleAction(item._id, 'approve')}
                                        disabled={submitting === item._id}
                                        className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium transition-colors shadow-lg shadow-teal-500/20 flex items-center gap-2"
                                    >
                                        <CheckCircle2 className="h-4 w-4" />
                                        Approve
                                    </button>
                                </div>

                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    const renderHistoryList = () => (
        <div className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden">
            {loading ? (
                <div className="flex items-center justify-center p-12">
                    <div className="animate-spin h-8 w-8 border-2 border-teal-500 rounded-full border-t-transparent"></div>
                </div>
            ) : history.length === 0 ? (
                <div className="p-12 text-center text-zinc-500">
                    <div className="w-16 h-16 bg-zinc-800/50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <History className="h-8 w-8 text-zinc-500/50" />
                    </div>
                    <h3 className="text-lg font-medium text-white">No history yet</h3>
                    <p>Your approval history will appear here.</p>
                </div>
            ) : (
                <div className="divide-y divide-zinc-800/50">
                    {history.map((item) => {
                        const actionDate = item.approvedBy?.approvedAt || item.rejectedBy?.rejectedAt || item.revisionRequestedBy?.requestedAt;
                        const actionBy = item.approvedBy?.userName || item.rejectedBy?.userName || item.revisionRequestedBy?.userName;
                        
                        return (
                            <div key={item._id} className="p-6 hover:bg-zinc-800/20 transition-colors">
                                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">

                                    {/* User & Timesheet Info */}
                                    <div className="flex items-start gap-4">
                                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-lg font-bold text-white shadow-lg shadow-indigo-500/20 shrink-0">
                                            {(item.userName || 'U').charAt(0)}
                                        </div>
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <h3 className="font-semibold text-white">{item.userName || 'Unknown User'}</h3>
                                                <div className="px-2 py-0.5 bg-zinc-800 rounded text-[10px] text-zinc-400 uppercase tracking-wider">
                                                    Week {item.weekNumber}
                                                </div>
                                                <StatusBadge status={item.status} />
                                            </div>
                                            <div className="text-sm text-zinc-400 flex items-center gap-2">
                                                <Calendar className="h-3.5 w-3.5" />
                                                {safeFormatDate(item.startDate, 'MMM d')} - {safeFormatDate(item.endDate, 'MMM d, yyyy')}
                                            </div>
                                            <div className="flex items-center gap-4 text-xs font-medium mt-1">
                                                <span className="text-emerald-400">{formatDuration((item.totalHours || item.summary?.totalHours || 0) * 60)} Worked</span>
                                                <span className="text-zinc-600">•</span>
                                                <span className="text-zinc-400">{item.daysWorked || item.summary?.daysWorked || 0} Days</span>
                                            </div>
                                            {/* Action info */}
                                            <div className="text-xs text-zinc-500 mt-2">
                                                {item.status === 'approved' && (
                                                    <span className="text-emerald-400">Approved by {actionBy} on {safeFormatDate(actionDate, 'MMM d, yyyy HH:mm')}</span>
                                                )}
                                                {item.status === 'rejected' && (
                                                    <>
                                                        <span className="text-red-400">Rejected by {actionBy} on {safeFormatDate(actionDate, 'MMM d, yyyy HH:mm')}</span>
                                                        {item.rejectedBy?.reason && (
                                                            <p className="mt-1 text-zinc-400">Reason: {item.rejectedBy.reason}</p>
                                                        )}
                                                    </>
                                                )}
                                                {item.status === 'revision_requested' && (
                                                    <>
                                                        <span className="text-amber-400">Revision requested by {actionBy} on {safeFormatDate(actionDate, 'MMM d, yyyy HH:mm')}</span>
                                                        {item.revisionRequestedBy?.reason && (
                                                            <p className="mt-1 text-zinc-400">Reason: {item.revisionRequestedBy.reason}</p>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* View Details Link */}
                                    <div className="flex items-center gap-3">
                                        <Link
                                            href={`/timesheets/${item._id}`}
                                            className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors flex items-center gap-2"
                                        >
                                            View Details
                                            <ChevronRight className="h-4 w-4" />
                                        </Link>
                                    </div>

                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white">Approvals</h1>
                    <p className="text-zinc-400">Review and action pending timesheets</p>
                </div>
            </div>

            {/* Tabs / Filters */}
            <div className="flex items-center gap-2 border-b border-zinc-800 pb-1">
                <button
                    onClick={() => setActiveTab('pending')}
                    className={cn(
                        "px-4 py-2 text-sm font-medium transition-colors rounded-t-lg",
                        activeTab === 'pending'
                            ? "text-teal-400 border-b-2 border-teal-500 bg-teal-950/20"
                            : "text-zinc-400 hover:text-white"
                    )}
                >
                    Pending ({approvals.length})
                </button>
                <button
                    onClick={() => setActiveTab('history')}
                    className={cn(
                        "px-4 py-2 text-sm font-medium transition-colors rounded-t-lg flex items-center gap-2",
                        activeTab === 'history'
                            ? "text-teal-400 border-b-2 border-teal-500 bg-teal-950/20"
                            : "text-zinc-400 hover:text-white"
                    )}
                >
                    <History className="h-4 w-4" />
                    History
                </button>
            </div>

            {activeTab === 'pending' ? renderPendingList() : renderHistoryList()}
        </div>
    );
}
