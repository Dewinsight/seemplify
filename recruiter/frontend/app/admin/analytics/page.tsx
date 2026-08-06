"use client";

import { FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Coins,
  Loader2,
  Mail,
  Menu,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  UserRound,
  UsersRound
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import AdminHeader from '@/components/AdminHeader';
import AdminSidebar from '@/components/AdminSidebar';
import { useAdmin } from '@/context/AdminContext';
import { useFeatureFlags } from '@/context/FeatureFlagsContext';
import { apiRequest } from '@/services/apiConfig';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTrigger,
  SheetTitle
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type RangeKey = '7d' | '30d' | '90d' | 'all';

interface AnalyticsTotals {
  interviews: number;
  candidates: number;
  organizations: number;
  creators: number;
  candidateSlots: number;
  estimatedCredits: number;
  estimatedBackendCostUsd: number;
  sessions: number;
  completed: number;
  active: number;
  awaiting: number;
  failed: number;
  completionRate: number;
  averageScore: number | null;
  averageDurationMinutes: number | null;
  creditsCharged: number;
  creditsRefunded: number;
  proctorFailures: number;
  emailFailures: number;
}

interface BreakdownRow {
  id: string;
  name: string;
  email?: string;
  organizationCount?: number;
  interviews: number;
  candidateSlots: number;
  sessions: number;
  completed: number;
  failed: number;
  completionRate: number;
  averageScore: number | null;
  creditsCharged: number;
}

interface AIInterviewAnalytics {
  generatedAt: string;
  range: {
    key: RangeKey;
    start: string | null;
    end: string;
    interval: 'day' | 'month';
  };
  totals: AnalyticsTotals;
  monitoring: {
    staleSessions: number;
    overdueInvites: number;
    failuresLast24Hours: number;
    scoringFailures: number;
    scheduledNext24Hours: number;
  };
  interviewStatuses: Array<{ _id: string; count: number }>;
  sessionStatuses: Array<{ _id: string; count: number }>;
  trend: Array<{
    date: string;
    interviews: number;
    candidates: number;
    completed: number;
  }>;
  organizations: BreakdownRow[];
  creators: BreakdownRow[];
}

interface FilterOption {
  id: string;
  name: string;
  email?: string;
}

interface AIInterviewListItem {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  schedule: {
    sendAt: string;
    expiresAt: string;
    timezone: string;
  };
  candidateCount: number;
  organization: FilterOption | null;
  creator: FilterOption | null;
  job: { id: string; title: string; status: string } | null;
  voice: { id?: string; name?: string; tier?: string } | null;
  estimatedCredits: number;
  estimatedBackendCostUsd: number;
  sessionSummary: AnalyticsTotals;
}

interface SessionDetail {
  id: string;
  status: string;
  recipientType: string;
  candidate: {
    id?: string;
    name: string;
    email: string;
    applicationStatus: string;
  };
  createdBy: FilterOption | null;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  openedAt?: string;
  startedAt?: string;
  completedAt?: string;
  lastActivityAt?: string;
  durationMinutes: number | null;
  progress: {
    currentQuestion: number;
    answered: number;
    skipped: number;
    timedOut: number;
    messages: number;
  };
  scoring: {
    status: string;
    overallScore: number | null;
    recommendation: string;
    summary: string;
    strengths: string[];
    concerns: string[];
    error: string;
  };
  delivery: {
    attempts: number;
    sentAt?: string;
    messageId: string;
    lastError: string;
  };
  credits: {
    charged?: boolean;
    cost?: number;
    refunded?: boolean;
    error?: string;
  };
  proctoring: {
    enabled: boolean;
    focusViolations: number;
    pasteAttempts: number;
    violationCount: number;
    terminatedAt?: string;
    terminationReason: string;
  };
}

interface AIInterviewDetail {
  interview: {
    id: string;
    title: string;
    status: string;
    guidelines: string;
    createdAt: string;
    updatedAt: string;
    schedule: { sendAt: string; expiresAt: string; timezone: string };
    timers: { perQuestionMinutes: number; totalMinutes: number };
    questionCount: number;
    candidateCount: number;
    organization: (FilterOption & { industry?: string; plan?: string }) | null;
    creator: (FilterOption & { title?: string }) | null;
    job: { id: string; title: string; status: string } | null;
    voice: { displayName?: string; name?: string; tierLabel?: string } | null;
    costEstimate: {
      totalCredits?: number;
      estimatedBackendCostUsd?: number;
      estimatedDisplayValue?: number;
      displayCurrency?: string;
    } | null;
    cancelledAt?: string;
    cancellationReason: string;
    cancelledBy: FilterOption | null;
  };
  summary: {
    sessions: number;
    completed: number;
    active: number;
    failed: number;
    completionRate: number;
    averageScore: number | null;
    creditsCharged: number;
  };
  sessions: SessionDetail[];
}

const RANGE_OPTIONS: Array<{ key: RangeKey; label: string }> = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'all', label: 'All time' }
];

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  sending: 'Sending',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
  pending_send: 'Pending send',
  sent: 'Sent',
  opened: 'Opened',
  in_progress: 'In progress',
  proctor_failed: 'Proctor failed',
  credit_blocked: 'Credit blocked',
  credit_error: 'Credit error',
  email_failed: 'Email failed'
};

