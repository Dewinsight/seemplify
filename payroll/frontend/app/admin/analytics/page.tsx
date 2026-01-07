'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { isAuthenticated } from '@/lib/api';
import Link from 'next/link';
import {
    ArrowLeft,
    Loader2,
    TrendingUp,
    Users,
    DollarSign,
    BarChart3,
    Calendar
} from 'lucide-react';

interface AnalyticsSummary {
    year: number;
    totalPayrollRuns: number;
    totalEmployeesPaid: number;
    totalGrossPayroll: number;
    totalNetPayroll: number;
    totalTaxWithheld: number;
    activeEmployees: number;
    monthlyBreakdown: {
        month: number;
        year: number;
        grossPayroll: number;
        netPayroll: number;
        employees: number;
        status: string;
    }[];
}

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function AnalyticsPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<AnalyticsSummary | null>(null);
    const [year, setYear] = useState(new Date().getFullYear());

    useEffect(() => {
        if (!isAuthenticated()) {
            router.push('/login');
            return;
        }
        fetchAnalytics();
    }, [router, year]);

    const fetchAnalytics = async () => {
        setLoading(true);
        try {
            const res = await api.get(`/payroll/analytics/summary?year=${year}`);
            setData(res.data);
        } catch (error) {
            console.error('Failed to fetch analytics:', error);
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

    const maxGross = Math.max(...(data?.monthlyBreakdown?.map(m => m.grossPayroll) || [1]));

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-200 p-8 pb-20">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <Link href="/dashboard" className="inline-flex items-center text-sm text-zinc-400 hover:text-amber-400 mb-2 transition-colors">
                            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Dashboard
                        </Link>
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
                            Payroll Analytics
                        </h1>
                        <p className="text-zinc-500">Yearly payroll metrics and trends</p>
                    </div>
                    <select
                        value={year}
                        onChange={(e) => setYear(Number(e.target.value))}
                        className="bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-zinc-200"
                    >
                        {[2026, 2025, 2024, 2023].map((y) => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                                <Calendar className="w-5 h-5 text-blue-400" />
                            </div>
                            <span className="text-sm text-zinc-500">Payroll Runs</span>
                        </div>
                        <p className="text-2xl font-bold">{data?.totalPayrollRuns || 0}</p>
                    </div>

                    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                                <Users className="w-5 h-5 text-purple-400" />
                            </div>
                            <span className="text-sm text-zinc-500">Active Employees</span>
                        </div>
                        <p className="text-2xl font-bold">{data?.activeEmployees || 0}</p>
                    </div>

                    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                                <DollarSign className="w-5 h-5 text-emerald-400" />
                            </div>
                            <span className="text-sm text-zinc-500">Total Gross</span>
                        </div>
                        <p className="text-2xl font-bold font-mono text-emerald-400">
                            ${(data?.totalGrossPayroll || 0).toLocaleString()}
                        </p>
                    </div>

                    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                                <TrendingUp className="w-5 h-5 text-amber-400" />
                            </div>
                            <span className="text-sm text-zinc-500">Total Tax</span>
                        </div>
                        <p className="text-2xl font-bold font-mono text-amber-400">
                            ${(data?.totalTaxWithheld || 0).toLocaleString()}
                        </p>
                    </div>
                </div>

                {/* Monthly Chart */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                    <div className="flex items-center gap-3 mb-6">
                        <BarChart3 className="w-5 h-5 text-zinc-400" />
                        <h2 className="text-lg font-semibold">Monthly Payroll</h2>
                    </div>

                    <div className="flex items-end gap-2 h-48">
                        {monthNames.map((month, idx) => {
                            const monthData = data?.monthlyBreakdown?.find(m => m.month === idx + 1);
                            const height = monthData ? (monthData.grossPayroll / maxGross) * 100 : 0;

                            return (
                                <div key={month} className="flex-1 flex flex-col items-center">
                                    <div
                                        className="w-full bg-gradient-to-t from-amber-600 to-amber-400 rounded-t transition-all hover:from-amber-500 hover:to-amber-300"
                                        style={{ height: `${Math.max(height, 2)}%` }}
                                        title={`$${(monthData?.grossPayroll || 0).toLocaleString()}`}
                                    />
                                    <span className="text-xs text-zinc-500 mt-2">{month}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
