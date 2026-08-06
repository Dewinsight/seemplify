'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { isAuthenticated } from '@/lib/api';
import { formatPayrollMoney } from '@/lib/payrollMoney';
import Link from 'next/link';
import {
    ArrowLeft,
    Loader2,
    CheckCircle,
    Clock,
    AlertCircle,
    ChevronRight,
    DollarSign,
    Users
} from 'lucide-react';

interface PayrollRun {
    _id: string;
    runNumber: string;
    payPeriod: {
        month: number;
        year: number;
    };
    status: string;
    summary: {
        totalEmployees: number;
        processedCount: number;
        skippedCount?: number;
        errorCount?: number;
        totalGrossPayroll: number;
        totalNetPayroll: number;
        currency?: string;
        hasAggregateTotals?: boolean;
        isMultiCurrency?: boolean;
        currencyBreakdown?: Array<{
            currency: string;
            employeeCount: number;
            totalGrossPayroll: number;
            totalNetPayroll: number;
        }>;
    };
    calculatedAt: string;
    paidAt?: string;
}

const statusConfig: Record<string, { icon: any; color: string; bg: string }> = {
    draft: { icon: Clock, color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
    calculating: { icon: Loader2, color: 'text-amber-400', bg: 'bg-amber-500/10' },
    calculated: { icon: CheckCircle, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    pending_review: { icon: AlertCircle, color: 'text-orange-400', bg: 'bg-orange-500/10' },
    pending_approval: { icon: Clock, color: 'text-purple-400', bg: 'bg-purple-500/10' },
    approved: { icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    exported: { icon: CheckCircle, color: 'text-amber-400', bg: 'bg-amber-500/10' },
    paid: { icon: DollarSign, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    cancelled: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/10' }
};

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const formatMoney = (currency: string, amount: number) => (
    formatPayrollMoney(amount || 0, currency)
);

const formatSummaryAmount = (
    summary: PayrollRun['summary'] | undefined,
    key: 'totalGrossPayroll' | 'totalNetPayroll'
) => {
    if (summary?.hasAggregateTotals !== false) {
        return formatMoney(summary?.currency || 'USD', Number(summary?.[key] || 0));
    }

    if (summary?.currencyBreakdown?.length) {
        return summary.currencyBreakdown
            .map((entry) => formatMoney(entry.currency, Number(entry[key] || 0)))
            .join(' · ');
    }

    return 'Mixed';
};

export default function PayrollRunsPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [runs, setRuns] = useState<PayrollRun[]>([]);

    useEffect(() => {
        if (!isAuthenticated()) {
            router.push('/login');
            return;
        }
        fetchRuns();
    }, [router]);

    const fetchRuns = async () => {
        try {
            const res = await api.get('/payroll/runs?limit=24');
            setRuns(res.data);
        } catch (error) {
            console.error('Failed to fetch runs:', error);
        } finally {
            setLoading(false);
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
            <div className="max-w-5xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <Link href="/dashboard" className="inline-flex items-center text-sm text-zinc-400 hover:text-amber-400 mb-2 transition-colors">
                            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Dashboard
                        </Link>
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
                            Payroll Run History
                        </h1>
                        <p className="text-zinc-500">View past payroll runs and their status</p>
                    </div>
                    <Link
                        href="/admin/run"
                        className="flex items-center gap-2 bg-amber-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-amber-500 transition-all"
                    >
                        New Run
                    </Link>
                </div>

                {/* Runs List */}
                <div className="space-y-4">
                    {runs.map((run) => {
                        const config = statusConfig[run.status] || statusConfig.draft;
                        const StatusIcon = config.icon;

                        return (
                            <Link
                                key={run._id}
                                href={`/admin/runs/${run._id}`}
                                className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-all group"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className={`w-12 h-12 rounded-lg ${config.bg} flex items-center justify-center`}>
                                            <StatusIcon className={`w-5 h-5 ${config.color} ${run.status === 'calculating' ? 'animate-spin' : ''}`} />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h3 className="font-semibold text-zinc-100">
                                                    {monthNames[run.payPeriod.month - 1]} {run.payPeriod.year}
                                                </h3>
                                                <span className="text-xs font-mono text-zinc-500">{run.runNumber}</span>
                                            </div>
                                            <div className="flex items-center gap-3 mt-1">
                                                <span className={`text-xs px-2 py-0.5 rounded ${config.bg} ${config.color} capitalize flex items-center gap-1`}>
                                                    <StatusIcon className="w-3 h-3" />
                                                    {run.status.replace(/_/g, ' ')}
                                                </span>
                                                <span className="text-xs text-zinc-500 flex items-center gap-1">
                                                    <Users className="w-3 h-3" />
                                                    {(run.summary?.processedCount || 0)}/{(run.summary?.totalEmployees || 0)} processed
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-6">
                                        <div className="text-right">
                                            <p className="text-xs text-zinc-500">Gross</p>
                                            <p className="font-mono font-semibold text-zinc-200">
                                                {formatSummaryAmount(run.summary, 'totalGrossPayroll')}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs text-zinc-500">Net</p>
                                            <p className="font-mono font-semibold text-emerald-400">
                                                {formatSummaryAmount(run.summary, 'totalNetPayroll')}
                                            </p>
                                        </div>
                                        <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-amber-500 transition-colors" />
                                    </div>
                                </div>
                            </Link>
                        );
                    })}

                    {runs.length === 0 && (
                        <div className="text-center py-12 text-zinc-500">
                            No payroll runs yet. Start by creating a new run.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