function statusLabel(status: string) {
  return STATUS_LABELS[status] || status.replaceAll('_', ' ');
}

function statusClass(status: string) {
  if (status === 'completed') return 'border-emerald-700 bg-emerald-950 text-emerald-300';
  if (['active', 'opened', 'in_progress'].includes(status)) {
    return 'border-cyan-700 bg-cyan-950 text-cyan-300';
  }
  if (['scheduled', 'sent', 'sending', 'pending_send'].includes(status)) {
    return 'border-blue-700 bg-blue-950 text-blue-300';
  }
  if (['cancelled', 'expired'].includes(status)) {
    return 'border-gray-600 bg-gray-800 text-gray-300';
  }
  return 'border-red-800 bg-red-950 text-red-300';
}

function formatDate(value?: string, includeTime = true) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {})
  }).format(date);
}

function formatTrendDate(value: string, interval: 'day' | 'month') {
  const normalized = interval === 'month' ? `${value}-01T00:00:00Z` : `${value}T00:00:00Z`;
  const date = new Date(normalized);
  return new Intl.DateTimeFormat('en-GB', interval === 'month'
    ? { month: 'short', year: '2-digit' }
    : { day: '2-digit', month: 'short' }).format(date);
}

function number(value: number | null | undefined, digits = 0) {
  if (value == null) return 'N/A';
  return new Intl.NumberFormat('en-GB', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(value);
}

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.msg || data.message || 'Request failed');
  }
  return data as T;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center border border-dashed border-gray-700 bg-gray-900/40 px-6 text-center text-sm text-gray-400">
      {message}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={statusClass(status)}>
      {statusLabel(status)}
    </Badge>
  );
}

