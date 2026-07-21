"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Bot,
  BriefcaseBusiness,
  Building2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Coins,
  FileText,
  Loader2,
  LogIn,
  Menu,
  MonitorSmartphone,
  MousePointerClick,
  RefreshCw,
  Search,
  ShieldAlert,
  UserRound,
  UsersRound
} from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import AdminHeader from '@/components/AdminHeader';
import AdminSidebar from '@/components/AdminSidebar';
import { apiRequest } from '@/services/apiConfig';
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
  SheetTitle,
  SheetTrigger
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type RangeKey = '7d' | '30d' | '90d' | 'all';
type LedgerTab = 'organizations' | 'people' | 'events';

interface ActivityTotals {
  organizations: number;
  activeOrganizations: number;
  inactiveOrganizations: number;
  organizationActivationRate: number;
  users: number;
  activeUsers: number;
  inactiveUsers: number;
  userActivationRate: number;
  sessions: number;
  activeSessions: number;
  trackedRequests: number;
  failedRequests: number;
  businessActions: number;
  jobs: number;
  candidates: number;
  interviews: number;
  aiInterviews: number;
  transitions: number;
  creditsUsed: number;
}

interface ActivityRange {
  key: RangeKey;
  start: string | null;
  end: string;
  interval: 'day' | 'month';
}

interface TrendPoint {
  date: string;
  activeUsers: number;
  activeOrganizations: number;
  requests: number;
  actions: number;
  failures: number;
  logins: number;
  jobs: number;
  candidates: number;
  interviews: number;
  aiInterviews: number;
  transitions: number;
}

interface ModuleRow {
  id: string;
  name: string;
  requests: number;
  actions?: number;
  businessActions?: number;
  users: number;
  organizations: number;
  failures: number;
}

interface OrganizationRow {
  id: string;
  name: string;
  plan: string;
  licenseStatus: string;
  isActive: boolean;
  createdAt: string;
  lastActiveAt: string | null;
  activeInRange: boolean;
  members: number;
  activeUsers: number;
  activationRate: number;
  sessions: number;
  activeSessions: number;
  trackedRequests: number;
  trackedActions: number;
  failedRequests: number;
  jobs: number;
  candidates: number;
  interviews: number;
  aiInterviews: number;
  transitions: number;
  creditsUsed: number;
  businessActions: number;
  activityScore: number;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  joinedAt: string;
  lastLoginAt: string | null;
  loginCount: number;
  lastActiveAt: string | null;
  activeInRange: boolean;
  organization: { id: string; name: string } | null;
  membershipCount: number;
  sessions: number;
  activeSessions: number;
  trackedRequests: number;
  trackedActions: number;
  failedRequests: number;
  jobs: number;
  candidates: number;
  interviews: number;
  aiInterviews: number;
  transitions: number;
  creditsUsed: number;
  businessActions: number;
  activityScore: number;
  ipCount: number;
  deviceCount: number;
}

interface ActivityEvent {
  id: string;
  source: string;
  category: string;
  module: string;
  moduleLabel: string;
  action: string;
  description: string;
  occurredAt: string;
  actor: { id: string; name: string; email?: string } | null;
  organization: { id: string; name: string } | null;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  ip?: string;
  userAgent?: string;
}

interface ActivityAnalytics {
  generatedAt: string;
  range: ActivityRange;
  totals: ActivityTotals;
  trend: TrendPoint[];
  modules: ModuleRow[];
  organizations: OrganizationRow[];
  users: UserRow[];
  recentEvents: ActivityEvent[];
}

interface PageInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface OrganizationListResponse {
  rows: OrganizationRow[];
  pagination: PageInfo;
}

interface UserListResponse {
  rows: UserRow[];
  pagination: PageInfo;
}

interface EventListResponse {
  events: ActivityEvent[];
  pagination: { page: number; limit: number; hasMore: boolean; loaded: number };
}

interface ActivityFilters {
  organizations: Array<{ id: string; name: string }>;
  modules: Array<{ id: string; name: string }>;
}

interface OrganizationDetail {
  organization: OrganizationRow;
  users: UserRow[];
  modules: ModuleRow[];
  events: ActivityEvent[];
}

interface UserSessionDetail {
  id: string;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
  revoked: boolean;
  revokedAt: string | null;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  riskSignals: string[];
}

interface UserDetail {
  user: UserRow;
  modules: ModuleRow[];
  sessions: UserSessionDetail[];
  events: ActivityEvent[];
}

const RANGE_OPTIONS: Array<{ key: RangeKey; label: string }> = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'all', label: 'All time' }
];

const emptyPage: PageInfo = { page: 1, limit: 25, total: 0, totalPages: 1 };

