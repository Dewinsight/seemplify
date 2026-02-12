'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, Download, FileText, DollarSign, Users, Calendar, TrendingUp } from 'lucide-react';
import api, { isAuthenticated } from '@/lib/api';

interface ReportSummary {
    totalPayroll: number;
    totalEmployees: number;
    avgSalary: number;
    currency: string;
    byDepartment: Array<{ department: string; total: number; count: number }>;
    byMonth: Array<{ month: string; gross: number; net: number; deductions: number }>;
}

export default function ReportsPage() {
    const router = useRouter();
    const [summary, setSummary] = useState<ReportSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [reportType, setReportType] = useState<'summary' | 'department' | 'monthly'>('summary');
    const [year, setYear] = useState(new Date().getFullYear());

    useEffect(() => {
        if (!isAuthenticated()) {
            router.push('/login');
            return;
        }
        fetchReportData();
    }, [year, router]);

    const fetchReportData = async () => {
        try {
            setLoading(true);
            const res = await api.get('/payroll/reports/summary', { params: { year } });
            setSummary(res.data);
            setError(null);
        } catch (err: any) {
            setError(err.message);
            setSummary(null);
        } finally {
            setLoading(false);
        }
    };

    const handleExport = async (format: 'csv' | 'pdf') => {
        try {
            if (format !== 'csv') {
                alert('Only CSV export is supported right now.');
                return;
            }

            const res = await api.get('/payroll/reports/export', {
                params: { format, year },
                responseType: 'blob'
            });
            const blob = res.data as Blob;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `payroll-report-${year}.${format}`;
            a.click();
        } catch (err: any) {
            alert(err.message || 'Export failed');
        }
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: summary?.currency || 'USD',
            minimumFractionDigits: 0,
        }).format(amount);
    };

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
                    <h1 className="text-2xl font-bold text-white">Payroll Reports</h1>
                    <p className="text-zinc-400 text-sm mt-1">
                        View and export payroll analytics
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <select
                        value={year}
                        onChange={(e) => setYear(Number(e.target.value))}
                        className="px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-white"
                    >
                        {[2026, 2025, 2024, 2023].map(y => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>
                    <button
                        onClick={() => handleExport('csv')}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        <Download className="h-4 w-4" />
                        Export CSV
                    </button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/20 rounded-xl p-6">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 rounded-lg bg-amber-500/20">
                            <DollarSign className="h-5 w-5 text-amber-400" />
                        </div>
                        <span className="text-zinc-400 text-sm">Total Payroll YTD</span>
                    </div>
                    <div className="text-3xl font-bold text-white">{formatCurrency(summary?.totalPayroll || 0)}</div>
                </div>

                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 rounded-lg bg-blue-500/20">
                            <Users className="h-5 w-5 text-blue-400" />
                        </div>
                        <span className="text-zinc-400 text-sm">Total Employees</span>
                    </div>
                    <div className="text-3xl font-bold text-white">{summary?.totalEmployees || 0}</div>
                </div>

                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 rounded-lg bg-green-500/20">
                            <TrendingUp className="h-5 w-5 text-green-400" />
                        </div>
                        <span className="text-zinc-400 text-sm">Average Salary</span>
                    </div>
                    <div className="text-3xl font-bold text-white">{formatCurrency(summary?.avgSalary || 0)}</div>
                </div>
            </div>

            {/* Report Type Tabs */}
            <div className="flex gap-2">
                {(['summary', 'department', 'monthly'] as const).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setReportType(tab)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${reportType === tab
                                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                            }`}
                    >
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                ))}
            </div>

            {/* Report Content */}
            {reportType === 'department' && summary?.byDepartment && (
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
                    <div className="p-4 border-b border-zinc-800">
                        <h2 className="font-semibold text-white">Payroll by Department</h2>
                    </div>
                    <div className="divide-y divide-zinc-800">
                        {summary.byDepartment.map((dept, idx) => (
                            <div key={idx} className="flex items-center justify-between p-4 hover:bg-zinc-800/30">
                                <div>
                                    <div className="font-medium text-white">{dept.department}</div>
                                    <div className="text-sm text-zinc-500">{dept.count} employees</div>
                                </div>
                                <div className="text-right">
                                    <div className="font-semibold text-white">{formatCurrency(dept.total)}</div>
                                    <div className="text-sm text-zinc-500">
                                        Avg: {formatCurrency(dept.total / dept.count)}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {reportType === 'monthly' && summary?.byMonth && (
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
                    <div className="p-4 border-b border-zinc-800">
                        <h2 className="font-semibold text-white">Monthly Breakdown</h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-zinc-800/50">
                                <tr>
                                    <th className="text-left p-4 text-sm font-medium text-zinc-400">Month</th>
                                    <th className="text-right p-4 text-sm font-medium text-zinc-400">Gross</th>
                                    <th className="text-right p-4 text-sm font-medium text-zinc-400">Deductions</th>
                                    <th className="text-right p-4 text-sm font-medium text-zinc-400">Net</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-800">
                                {summary.byMonth.map((month, idx) => (
                                    <tr key={idx} className="hover:bg-zinc-800/30">
                                        <td className="p-4 font-medium text-white">{month.month} {year}</td>
                                        <td className="p-4 text-right text-zinc-300">{formatCurrency(month.gross)}</td>
                                        <td className="p-4 text-right text-red-400">-{formatCurrency(month.deductions)}</td>
                                        <td className="p-4 text-right text-green-400 font-medium">{formatCurrency(month.net)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {reportType === 'summary' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Quick Stats */}
                    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                        <h2 className="font-semibold text-white mb-4">Payroll Statistics</h2>
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <span className="text-zinc-400">Highest Department</span>
                                <span className="text-white font-medium">{summary?.byDepartment?.[0]?.department || 'N/A'}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-zinc-400">Active Pay Periods</span>
                                <span className="text-white font-medium">{summary?.byMonth?.length || 0}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-zinc-400">Last Run</span>
                                <span className="text-white font-medium">{summary?.byMonth?.slice(-1)[0]?.month || 'N/A'} {year}</span>
                            </div>
                        </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                        <h2 className="font-semibold text-white mb-4">Export Options</h2>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => handleExport('csv')}
                                className="flex items-center gap-2 p-3 bg-zinc-800/50 hover:bg-zinc-800 rounded-lg transition-colors"
                            >
                                <FileText className="h-5 w-5 text-green-400" />
                                <div className="text-left">
                                    <div className="text-sm font-medium text-white">CSV Export</div>
                                    <div className="text-xs text-zinc-500">Spreadsheet format</div>
                                </div>
                            </button>
                            <button
                                onClick={() => handleExport('pdf')}
                                className="flex items-center gap-2 p-3 bg-zinc-800/50 hover:bg-zinc-800 rounded-lg transition-colors"
                            >
                                <BarChart3 className="h-5 w-5 text-red-400" />
                                <div className="text-left">
                                    <div className="text-sm font-medium text-white">PDF Report</div>
                                    <div className="text-xs text-zinc-500">Printable format</div>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