export default function AdminAnalyticsPage() {
  const { checkPermission } = useAdmin();
  const { isFeatureEnabled, isLoading: featureFlagsLoading } = useFeatureFlags();
  const [range, setRange] = useState<RangeKey>('30d');
  const [organizationId, setOrganizationId] = useState('all');
  const [creatorId, setCreatorId] = useState('all');
  const [status, setStatus] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [analytics, setAnalytics] = useState<AIInterviewAnalytics | null>(null);
  const [filters, setFilters] = useState<{
    organizations: FilterOption[];
    creators: FilterOption[];
    statuses: string[];
  }>({ organizations: [], creators: [], statuses: [] });
  const [interviews, setInterviews] = useState<AIInterviewListItem[]>([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [selectedInterviewId, setSelectedInterviewId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AIInterviewDetail | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState('');

  const buildQuery = useCallback((withPagination = false) => {
    const params = new URLSearchParams({ range });
    if (organizationId !== 'all') params.set('organizationId', organizationId);
    if (creatorId !== 'all') params.set('creatorId', creatorId);
    if (status !== 'all') params.set('status', status);
    if (search) params.set('search', search);
    if (withPagination) {
      params.set('page', String(page));
      params.set('limit', '25');
    }
    return params;
  }, [creatorId, organizationId, page, range, search, status]);

  const fetchOverview = useCallback(async (quiet = false) => {
    if (!quiet) setLoadingOverview(true);
    try {
      const token = localStorage.getItem('adminToken') || '';
      const response = await apiRequest(`/api/admin/ai-interviews/analytics?${buildQuery()}`, {
        headers: { 'x-admin-auth-token': token }
      });
      setAnalytics(await readResponse<AIInterviewAnalytics>(response));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load analytics');
    } finally {
      if (!quiet) setLoadingOverview(false);
    }
  }, [buildQuery]);

  const fetchInterviews = useCallback(async (quiet = false) => {
    if (!quiet) setLoadingList(true);
    try {
      const token = localStorage.getItem('adminToken') || '';
      const response = await apiRequest(`/api/admin/ai-interviews?${buildQuery(true)}`, {
        headers: { 'x-admin-auth-token': token }
      });
      const data = await readResponse<{
        interviews: AIInterviewListItem[];
        pagination: { page: number; totalPages: number; total: number };
      }>(response);
      setInterviews(data.interviews);
      setPagination(data.pagination);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load interviews');
    } finally {
      if (!quiet) setLoadingList(false);
    }
  }, [buildQuery]);

  const refreshAll = useCallback(async (quiet = false) => {
    setError('');
    await Promise.all([fetchOverview(quiet), fetchInterviews(quiet)]);
  }, [fetchInterviews, fetchOverview]);

  useEffect(() => {
    const fetchFilters = async () => {
      try {
        const token = localStorage.getItem('adminToken') || '';
        const response = await apiRequest('/api/admin/ai-interviews/filters', {
          headers: { 'x-admin-auth-token': token }
        });
        setFilters(await readResponse(response));
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Failed to load filters');
      }
    };
    fetchFilters();
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = window.setInterval(() => refreshAll(true), 60_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, refreshAll]);

  useEffect(() => {
    if (!selectedInterviewId) {
      setDetail(null);
      setExpandedSessionId(null);
      return;
    }

    const fetchDetail = async () => {
      setLoadingDetail(true);
      try {
        const token = localStorage.getItem('adminToken') || '';
        const response = await apiRequest(`/api/admin/ai-interviews/${selectedInterviewId}`, {
          headers: { 'x-admin-auth-token': token }
        });
        setDetail(await readResponse<AIInterviewDetail>(response));
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Failed to load interview details');
        setSelectedInterviewId(null);
      } finally {
        setLoadingDetail(false);
      }
    };
    fetchDetail();
  }, [selectedInterviewId]);

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  const updateFilter = (setter: (value: string) => void, value: string) => {
    setPage(1);
    setter(value);
  };

  const healthIssueCount = useMemo(() => {
    if (!analytics) return 0;
    return analytics.monitoring.staleSessions
      + analytics.monitoring.overdueInvites
      + analytics.monitoring.failuresLast24Hours
      + analytics.monitoring.scoringFailures;
  }, [analytics]);

  if (!checkPermission('viewAnalytics')) {
    return (
      <div className="flex h-screen bg-gray-900">
        <AdminSidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <AdminHeader />
          <main className="flex flex-1 items-center justify-center p-6">
            <div className="max-w-lg border border-gray-700 bg-gray-800 p-8 text-center">
              <BarChart3 className="mx-auto mb-4 h-10 w-10 text-gray-500" />
              <h1 className="text-xl font-semibold text-white">Access denied</h1>
              <p className="mt-2 text-sm text-gray-400">Analytics permission is required.</p>
            </div>
          </main>
        </div>
      </div>
    );
  }

  const metricItems = analytics ? [
    { label: 'Interviews', value: number(analytics.totals.interviews), icon: Bot, tone: 'text-blue-300' },
    { label: 'Candidate sessions', value: number(analytics.totals.sessions), icon: UsersRound, tone: 'text-cyan-300' },
    { label: 'Completion rate', value: `${number(analytics.totals.completionRate, 1)}%`, icon: CheckCircle2, tone: 'text-emerald-300' },
    { label: 'Average score', value: analytics.totals.averageScore == null ? 'N/A' : `${number(analytics.totals.averageScore, 1)}%`, icon: Sparkles, tone: 'text-amber-300' },
    { label: 'Credits charged', value: number(analytics.totals.creditsCharged, 1), icon: Coins, tone: 'text-violet-300' },
    { label: 'Organizations', value: number(analytics.totals.organizations), icon: Building2, tone: 'text-rose-300' }
  ] : [];

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      <div className="hidden lg:flex">
        <AdminSidebar />
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AdminHeader>
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-gray-300 hover:bg-gray-700 hover:text-white lg:hidden"
                aria-label="Open admin navigation"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 border-gray-700 bg-gray-800 p-0 sm:max-w-64">
              <SheetHeader className="sr-only">
                <SheetTitle>Admin navigation</SheetTitle>
                <SheetDescription>Navigate the admin portal</SheetDescription>
              </SheetHeader>
              <AdminSidebar onToggle={() => setMobileNavOpen(false)} />
            </SheetContent>
          </Sheet>
        </AdminHeader>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
            <header className="flex flex-col gap-4 border-b border-gray-800 pb-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-cyan-300">
                  <Activity className="h-4 w-4" />
                  AI Interview Operations
                </div>
                <h1 className="mt-2 text-2xl font-semibold text-white">Monitoring and analytics</h1>
                <p className="mt-1 text-sm text-gray-400">
                  {analytics ? `Updated ${formatDate(analytics.generatedAt)}` : 'Loading platform activity'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-9 items-center gap-2 border border-gray-700 bg-gray-900 px-3">
                  <span className={`h-2 w-2 rounded-full ${
                    featureFlagsLoading
                      ? 'bg-gray-500'
                      : isFeatureEnabled('aiInterviews')
                        ? 'bg-cyan-400'
                        : 'bg-amber-400'
                  }`} />
                  <span className="text-xs font-medium text-gray-300">
                    {featureFlagsLoading
                      ? 'Checking feature state'
                      : isFeatureEnabled('aiInterviews')
                        ? 'AI Interviews enabled'
                        : 'AI Interviews paused'}
                  </span>
                </div>
                <div className="flex h-9 items-center gap-2 border border-gray-700 bg-gray-900 px-3">
                  <span className={`h-2 w-2 rounded-full ${autoRefresh ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                  <span className="text-xs font-medium text-gray-300">Live refresh</span>
                  <Switch
                    checked={autoRefresh}
                    onCheckedChange={setAutoRefresh}
                    aria-label="Toggle live refresh"
                  />
                </div>
                <Button
                  variant="outline"
                  className="h-9 border-gray-700 bg-gray-900 text-gray-200 hover:bg-gray-800"
                  onClick={() => refreshAll()}
                  disabled={loadingOverview || loadingList}
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${(loadingOverview || loadingList) ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>
            </header>

            <section className="border-b border-gray-800 py-4" aria-label="Analytics filters">
              <div className="flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-center">
                <div className="flex min-h-9 shrink-0 flex-nowrap border border-gray-700 bg-gray-900 p-1">
                  {RANGE_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => updateFilter((value) => setRange(value as RangeKey), option.key)}
                      className={`h-7 whitespace-nowrap px-2.5 text-xs font-medium transition-colors ${
                        range === option.key
                          ? 'bg-gray-700 text-white'
                          : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <Select value={organizationId} onValueChange={(value) => updateFilter(setOrganizationId, value)}>
                  <SelectTrigger className="h-9 w-full border-gray-700 bg-gray-900 text-gray-200 xl:w-48">
                    <SelectValue placeholder="All organizations" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All organizations</SelectItem>
                    {filters.organizations.map((organization) => (
                      <SelectItem key={organization.id} value={organization.id}>{organization.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={creatorId} onValueChange={(value) => updateFilter(setCreatorId, value)}>
                  <SelectTrigger className="h-9 w-full border-gray-700 bg-gray-900 text-gray-200 xl:w-48">
                    <SelectValue placeholder="All creators" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All creators</SelectItem>
                    {filters.creators.map((creator) => (
                      <SelectItem key={creator.id} value={creator.id}>{creator.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={status} onValueChange={(value) => updateFilter(setStatus, value)}>
                  <SelectTrigger className="h-9 w-full border-gray-700 bg-gray-900 text-gray-200 xl:w-40">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {filters.statuses.map((item) => (
                      <SelectItem key={item} value={item}>{statusLabel(item)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <form onSubmit={handleSearch} className="flex min-w-0 flex-1 gap-2 xl:min-w-72">
                  <div className="relative min-w-0 flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                    <Input
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                      placeholder="Search title, job, organization or creator"
                      className="h-9 border-gray-700 bg-gray-900 pl-9 text-gray-200 placeholder:text-gray-600"
                    />
                  </div>
                  <Button type="submit" className="h-9 bg-blue-600 text-white hover:bg-blue-500">Search</Button>
                </form>
              </div>
            </section>

            {error && (
              <div className="mt-4 flex items-center gap-3 border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-200">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="flex-1">{error}</span>
                <Button variant="ghost" size="sm" onClick={() => refreshAll()} className="text-red-100">Retry</Button>
              </div>
            )}

            <section className="py-5" aria-label="AI interview totals">
              {loadingOverview && !analytics ? (
                <div className="flex h-32 items-center justify-center text-gray-400">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading analytics
                </div>
              ) : (
                <div className="grid grid-cols-2 border-l border-t border-gray-800 sm:grid-cols-3 xl:grid-cols-6">
                  {metricItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.label} className="min-h-28 border-b border-r border-gray-800 bg-gray-900/55 p-4">
                        <Icon className={`h-5 w-5 ${item.tone}`} />
                        <div className="mt-4 text-2xl font-semibold text-white">{item.value}</div>
                        <div className="mt-1 text-xs text-gray-400">{item.label}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {analytics && (
              <>
                <section className="border-y border-gray-800 bg-gray-900/35 py-4" aria-label="Live monitoring">
                  <div className="flex flex-col gap-4 px-4 lg:flex-row lg:items-center">
                    <div className="flex min-w-52 items-center gap-3">
                      <div className={`flex h-10 w-10 items-center justify-center border ${
                        healthIssueCount === 0
                          ? 'border-emerald-800 bg-emerald-950 text-emerald-300'
                          : 'border-amber-800 bg-amber-950 text-amber-300'
                      }`}>
                        {healthIssueCount === 0
                          ? <CheckCircle2 className="h-5 w-5" />
                          : <ShieldAlert className="h-5 w-5" />}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white">
                          {healthIssueCount === 0 ? 'Healthy' : `${healthIssueCount} items need attention`}
                        </div>
                        <div className="text-xs text-gray-500">Current operational state</div>
                      </div>
                    </div>
                    <div className="grid flex-1 grid-cols-2 gap-px bg-gray-800 md:grid-cols-5">
                      {[
                        { label: 'Overdue invites', value: analytics.monitoring.overdueInvites, icon: Mail },
                        { label: 'Stale sessions', value: analytics.monitoring.staleSessions, icon: Clock3 },
                        { label: 'Failures, 24h', value: analytics.monitoring.failuresLast24Hours, icon: AlertTriangle },
                        { label: 'Scoring failures', value: analytics.monitoring.scoringFailures, icon: Sparkles },
                        { label: 'Due next 24h', value: analytics.monitoring.scheduledNext24Hours, icon: CalendarClock }
                      ].map((item) => {
                        const Icon = item.icon;
                        return (
                          <div key={item.label} className="flex min-h-16 items-center gap-3 bg-gray-950 px-3 py-2">
                            <Icon className={`h-4 w-4 ${item.value ? 'text-amber-300' : 'text-gray-600'}`} />
                            <div>
                              <div className="text-base font-semibold text-white">{number(item.value)}</div>
                              <div className="text-xs text-gray-500">{item.label}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>

                <section className="grid gap-6 border-b border-gray-800 py-6 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
                  <div className="min-w-0">
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <h2 className="text-base font-semibold text-white">Activity trend</h2>
                        <p className="mt-1 text-xs text-gray-500">Interviews created, candidates invited and sessions completed</p>
                      </div>
                    </div>
                    {analytics.trend.length ? (
                      <div className="h-72 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={analytics.trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                            <defs>
                              <linearGradient id="interviewsFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.35} />
                                <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                              </linearGradient>
                              <linearGradient id="completedFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid stroke="#1f2937" vertical={false} />
                            <XAxis
                              dataKey="date"
                              tickFormatter={(value) => formatTrendDate(value, analytics.range.interval)}
                              tick={{ fill: '#6b7280', fontSize: 11 }}
                              tickLine={false}
                              axisLine={{ stroke: '#374151' }}
                              minTickGap={28}
                            />
                            <YAxis
                              allowDecimals={false}
                              tick={{ fill: '#6b7280', fontSize: 11 }}
                              tickLine={false}
                              axisLine={false}
                            />
                            <Tooltip
                              labelFormatter={(value) => formatTrendDate(String(value), analytics.range.interval)}
                              contentStyle={{ background: '#111827', border: '1px solid #374151', color: '#f9fafb' }}
                            />
                            <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12 }} />
                            <Area type="monotone" dataKey="interviews" name="Interviews" stroke="#60a5fa" fill="url(#interviewsFill)" strokeWidth={2} />
                            <Area type="monotone" dataKey="candidates" name="Candidates" stroke="#fbbf24" fill="transparent" strokeWidth={2} />
                            <Area type="monotone" dataKey="completed" name="Completed" stroke="#34d399" fill="url(#completedFill)" strokeWidth={2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <EmptyState message="No activity in this period." />
                    )}
                  </div>
                  <div className="border-l-0 border-gray-800 xl:border-l xl:pl-6">
                    <h2 className="text-base font-semibold text-white">Session status</h2>
                    <p className="mt-1 text-xs text-gray-500">Current candidate session distribution</p>
                    <div className="mt-5 space-y-3">
                      {analytics.sessionStatuses.length ? analytics.sessionStatuses.map((item) => {
                        const percentage = analytics.totals.sessions
                          ? (item.count / analytics.totals.sessions) * 100
                          : 0;
                        return (
                          <div key={item._id}>
                            <div className="mb-1.5 flex items-center justify-between text-xs">
                              <span className="capitalize text-gray-300">{statusLabel(item._id)}</span>
                              <span className="text-gray-500">{number(item.count)} / {number(percentage, 1)}%</span>
                            </div>
                            <div className="h-1.5 overflow-hidden bg-gray-800">
                              <div className="h-full bg-cyan-500" style={{ width: `${Math.max(2, percentage)}%` }} />
                            </div>
                          </div>
                        );
                      }) : <EmptyState message="No candidate sessions." />}
                    </div>
                  </div>
                </section>

                <section className="border-b border-gray-800 py-6">
                  <Tabs defaultValue="organizations">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <h2 className="text-base font-semibold text-white">Usage breakdown</h2>
                        <p className="mt-1 text-xs text-gray-500">Highest activity across organizations and interview creators</p>
                      </div>
                      <TabsList className="h-9 bg-gray-900">
                        <TabsTrigger value="organizations">Organizations</TabsTrigger>
                        <TabsTrigger value="creators">Creators</TabsTrigger>
                      </TabsList>
                    </div>
                    <TabsContent value="organizations" className="mt-0 overflow-x-auto border border-gray-800">
                      <BreakdownTable rows={analytics.organizations} type="organization" onSelect={(id) => updateFilter(setOrganizationId, id)} />
                    </TabsContent>
                    <TabsContent value="creators" className="mt-0 overflow-x-auto border border-gray-800">
                      <BreakdownTable rows={analytics.creators} type="creator" onSelect={(id) => updateFilter(setCreatorId, id)} />
                    </TabsContent>
                  </Tabs>
                </section>
              </>
            )}

            <section className="py-6">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white">Interview ledger</h2>
                  <p className="mt-1 text-xs text-gray-500">{number(pagination.total)} matching interviews</p>
                </div>
                {search && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-gray-400"
                    onClick={() => {
                      setSearchInput('');
                      setSearch('');
                      setPage(1);
                    }}
                  >
                    Clear search
                  </Button>
                )}
              </div>
              <div className="overflow-x-auto border border-gray-800">
                <Table>
                  <TableHeader className="bg-gray-900">
                    <TableRow className="border-gray-800 hover:bg-gray-900">
                      <TableHead className="min-w-64 text-gray-400">Interview</TableHead>
                      <TableHead className="min-w-44 text-gray-400">Organization</TableHead>
                      <TableHead className="min-w-44 text-gray-400">Created by</TableHead>
                      <TableHead className="text-gray-400">Status</TableHead>
                      <TableHead className="text-right text-gray-400">Sessions</TableHead>
                      <TableHead className="text-right text-gray-400">Completed</TableHead>
                      <TableHead className="text-right text-gray-400">Avg score</TableHead>
                      <TableHead className="min-w-36 text-gray-400">Created</TableHead>
                      <TableHead className="w-12"><span className="sr-only">Open</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingList ? (
                      <TableRow className="border-gray-800">
                        <TableCell colSpan={9} className="h-32 text-center text-gray-400">
                          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading interviews
                        </TableCell>
                      </TableRow>
                    ) : interviews.length ? interviews.map((interview) => (
                      <TableRow
                        key={interview.id}
                        className="cursor-pointer border-gray-800 bg-gray-950 hover:bg-gray-900"
                        onClick={() => setSelectedInterviewId(interview.id)}
                      >
                        <TableCell>
                          <div className="font-medium text-white">{interview.title}</div>
                          <div className="mt-1 text-xs text-gray-500">{interview.job?.title || 'No job linked'}</div>
                        </TableCell>
                        <TableCell className="text-sm text-gray-300">{interview.organization?.name || 'Unknown'}</TableCell>
                        <TableCell>
                          <div className="text-sm text-gray-300">{interview.creator?.name || 'Unknown'}</div>
                          <div className="text-xs text-gray-600">{interview.creator?.email}</div>
                        </TableCell>
                        <TableCell><StatusBadge status={interview.status} /></TableCell>
                        <TableCell className="text-right text-gray-300">{number(interview.sessionSummary.sessions)}</TableCell>
                        <TableCell className="text-right text-gray-300">{number(interview.sessionSummary.completed)}</TableCell>
                        <TableCell className="text-right text-gray-300">
                          {interview.sessionSummary.averageScore == null ? 'N/A' : `${number(interview.sessionSummary.averageScore, 1)}%`}
                        </TableCell>
                        <TableCell className="text-xs text-gray-500">{formatDate(interview.createdAt)}</TableCell>
                        <TableCell>
                          <button
                            type="button"
                            aria-label={`Open ${interview.title}`}
                            title="Open details"
                            className="flex h-8 w-8 items-center justify-center text-gray-500 hover:bg-gray-800 hover:text-white"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedInterviewId(interview.id);
                            }}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </TableCell>
                      </TableRow>
                    )) : (
                      <TableRow className="border-gray-800">
                        <TableCell colSpan={9} className="h-32 text-center text-gray-500">No interviews match these filters.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <div className="text-xs text-gray-500">Page {pagination.page} of {pagination.totalPages}</div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-gray-700 bg-gray-900 text-gray-300"
                    disabled={page <= 1 || loadingList}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" /> Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-gray-700 bg-gray-900 text-gray-300"
                    disabled={page >= pagination.totalPages || loadingList}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    Next <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>

      <Sheet open={Boolean(selectedInterviewId)} onOpenChange={(open) => !open && setSelectedInterviewId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto border-gray-700 bg-gray-950 p-0 text-gray-100 sm:max-w-4xl">
          {loadingDetail || !detail ? (
            <div className="flex h-full items-center justify-center text-gray-400">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading interview
            </div>
          ) : (
            <>
              <SheetHeader className="border-b border-gray-800 px-6 py-5 text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={detail.interview.status} />
                  <span className="text-xs text-gray-500">Created {formatDate(detail.interview.createdAt)}</span>
                </div>
                <SheetTitle className="mt-2 text-xl text-white">{detail.interview.title}</SheetTitle>
                <SheetDescription className="text-gray-400">
                  {detail.interview.organization?.name || 'Unknown organization'} / {detail.interview.job?.title || 'No job linked'}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-0">
                <section className="grid grid-cols-2 border-b border-gray-800 md:grid-cols-4">
                  {[
                    { label: 'Sessions', value: detail.summary.sessions },
                    { label: 'Completed', value: detail.summary.completed },
                    { label: 'Completion', value: `${number(detail.summary.completionRate, 1)}%` },
                    { label: 'Average score', value: detail.summary.averageScore == null ? 'N/A' : `${number(detail.summary.averageScore, 1)}%` }
                  ].map((item) => (
                    <div key={item.label} className="border-b border-r border-gray-800 p-4 md:border-b-0">
                      <div className="text-xl font-semibold text-white">{item.value}</div>
                      <div className="mt-1 text-xs text-gray-500">{item.label}</div>
                    </div>
                  ))}
                </section>

                <section className="grid gap-5 border-b border-gray-800 p-6 md:grid-cols-2">
                  <div>
                    <h3 className="text-xs font-semibold uppercase text-gray-500">Ownership</h3>
                    <dl className="mt-3 space-y-3 text-sm">
                      <DetailLine icon={Building2} label="Organization" value={detail.interview.organization?.name || 'Unknown'} />
                      <DetailLine icon={UserRound} label="Created by" value={`${detail.interview.creator?.name || 'Unknown'}${detail.interview.creator?.email ? ` / ${detail.interview.creator.email}` : ''}`} />
                      <DetailLine icon={Bot} label="Job" value={detail.interview.job?.title || 'No job linked'} />
                    </dl>
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold uppercase text-gray-500">Schedule and cost</h3>
                    <dl className="mt-3 space-y-3 text-sm">
                      <DetailLine icon={CalendarClock} label="Send at" value={formatDate(detail.interview.schedule?.sendAt)} />
                      <DetailLine icon={Clock3} label="Expires" value={formatDate(detail.interview.schedule?.expiresAt)} />
                      <DetailLine icon={Coins} label="Estimated credits" value={number(detail.interview.costEstimate?.totalCredits || 0, 1)} />
                    </dl>
                  </div>
                </section>

                <section className="p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-white">Candidate sessions</h3>
                      <p className="mt-1 text-xs text-gray-500">Delivery, progress, scoring and integrity details</p>
                    </div>
                    <Badge variant="outline" className="border-gray-700 text-gray-300">{detail.sessions.length}</Badge>
                  </div>
                  <div className="overflow-hidden border border-gray-800">
                    <Table>
                      <TableHeader className="bg-gray-900">
                        <TableRow className="border-gray-800 hover:bg-gray-900">
                          <TableHead className="text-gray-400">Candidate</TableHead>
                          <TableHead className="text-gray-400">Status</TableHead>
                          <TableHead className="text-right text-gray-400">Score</TableHead>
                          <TableHead className="text-right text-gray-400">Duration</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.sessions.map((session) => {
                          const expanded = expandedSessionId === session.id;
                          return (
                            <Fragment key={session.id}>
                              <TableRow
                                className="cursor-pointer border-gray-800 bg-gray-950 hover:bg-gray-900"
                                onClick={() => setExpandedSessionId(expanded ? null : session.id)}
                              >
                                <TableCell>
                                  <div className="font-medium text-white">{session.candidate.name}</div>
                                  <div className="text-xs text-gray-600">{session.candidate.email}</div>
                                </TableCell>
                                <TableCell><StatusBadge status={session.status} /></TableCell>
                                <TableCell className="text-right text-gray-300">
                                  {session.scoring.overallScore == null ? 'N/A' : `${number(session.scoring.overallScore, 1)}%`}
                                </TableCell>
                                <TableCell className="text-right text-gray-300">
                                  {session.durationMinutes == null ? 'N/A' : `${number(session.durationMinutes, 1)} min`}
                                </TableCell>
                                <TableCell>
                                  <ChevronRight className={`h-4 w-4 text-gray-500 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                                </TableCell>
                              </TableRow>
                              {expanded && (
                                <TableRow className="border-gray-800 bg-gray-900/60 hover:bg-gray-900/60">
                                  <TableCell colSpan={5} className="p-0">
                                    <SessionDrilldown session={session} />
                                  </TableCell>
                                </TableRow>
                              )}
                            </Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                    {!detail.sessions.length && <EmptyState message="No candidate sessions were created." />}
                  </div>
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function BreakdownTable({
  rows,
  type,
  onSelect
}: {
  rows: BreakdownRow[];
  type: 'organization' | 'creator';
  onSelect: (id: string) => void;
}) {
  if (!rows.length) return <EmptyState message={`No ${type} activity in this period.`} />;
  return (
    <Table>
      <TableHeader className="bg-gray-900">
        <TableRow className="border-gray-800 hover:bg-gray-900">
          <TableHead className="min-w-60 text-gray-400">{type === 'organization' ? 'Organization' : 'Creator'}</TableHead>
          <TableHead className="text-right text-gray-400">Interviews</TableHead>
          <TableHead className="text-right text-gray-400">Sessions</TableHead>
          <TableHead className="text-right text-gray-400">Completed</TableHead>
          <TableHead className="text-right text-gray-400">Completion</TableHead>
          <TableHead className="text-right text-gray-400">Avg score</TableHead>
          <TableHead className="text-right text-gray-400">Credits</TableHead>
          <TableHead className="w-12" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} className="border-gray-800 bg-gray-950 hover:bg-gray-900">
            <TableCell>
              <div className="font-medium text-white">{row.name}</div>
              {row.email && <div className="text-xs text-gray-600">{row.email}</div>}
            </TableCell>
            <TableCell className="text-right text-gray-300">{number(row.interviews)}</TableCell>
            <TableCell className="text-right text-gray-300">{number(row.sessions)}</TableCell>
            <TableCell className="text-right text-gray-300">{number(row.completed)}</TableCell>
            <TableCell className="text-right text-gray-300">{number(row.completionRate, 1)}%</TableCell>
            <TableCell className="text-right text-gray-300">{row.averageScore == null ? 'N/A' : `${number(row.averageScore, 1)}%`}</TableCell>
            <TableCell className="text-right text-gray-300">{number(row.creditsCharged, 1)}</TableCell>
            <TableCell>
              <button
                type="button"
                aria-label={`Filter by ${row.name}`}
                title={`Filter by ${row.name}`}
                onClick={() => onSelect(row.id)}
                className="flex h-8 w-8 items-center justify-center text-gray-500 hover:bg-gray-800 hover:text-white"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function DetailLine({ icon: Icon, label, value }: {
  icon: typeof Building2;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-600" />
      <div>
        <dt className="text-xs text-gray-500">{label}</dt>
        <dd className="mt-0.5 break-words text-gray-300">{value}</dd>
      </div>
    </div>
  );
}

function SessionDrilldown({ session }: { session: SessionDetail }) {
  return (
    <div className="grid gap-5 p-5 md:grid-cols-2">
      <section>
        <h4 className="text-xs font-semibold uppercase text-gray-500">Timeline</h4>
        <div className="mt-3 space-y-2 text-xs">
          <TimelineRow label="Created" value={formatDate(session.createdAt)} />
          <TimelineRow label="Email sent" value={formatDate(session.delivery.sentAt)} warning={Boolean(session.delivery.lastError)} />
          <TimelineRow label="Started" value={formatDate(session.startedAt)} />
          <TimelineRow label="Completed" value={formatDate(session.completedAt)} />
          <TimelineRow label="Last activity" value={formatDate(session.lastActivityAt)} />
        </div>
      </section>
      <section>
        <h4 className="text-xs font-semibold uppercase text-gray-500">Progress</h4>
        <div className="mt-3 grid grid-cols-2 gap-px bg-gray-800">
          {[
            ['Answered', session.progress.answered],
            ['Skipped', session.progress.skipped],
            ['Timed out', session.progress.timedOut],
            ['Messages', session.progress.messages]
          ].map(([label, value]) => (
            <div key={String(label)} className="bg-gray-950 p-3">
              <div className="text-base font-semibold text-white">{value}</div>
              <div className="text-xs text-gray-600">{label}</div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h4 className="text-xs font-semibold uppercase text-gray-500">Scoring</h4>
        <div className="mt-3 text-sm text-gray-300">
          <div className="flex items-center justify-between border-b border-gray-800 pb-2">
            <span className="text-gray-500">Status</span>
            <span className="capitalize">{statusLabel(session.scoring.status)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-gray-800 py-2">
            <span className="text-gray-500">Recommendation</span>
            <span>{session.scoring.recommendation || 'Not available'}</span>
          </div>
          {session.scoring.summary && <p className="mt-3 text-xs leading-5 text-gray-400">{session.scoring.summary}</p>}
          {session.scoring.error && <p className="mt-3 text-xs text-red-300">{session.scoring.error}</p>}
        </div>
      </section>
      <section>
        <h4 className="text-xs font-semibold uppercase text-gray-500">Delivery and integrity</h4>
        <div className="mt-3 space-y-2 text-xs">
          <TimelineRow label="Email attempts" value={String(session.delivery.attempts)} warning={Boolean(session.delivery.lastError)} />
          <TimelineRow label="Credits" value={`${number(session.credits.cost || 0, 1)}${session.credits.refunded ? ' / refunded' : session.credits.charged ? ' / charged' : ' / not charged'}`} />
          <TimelineRow label="Focus violations" value={String(session.proctoring.focusViolations)} warning={session.proctoring.focusViolations > 0} />
          <TimelineRow label="Paste attempts" value={String(session.proctoring.pasteAttempts)} warning={session.proctoring.pasteAttempts > 0} />
          <TimelineRow label="Proctor events" value={String(session.proctoring.violationCount)} warning={session.proctoring.violationCount > 0} />
          {session.delivery.lastError && <p className="border border-red-900 bg-red-950/50 p-2 text-red-300">{session.delivery.lastError}</p>}
          {session.proctoring.terminationReason && <p className="border border-amber-900 bg-amber-950/50 p-2 text-amber-200">{session.proctoring.terminationReason}</p>}
        </div>
      </section>
    </div>
  );
}

function TimelineRow({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-800 pb-2">
      <span className="text-gray-500">{label}</span>
      <span className={`text-right ${warning ? 'text-amber-300' : 'text-gray-300'}`}>{value}</span>
    </div>
  );
}
