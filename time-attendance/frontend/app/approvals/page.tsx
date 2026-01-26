'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { approvalsApi } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDuration } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import {
    CheckCircle2,
    XCircle,
    AlertCircle,
    Calendar,
    ChevronRight,
    Filter
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ApprovalsPage() {
    const [approvals, setApprovals] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState<string | null>(null);

    useEffect(() => {
        fetchApprovals();
    }, []);

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
                <button className="px-4 py-2 text-sm font-medium text-teal-400 border-b-2 border-teal-500 bg-teal-950/20 rounded-t-lg">
                    Pending ({approvals.length})
                </button>
                <button className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white transition-colors">
                    History
                </button>
            </div>

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
                                            {item.user.name.charAt(0)}
                                        </div>
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <h3 className="font-semibold text-white">{item.user.name}</h3>
                                                <div className="px-2 py-0.5 bg-zinc-800 rounded text-[10px] text-zinc-400 uppercase tracking-wider">
                                                    Week {item.weekNumber}
                                                </div>
                                            </div>
                                            <div className="text-sm text-zinc-400 flex items-center gap-2">
                                                <Calendar className="h-3.5 w-3.5" />
                                                {format(parseISO(item.startDate), 'MMM d')} - {format(parseISO(item.endDate), 'MMM d, yyyy')}
                                            </div>
                                            <div className="flex items-center gap-4 text-xs font-medium mt-1">
                                                <span className="text-emerald-400">{formatDuration((item.totalHours || 0) * 60)} Worked</span>
                                                <span className="text-zinc-600">•</span>
                                                <span className="text-zinc-400">{item.daysWorked} Days</span>
                                                {item.overtimeHours > 0 && (
                                                    <>
                                                        <span className="text-zinc-600">•</span>
                                                        <span className="text-amber-400">{formatDuration((item.overtimeHours || 0) * 60)} OT</span>
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
        </div>
    );
}