function number(value: number | null | undefined, digits = 0) {
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: digits }).format(Number(value || 0));
}

function formatDate(value: string | Date | null | undefined) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function formatTrendDate(value: string, interval: 'day' | 'month') {
  const date = new Date(interval === 'month' ? `${value}-01T00:00:00Z` : `${value}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', interval === 'month'
    ? { month: 'short', year: '2-digit' }
    : { day: '2-digit', month: 'short' }).format(date);
}

function roleLabel(value: string) {
  return String(value || 'member').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function deviceLabel(userAgent?: string | null) {
  if (!userAgent) return 'Unknown device';
  const browser = userAgent.includes('Edg/') ? 'Edge'
    : userAgent.includes('Chrome/') ? 'Chrome'
      : userAgent.includes('Firefox/') ? 'Firefox'
        : userAgent.includes('Safari/') ? 'Safari'
          : 'Browser';
  const system = userAgent.includes('Windows') ? 'Windows'
    : userAgent.includes('Mac OS') ? 'macOS'
      : userAgent.includes('Android') ? 'Android'
        : /iPhone|iPad/.test(userAgent) ? 'iOS'
          : userAgent.includes('Linux') ? 'Linux'
            : 'unknown OS';
  return `${browser} on ${system}`;
}

async function getAdminJson<T>(path: string): Promise<T> {
  const token = localStorage.getItem('adminToken') || '';
  const response = await apiRequest(path, { headers: { 'x-admin-auth-token': token } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.msg || 'Unable to load activity data');
  return body as T;
}

export default function AdminActivityPage() {
  const [range, setRange] = useState<RangeKey>('30d');
  const [organizationId, setOrganizationId] = useState('all');
  const [moduleId, setModuleId] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<LedgerTab>('organizations');
  const [page, setPage] = useState(1);
  const [analytics, setAnalytics] = useState<ActivityAnalytics | null>(null);
  const [filters, setFilters] = useState<ActivityFilters>({ organizations: [], modules: [] });
  const [organizationRows, setOrganizationRows] = useState<OrganizationRow[]>([]);
  const [userRows, setUserRows] = useState<UserRow[]>([]);
  const [eventRows, setEventRows] = useState<ActivityEvent[]>([]);
  const [pagination, setPagination] = useState<PageInfo>(emptyPage);
  const [eventsHaveMore, setEventsHaveMore] = useState(false);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [organizationDetail, setOrganizationDetail] = useState<OrganizationDetail | null>(null);
  const [userDetail, setUserDetail] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const commonQuery = useCallback((extra: Record<string, string | number> = {}) => {
    const params = new URLSearchParams({ range });
    if (organizationId !== 'all') params.set('organizationId', organizationId);
    Object.entries(extra).forEach(([key, value]) => {
      if (String(value).trim()) params.set(key, String(value));
    });
    return params.toString();
  }, [organizationId, range]);

  const loadOverview = useCallback(async (quiet = false) => {
    if (!quiet) setLoadingOverview(true);
    try {
      const data = await getAdminJson<ActivityAnalytics>(`/api/admin/activity/analytics?${commonQuery()}`);
      setAnalytics(data);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load activity analytics');
    } finally {
      if (!quiet) setLoadingOverview(false);
    }
  }, [commonQuery]);

  const loadLedger = useCallback(async (quiet = false) => {
    if (!quiet) setLoadingList(true);
    try {
      const extra: Record<string, string | number> = { page, limit: 25 };
      if (search) extra.search = search;
      if (activeTab === 'events' && moduleId !== 'all') extra.module = moduleId;
      const query = commonQuery(extra);

      if (activeTab === 'organizations') {
        const data = await getAdminJson<OrganizationListResponse>(`/api/admin/activity/organizations?${query}`);
        setOrganizationRows(data.rows);
        setPagination(data.pagination);
      } else if (activeTab === 'people') {
        const data = await getAdminJson<UserListResponse>(`/api/admin/activity/users?${query}`);
        setUserRows(data.rows);
        setPagination(data.pagination);
      } else {
        const data = await getAdminJson<EventListResponse>(`/api/admin/activity/events?${query}`);
        setEventRows(data.events);
        setEventsHaveMore(data.pagination.hasMore);
        setPagination({ page: data.pagination.page, limit: data.pagination.limit, total: data.pagination.loaded, totalPages: data.pagination.hasMore ? data.pagination.page + 1 : data.pagination.page });
      }
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load activity ledger');
    } finally {
      if (!quiet) setLoadingList(false);
    }
  }, [activeTab, commonQuery, moduleId, page, search]);

  useEffect(() => {
    getAdminJson<ActivityFilters>('/api/admin/activity/filters')
      .then(setFilters)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Unable to load filters'));
  }, []);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { loadLedger(); }, [loadLedger]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      loadOverview(true);
      loadLedger(true);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, loadLedger, loadOverview]);

  useEffect(() => {
    if (!selectedOrganizationId) {
      setOrganizationDetail(null);
      return;
    }
    setDetailLoading(true);
    getAdminJson<OrganizationDetail>(`/api/admin/activity/organizations/${selectedOrganizationId}?${commonQuery()}`)
      .then(setOrganizationDetail)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Unable to load organization details'))
      .finally(() => setDetailLoading(false));
  }, [commonQuery, selectedOrganizationId]);

  useEffect(() => {
    if (!selectedUserId) {
      setUserDetail(null);
      return;
    }
    setDetailLoading(true);
    getAdminJson<UserDetail>(`/api/admin/activity/users/${selectedUserId}?${commonQuery()}`)
      .then(setUserDetail)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Unable to load person details'))
      .finally(() => setDetailLoading(false));
  }, [commonQuery, selectedUserId]);

  const refreshAll = useCallback(() => {
    loadOverview();
    loadLedger();
  }, [loadLedger, loadOverview]);

  const changeFilter = (callback: (value: string) => void, value: string) => {
    callback(value);
    setPage(1);
  };

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  };

  const maxModuleUsage = useMemo(() => Math.max(
    1,
    ...(analytics?.modules || []).map((module) => module.requests + Number(module.businessActions || 0))
  ), [analytics]);

  const metrics = analytics ? [
    { label: 'Active organizations', value: `${number(analytics.totals.activeOrganizations)} / ${number(analytics.totals.organizations)}`, detail: `${number(analytics.totals.organizationActivationRate, 1)}% active`, icon: Building2, tone: 'text-cyan-300' },
    { label: 'Active people', value: `${number(analytics.totals.activeUsers)} / ${number(analytics.totals.users)}`, detail: `${number(analytics.totals.userActivationRate, 1)}% active`, icon: UsersRound, tone: 'text-emerald-300' },
    { label: 'Sign-in sessions', value: number(analytics.totals.sessions), detail: `${number(analytics.totals.activeSessions)} currently valid`, icon: LogIn, tone: 'text-blue-300' },
    { label: 'Product actions', value: number(analytics.totals.businessActions), detail: 'Created platform records', icon: MousePointerClick, tone: 'text-amber-300' },
    { label: 'Tracked activity', value: number(analytics.totals.trackedRequests), detail: `${number(analytics.totals.failedRequests)} failed requests`, icon: Activity, tone: 'text-violet-300' },
    { label: 'Credits used', value: number(analytics.totals.creditsUsed, 1), detail: 'Across all organizations', icon: Coins, tone: 'text-rose-300' }
  ] : [];

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      <div className="hidden lg:flex"><AdminSidebar /></div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AdminHeader>
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-gray-300 hover:bg-gray-700 hover:text-white lg:hidden" aria-label="Open admin navigation">
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
                  <Activity className="h-4 w-4" /> Platform activity
                </div>
                <h1 className="mt-2 text-2xl font-semibold text-white">Organization usage and activity</h1>
                <p className="mt-1 text-sm text-gray-400">
                  {analytics ? `Updated ${formatDate(analytics.generatedAt)}` : 'Loading organization activity'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-9 items-center gap-2 border border-gray-700 bg-gray-900 px-3">
                  <span className={`h-2 w-2 rounded-full ${autoRefresh ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                  <span className="text-xs font-medium text-gray-300">Live refresh</span>
                  <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} aria-label="Toggle live refresh" />
                </div>
                <Button variant="outline" className="h-9 border-gray-700 bg-gray-900 text-gray-200 hover:bg-gray-800" onClick={refreshAll} disabled={loadingOverview || loadingList}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${loadingOverview || loadingList ? 'animate-spin' : ''}`} /> Refresh
                </Button>
              </div>
            </header>

            <section className="border-b border-gray-800 py-4" aria-label="Activity filters">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                <div className="flex min-h-9 shrink-0 flex-nowrap border border-gray-700 bg-gray-900 p-1">
                  {RANGE_OPTIONS.map((option) => (
                    <button key={option.key} type="button" onClick={() => changeFilter((value) => setRange(value as RangeKey), option.key)} className={`h-7 whitespace-nowrap px-2.5 text-xs font-medium transition-colors ${range === option.key ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                      {option.label}
                    </button>
                  ))}
                </div>
                <Select value={organizationId} onValueChange={(value) => changeFilter(setOrganizationId, value)}>
                  <SelectTrigger className="h-9 w-full border-gray-700 bg-gray-900 text-gray-200 xl:w-56"><SelectValue placeholder="All organizations" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All organizations</SelectItem>
                    {filters.organizations.map((organization) => <SelectItem key={organization.id} value={organization.id}>{organization.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <form onSubmit={handleSearch} className="flex min-w-0 flex-1 gap-2 xl:min-w-72">
                  <div className="relative min-w-0 flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                    <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search organizations, people or activity" className="h-9 border-gray-700 bg-gray-900 pl-9 text-gray-200 placeholder:text-gray-600" />
                  </div>
                  <Button type="submit" size="icon" className="h-9 w-9 shrink-0 bg-blue-600 text-white hover:bg-blue-500" aria-label="Search activity" title="Search">
                    <Search className="h-4 w-4" />
                  </Button>
                </form>
              </div>
            </section>

            {error && (
              <div className="mt-4 flex items-center gap-3 border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-200">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="flex-1">{error}</span>
                <Button variant="ghost" size="sm" onClick={refreshAll} className="text-red-100">Retry</Button>
              </div>
            )}

            <section className="py-5" aria-label="Platform activity totals">
              {loadingOverview && !analytics ? (
                <LoadingBlock label="Loading organization activity" />
              ) : (
                <div className="grid grid-cols-2 border-l border-t border-gray-800 sm:grid-cols-3 xl:grid-cols-6">
                  {metrics.map((metric) => {
                    const Icon = metric.icon;
                    return (
                      <div key={metric.label} className="min-h-32 border-b border-r border-gray-800 bg-gray-900/55 p-4">
                        <Icon className={`h-5 w-5 ${metric.tone}`} />
                        <div className="mt-4 text-2xl font-semibold text-white">{metric.value}</div>
                        <div className="mt-1 text-xs font-medium text-gray-300">{metric.label}</div>
                        <div className="mt-1 text-xs text-gray-600">{metric.detail}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {analytics && (
              <section className="grid gap-6 border-y border-gray-800 py-6 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-white">Activity over time</h2>
                  <p className="mt-1 text-xs text-gray-500">Active people, organizations, and recorded product actions</p>
                  {analytics.trend.length ? (
                    <div className="mt-4 h-72 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={analytics.trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                          <CartesianGrid stroke="#1f2937" vertical={false} />
                          <XAxis dataKey="date" tickFormatter={(value) => formatTrendDate(value, analytics.range.interval)} tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#374151' }} minTickGap={28} />
                          <YAxis allowDecimals={false} tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={false} />
                          <Tooltip labelFormatter={(value) => formatTrendDate(String(value), analytics.range.interval)} contentStyle={{ background: '#111827', border: '1px solid #374151', color: '#f9fafb' }} />
                          <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12 }} />
                          <Line type="monotone" dataKey="activeUsers" name="Active people" stroke="#34d399" strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="activeOrganizations" name="Active organizations" stroke="#22d3ee" strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="actions" name="Product actions" stroke="#fbbf24" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : <EmptyState message="No activity in this period." />}
                </div>
                <div className="border-l-0 border-gray-800 xl:border-l xl:pl-6">
                  <h2 className="text-base font-semibold text-white">Product usage</h2>
                  <p className="mt-1 text-xs text-gray-500">Recorded requests and created records by area</p>
                  <div className="mt-5 space-y-4">
                    {analytics.modules.slice(0, 8).map((module) => {
                      const usage = module.requests + Number(module.businessActions || 0);
                      return (
                        <button key={module.id} type="button" className="block w-full text-left" onClick={() => { setActiveTab('events'); setModuleId(module.id); setPage(1); }}>
                          <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                            <span className="truncate text-gray-300">{module.name}</span>
                            <span className="shrink-0 text-gray-500">{number(usage)} activity</span>
                          </div>
                          <div className="h-1.5 overflow-hidden bg-gray-800">
                            <div className="h-full bg-cyan-500" style={{ width: `${usage === 0 ? 0 : Math.max(2, (usage / maxModuleUsage) * 100)}%` }} />
                          </div>
                        </button>
                      );
                    })}
                    {!analytics.modules.length && <EmptyState message="No detailed usage recorded yet." />}
                  </div>
                </div>
              </section>
            )}

            <section className="py-6">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white">Activity ledger</h2>
                  <p className="mt-1 text-xs text-gray-500">
                    {activeTab === 'events' ? 'Detailed sign-ins, platform requests, and business actions' : `${number(pagination.total)} matching ${activeTab}`}
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  {activeTab === 'events' && (
                    <Select value={moduleId} onValueChange={(value) => changeFilter(setModuleId, value)}>
                      <SelectTrigger className="h-9 w-full border-gray-700 bg-gray-900 text-gray-200 sm:w-48"><SelectValue placeholder="All product areas" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All product areas</SelectItem>
                        {filters.modules.map((module) => <SelectItem key={module.id} value={module.id}>{module.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  <Tabs value={activeTab} onValueChange={(value) => { setActiveTab(value as LedgerTab); setPage(1); }}>
                    <TabsList className="h-9 bg-gray-900">
                      <TabsTrigger value="organizations">Organizations</TabsTrigger>
                      <TabsTrigger value="people">People</TabsTrigger>
                      <TabsTrigger value="events">Activity log</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </div>

              <div className="overflow-x-auto border border-gray-800">
                {activeTab === 'organizations' && <OrganizationTable rows={organizationRows} loading={loadingList} onSelect={setSelectedOrganizationId} />}
                {activeTab === 'people' && <PeopleTable rows={userRows} loading={loadingList} onSelect={setSelectedUserId} />}
                {activeTab === 'events' && <EventTable rows={eventRows} loading={loadingList} />}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="text-xs text-gray-500">Page {pagination.page}{activeTab !== 'events' ? ` of ${pagination.totalPages}` : ''}</div>
                <div className="flex gap-2">
                  <Button variant="outline" size="icon" className="h-9 w-9 border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-800" disabled={page <= 1 || loadingList} onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label="Previous page" title="Previous page">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" className="h-9 w-9 border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-800" disabled={loadingList || (activeTab === 'events' ? !eventsHaveMore : page >= pagination.totalPages)} onClick={() => setPage((value) => value + 1)} aria-label="Next page" title="Next page">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </section>

            <div className="border-t border-gray-800 py-4 text-xs text-gray-600">
              Business record totals include existing platform history. Detailed request activity is retained for 365 days from the point monitoring is enabled.
            </div>
          </div>
        </main>
      </div>

      <Sheet open={Boolean(selectedOrganizationId)} onOpenChange={(open) => !open && setSelectedOrganizationId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto border-gray-700 bg-gray-950 p-0 text-gray-100 sm:max-w-2xl">
          <SheetHeader className="border-b border-gray-800 px-5 py-5 text-left">
            <SheetTitle className="text-white">{organizationDetail?.organization.name || 'Organization activity'}</SheetTitle>
            <SheetDescription className="text-gray-500">Usage, active members, and recent activity for the selected period</SheetDescription>
          </SheetHeader>
          {detailLoading || !organizationDetail ? <LoadingBlock label="Loading organization details" /> : <OrganizationDetailPanel detail={organizationDetail} onSelectUser={(id) => { setSelectedOrganizationId(null); setSelectedUserId(id); }} />}
        </SheetContent>
      </Sheet>

      <Sheet open={Boolean(selectedUserId)} onOpenChange={(open) => !open && setSelectedUserId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto border-gray-700 bg-gray-950 p-0 text-gray-100 sm:max-w-2xl">
          <SheetHeader className="border-b border-gray-800 px-5 py-5 text-left">
            <SheetTitle className="text-white">{userDetail?.user.name || 'Person activity'}</SheetTitle>
            <SheetDescription className="text-gray-500">Sign-ins, devices, product usage, and recent actions</SheetDescription>
          </SheetHeader>
          {detailLoading || !userDetail ? <LoadingBlock label="Loading person details" /> : <UserDetailPanel detail={userDetail} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function OrganizationTable({ rows, loading, onSelect }: { rows: OrganizationRow[]; loading: boolean; onSelect: (id: string) => void }) {
  return (
    <Table>
      <TableHeader className="bg-gray-900">
        <TableRow className="border-gray-800 hover:bg-gray-900">
          <TableHead className="min-w-56 text-gray-400">Organization</TableHead>
          <TableHead className="min-w-36 text-gray-400">Active people</TableHead>
          <TableHead className="text-right text-gray-400">Sessions</TableHead>
          <TableHead className="text-right text-gray-400">Jobs</TableHead>
          <TableHead className="text-right text-gray-400">Candidates</TableHead>
          <TableHead className="text-right text-gray-400">Interviews</TableHead>
          <TableHead className="text-right text-gray-400">AI interviews</TableHead>
          <TableHead className="text-right text-gray-400">Transitions</TableHead>
          <TableHead className="text-right text-gray-400">Credits</TableHead>
          <TableHead className="min-w-36 text-gray-400">Last active</TableHead>
          <TableHead className="w-12"><span className="sr-only">Open</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? <LoadingRow columns={11} label="Loading organizations" /> : rows.length ? rows.map((row) => (
          <TableRow key={row.id} className="cursor-pointer border-gray-800 bg-gray-950 hover:bg-gray-900" onClick={() => onSelect(row.id)}>
            <TableCell>
              <div className="font-medium text-white">{row.name}</div>
              <div className="mt-1 flex gap-2 text-xs text-gray-600"><span>{roleLabel(row.plan)}</span><span>{roleLabel(row.licenseStatus)}</span></div>
            </TableCell>
            <TableCell>
              <div className="text-sm text-gray-300">{number(row.activeUsers)} of {number(row.members)}</div>
              <div className="mt-1 h-1 w-24 bg-gray-800"><div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, row.activationRate)}%` }} /></div>
            </TableCell>
            <TableCell className="text-right text-gray-300">{number(row.sessions)}</TableCell>
            <TableCell className="text-right text-gray-300">{number(row.jobs)}</TableCell>
            <TableCell className="text-right text-gray-300">{number(row.candidates)}</TableCell>
            <TableCell className="text-right text-gray-300">{number(row.interviews)}</TableCell>
            <TableCell className="text-right text-gray-300">{number(row.aiInterviews)}</TableCell>
            <TableCell className="text-right text-gray-300">{number(row.transitions)}</TableCell>
            <TableCell className="text-right text-gray-300">{number(row.creditsUsed, 1)}</TableCell>
            <TableCell className="text-xs text-gray-500">{formatDate(row.lastActiveAt)}</TableCell>
            <TableCell>
              <button type="button" className="flex h-8 w-8 items-center justify-center text-gray-600 hover:bg-gray-800 hover:text-white" onClick={(event) => { event.stopPropagation(); onSelect(row.id); }} aria-label={`Open ${row.name} activity`} title="Open activity details">
                <ChevronRight className="h-4 w-4" />
              </button>
            </TableCell>
          </TableRow>
        )) : <EmptyRow columns={11} message="No organizations match these filters." />}
      </TableBody>
    </Table>
  );
}

function PeopleTable({ rows, loading, onSelect }: { rows: UserRow[]; loading: boolean; onSelect: (id: string) => void }) {
  return (
    <Table>
      <TableHeader className="bg-gray-900">
        <TableRow className="border-gray-800 hover:bg-gray-900">
          <TableHead className="min-w-56 text-gray-400">Person</TableHead>
          <TableHead className="min-w-48 text-gray-400">Organization</TableHead>
          <TableHead className="text-gray-400">Role</TableHead>
          <TableHead className="min-w-36 text-gray-400">Last active</TableHead>
          <TableHead className="text-right text-gray-400">Sessions</TableHead>
          <TableHead className="text-right text-gray-400">Requests</TableHead>
          <TableHead className="text-right text-gray-400">Actions</TableHead>
          <TableHead className="text-right text-gray-400">Devices</TableHead>
          <TableHead className="w-12"><span className="sr-only">Open</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? <LoadingRow columns={9} label="Loading people" /> : rows.length ? rows.map((row) => (
          <TableRow key={row.id} className="cursor-pointer border-gray-800 bg-gray-950 hover:bg-gray-900" onClick={() => onSelect(row.id)}>
            <TableCell>
              <div className="font-medium text-white">{row.name}</div>
              <div className="mt-1 text-xs text-gray-600">{row.email}</div>
            </TableCell>
            <TableCell className="text-sm text-gray-300">{row.organization?.name || 'No current organization'}</TableCell>
            <TableCell className="text-sm text-gray-400">{roleLabel(row.role)}</TableCell>
            <TableCell className="text-xs text-gray-500">{formatDate(row.lastActiveAt)}</TableCell>
            <TableCell className="text-right text-gray-300">{number(row.sessions)}</TableCell>
            <TableCell className="text-right text-gray-300">{number(row.trackedRequests)}</TableCell>
            <TableCell className="text-right text-gray-300">{number(row.businessActions)}</TableCell>
            <TableCell className="text-right text-gray-300">{number(row.deviceCount)}</TableCell>
            <TableCell>
              <button type="button" className="flex h-8 w-8 items-center justify-center text-gray-600 hover:bg-gray-800 hover:text-white" onClick={(event) => { event.stopPropagation(); onSelect(row.id); }} aria-label={`Open ${row.name} activity`} title="Open activity details">
                <ChevronRight className="h-4 w-4" />
              </button>
            </TableCell>
          </TableRow>
        )) : <EmptyRow columns={9} message="No people match these filters." />}
      </TableBody>
    </Table>
  );
}

function EventTable({ rows, loading }: { rows: ActivityEvent[]; loading: boolean }) {
  return (
    <Table>
      <TableHeader className="bg-gray-900">
        <TableRow className="border-gray-800 hover:bg-gray-900">
          <TableHead className="min-w-36 text-gray-400">When</TableHead>
          <TableHead className="min-w-52 text-gray-400">Person</TableHead>
          <TableHead className="min-w-44 text-gray-400">Organization</TableHead>
          <TableHead className="min-w-64 text-gray-400">Activity</TableHead>
          <TableHead className="min-w-48 text-gray-400">Request</TableHead>
          <TableHead className="text-gray-400">Result</TableHead>
          <TableHead className="min-w-32 text-gray-400">IP</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? <LoadingRow columns={7} label="Loading activity" /> : rows.length ? rows.map((row) => (
          <TableRow key={row.id} className="border-gray-800 bg-gray-950 hover:bg-gray-900">
            <TableCell className="text-xs text-gray-500">{formatDate(row.occurredAt)}</TableCell>
            <TableCell>
              <div className="text-sm text-gray-200">{row.actor?.name || 'System or unknown user'}</div>
              <div className="mt-1 text-xs text-gray-600">{row.actor?.email}</div>
            </TableCell>
            <TableCell className="text-sm text-gray-400">{row.organization?.name || 'Not attributed'}</TableCell>
            <TableCell>
              <div className="text-sm text-gray-200">{row.description}</div>
              <div className="mt-1 text-xs text-gray-600">{row.moduleLabel}</div>
            </TableCell>
            <TableCell>
              <div className="text-xs text-gray-400">{row.method || 'Record'} {row.path || ''}</div>
              {row.durationMs != null && <div className="mt-1 text-xs text-gray-600">{number(row.durationMs)} ms · {deviceLabel(row.userAgent)}</div>}
            </TableCell>
            <TableCell><ResultText statusCode={row.statusCode} /></TableCell>
            <TableCell className="text-xs text-gray-500">{row.ip || 'Not recorded'}</TableCell>
          </TableRow>
        )) : <EmptyRow columns={7} message="No activity matches these filters." />}
      </TableBody>
    </Table>
  );
}

function OrganizationDetailPanel({ detail, onSelectUser }: { detail: OrganizationDetail; onSelectUser: (id: string) => void }) {
  const organization = detail.organization;
  return (
    <div className="px-5 py-5">
      <div className="grid grid-cols-2 border-l border-t border-gray-800 sm:grid-cols-4">
        <DetailMetric label="Active people" value={`${number(organization.activeUsers)} / ${number(organization.members)}`} />
        <DetailMetric label="Sessions" value={number(organization.sessions)} />
        <DetailMetric label="Product actions" value={number(organization.businessActions)} />
        <DetailMetric label="Credits used" value={number(organization.creditsUsed, 1)} />
      </div>
      <DetailSection title="Usage by product">
        <div className="divide-y divide-gray-800 border border-gray-800">
          {detail.modules.slice(0, 10).map((module) => (
            <div key={module.id} className="flex items-center justify-between gap-4 px-3 py-2.5 text-sm">
              <span className="text-gray-300">{module.name}</span>
              <span className="text-gray-500">{number(module.requests)} requests · {number(module.businessActions)} records</span>
            </div>
          ))}
          {!detail.modules.length && <div className="p-4 text-sm text-gray-500">No product activity in this period.</div>}
        </div>
      </DetailSection>
      <DetailSection title="People">
        <div className="divide-y divide-gray-800 border border-gray-800">
          {detail.users.slice(0, 20).map((user) => (
            <button key={user.id} type="button" className="flex w-full items-center justify-between gap-4 px-3 py-3 text-left hover:bg-gray-900" onClick={() => onSelectUser(user.id)}>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white">{user.name}</div>
                <div className="mt-1 truncate text-xs text-gray-600">{user.email} · {roleLabel(user.role)}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm text-gray-300">{number(user.businessActions)} actions</div>
                <div className="mt-1 text-xs text-gray-600">{formatDate(user.lastActiveAt)}</div>
              </div>
            </button>
          ))}
          {!detail.users.length && <div className="p-4 text-sm text-gray-500">No members found.</div>}
        </div>
      </DetailSection>
      <DetailSection title="Recent activity"><CompactEventList rows={detail.events} /></DetailSection>
    </div>
  );
}

function UserDetailPanel({ detail }: { detail: UserDetail }) {
  const user = detail.user;
  return (
    <div className="px-5 py-5">
      <div className="border-b border-gray-800 pb-5">
        <div className="text-sm text-gray-300">{user.email}</div>
        <div className="mt-1 text-xs text-gray-500">{user.organization?.name || 'No current organization'} · {roleLabel(user.role)}</div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-500">
          <span>Last active: {formatDate(user.lastActiveAt)}</span>
          <span>Lifetime sign-ins: {number(user.loginCount)}</span>
          <span>Organization memberships: {number(user.membershipCount)}</span>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 border-l border-t border-gray-800 sm:grid-cols-4">
        <DetailMetric label="Sessions" value={number(user.sessions)} />
        <DetailMetric label="Requests" value={number(user.trackedRequests)} />
        <DetailMetric label="Product actions" value={number(user.businessActions)} />
        <DetailMetric label="Credits used" value={number(user.creditsUsed, 1)} />
      </div>
      <DetailSection title="Product activity">
        <div className="grid grid-cols-2 gap-px border border-gray-800 bg-gray-800 sm:grid-cols-5">
          {[
            ['Jobs', user.jobs, BriefcaseBusiness],
            ['Candidates', user.candidates, UsersRound],
            ['Interviews', user.interviews, Clock3],
            ['AI interviews', user.aiInterviews, Bot],
            ['Transitions', user.transitions, FileText]
          ].map(([label, value, Icon]) => {
            const ProductIcon = Icon as typeof Activity;
            return <div key={String(label)} className="bg-gray-950 p-3"><ProductIcon className="h-4 w-4 text-gray-500" /><div className="mt-3 text-lg font-semibold text-white">{number(value as number)}</div><div className="mt-1 text-xs text-gray-600">{String(label)}</div></div>;
          })}
        </div>
      </DetailSection>
      <DetailSection title="Sign-in sessions">
        <div className="divide-y divide-gray-800 border border-gray-800">
          {detail.sessions.map((session) => (
            <div key={session.id} className="px-3 py-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-sm text-gray-200"><MonitorSmartphone className="h-4 w-4 text-gray-500" />{deviceLabel(session.userAgent)}</div>
                  <div className="mt-1 text-xs text-gray-600">{session.ip || 'IP not recorded'} · Started {formatDate(session.createdAt)}</div>
                </div>
                <span className={`text-xs font-medium ${session.revoked ? 'text-red-300' : 'text-emerald-300'}`}>{session.revoked ? 'Revoked' : 'Valid'}</span>
              </div>
              <div className="mt-2 text-xs text-gray-500">Last activity {formatDate(session.lastActivityAt)}{session.reason ? ` · ${roleLabel(session.reason)}` : ''}</div>
              {session.riskSignals.length > 0 && <div className="mt-2 flex items-center gap-2 text-xs text-amber-300"><ShieldAlert className="h-3.5 w-3.5" />{session.riskSignals.map(roleLabel).join(', ')}</div>}
            </div>
          ))}
          {!detail.sessions.length && <div className="p-4 text-sm text-gray-500">No sign-in sessions in this period.</div>}
        </div>
      </DetailSection>
      <DetailSection title="Recent activity"><CompactEventList rows={detail.events} /></DetailSection>
    </div>
  );
}

function CompactEventList({ rows }: { rows: ActivityEvent[] }) {
  return (
    <div className="divide-y divide-gray-800 border border-gray-800">
      {rows.slice(0, 30).map((event) => (
        <div key={event.id} className="flex gap-3 px-3 py-3">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border border-gray-800 text-gray-500"><Activity className="h-3.5 w-3.5" /></div>
          <div className="min-w-0 flex-1">
            <div className="text-sm text-gray-200">{event.description}</div>
            <div className="mt-1 text-xs text-gray-600">{event.actor?.name || 'System'} · {formatDate(event.occurredAt)}</div>
          </div>
          <ResultText statusCode={event.statusCode} />
        </div>
      ))}
      {!rows.length && <div className="p-4 text-sm text-gray-500">No activity in this period.</div>}
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-7"><h3 className="mb-3 text-sm font-semibold text-white">{title}</h3>{children}</section>;
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return <div className="min-h-24 border-b border-r border-gray-800 bg-gray-900/50 p-3"><div className="text-xl font-semibold text-white">{value}</div><div className="mt-2 text-xs text-gray-500">{label}</div></div>;
}

function ResultText({ statusCode }: { statusCode?: number }) {
  if (!statusCode) return <span className="text-xs text-gray-600">Recorded</span>;
  const failed = statusCode >= 400;
  return <span className={`text-xs font-medium ${failed ? 'text-red-300' : 'text-emerald-300'}`}>{statusCode}</span>;
}

function LoadingBlock({ label }: { label: string }) {
  return <div className="flex h-40 items-center justify-center text-sm text-gray-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" />{label}</div>;
}

function LoadingRow({ columns, label }: { columns: number; label: string }) {
  return <TableRow className="border-gray-800"><TableCell colSpan={columns} className="h-32 text-center text-gray-400"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />{label}</TableCell></TableRow>;
}

function EmptyRow({ columns, message }: { columns: number; message: string }) {
  return <TableRow className="border-gray-800"><TableCell colSpan={columns} className="h-32 text-center text-gray-500">{message}</TableCell></TableRow>;
}

function EmptyState({ message }: { message: string }) {
  return <div className="flex min-h-32 items-center justify-center border border-dashed border-gray-800 text-sm text-gray-500">{message}</div>;
}
