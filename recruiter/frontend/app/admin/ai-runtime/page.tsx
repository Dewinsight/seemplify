"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Cpu,
  KeyRound,
  Loader2,
  Menu,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  ShieldAlert,
  Trash2,
  UserRound
} from 'lucide-react';
import AdminHeader from '@/components/AdminHeader';
import AdminSidebar from '@/components/AdminSidebar';
import { useAdmin } from '@/context/AdminContext';
import { apiRequest } from '@/services/apiConfig';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
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
import { useToast } from '@/components/ui/use-toast';
import {
  type QuotaGroupOption,
  validateCredentialDraft,
  validateQuotaGroupDraft
} from '@/lib/aiRuntimeAdminValidation';

type RangeKey = '7d' | '30d' | '90d' | 'all';
type TabKey = 'overview' | 'test' | 'routing' | 'credentials' | 'requests' | 'alerts';

interface RuntimeModel {
  id: string;
  label: string;
  available?: boolean;
  enabled: boolean;
}

interface ActivityRoute {
  activity: string;
  provider: string;
  model: string;
  reasoningEffort: 'low' | 'medium' | 'high';
  enabled: boolean;
  routeVersion: number;
}

interface ActivityDefinition {
  activity: string;
  label: string;
  group: string;
}

interface AlertSettings {
  enabled: boolean;
  recipients: string[];
  monthlyBudgetUsd: number | null;
}

interface RuntimeSettings {
  models: RuntimeModel[];
  routes: ActivityRoute[];
  activityDefinitions: ActivityDefinition[];
  alerts: AlertSettings;
  quotaGroups: QuotaGroupOption[];
  rollout: {
    groqPercent: 10 | 50 | 100;
    azureBaselineEnabled: boolean;
  };
}

interface UsageBreakdown {
  _id: string;
  name?: string;
  calls: number;
  failures: number;
  tokens: number;
  cost?: number;
}

interface QuotaSnapshot {
  _id: string;
  quotaGroup: string;
  model: string;
  requestLimitDaily?: number;
  requestRemainingDaily?: number;
  tokenLimitMinute?: number;
  tokenRemainingMinute?: number;
  localRequestsToday: number;
  localTokensToday: number;
  blockedUntil?: string;
  observedAt: string;
}

interface RuntimeOverview {
  totals: {
    calls: number;
    successes: number;
    failures: number;
    successRate: number;
    totalTokens: number;
    estimatedCostUsd: number;
    averageLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
  };
  byActivity: UsageBreakdown[];
  byModel: UsageBreakdown[];
  byProvider: UsageBreakdown[];
  bySource: UsageBreakdown[];
  organizations: UsageBreakdown[];
  actors: UsageBreakdown[];
  quotas: QuotaSnapshot[];
}

interface RuntimeTestResult {
  success: true;
  activity: string;
  activityLabel: string;
  configuredRoute: {
    provider: string;
    model: string;
    reasoningEffort: string;
    routeVersion: number;
  };
  execution: {
    requestId: string;
    provider: string;
    model: string;
    reasoningEffort: string;
    response: string;
    finishReason?: string;
    latencyMs: number;
    attempts: number;
    failovers: number;
    quotaGroup: string;
    usage: {
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      reasoningTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
    };
  };
}

interface Credential {
  _id: string;
  label: string;
  maskedKey: string;
  fingerprint: string;
  quotaGroup: string;
  projectLabel?: string;
  priority: number;
  enabled: boolean;
  status: string;
  lastSuccessAt?: string;
  lastCheckedAt?: string;
  lastError?: { message?: string };
}

interface UsageRequest {
  _id: string;
  requestId: string;
  createdAt: string;
  sourceApp: string;
  activity: string;
  provider: string;
  model: string;
  status: string;
  organizationId?: string;
  organizationName?: string;
  actorId?: string;
  actorName?: string;
  actorEmail?: string;
  totalTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  failovers: number;
  errorCode?: string;
}

interface AuditEvent {
  _id: string;
  createdAt: string;
  category: string;
  action: string;
  status: string;
  message: string;
  actorEmail?: string;
}

function formatNumber(value: number | undefined, digits = 0) {
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: digits }).format(Number(value || 0));
}

function formatDate(value?: string) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

async function adminJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('adminToken') || '';
  const response = await apiRequest(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-auth-token': token,
      ...(init.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.msg || body.message || 'AI runtime request failed');
  return body as T;
}

