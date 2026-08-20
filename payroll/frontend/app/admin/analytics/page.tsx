'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated, authApi } from '@/lib/api';
import { formatPayrollMoney } from '@/lib/payrollMoney';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  TrendingUp,
  TrendingDown,
  Users,
  DollarSign,
  BarChart3,
  Calendar,
  PieChart,
  Activity,
  Building2,
  Briefcase,
  CreditCard,
  Percent,
  Award,
  Clock,
  ChevronUp,
  ChevronDown,
  ArrowUpRight,
  ArrowDownRight,
  FileText,
  CheckCircle,
  AlertCircle,
  RefreshCw
} from 'lucide-react';
import analyticsService, {
  ComprehensiveAnalytics,
  CurrencyBreakdown,
  HeadcountAnalytics
} from '@/services/analyticsService';

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fullMonthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Utility for formatting currency
const formatCurrency = (amount: number | null | undefined, compact = false, currency = 'USD') => {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  if (compact && amount >= 1000000) {
    return `${currency} ${(amount / 1000000).toFixed(1)}M`;
  }
  if (compact && amount >= 1000) {
    return `${currency} ${(amount / 1000).toFixed(0)}K`;
  }
  return formatPayrollMoney(amount, currency);
};

function NativeCurrencyTotals({
  breakdown = [],
  field = 'grossPay',
}: {
  breakdown?: CurrencyBreakdown[];
  field?: 'grossPay' | 'netPay' | 'totalTax' | 'totalEmployerCost';
}) {
  if (breakdown.length === 0) return null;
  return (
    <div className="mt-3 border-t border-zinc-800 pt-3 space-y-1">
      {breakdown.map((entry) => (
        <div key={entry.currency} className="flex justify-between gap-4 text-xs text-zinc-400">
          <span>{entry.currency}</span>
          <span className="font-mono text-zinc-300">{formatCurrency(entry[field], false, entry.currency)}</span>
        </div>
      ))}
    </div>
  );
}

// Color palette for charts
const chartColors = [
  '#f59e0b', // amber
  '#3b82f6', // blue  
  '#10b981', // emerald
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#6366f1', // indigo
];

