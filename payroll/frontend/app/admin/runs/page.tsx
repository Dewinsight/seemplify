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
import type { LucideIcon } from 'lucide-react';

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
    employerEntitySnapshot?: {
        legalName?: string;
        jurisdictionCode?: string;
        currency?: string;
    };
}

const statusConfig: Record<string, { icon: LucideIcon; color: string; bg: string }> = {
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
    const [error, setError] = useState('');

    useEffect(() => {
        if (!isAuthenticated()) {
            router.push('/login');
            return;
        }
        fetchRuns();
    }, [router]);

    const fetchRuns = async () => {
        setError('');
        try {
            const res = await api.get('/payroll/runs?limit=24');
            setRuns(Array.isArray(res.data) ? res.data : []);
        } catch (error) {
            console.error('Failed to fetch runs:', error);
            setError('Payroll history could not be loaded. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex min-h-[360px] items-center justify-center" aria-label="Loading payroll history">
                <Loader2 className="h-7 w-7 animate-spin text-amber-500" aria-hidden="true" />
            </div>
        );
    }

    return (
        <div className="mx-auto w-full max-w-6xl text-zinc-200">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <Link
                        href="/dashboard"
                        className="mb-2 inline-flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-amber-400"
                    >
                        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                        Back to Dashboard
                    </Link>
                    <h1 className="text-3xl font-bold tracking-tight text-zinc-100">Payroll Run History</h1>
                    <p className="mt-1 text-sm text-zinc-500">Review previous payroll runs, totals, and processing status.</p>
                </div>
                <Link
                    href="/admin/run"
                    className="inline-flex h-10 items-center justify-center self-start rounded-lg bg-amber-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-amber-500 sm:self-auto"
                >
                    New Run
                </Link>
            </div>

            {error ? (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-5 py-8 text-center">
                    <AlertCircle className="mx-auto h-5 w-5 text-red-400" aria-hidden="true" />
                    <p className="mt-2 text-sm text-red-300">{error}</p>
                    <button
                        type="button"
                        onClick={() => {
                            setLoading(true);
                            fetchRuns();
                        }}
                        className="mt-4 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
                    >
                        Try again
                    </button>
                </div>
            ) : runs.length === 0 ? (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-6 py-12 text-center">
                    <p className="text-sm font-medium text-zinc-300">No payroll runs yet</p>
                    <p className="mt-1 text-sm text-zinc-500">Create a payroll run to see its progress and totals here.</p>
                    <Link
                        href="/admin/run"
                        className="mt-5 inline-flex h-9 items-center justify-center rounded-lg bg-amber-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-amber-500"
                    >
                        Create payroll run
                    </Link>
                </div>
            ) : (
                <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
                    <div className="hidden grid-cols-[minmax(240px,1.5fr)_minmax(130px,0.8fr)_minmax(100px,0.65fr)_minmax(130px,0.9fr)_minmax(130px,0.9fr)_20px] gap-4 border-b border-zinc-800 bg-zinc-900/70 px-5 py-3 text-xs font-medium text-zinc-500 lg:grid">
                        <span>Run</span>
                        <span>Status</span>
                        <span>Employees</span>
                        <span className="text-right">Gross</span>
                        <span className="text-right">Net</span>
                        <span aria-hidden="true" />
                    </div>

                    <div className="divide-y divide-zinc-800">
                        {runs.map((run) => {
                            const config = statusConfig[run.status] || statusConfig.draft;
                            const StatusIcon = config.icon;
                            const period = `${monthNames[run.payPeriod.month - 1]} ${run.payPeriod.year}`;
                            const employer = run.employerEntitySnapshot?.legalName || 'Legacy run — legal employer not recorded';

                            return (
                                <Link
                                    key={run._id}
                                    href={`/admin/runs/${run._id}`}
                                    aria-label={`Open ${period} payroll run`}
                                    className="group block bg-zinc-950/30 px-5 py-4 transition-colors hover:bg-zinc-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500"
                                >
                                    <div className="grid gap-4 lg:grid-cols-[minmax(240px,1.5fr)_minmax(130px,0.8fr)_minmax(100px,0.65fr)_minmax(130px,0.9fr)_minmax(130px,0.9fr)_20px] lg:items-center">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <StatusIcon
                                                    className={`h-4 w-4 flex-none ${config.color} ${run.status === 'calculating' ? 'animate-spin' : ''}`}
                                                    aria-hidden="true"
                                                />
                                                <span className="font-semibold text-zinc-100">{period}</span>
                                                <span className="truncate font-mono text-xs text-zinc-500">{run.runNumber}</span>
                                            </div>
                                            <p className="mt-1 truncate pl-6 text-xs text-zinc-500">
                                                {employer}
                                                {run.employerEntitySnapshot?.jurisdictionCode ? ` · ${run.employerEntitySnapshot.jurisdictionCode}` : ''}
                                            </p>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-3 lg:contents">
                                            <div>
                                                <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium capitalize ${config.bg} ${config.color}`}>
                                                    {run.status.replace(/_/g, ' ')}
                                                </span>
                                            </div>

                                            <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                                                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                                                <span>{run.summary?.processedCount || 0}/{run.summary?.totalEmployees || 0} processed</span>
                                            </div>

                                            <div className="ml-auto min-w-0 text-right lg:ml-0">
                                                <p className="text-xs text-zinc-500 lg:hidden">Gross</p>
                                                <p className="break-words font-mono text-sm font-semibold text-zinc-200">
                                                    {formatSummaryAmount(run.summary, 'totalGrossPayroll')}
                                                </p>
                                            </div>

                                            <div className="min-w-0 text-right">
                                                <p className="text-xs text-zinc-500 lg:hidden">Net</p>
                                                <p className="break-words font-mono text-sm font-semibold text-emerald-400">
                                                    {formatSummaryAmount(run.summary, 'totalNetPayroll')}
                                                </p>
                                            </div>

                                            <ChevronRight
                                                className="hidden h-4 w-4 text-zinc-600 transition-colors group-hover:text-amber-500 lg:block"
                                                aria-hidden="true"
                                            />
                                        </div>
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