function StatusBadge({ status }: { status: string }) {
  const healthy = ['healthy', 'success', 'sent'].includes(status);
  const warning = ['unknown', 'degraded', 'suppressed'].includes(status);
  return (
    <Badge className={healthy
      ? 'border-green-700 bg-green-950 text-green-300'
      : warning
        ? 'border-amber-700 bg-amber-950 text-amber-300'
        : 'border-red-700 bg-red-950 text-red-300'} variant="outline">
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}

export default function AIRuntimeAdminPage() {
  const { checkPermission } = useAdmin();
  const { toast } = useToast();
  const canConfigure = checkPermission('systemSettings');
  const canManageSecrets = canConfigure;
  const [tab, setTab] = useState<TabKey>('overview');
  const [range, setRange] = useState<RangeKey>('30d');
  const [overview, setOverview] = useState<RuntimeOverview | null>(null);
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [requests, setRequests] = useState<UsageRequest[]>([]);
  const [audits, setAudits] = useState<AuditEvent[]>([]);
  const [requestPage, setRequestPage] = useState(1);
  const [requestPages, setRequestPages] = useState(1);
  const [auditPage, setAuditPage] = useState(1);
  const [auditPages, setAuditPages] = useState(1);
  const [requestStatus, setRequestStatus] = useState('all');
  const [organizationFilter, setOrganizationFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [credentialDialog, setCredentialDialog] = useState<{ mode: 'create' | 'rotate'; id?: string } | null>(null);
  const [credentialToRemove, setCredentialToRemove] = useState<Credential | null>(null);
  const [quotaDialog, setQuotaDialog] = useState(false);
  const [credentialForm, setCredentialForm] = useState({ label: '', apiKey: '', quotaGroup: 'groq-primary', projectLabel: '', priority: '100' });
  const [quotaForm, setQuotaForm] = useState({ label: '', confirmed: false });
  const [credentialError, setCredentialError] = useState('');
  const [quotaError, setQuotaError] = useState('');
  const [testActivity, setTestActivity] = useState('');
  const [testResult, setTestResult] = useState<RuntimeTestResult | null>(null);
  const [testError, setTestError] = useState('');
  const [alertForm, setAlertForm] = useState({ enabled: true, recipients: '', monthlyBudgetUsd: '' });

  const definitions = useMemo(() => new Map(
    (settings?.activityDefinitions || []).map((item) => [item.activity, item])
  ), [settings]);

  const availableQuotaGroups = useMemo(
    () => (settings?.quotaGroups || []).filter((group) => group.enabled !== false),
    [settings?.quotaGroups]
  );

  const enabledTestRoutes = useMemo(
    () => (settings?.routes || []).filter((route) => route.enabled),
    [settings?.routes]
  );
  const selectedTestRoute = enabledTestRoutes.find((route) => route.activity === testActivity);

  function defaultQuotaGroupId() {
    return availableQuotaGroups.find((group) => group.id === 'groq-primary')?.id
      || availableQuotaGroups[0]?.id
      || '';
  }

  function openCredentialDialog(mode: 'create' | 'rotate', id?: string, credential?: Credential) {
    setCredentialError('');
    setCredentialForm({
      label: credential?.label || '',
      apiKey: '',
      quotaGroup: credential?.quotaGroup || defaultQuotaGroupId(),
      projectLabel: credential?.projectLabel || '',
      priority: String(credential?.priority || 100)
    });
    setCredentialDialog({ mode, id });
  }

  function closeCredentialDialog() {
    setCredentialDialog(null);
    setCredentialError('');
    setCredentialForm({ label: '', apiKey: '', quotaGroup: defaultQuotaGroupId(), projectLabel: '', priority: '100' });
  }

  function openQuotaDialog() {
    setQuotaError('');
    setQuotaForm({ label: '', confirmed: false });
    setQuotaDialog(true);
  }

  function closeQuotaDialog() {
    setQuotaDialog(false);
    setQuotaError('');
    setQuotaForm({ label: '', confirmed: false });
  }

  const loadOverview = useCallback(async () => {
    const data = await adminJson<RuntimeOverview>(`/api/admin/ai-runtime/overview?range=${range}`);
    setOverview(data);
  }, [range]);

  const loadSettings = useCallback(async () => {
    if (!canConfigure) return;
    const [runtime, credentialData] = await Promise.all([
      adminJson<RuntimeSettings>('/api/admin/ai-runtime/settings'),
      adminJson<{ items: Credential[] }>('/api/admin/ai-runtime/credentials')
    ]);
    setSettings(runtime);
    setCredentials(credentialData.items);
    setAlertForm({
      enabled: runtime.alerts.enabled,
      recipients: runtime.alerts.recipients.join(', '),
      monthlyBudgetUsd: runtime.alerts.monthlyBudgetUsd == null ? '' : String(runtime.alerts.monthlyBudgetUsd)
    });
  }, [canConfigure]);

  const loadRequests = useCallback(async () => {
    const params = new URLSearchParams({ range, page: String(requestPage), limit: '25' });
    if (requestStatus !== 'all') params.set('status', requestStatus);
    if (organizationFilter) params.set('organizationId', organizationFilter);
    if (actorFilter) params.set('actorId', actorFilter);
    const data = await adminJson<{ items: UsageRequest[]; pagination: { pages: number } }>(`/api/admin/ai-runtime/requests?${params}`);
    setRequests(data.items);
    setRequestPages(Math.max(1, data.pagination.pages));
  }, [actorFilter, organizationFilter, range, requestPage, requestStatus]);

  const loadAudits = useCallback(async () => {
    const data = await adminJson<{ items: AuditEvent[]; pagination: { pages: number } }>(`/api/admin/ai-runtime/audit?page=${auditPage}&limit=25`);
    setAudits(data.items);
    setAuditPages(Math.max(1, data.pagination.pages));
  }, [auditPage]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadOverview(), loadSettings(), loadAudits()]);
      if (tab === 'requests') await loadRequests();
    } catch (error) {
      toast({ title: 'Unable to load AI runtime', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [loadAudits, loadOverview, loadRequests, loadSettings, tab, toast]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (tab !== 'requests') return;
    loadRequests().catch((error) => toast({ title: 'Unable to load requests', description: error.message, variant: 'destructive' }));
  }, [loadRequests, tab, toast]);
  useEffect(() => {
    if (!enabledTestRoutes.length) {
      if (testActivity) setTestActivity('');
      return;
    }
    if (!enabledTestRoutes.some((route) => route.activity === testActivity)) {
      setTestActivity(enabledTestRoutes.find((route) => route.activity === 'recruiter.general')?.activity || enabledTestRoutes[0].activity);
      setTestResult(null);
      setTestError('');
    }
  }, [enabledTestRoutes, testActivity]);

  async function submitRuntimeTest(event: FormEvent) {
    event.preventDefault();
    if (!testActivity) {
      setTestError('Choose an enabled AI activity.');
      return;
    }
    setBusy('runtime-test');
    setTestError('');
    setTestResult(null);
    try {
      const result = await adminJson<RuntimeTestResult>('/api/admin/ai-runtime/test', {
        method: 'POST',
        body: JSON.stringify({ activity: testActivity })
      });
      setTestResult(result);
      await Promise.all([loadOverview(), loadAudits()]);
      toast({ title: 'Runtime test passed', description: `${result.execution.model} responded in ${formatNumber(result.execution.latencyMs)} ms.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI runtime test failed';
      setTestError(message);
      toast({ title: 'Runtime test failed', description: message, variant: 'destructive' });
    } finally {
      setBusy('');
    }
  }

  async function saveRoute(route: ActivityRoute) {
    setBusy(`route:${route.activity}`);
    try {
      await adminJson(`/api/admin/ai-runtime/routes/${encodeURIComponent(route.activity)}`, {
        method: 'PUT',
        body: JSON.stringify({ model: route.model, reasoningEffort: route.reasoningEffort, enabled: route.enabled })
      });
      await loadSettings();
      toast({ title: 'Route saved', description: `${definitions.get(route.activity)?.label || route.activity} now uses ${route.model}.` });
    } catch (error) {
      toast({ title: 'Route was not saved', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setBusy('');
    }
  }

  function editRoute(activity: string, patch: Partial<ActivityRoute>) {
    setSettings((current) => current ? {
      ...current,
      routes: current.routes.map((route) => route.activity === activity ? { ...route, ...patch } : route)
    } : current);
  }

  async function submitCredential(event: FormEvent) {
    event.preventDefault();
    if (!credentialDialog) return;
    const rotating = credentialDialog.mode === 'rotate';
    const validation = validateCredentialDraft(credentialForm, availableQuotaGroups, rotating);
    if (!validation.ok) {
      setCredentialError(validation.message);
      return;
    }
    setCredentialError('');
    setBusy('credential-save');
    try {
      await adminJson(rotating
        ? `/api/admin/ai-runtime/credentials/${credentialDialog.id}/rotate`
        : '/api/admin/ai-runtime/credentials', {
        method: 'POST',
        body: JSON.stringify(rotating ? { apiKey: validation.value.apiKey } : {
          ...validation.value,
          verify: true
        })
      });
      closeCredentialDialog();
      await loadSettings();
      toast({ title: rotating ? 'Credential rotated' : 'Credential added', description: 'The key was encrypted and its connection test succeeded.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setCredentialError(message);
      toast({ title: 'Credential was not saved', description: message, variant: 'destructive' });
    } finally {
      setBusy('');
    }
  }

  async function submitQuotaGroup(event: FormEvent) {
    event.preventDefault();
    const validation = validateQuotaGroupDraft(quotaForm, availableQuotaGroups);
    if (!validation.ok) {
      setQuotaError(validation.message);
      return;
    }
    setQuotaError('');
    setBusy('quota-group');
    try {
      await adminJson('/api/admin/ai-runtime/quota-groups', {
        method: 'POST',
        body: JSON.stringify(validation.value)
      });
      closeQuotaDialog();
      await loadSettings();
      toast({ title: 'Quota group added', description: 'Credentials in this group may be used after another independent quota scope is exhausted.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setQuotaError(message);
      toast({ title: 'Quota group was not added', description: message, variant: 'destructive' });
    } finally {
      setBusy('');
    }
  }

  async function credentialAction(id: string, action: 'test' | 'toggle' | 'revoke', enabled?: boolean) {
    setBusy(`${action}:${id}`);
    try {
      if (action === 'test') await adminJson(`/api/admin/ai-runtime/credentials/${id}/test`, { method: 'POST', body: '{}' });
      if (action === 'toggle') await adminJson(`/api/admin/ai-runtime/credentials/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
      if (action === 'revoke') await adminJson(`/api/admin/ai-runtime/credentials/${id}`, { method: 'DELETE' });
      await loadSettings();
      toast({ title: action === 'test' ? 'Connection test passed' : action === 'revoke' ? 'Credential removed' : 'Credential updated' });
    } catch (error) {
      toast({ title: 'Credential action failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setBusy('');
    }
  }

  async function syncModels() {
    setBusy('model-sync');
    try {
      await adminJson('/api/admin/ai-runtime/models/sync', { method: 'POST', body: '{}' });
      await loadSettings();
      toast({ title: 'Model catalog synchronized', description: 'Model access was checked against Groq.' });
    } catch (error) {
      toast({ title: 'Model sync failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setBusy('');
    }
  }

  async function saveAlerts(event: FormEvent) {
    event.preventDefault();
    setBusy('alerts');
    try {
      await adminJson('/api/admin/ai-runtime/alerts', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: alertForm.enabled,
          recipients: alertForm.recipients.split(',').map((item) => item.trim()).filter(Boolean),
          monthlyBudgetUsd: alertForm.monthlyBudgetUsd
        })
      });
      await Promise.all([loadSettings(), loadAudits()]);
      toast({ title: 'Alert settings saved', description: 'Quota and health notification rules are active.' });
    } catch (error) {
      toast({ title: 'Alert settings were not saved', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setBusy('');
    }
  }

  async function saveRollout() {
    if (!settings) return;
    setBusy('rollout');
    try {
      await adminJson('/api/admin/ai-runtime/rollout', {
        method: 'PUT',
        body: JSON.stringify({ groqPercent: settings.rollout.groqPercent })
      });
      await Promise.all([loadSettings(), loadAudits()]);
      toast({
        title: settings.rollout.groqPercent === 100 ? 'Groq rollout completed' : 'Canary updated',
        description: settings.rollout.groqPercent === 100
          ? 'Azure text generation is disabled; all text generation now uses Groq.'
          : `${settings.rollout.groqPercent}% of organizations are deterministically routed to Groq.`
      });
    } catch (error) {
      toast({ title: 'Rollout was not updated', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setBusy('');
    }
  }

  function inspectOrganization(id: string) {
    setOrganizationFilter(id);
    setActorFilter('');
    setRequestPage(1);
    setTab('requests');
  }

  function inspectActor(id: string) {
    setActorFilter(id);
    setOrganizationFilter('');
    setRequestPage(1);
    setTab('requests');
  }

  const stats = overview?.totals;

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      <div className="hidden lg:flex"><AdminSidebar /></div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AdminHeader>
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-gray-300 lg:hidden"
                aria-label="Open admin navigation"
                title="Open admin navigation"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 border-gray-700 bg-gray-800 p-0">
              <AdminSidebar onToggle={() => setMobileNavOpen(false)} />
            </SheetContent>
          </Sheet>
        </AdminHeader>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8">
            <div className="mb-5 flex flex-col gap-4 border-b border-gray-800 pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Cpu className="h-5 w-5 text-blue-400" />
                  <h1 className="text-2xl font-semibold text-white">AI Runtime</h1>
                </div>
                <p className="mt-1 text-sm text-gray-400">Groq routing, credentials, quota health, and request telemetry.</p>
              </div>
              <div className="flex items-center gap-2">
                <Select value={range} onValueChange={(value) => setRange(value as RangeKey)}>
                  <SelectTrigger className="w-32 border-gray-700 bg-gray-900 text-gray-200"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="7d">7 days</SelectItem><SelectItem value="30d">30 days</SelectItem><SelectItem value="90d">90 days</SelectItem><SelectItem value="all">All time</SelectItem></SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={refresh} disabled={loading} className="border-gray-700 bg-gray-900 text-gray-200" title="Refresh runtime data">
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>

            <Tabs value={tab} onValueChange={(value) => setTab(value as TabKey)}>
              <div className="overflow-x-auto border-b border-gray-800">
                <TabsList className="h-11 min-w-max justify-start rounded-none bg-transparent p-0">
                  <TabsTrigger value="overview" className="h-11 rounded-none border-b-2 border-transparent bg-transparent text-gray-400 data-[state=active]:border-blue-500 data-[state=active]:bg-transparent data-[state=active]:text-white">Overview</TabsTrigger>
                  {canConfigure && <TabsTrigger value="test" className="h-11 rounded-none border-b-2 border-transparent bg-transparent text-gray-400 data-[state=active]:border-blue-500 data-[state=active]:bg-transparent data-[state=active]:text-white">Test</TabsTrigger>}
                  {canConfigure && <TabsTrigger value="routing" className="h-11 rounded-none border-b-2 border-transparent bg-transparent text-gray-400 data-[state=active]:border-blue-500 data-[state=active]:bg-transparent data-[state=active]:text-white">Routing</TabsTrigger>}
                  {canConfigure && <TabsTrigger value="credentials" className="h-11 rounded-none border-b-2 border-transparent bg-transparent text-gray-400 data-[state=active]:border-blue-500 data-[state=active]:bg-transparent data-[state=active]:text-white">Credentials</TabsTrigger>}
                  <TabsTrigger value="requests" className="h-11 rounded-none border-b-2 border-transparent bg-transparent text-gray-400 data-[state=active]:border-blue-500 data-[state=active]:bg-transparent data-[state=active]:text-white">Requests</TabsTrigger>
                  <TabsTrigger value="alerts" className="h-11 rounded-none border-b-2 border-transparent bg-transparent text-gray-400 data-[state=active]:border-blue-500 data-[state=active]:bg-transparent data-[state=active]:text-white">Alerts</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="overview" className="mt-5 space-y-5">
                {loading && !overview ? <div className="flex h-48 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-blue-400" /></div> : (
                  <>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
                      {[
                        { label: 'Calls', value: formatNumber(stats?.calls), icon: Activity },
                        { label: 'Success rate', value: `${formatNumber(stats?.successRate, 1)}%`, icon: CheckCircle2 },
                        { label: 'Tokens', value: formatNumber(stats?.totalTokens), icon: Cpu },
                        { label: 'Est. cost', value: `$${formatNumber(stats?.estimatedCostUsd, 4)}`, icon: CircleDollarSign },
                        { label: 'Average', value: `${formatNumber(stats?.averageLatencyMs)} ms`, icon: Clock3 },
                        { label: 'P50', value: `${formatNumber(stats?.p50LatencyMs)} ms`, icon: Clock3 },
                        { label: 'P95', value: `${formatNumber(stats?.p95LatencyMs)} ms`, icon: AlertTriangle }
                      ].map(({ label, value, icon: Icon }) => (
                        <div key={label} className="min-w-0 rounded-md border border-gray-800 bg-gray-900 p-4">
                          <div className="flex items-center justify-between gap-2 text-xs text-gray-500"><span>{label}</span><Icon className="h-4 w-4" /></div>
                          <div className="mt-2 truncate text-lg font-semibold text-white" title={value}>{value}</div>
                        </div>
                      ))}
                    </div>

                    <div className="grid gap-5 xl:grid-cols-2">
                      <BreakdownTable title="Activity usage" rows={overview?.byActivity || []} label={(id) => definitions.get(id)?.label || id} />
                      <BreakdownTable title="Model usage" rows={overview?.byModel || []} label={(id) => id || 'Unknown'} />
                      <BreakdownTable title="Provider usage" rows={overview?.byProvider || []} label={(id) => id || 'Unknown'} />
                      <BreakdownTable title="Application usage" rows={overview?.bySource || []} label={(id) => id || 'Unknown'} />
                      <DrilldownTable title="Organizations" icon={Building2} rows={overview?.organizations || []} onSelect={inspectOrganization} />
                      <DrilldownTable title="People" icon={UserRound} rows={overview?.actors || []} onSelect={inspectActor} />
                    </div>

                    <section className="overflow-hidden rounded-md border border-gray-800 bg-gray-900">
                      <div className="border-b border-gray-800 px-4 py-3"><h2 className="text-sm font-semibold text-white">Quota health</h2></div>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader><TableRow className="border-gray-800"><TableHead>Quota group</TableHead><TableHead>Model</TableHead><TableHead>Daily requests</TableHead><TableHead>Minute tokens</TableHead><TableHead>Status</TableHead><TableHead>Observed</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {(overview?.quotas || []).map((quota) => (
                              <TableRow key={quota._id} className="border-gray-800">
                                <TableCell>{quota.quotaGroup}</TableCell><TableCell className="font-mono text-xs">{quota.model}</TableCell>
                                <TableCell>{formatNumber(quota.requestRemainingDaily)} / {formatNumber(quota.requestLimitDaily)}</TableCell>
                                <TableCell>{formatNumber(quota.tokenRemainingMinute)} / {formatNumber(quota.tokenLimitMinute)}</TableCell>
                                <TableCell><StatusBadge status={quota.blockedUntil && new Date(quota.blockedUntil) > new Date() ? 'blocked' : 'healthy'} /></TableCell>
                                <TableCell className="text-gray-400">{formatDate(quota.observedAt)}</TableCell>
                              </TableRow>
                            ))}
                            {!overview?.quotas?.length && <TableRow><TableCell colSpan={6} className="h-24 text-center text-gray-500">Quota observations appear after the first model request.</TableCell></TableRow>}
                          </TableBody>
                        </Table>
                      </div>
                    </section>
                  </>
                )}
              </TabsContent>

              <TabsContent value="test" className="mt-5 space-y-4">
                <section className="overflow-hidden rounded-md border border-gray-800 bg-gray-900">
                  <div className="flex flex-col gap-3 border-b border-gray-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-950 text-blue-300"><Activity className="h-4 w-4" /></div><div><h2 className="text-sm font-semibold text-white">Runtime test</h2><p className="mt-1 text-xs text-gray-500">Synthetic request with production routing and telemetry.</p></div></div>
                    <Badge variant="outline" className="w-fit border-green-900 bg-green-950/50 text-green-300">No candidate data</Badge>
                  </div>
                  <form onSubmit={submitRuntimeTest} className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(280px,1fr)_auto] lg:items-end">
                    <div className="space-y-2">
                      <Label htmlFor="runtime-test-activity">AI activity</Label>
                      <Select value={testActivity} onValueChange={(activity) => { setTestActivity(activity); setTestResult(null); setTestError(''); }}>
                        <SelectTrigger id="runtime-test-activity" className="border-gray-700 bg-gray-950"><SelectValue placeholder="Choose activity" /></SelectTrigger>
                        <SelectContent>{enabledTestRoutes.map((route) => <SelectItem key={route.activity} value={route.activity}>{definitions.get(route.activity)?.group} / {definitions.get(route.activity)?.label || route.activity}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <Button type="submit" disabled={!testActivity || busy === 'runtime-test'} className="min-w-36">{busy === 'runtime-test' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}Run test</Button>
                  </form>
                  <dl className="grid border-t border-gray-800 bg-gray-950/40 sm:grid-cols-4">
                    <RuntimeTestDatum label="Provider" value={selectedTestRoute?.provider || 'Not selected'} />
                    <RuntimeTestDatum label="Configured model" value={selectedTestRoute?.model || 'Not selected'} mono />
                    <RuntimeTestDatum label="Reasoning" value={selectedTestRoute?.reasoningEffort || 'Not selected'} />
                    <RuntimeTestDatum label="Route version" value={selectedTestRoute ? `v${selectedTestRoute.routeVersion}` : 'Not selected'} />
                  </dl>
                </section>

                {testError && <section role="alert" aria-live="polite" className="flex items-start gap-3 rounded-md border border-red-900 bg-red-950/40 px-4 py-4 text-sm text-red-200"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-medium">Runtime test failed</p><p className="mt-1 text-red-300">{testError}</p></div></section>}

                {testResult && <section aria-live="polite" className="overflow-hidden rounded-md border border-green-900/80 bg-gray-900">
                  <div className="flex flex-col gap-3 border-b border-gray-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-green-400" /><div><h2 className="text-sm font-semibold text-white">Test passed</h2><p className="mt-1 text-xs text-gray-500">{testResult.activityLabel}</p></div></div><StatusBadge status="success" /></div>
                  <div className="border-b border-gray-800 px-5 py-5"><p className="text-xs font-medium uppercase text-gray-500">Synthetic response</p><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-gray-200">{testResult.execution.response || 'The provider returned no visible text.'}</p></div>
                  <dl className="grid sm:grid-cols-2 lg:grid-cols-4">
                    <RuntimeTestDatum label="Executed provider" value={testResult.execution.provider} />
                    <RuntimeTestDatum label="Executed model" value={testResult.execution.model} mono />
                    <RuntimeTestDatum label="Latency" value={`${formatNumber(testResult.execution.latencyMs)} ms`} />
                    <RuntimeTestDatum label="Total tokens" value={formatNumber(testResult.execution.usage.totalTokens)} />
                    <RuntimeTestDatum label="Estimated cost" value={`$${formatNumber(testResult.execution.usage.estimatedCostUsd, 6)}`} />
                    <RuntimeTestDatum label="Attempts" value={formatNumber(testResult.execution.attempts)} />
                    <RuntimeTestDatum label="Failovers" value={formatNumber(testResult.execution.failovers)} />
                    <RuntimeTestDatum label="Quota group" value={testResult.execution.quotaGroup || 'Not reported'} mono />
                  </dl>
                  <div className="border-t border-gray-800 bg-gray-950/40 px-5 py-3"><span className="text-xs text-gray-500">Request ID </span><span className="break-all font-mono text-xs text-gray-300">{testResult.execution.requestId}</span></div>
                </section>}
              </TabsContent>

              <TabsContent value="routing" className="mt-5">
                <section className="overflow-hidden rounded-md border border-gray-800 bg-gray-900">
                  <div className="flex flex-col gap-3 border-b border-gray-800 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                    <div><h2 className="text-sm font-semibold text-white">Activity routing</h2><p className="mt-1 text-xs text-gray-500">Token ceilings and safety constraints remain code-owned.</p></div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={String(settings?.rollout.groqPercent || 100)} onValueChange={(value) => setSettings((current) => current ? { ...current, rollout: { ...current.rollout, groqPercent: Number(value) as 10 | 50 | 100 } } : current)}>
                        <SelectTrigger className="w-44 border-gray-700 bg-gray-950"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="10">Groq canary 10%</SelectItem><SelectItem value="50">Groq canary 50%</SelectItem><SelectItem value="100">Groq only 100%</SelectItem></SelectContent>
                      </Select>
                      <Button size="sm" onClick={saveRollout} disabled={busy === 'rollout'}><Save className="mr-2 h-4 w-4" />Save rollout</Button>
                      <Button variant="outline" size="sm" onClick={syncModels} disabled={busy === 'model-sync'} className="border-gray-700 bg-gray-950"><RefreshCw className={`mr-2 h-4 w-4 ${busy === 'model-sync' ? 'animate-spin' : ''}`} />Sync models</Button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow className="border-gray-800"><TableHead>Activity</TableHead><TableHead>Model</TableHead><TableHead>Reasoning</TableHead><TableHead>Enabled</TableHead><TableHead className="text-right">Save</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {(settings?.routes || []).map((route) => (
                          <TableRow key={route.activity} className="border-gray-800">
                            <TableCell><div className="font-medium text-gray-200">{definitions.get(route.activity)?.label || route.activity}</div><div className="text-xs text-gray-500">{definitions.get(route.activity)?.group} / v{route.routeVersion}</div></TableCell>
                            <TableCell><Select value={route.model} onValueChange={(model) => editRoute(route.activity, { model })}><SelectTrigger className="w-56 border-gray-700 bg-gray-950"><SelectValue /></SelectTrigger><SelectContent>{settings?.models.filter((model) => model.enabled && model.available !== false).map((model) => <SelectItem key={model.id} value={model.id}>{model.label}</SelectItem>)}</SelectContent></Select></TableCell>
                            <TableCell><Select value={route.reasoningEffort} onValueChange={(reasoningEffort) => editRoute(route.activity, { reasoningEffort: reasoningEffort as ActivityRoute['reasoningEffort'] })}><SelectTrigger className="w-28 border-gray-700 bg-gray-950"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem></SelectContent></Select></TableCell>
                            <TableCell><Switch checked={route.enabled} onCheckedChange={(enabled) => editRoute(route.activity, { enabled })} /></TableCell>
                            <TableCell className="text-right"><Button size="sm" onClick={() => saveRoute(route)} disabled={busy === `route:${route.activity}`}><Save className="mr-2 h-4 w-4" />Save</Button></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              </TabsContent>

              <TabsContent value="credentials" className="mt-5">
                <section className="overflow-hidden rounded-md border border-gray-800 bg-gray-900">
                  <div className="flex flex-col gap-3 border-b border-gray-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div><h2 className="text-sm font-semibold text-white">Groq credentials</h2><p className="mt-1 text-xs text-gray-500">Add, rotate, disable, test, or permanently remove runtime credentials.</p></div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => openCredentialDialog('create')} disabled={!canManageSecrets} title={canManageSecrets ? 'Add Groq credential' : 'AI runtime settings permission is required'}><Plus className="mr-2 h-4 w-4" />Add credential</Button>
                      {canConfigure && <Button variant="outline" size="sm" onClick={openQuotaDialog} className="border-gray-700"><Building2 className="mr-2 h-4 w-4" />New independent group</Button>}
                    </div>
                  </div>
                  <div className="border-b border-gray-800 bg-gray-950/40 px-4 py-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div><p className="text-xs font-medium text-gray-300">Available quota groups</p><p className="mt-1 text-xs text-gray-500">Keys in the same group share Groq limits. Quota groups never contain API keys.</p></div>
                      <div className="flex flex-wrap gap-2">
                        {availableQuotaGroups.map((group) => <Badge key={group.id} variant="outline" className="border-gray-700 bg-gray-900 text-gray-300">{group.label} <span className="ml-1 font-mono text-gray-500">{group.id}</span></Badge>)}
                        {!availableQuotaGroups.length && <span className="text-xs text-amber-400">No quota groups configured</span>}
                      </div>
                    </div>
                    {!canManageSecrets && <div role="note" className="mt-3 flex items-start gap-2 border-t border-gray-800 pt-3 text-xs text-amber-300"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>AI runtime settings permission is required to add, rotate, or remove API keys.</span></div>}
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow className="border-gray-800"><TableHead>Credential</TableHead><TableHead>Quota group</TableHead><TableHead>Priority</TableHead><TableHead>Status</TableHead><TableHead>Last success</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {credentials.map((credential) => (
                          <TableRow key={credential._id} className="border-gray-800">
                            <TableCell><div className="flex items-center gap-2 font-medium"><KeyRound className="h-4 w-4 text-gray-500" />{credential.label}</div><div className="mt-1 font-mono text-xs text-gray-500">{credential.maskedKey} / {credential.fingerprint.slice(0, 10)}</div></TableCell>
                            <TableCell>{credential.quotaGroup}<div className="text-xs text-gray-500">{credential.projectLabel || 'No project label'}</div></TableCell>
                            <TableCell>{credential.priority}</TableCell><TableCell><StatusBadge status={credential.status} /></TableCell><TableCell className="text-gray-400">{formatDate(credential.lastSuccessAt)}</TableCell>
                            <TableCell><div className="flex justify-end gap-1">
                              {canManageSecrets && <><Button variant="ghost" size="icon" title="Test credential" onClick={() => credentialAction(credential._id, 'test')}><Play className="h-4 w-4" /></Button><Button variant="ghost" size="icon" title="Rotate credential" onClick={() => openCredentialDialog('rotate', credential._id, credential)}><RotateCw className="h-4 w-4" /></Button><Switch className="mx-2 mt-2" checked={credential.enabled} onCheckedChange={(enabled) => credentialAction(credential._id, 'toggle', enabled)} /></>}
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={!canManageSecrets || busy === `revoke:${credential._id}`}
                                title={canManageSecrets ? 'Permanently remove credential' : 'AI runtime settings permission is required'}
                                onClick={() => setCredentialToRemove(credential)}
                                className="text-red-400 hover:bg-red-950 hover:text-red-300"
                              >
                                {busy === `revoke:${credential._id}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                                Remove
                              </Button>
                            </div></TableCell>
                          </TableRow>
                        ))}
                        {!credentials.length && <TableRow><TableCell colSpan={6} className="h-24 text-center text-gray-500">No Groq credentials are configured.{!canManageSecrets && ' A super admin must add the first key.'}</TableCell></TableRow>}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              </TabsContent>

              <TabsContent value="requests" className="mt-5 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap gap-2"><Select value={requestStatus} onValueChange={(value) => { setRequestStatus(value); setRequestPage(1); }}><SelectTrigger className="w-36 border-gray-700 bg-gray-900"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="success">Success</SelectItem><SelectItem value="failed">Failed</SelectItem></SelectContent></Select>{organizationFilter && <Button variant="outline" onClick={() => setOrganizationFilter('')} className="border-gray-700">Clear organization</Button>}{actorFilter && <Button variant="outline" onClick={() => setActorFilter('')} className="border-gray-700">Clear person</Button>}</div>
                  <span className="text-xs text-gray-500">Detailed events are retained for 90 days.</span>
                </div>
                <section className="overflow-hidden rounded-md border border-gray-800 bg-gray-900"><div className="overflow-x-auto"><Table>
                  <TableHeader><TableRow className="border-gray-800"><TableHead>Time</TableHead><TableHead>Activity</TableHead><TableHead>Application</TableHead><TableHead>Organization / person</TableHead><TableHead>Model</TableHead><TableHead>Tokens</TableHead><TableHead>Est. cost</TableHead><TableHead>Attempts</TableHead><TableHead>Latency</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>{requests.map((request) => <TableRow key={request._id} className="border-gray-800"><TableCell className="whitespace-nowrap text-gray-400">{formatDate(request.createdAt)}</TableCell><TableCell><div>{definitions.get(request.activity)?.label || request.activity}</div><div className="font-mono text-xs text-gray-500">{request.requestId.slice(0, 12)}</div></TableCell><TableCell>{request.sourceApp}</TableCell><TableCell><div>{request.organizationName || 'Unresolved organization'}</div><div className="text-xs text-gray-500">{request.actorName || request.actorEmail || 'System'}</div></TableCell><TableCell><div className="text-xs text-gray-500">{request.provider}</div><div className="font-mono text-xs">{request.model}</div></TableCell><TableCell>{formatNumber(request.totalTokens)}</TableCell><TableCell>${formatNumber(request.estimatedCostUsd, 6)}</TableCell><TableCell>{request.failovers + 1}</TableCell><TableCell>{formatNumber(request.latencyMs)} ms</TableCell><TableCell><StatusBadge status={request.status} />{request.errorCode && <div className="mt-1 text-xs text-red-400">{request.errorCode}</div>}</TableCell></TableRow>)}</TableBody>
                </Table></div>{!requests.length && <div className="py-16 text-center text-sm text-gray-500">No requests match these filters.</div>}</section>
                <div className="flex items-center justify-end gap-2"><Button variant="outline" size="icon" disabled={requestPage <= 1} onClick={() => setRequestPage((page) => page - 1)} className="border-gray-700"><ChevronLeft className="h-4 w-4" /></Button><span className="min-w-24 text-center text-sm text-gray-400">{requestPage} of {requestPages}</span><Button variant="outline" size="icon" disabled={requestPage >= requestPages} onClick={() => setRequestPage((page) => page + 1)} className="border-gray-700"><ChevronRight className="h-4 w-4" /></Button></div>
              </TabsContent>

              <TabsContent value="alerts" className="mt-5 grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
                {canConfigure ? <form onSubmit={saveAlerts} className="h-fit rounded-md border border-gray-800 bg-gray-900 p-5">
                  <div className="mb-5 flex items-start justify-between gap-4"><div><h2 className="text-sm font-semibold text-white">Notifications</h2><p className="mt-1 text-xs text-gray-500">Daily quota, monthly estimate, credential health, and recovery emails.</p></div><Switch checked={alertForm.enabled} onCheckedChange={(enabled) => setAlertForm((form) => ({ ...form, enabled }))} /></div>
                  <div className="space-y-4"><div className="space-y-2"><Label htmlFor="alert-recipients">Additional recipients</Label><Input id="alert-recipients" value={alertForm.recipients} onChange={(event) => setAlertForm((form) => ({ ...form, recipients: event.target.value }))} placeholder="ops@example.com, finance@example.com" className="border-gray-700 bg-gray-950" /><p className="text-xs text-gray-500">Active super admins are always included.</p></div><div className="space-y-2"><Label htmlFor="monthly-budget">Monthly estimated budget (USD)</Label><Input id="monthly-budget" type="number" min="0" step="0.01" value={alertForm.monthlyBudgetUsd} onChange={(event) => setAlertForm((form) => ({ ...form, monthlyBudgetUsd: event.target.value }))} placeholder="No budget limit" className="border-gray-700 bg-gray-950" /></div><Button type="submit" disabled={busy === 'alerts'} className="w-full"><Save className="mr-2 h-4 w-4" />Save alert settings</Button></div>
                </form> : <div className="h-fit rounded-md border border-gray-800 bg-gray-900 p-5"><ShieldAlert className="h-5 w-5 text-amber-400" /><p className="mt-3 text-sm text-gray-300">System settings permission is required to change alert rules.</p></div>}
                <section className="overflow-hidden rounded-md border border-gray-800 bg-gray-900"><div className="border-b border-gray-800 px-4 py-3"><h2 className="text-sm font-semibold text-white">Alert and audit history</h2></div><div className="overflow-x-auto"><Table><TableHeader><TableRow className="border-gray-800"><TableHead>Time</TableHead><TableHead>Category</TableHead><TableHead>Event</TableHead><TableHead>Status</TableHead><TableHead>Admin</TableHead></TableRow></TableHeader><TableBody>{audits.map((event) => <TableRow key={event._id} className="border-gray-800"><TableCell className="whitespace-nowrap text-gray-400">{formatDate(event.createdAt)}</TableCell><TableCell>{event.category}</TableCell><TableCell><div>{event.message}</div><div className="text-xs text-gray-500">{event.action}</div></TableCell><TableCell><StatusBadge status={event.status} /></TableCell><TableCell className="text-gray-400">{event.actorEmail || 'System'}</TableCell></TableRow>)}</TableBody></Table></div>{!audits.length && <div className="py-16 text-center text-sm text-gray-500">No alert or configuration events yet.</div>}<div className="flex items-center justify-end gap-2 border-t border-gray-800 px-4 py-3"><Button variant="outline" size="icon" disabled={auditPage <= 1} onClick={() => setAuditPage((page) => page - 1)} className="border-gray-700"><ChevronLeft className="h-4 w-4" /></Button><span className="min-w-24 text-center text-sm text-gray-400">{auditPage} of {auditPages}</span><Button variant="outline" size="icon" disabled={auditPage >= auditPages} onClick={() => setAuditPage((page) => page + 1)} className="border-gray-700"><ChevronRight className="h-4 w-4" /></Button></div></section>
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>

      <Dialog open={Boolean(credentialDialog)} onOpenChange={(open) => !open && closeCredentialDialog()}>
        <DialogContent className="border-gray-700 bg-gray-900 text-gray-100">
          <DialogHeader>
            <DialogTitle>{credentialDialog?.mode === 'rotate' ? 'Rotate Groq credential' : 'Add Groq credential'}</DialogTitle>
            <DialogDescription className="text-gray-400">The key is verified before it becomes available to the runtime.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCredential} className="space-y-4">
            {credentialDialog?.mode === 'create' && <>
              <div className="space-y-2">
                <Label htmlFor="credential-label">Credential label</Label>
                <Input id="credential-label" required value={credentialForm.label} onChange={(event) => { setCredentialError(''); setCredentialForm((form) => ({ ...form, label: event.target.value })); }} placeholder="Primary Groq key" className="border-gray-700 bg-gray-950" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="quota-group">Quota group</Label>
                  <Select value={credentialForm.quotaGroup} onValueChange={(quotaGroup) => { setCredentialError(''); setCredentialForm((form) => ({ ...form, quotaGroup })); }}>
                    <SelectTrigger id="quota-group" className="border-gray-700 bg-gray-950"><SelectValue placeholder="Choose quota group" /></SelectTrigger>
                    <SelectContent>{availableQuotaGroups.map((group) => <SelectItem key={group.id} value={group.id}>{group.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500">Choose the Groq organization whose limits this key shares.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="priority">Priority</Label>
                  <Input id="priority" type="number" min="1" max="10000" required value={credentialForm.priority} onChange={(event) => { setCredentialError(''); setCredentialForm((form) => ({ ...form, priority: event.target.value })); }} className="border-gray-700 bg-gray-950" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="project-label">Project label <span className="text-gray-500">(optional)</span></Label>
                <Input id="project-label" value={credentialForm.projectLabel} onChange={(event) => { setCredentialError(''); setCredentialForm((form) => ({ ...form, projectLabel: event.target.value })); }} placeholder="Production" className="border-gray-700 bg-gray-950" />
              </div>
            </>}
            <div className="space-y-2">
              <Label htmlFor="groq-key">Groq API key</Label>
              <Input id="groq-key" type="password" autoComplete="new-password" required value={credentialForm.apiKey} onChange={(event) => { setCredentialError(''); setCredentialForm((form) => ({ ...form, apiKey: event.target.value })); }} className="border-gray-700 bg-gray-950 font-mono" />
              <p className="text-xs text-gray-500">Stored encrypted; only its fingerprint and final four characters are returned.</p>
            </div>
            {credentialError && <div role="alert" aria-live="polite" className="flex items-start gap-2 rounded-md border border-red-900 bg-red-950/60 p-3 text-sm text-red-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{credentialError}</span></div>}
            <DialogFooter><Button type="button" variant="outline" onClick={closeCredentialDialog} className="border-gray-700">Cancel</Button><Button type="submit" disabled={busy === 'credential-save' || (credentialDialog?.mode === 'create' && !availableQuotaGroups.length)}>{busy === 'credential-save' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{credentialDialog?.mode === 'rotate' ? 'Verify and rotate' : 'Verify and add'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(credentialToRemove)} onOpenChange={(open) => !open && setCredentialToRemove(null)}>
        <AlertDialogContent className="border-gray-700 bg-gray-900 text-gray-100">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Groq credential?</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              This permanently revokes {credentialToRemove?.label || 'this credential'}, erases its encrypted API key, and immediately stops the runtime from using it. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-gray-700 bg-transparent text-gray-200 hover:bg-gray-800 hover:text-white">Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!credentialToRemove || busy === `revoke:${credentialToRemove?._id}`}
              onClick={() => credentialToRemove && credentialAction(credentialToRemove._id, 'revoke')}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              {busy === `revoke:${credentialToRemove?._id}` && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remove credential
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={quotaDialog} onOpenChange={(open) => !open && closeQuotaDialog()}>
        <DialogContent className="border-gray-700 bg-gray-900 text-gray-100">
          <DialogHeader><DialogTitle>New independent quota group</DialogTitle><DialogDescription className="text-gray-400">Use this only for a separate authorized Groq organization. Existing groups are selected from the dropdown when adding a credential; never paste an API key here.</DialogDescription></DialogHeader>
          <form onSubmit={submitQuotaGroup} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="quota-label">Organization label</Label><Input id="quota-label" required value={quotaForm.label} onChange={(event) => { setQuotaError(''); setQuotaForm((form) => ({ ...form, label: event.target.value })); }} placeholder="EU backup organization" className="border-gray-700 bg-gray-950" /><p className="text-xs text-gray-500">The internal identifier is generated automatically.</p></div>
            <label className="flex items-start gap-3 rounded-md border border-gray-700 bg-gray-950 p-3 text-sm text-gray-300"><Switch checked={quotaForm.confirmed} onCheckedChange={(confirmed) => { setQuotaError(''); setQuotaForm((form) => ({ ...form, confirmed })); }} /><span>I confirm this quota is independent and authorized by Groq.</span></label>
            {quotaError && <div role="alert" aria-live="polite" className="flex items-start gap-2 rounded-md border border-red-900 bg-red-950/60 p-3 text-sm text-red-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{quotaError}</span></div>}
            <DialogFooter><Button type="button" variant="outline" onClick={closeQuotaDialog} className="border-gray-700">Cancel</Button><Button type="submit" disabled={!quotaForm.confirmed || busy === 'quota-group'}>Create independent group</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RuntimeTestDatum({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0 border-b border-gray-800 px-5 py-4 last:border-b-0 sm:border-b-0"><dt className="text-xs text-gray-500">{label}</dt><dd className={`mt-1 break-words text-sm text-gray-200 ${mono ? 'font-mono' : ''}`}>{value}</dd></div>;
}

function BreakdownTable({ title, rows, label }: { title: string; rows: UsageBreakdown[]; label: (id: string) => string }) {
  return <section className="overflow-hidden rounded-md border border-gray-800 bg-gray-900"><div className="border-b border-gray-800 px-4 py-3"><h2 className="text-sm font-semibold text-white">{title}</h2></div><div className="overflow-x-auto"><Table><TableHeader><TableRow className="border-gray-800"><TableHead>Name</TableHead><TableHead>Calls</TableHead><TableHead>Failures</TableHead><TableHead>Tokens</TableHead><TableHead>Est. cost</TableHead></TableRow></TableHeader><TableBody>{rows.slice(0, 12).map((row) => <TableRow key={row._id} className="border-gray-800"><TableCell className="max-w-56 truncate" title={label(row._id)}>{label(row._id)}</TableCell><TableCell>{formatNumber(row.calls)}</TableCell><TableCell>{formatNumber(row.failures)}</TableCell><TableCell>{formatNumber(row.tokens)}</TableCell><TableCell>${formatNumber(row.cost, 4)}</TableCell></TableRow>)}</TableBody></Table></div>{!rows.length && <div className="py-12 text-center text-sm text-gray-500">No usage in this range.</div>}</section>;
}

function DrilldownTable({ title, icon: Icon, rows, onSelect }: { title: string; icon: typeof Building2; rows: UsageBreakdown[]; onSelect?: (id: string) => void }) {
  return <section className="overflow-hidden rounded-md border border-gray-800 bg-gray-900"><div className="flex items-center gap-2 border-b border-gray-800 px-4 py-3"><Icon className="h-4 w-4 text-gray-500" /><h2 className="text-sm font-semibold text-white">{title}</h2></div><div className="overflow-x-auto"><Table><TableHeader><TableRow className="border-gray-800"><TableHead>Name</TableHead><TableHead>Calls</TableHead><TableHead>Failures</TableHead><TableHead>Tokens</TableHead></TableRow></TableHeader><TableBody>{rows.slice(0, 12).map((row) => <TableRow key={row._id} className={`border-gray-800 ${onSelect ? 'cursor-pointer hover:bg-gray-800/70' : ''}`} onClick={() => onSelect?.(row._id)}><TableCell className="font-medium">{row.name || row._id}</TableCell><TableCell>{formatNumber(row.calls)}</TableCell><TableCell>{formatNumber(row.failures)}</TableCell><TableCell>{formatNumber(row.tokens)}</TableCell></TableRow>)}</TableBody></Table></div>{!rows.length && <div className="py-12 text-center text-sm text-gray-500">No attributed usage in this range.</div>}</section>;
}