export default function AnalyticsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ComprehensiveAnalytics | null>(null);
  const [headcount, setHeadcount] = useState<HeadcountAnalytics | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [isHRAdmin, setIsHRAdmin] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'departments' | 'workforce'>('overview');
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');

  const checkAccess = useCallback(async () => {
    try {
      const response = await authApi.getMe();
      const user = response.user;
      const currentOrgId = response.currentOrganizationId;
      const currentOrg = user.organizations?.find((o: any) => o.id === currentOrgId);
      const hasAccess = currentOrg && ['owner', 'admin', 'hr_manager'].includes(currentOrg.role);

      if (!hasAccess) {
        alert('Access denied. Only administrators can view analytics.');
        router.push('/dashboard');
        return;
      }

      setIsHRAdmin(true);
    } catch (error) {
      console.error('Failed to check access:', error);
      router.push('/login');
    }
  }, [router]);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [analyticsData, headcountData] = await Promise.all([
        analyticsService.getComprehensiveAnalytics(year),
        analyticsService.getHeadcountAnalytics()
      ]);
      setData(analyticsData);
      setHeadcount(headcountData);
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
      setLoadError('Payroll analytics could not be refreshed. Try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [year]);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login');
      return;
    }
    checkAccess();
  }, [router, checkAccess]);

  useEffect(() => {
    if (isHRAdmin) {
      fetchAnalytics();
    }
  }, [isHRAdmin, fetchAnalytics]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchAnalytics();
  };

  // Calculate max values for charts
  const maxGross = useMemo(() =>
    Math.max(1, ...(data?.monthlyTrend?.flatMap((month) => [month.grossPayroll ?? 0, month.previousYearGross ?? 0]) || [1])), [data]
  );

  const maxDeptGross = useMemo(() =>
    Math.max(1, ...(data?.departmentBreakdown?.map(d => d.totalGross ?? 0) || [1])), [data]
  );

  const reportingCurrency = data?.reportingCurrency || data?.currency || 'USD';
  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, index) => current - index);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="relative w-16 h-16 mx-auto mb-6">
            <div className="absolute inset-0 bg-gradient-to-tr from-amber-500 to-orange-400 rounded-2xl opacity-20 blur-xl animate-pulse" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-10 h-10 text-amber-500 animate-spin" />
            </div>
          </div>
          <p className="text-zinc-400 font-medium">Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (!isHRAdmin) {
    return null;
  }

  return (
    <div className="space-y-8 pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <Link
            href="/dashboard"
            className="inline-flex items-center text-sm text-zinc-400 hover:text-amber-400 mb-2 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Dashboard
          </Link>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-zinc-100 to-zinc-300 bg-clip-text text-transparent">
            Payroll Analytics
          </h1>
          <p className="text-zinc-500 mt-1">Comprehensive insights into your organization&apos;s payroll</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2.5 rounded-xl border border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:text-white hover:border-zinc-600 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="px-4 py-2.5 rounded-xl border border-zinc-700 bg-zinc-800/50 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="border border-red-900/70 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {loadError}
        </div>
      )}

      {data?.isMultiCurrency && (
        <div className="border border-zinc-800 bg-zinc-900/50 px-4 py-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-200">Reporting currency: {reportingCurrency}</p>
            <p className="text-xs text-zinc-500">Native totals are retained for {data.currencies.join(', ')}.</p>
          </div>
          {!data.hasAggregateTotals && (
            <p className="mt-2 text-xs text-amber-300">
              Consolidated totals are unavailable until exchange rates are configured for {data.unconvertedCurrencies.join(', ')}.
            </p>
          )}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-zinc-800 pb-px">
        {[
          { id: 'overview', label: 'Overview', icon: BarChart3 },
          { id: 'departments', label: 'Departments', icon: Building2 },
          { id: 'workforce', label: 'Workforce', icon: Users }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium rounded-t-xl transition-all ${
              activeTab === tab.id
                ? 'text-amber-400 border-b-2 border-amber-500 bg-amber-500/5'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Gross Payroll */}
            <div className="relative overflow-hidden bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-2xl border border-amber-500/20 p-5">
              <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="relative">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
                    <DollarSign className="w-5 h-5 text-white" />
                  </div>
                  <span className="text-sm text-zinc-400">Gross Payroll</span>
                </div>
                <p className="text-2xl font-bold text-white font-mono">
                  {formatCurrency(data?.overview?.totalGrossPayroll, true, reportingCurrency)}
                </p>
                <div className="flex items-center gap-1 mt-2">
                  {(data?.overview?.yoyGrossGrowth || 0) >= 0 ? (
                    <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <ArrowDownRight className="w-4 h-4 text-red-400" />
                  )}
                  <span className={`text-sm font-medium ${
                    (data?.overview?.yoyGrossGrowth || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {Math.abs(data?.overview?.yoyGrossGrowth || 0)}% YoY
                  </span>
                </div>
              </div>
            </div>

            {/* Total Net Payroll */}
            <div className="relative overflow-hidden bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-2xl border border-emerald-500/20 p-5">
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="relative">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                    <CreditCard className="w-5 h-5 text-white" />
                  </div>
                  <span className="text-sm text-zinc-400">Net Payroll</span>
                </div>
                <p className="text-2xl font-bold text-white font-mono">
                  {formatCurrency(data?.overview?.totalNetPayroll, true, reportingCurrency)}
                </p>
                <div className="flex items-center gap-1 mt-2">
                  {(data?.overview?.yoyNetGrowth || 0) >= 0 ? (
                    <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <ArrowDownRight className="w-4 h-4 text-red-400" />
                  )}
                  <span className={`text-sm font-medium ${
                    (data?.overview?.yoyNetGrowth || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {Math.abs(data?.overview?.yoyNetGrowth || 0)}% YoY
                  </span>
                </div>
              </div>
            </div>

            {/* Total Tax */}
            <div className="relative overflow-hidden bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-2xl border border-blue-500/20 p-5">
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="relative">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
                    <Percent className="w-5 h-5 text-white" />
                  </div>
                  <span className="text-sm text-zinc-400">Tax Withheld</span>
                </div>
                <p className="text-2xl font-bold text-white font-mono">
                  {formatCurrency(data?.overview?.totalTaxWithheld, true, reportingCurrency)}
                </p>
                <p className="text-xs text-zinc-500 mt-2">
                  {data?.overview?.totalTaxWithheld !== null && data?.overview?.totalGrossPayroll
                    ? `${((data.overview.totalTaxWithheld / data.overview.totalGrossPayroll) * 100).toFixed(1)}% effective rate`
                    : 'Rate unavailable'}
                </p>
              </div>
            </div>

            {/* Active Employees */}
            <div className="relative overflow-hidden bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-2xl border border-purple-500/20 p-5">
              <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="relative">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-violet-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
                    <Users className="w-5 h-5 text-white" />
                  </div>
                  <span className="text-sm text-zinc-400">Employees</span>
                </div>
                <p className="text-2xl font-bold text-white">
                  {data?.overview?.totalEmployees || 0}
                </p>
                <p className="text-xs text-zinc-500 mt-2">
                  Avg cost: {formatCurrency(data?.overview?.avgCostPerEmployee, true, reportingCurrency)}/yr
                </p>
              </div>
            </div>
          </div>

          {/* Secondary KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center gap-2 text-zinc-500 text-sm mb-2">
                <FileText className="w-4 h-4" />
                Total Payslips
              </div>
              <p className="text-xl font-bold text-zinc-200">{data?.overview?.totalPayslips || 0}</p>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center gap-2 text-zinc-500 text-sm mb-2">
                <Calendar className="w-4 h-4" />
                Payroll Runs
              </div>
              <p className="text-xl font-bold text-zinc-200">{data?.runStatusSummary?.total || 0}</p>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center gap-2 text-zinc-500 text-sm mb-2">
                <Activity className="w-4 h-4" />
                Avg Monthly
              </div>
              <p className="text-xl font-bold text-zinc-200">{formatCurrency(data?.overview?.avgMonthlyPayroll, true, reportingCurrency)}</p>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center gap-2 text-zinc-500 text-sm mb-2">
                <CheckCircle className="w-4 h-4" />
                Paid Runs
              </div>
              <p className="text-xl font-bold text-emerald-400">{data?.runStatusSummary?.paid || 0}</p>
            </div>
          </div>

          {data?.isMultiCurrency && data.currencyBreakdown.length > 0 && (
            <div className="border border-zinc-800 bg-zinc-900/50 overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="border-b border-zinc-800 text-left text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Currency</th>
                    <th className="px-4 py-3 font-medium text-right">Employees</th>
                    <th className="px-4 py-3 font-medium text-right">Gross</th>
                    <th className="px-4 py-3 font-medium text-right">Tax</th>
                    <th className="px-4 py-3 font-medium text-right">Net</th>
                    <th className="px-4 py-3 font-medium text-right">Employer cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {data.currencyBreakdown.map((entry) => (
                    <tr key={entry.currency} className="text-zinc-300">
                      <td className="px-4 py-3 font-medium">{entry.currency}</td>
                      <td className="px-4 py-3 text-right">{entry.employeeCount}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(entry.grossPay, false, entry.currency)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(entry.totalTax, false, entry.currency)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(entry.netPay, false, entry.currency)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(entry.totalEmployerCost, false, entry.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Monthly Trend Chart */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <BarChart3 className="w-5 h-5 text-amber-400" />
                  <h2 className="text-lg font-semibold text-zinc-100">Monthly Payroll Trend</h2>
                </div>
                <div className="flex gap-4 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-amber-500" />
                    <span className="text-zinc-400">{year}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-zinc-600" />
                    <span className="text-zinc-400">{year - 1}</span>
                  </span>
                </div>
              </div>

              <div className="flex items-end gap-1.5 h-52">
                {monthNames.map((month, idx) => {
                  const monthData = data?.monthlyTrend?.find(m => m.month === idx + 1);
                  const height = monthData?.grossPayroll !== null && monthData?.grossPayroll !== undefined
                    ? (monthData.grossPayroll / maxGross) * 100 : 0;
                  const prevHeight = monthData?.previousYearGross
                    ? (monthData.previousYearGross / maxGross) * 100 : 0;

                  return (
                    <div key={month} className="flex-1 flex flex-col items-center group">
                      <div className="relative w-full flex justify-center gap-0.5" style={{ height: '180px' }}>
                        {/* Previous year bar */}
                        <div
                          className="w-2 bg-zinc-700 rounded-t transition-all group-hover:bg-zinc-600"
                          style={{ height: `${Math.max(prevHeight, 1)}%`, alignSelf: 'flex-end' }}
                        />
                        {/* Current year bar */}
                        <div
                          className="w-3 bg-gradient-to-t from-amber-600 to-amber-400 rounded-t transition-all group-hover:from-amber-500 group-hover:to-amber-300"
                          style={{ height: `${Math.max(height, 1)}%`, alignSelf: 'flex-end' }}
                        />
                        
                        {/* Tooltip */}
                        <div className="absolute -top-14 left-1/2 -translate-x-1/2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10 shadow-xl">
                          <div className="font-medium text-white">{fullMonthNames[idx]}</div>
                          <div className="text-amber-400">{formatCurrency(monthData?.grossPayroll, false, reportingCurrency)}</div>
                          <div className="text-zinc-400">vs {formatCurrency(monthData?.previousYearGross, false, reportingCurrency)}</div>
                        </div>
                      </div>
                      <span className="text-xs text-zinc-500 mt-2">{month}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Earnings vs Deductions */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <PieChart className="w-5 h-5 text-emerald-400" />
                <h2 className="text-lg font-semibold text-zinc-100">Payroll Composition</h2>
              </div>

              <div className="grid grid-cols-2 gap-6">
                {/* Earnings Breakdown */}
                <div>
                  <h3 className="text-sm font-medium text-zinc-400 mb-4">Earnings</h3>
                  <div className="space-y-3">
                    {data?.earningBreakdown?.filter((item) => item.total !== null).slice(0, 5).map((item, idx) => {
                      const total = data.earningBreakdown.reduce((s, e) => s + (e.total ?? 0), 0) || 1;
                      const percent = (((item.total ?? 0) / total) * 100).toFixed(1);
                      return (
                        <div key={item.type}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-zinc-300 capitalize">{item.type.replace(/_/g, ' ')}</span>
                            <span className="text-zinc-400">{percent}%</span>
                          </div>
                          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${percent}%`,
                                backgroundColor: chartColors[idx % chartColors.length]
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Deductions Breakdown */}
                <div>
                  <h3 className="text-sm font-medium text-zinc-400 mb-4">Deductions</h3>
                  <div className="space-y-3">
                    {data?.deductionBreakdown?.filter((item) => item.total !== null).slice(0, 5).map((item, idx) => {
                      const total = data.deductionBreakdown.reduce((s, d) => s + (d.total ?? 0), 0) || 1;
                      const percent = (((item.total ?? 0) / total) * 100).toFixed(1);
                      return (
                        <div key={item.type}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-zinc-300 capitalize">{item.type.replace(/_/g, ' ')}</span>
                            <span className="text-zinc-400">{percent}%</span>
                          </div>
                          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${percent}%`,
                                backgroundColor: chartColors[(idx + 4) % chartColors.length]
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Salary Distribution */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <Award className="w-5 h-5 text-purple-400" />
              <h2 className="text-lg font-semibold text-zinc-100">Salary Distribution</h2>
            </div>
            <div className="grid grid-cols-6 gap-4">
              {data?.salaryDistribution?.map((range, idx) => {
                const maxCount = Math.max(...(data?.salaryDistribution?.map(r => r.count) || [1]));
                const height = (range.count / maxCount) * 100;
                return (
                  <div key={range.label} className="flex flex-col items-center">
                    <div className="text-2xl font-bold text-zinc-200 mb-2">{range.count}</div>
                    <div className="w-full h-24 bg-zinc-800 rounded-lg overflow-hidden flex items-end">
                      <div
                        className="w-full transition-all rounded-t"
                        style={{
                          height: `${Math.max(height, 5)}%`,
                          backgroundColor: chartColors[idx % chartColors.length]
                        }}
                      />
                    </div>
                    <span className="text-xs text-zinc-500 mt-2 text-center">{range.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Departments Tab */}
      {activeTab === 'departments' && (
        <div className="space-y-6">
          {/* Department Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {data?.departmentBreakdown?.map((dept, idx) => {
              const percentOfTotal = dept.totalGross !== null && data.overview.totalGrossPayroll
                ? (dept.totalGross / data.overview.totalGrossPayroll) * 100
                : null;
              return (
                <div
                  key={dept.department}
                  className="bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 border border-zinc-700/50 rounded-2xl p-5 hover:border-zinc-600/50 transition-all"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="font-semibold text-zinc-100 text-lg">{dept.department}</h3>
                      <p className="text-sm text-zinc-500">{dept.currentHeadcount} current employees</p>
                    </div>
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{ backgroundColor: `${chartColors[idx % chartColors.length]}20` }}
                    >
                      <Building2 className="w-5 h-5" style={{ color: chartColors[idx % chartColors.length] }} />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-sm text-zinc-400">Total Gross</span>
                      <span className="font-mono font-medium text-zinc-200">{formatCurrency(dept.totalGross, true, reportingCurrency)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-zinc-400">Total Net</span>
                      <span className="font-mono font-medium text-emerald-400">{formatCurrency(dept.totalNet, true, reportingCurrency)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-zinc-400">Avg pay / payslip</span>
                      <span className="font-mono font-medium text-zinc-200">{formatCurrency(dept.avgPayPerPayslip, false, reportingCurrency)}</span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-sm text-zinc-400">Employees in payroll</span>
                      <span className="font-medium text-zinc-200">{dept.payrollEmployeeCount}</span>
                    </div>

                    {percentOfTotal !== null && (
                    <div className="pt-3 border-t border-zinc-800">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-zinc-500">% of Total Payroll</span>
                        <span className="text-zinc-300">{percentOfTotal.toFixed(1)}%</span>
                      </div>
                      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${percentOfTotal}%`,
                            backgroundColor: chartColors[idx % chartColors.length]
                          }}
                        />
                      </div>
                    </div>
                    )}
                    <NativeCurrencyTotals breakdown={dept.currencyBreakdown} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Department Comparison Chart */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <BarChart3 className="w-5 h-5 text-blue-400" />
              <h2 className="text-lg font-semibold text-zinc-100">Department Payroll Comparison</h2>
            </div>

            <div className="space-y-4">
              {data?.departmentBreakdown?.map((dept, idx) => {
                const width = ((dept.totalGross ?? 0) / maxDeptGross) * 100;
                return (
                  <div key={dept.department} className="group">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-zinc-300">{dept.department}</span>
                      <span className="text-sm font-mono text-zinc-400">{formatCurrency(dept.totalGross, true, reportingCurrency)}</span>
                    </div>
                    <div className="h-8 bg-zinc-800 rounded-lg overflow-hidden">
                      <div
                        className="h-full rounded-lg transition-all flex items-center px-3 group-hover:opacity-90"
                        style={{
                          width: `${Math.max(width, 2)}%`,
                          backgroundColor: chartColors[idx % chartColors.length]
                        }}
                      >
                        <span className="text-xs font-medium text-white/80">
                          {dept.currentHeadcount} current · {dept.payrollEmployeeCount} paid
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Workforce Tab */}
      {activeTab === 'workforce' && headcount && (
        <div className="space-y-6">
          <div className="flex flex-col gap-1 border-b border-zinc-800 pb-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="text-zinc-300">
              Current workforce: <span className="font-semibold text-white">{headcount.total}</span>
              <span className="text-zinc-500"> across {Object.keys(headcount.departmentHeadcount).length} departments</span>
            </p>
            <p className="text-xs text-zinc-500">
              Source updated {headcount.latestSourceUpdate ? new Date(headcount.latestSourceUpdate).toLocaleString() : 'not recorded'}
            </p>
          </div>
          {/* Headcount Overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 border border-emerald-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                </div>
                <span className="text-sm text-zinc-400">Active</span>
              </div>
              <p className="text-3xl font-bold text-emerald-400">{headcount.statusBreakdown.active}</p>
            </div>

            <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 border border-amber-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-amber-400" />
                </div>
                <span className="text-sm text-zinc-400">On Notice</span>
              </div>
              <p className="text-3xl font-bold text-amber-400">{headcount.statusBreakdown.on_notice}</p>
            </div>

            <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 border border-blue-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-blue-400" />
                </div>
                <span className="text-sm text-zinc-400">On Leave</span>
              </div>
              <p className="text-3xl font-bold text-blue-400">{headcount.statusBreakdown.on_leave}</p>
            </div>

            <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 border border-red-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-red-400" />
                </div>
                <span className="text-sm text-zinc-400">Terminated</span>
              </div>
              <p className="text-3xl font-bold text-red-400">{headcount.statusBreakdown.terminated}</p>
            </div>
          </div>

          {(headcount.statusBreakdown.suspended > 0 || headcount.statusBreakdown.inactive > 0) && (
            <p className="text-sm text-zinc-500">
              Excluded from current workforce: {headcount.statusBreakdown.suspended} suspended, {headcount.statusBreakdown.inactive} inactive.
            </p>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Employment Types */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <Briefcase className="w-5 h-5 text-violet-400" />
                <h2 className="text-lg font-semibold text-zinc-100">Employment Types</h2>
              </div>

              <div className="space-y-4">
                {Object.entries(headcount.employmentTypes).map(([type, count], idx) => {
                  const total = Object.values(headcount.employmentTypes).reduce((a, b) => a + b, 0) || 1;
                  const percent = (count / total * 100).toFixed(1);
                  return (
                    <div key={type}>
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-zinc-300 capitalize">{type.replace(/_/g, ' ')}</span>
                        <span className="text-sm text-zinc-400">{count} ({percent}%)</span>
                      </div>
                      <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${percent}%`,
                            backgroundColor: chartColors[idx % chartColors.length]
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Tenure Distribution */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <Clock className="w-5 h-5 text-teal-400" />
                <h2 className="text-lg font-semibold text-zinc-100">Tenure Distribution</h2>
              </div>

              <div className="space-y-4">
                {headcount.tenureDistribution?.map((range, idx) => {
                  const total = headcount.tenureDistribution.reduce((a, b) => a + b.count, 0) || 1;
                  const percent = (range.count / total * 100).toFixed(1);
                  return (
                    <div key={range.label}>
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-zinc-300">{range.label}</span>
                        <span className="text-sm text-zinc-400">{range.count} ({percent}%)</span>
                      </div>
                      <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${percent}%`,
                            backgroundColor: chartColors[(idx + 4) % chartColors.length]
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Department Headcount */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <Building2 className="w-5 h-5 text-pink-400" />
              <h2 className="text-lg font-semibold text-zinc-100">Headcount by Department</h2>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {Object.entries(headcount.departmentHeadcount)
                .sort(([, a], [, b]) => b - a)
                .map(([dept, count], idx) => {
                  const total = Object.values(headcount.departmentHeadcount).reduce((a, b) => a + b, 0) || 1;
                  const percent = ((count / total) * 100).toFixed(1);
                  return (
                    <div
                      key={dept}
                      className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-4 hover:border-zinc-600/50 transition-all"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: chartColors[idx % chartColors.length] }}
                        />
                        <span className="text-sm font-medium text-zinc-300 truncate">{dept}</span>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-zinc-100">{count}</span>
                        <span className="text-xs text-zinc-500">({percent}%)</span>
                      </div>
                    </div>
                  );
                })}
              {Object.keys(headcount.departmentHeadcount).length === 0 && (
                <p className="col-span-full py-8 text-center text-sm text-zinc-500">No current employees have been assigned to a department.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
