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
import { parseServerSentEventBuffer } from '@/lib/queueTelemetryStream';

type RangeKey = '7d' | '30d' | '90d' | 'all';
type TabKey = 'overview' | 'local' | 'test' | 'routing' | 'credentials' | 'requests' | 'alerts';
type DetailKind = 'request' | 'queue' | 'audit';

interface RuntimeModel {
  id: string;
  label: string;
  provider?: string;
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
  provider?: string;
  lockedProvider?: boolean;
}

interface LocalRuntimeStatus {
  configured: boolean;
  reachable: boolean;
  service?: string;
  engine?: 'ollama' | 'vllm' | 'codex';
  model?: string;
  executionMode?: 'local' | 'local-cloud';
  cvLocalEligible?: boolean;
  state?: {
    enabled: boolean;
    ingressEnabled: boolean;
    paused: boolean;
    concurrency: number;
    selectedEngine?: 'ollama' | 'vllm' | 'codex';
  };
  engines?: Array<{ id: string; label: string; model: string; selected: boolean }>;
  active?: number;
  waiting?: number;
  completed?: number;
  failed?: number;
  averageLatencyMs?: number;
  lastRequestAt?: string;
  health?: { ok?: boolean; engine?: string; model?: string; modelInstalled?: boolean; error?: string };
  queue?: {
    waiting: number;
    active: number;
    delayed: number;
    completed: number;
    failed: number;
    oldestWaitMs: number;
    paused: boolean;
    workerConcurrency: number;
    measuredAt: string;
  };
  failover?: {
    enabled: boolean;
    intervalMinutes: number;
    active: boolean;
    status: 'unknown' | 'healthy' | 'groq_failover' | 'disabled';
    checkedAt?: string | null;
    failedAt?: string | null;
    recoveredAt?: string | null;
    reason?: string | null;
  };
  error?: string;
}

interface LocalQueueStatus {
  queue: string;
  concurrency: number;
  sampledAt: string;
  available: boolean;
  counts: Record<string, number>;
  oldestQueuedAt: string | null;
  oldestWaitMs: number;
  paused: boolean;
  error?: string;
  worker: {
    running: boolean;
    concurrency: number;
    active: number;
    availableSlots: number;
    utilizationPercent: number;
  };
  durable: {
    queued: number;
    waitingForRuntime: number;
    processing: number;
    completed: number;
    failed: number;
    retrying: number;
  };
  rates: {
    completedLast5Minutes: number;
    completedLastHour: number;
    failedLastHour: number;
    averageProcessingMs: number;
    p95ProcessingMs: number;
  };
  recentJobs: Array<{
    jobId: string;
    source: 'private' | 'public' | 'bulk' | 'ai-interview';
    state: 'queued' | 'waiting_for_local_runtime' | 'processing' | 'completed' | 'failed';
    progress: number;
    attempts: number;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
    failedAt: string | null;
    updatedAt: string;
    waitMs: number | null;
    processingMs: number | null;
    errorCode: string | null;
    organization: { id: string; name: string };
    uploader: { id: string; name: string; email: string; type: 'member' | 'public' };
    application: { id: string; title: string } | null;
    candidate: { id: string; name: string; email: string } | null;
    file: { name: string; type: string; size: number };
  }>;
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
  routingHealth: {
    valid: boolean;
    configured: number;
    expected: number;
    enabled: number;
    issues: Array<{ activity: string; code: string; message: string }>;
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
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
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

interface LiveMetric {
  calls: number;
  successes: number;
  failures: number;
  successRate: number;
  tokens: number;
  estimatedCostUsd: number;
  averageLatencyMs: number;
  maxLatencyMs: number;
  failovers: number;
}

interface LiveOperations {
  sampledAt: string;
  windowMinutes: number;
  totals: { fiveMinutes: LiveMetric; hour: LiveMetric };
  providers: Array<LiveMetric & { id: string; lastRequestAt?: string }>;
  activities: Array<LiveMetric & { id: string; lastRequestAt?: string }>;
  timeline: Array<{ minute: string; calls: number; failures: number }>;
  recent: UsageRequest[];
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
    structuredOutput?: boolean;
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
  errorMessage?: string;
  attemptErrors?: Array<{ code?: string; message?: string; providerStatus?: number; credentialLabel?: string }>;
}

interface RequestSummary {
  calls: number;
  successes: number;
  failures: number;
  successRate: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  averageLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  failovers: number;
  detailWindow?: string;
}

interface AuditEvent {
  _id: string;
  createdAt: string;
  category: string;
  action: string;
  status: string;
  message: string;
  actorEmail?: string;
  targetType?: string;
  targetId?: string;
  model?: string;
  quotaGroup?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

interface DetailSelection {
  kind: DetailKind;
  id: string;
  title: string;
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

function formatTime(value?: string) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(date);
}

function formatDuration(value?: number | null) {
  if (value == null) return '—';
  if (value < 1_000) return value > 0 ? '<1 sec' : '0 sec';
  const seconds = Math.round(value / 1_000);
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatFileSize(value?: number | null) {
  const bytes = Number(value || 0);
  if (!bytes) return '0 B';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function queueStateClass(state: string) {
  if (state === 'completed') return 'text-green-300';
  if (state === 'failed') return 'text-red-300';
  if (state === 'waiting_for_local_runtime') return 'text-amber-300';
  if (state === 'processing') return 'text-gray-100';
  return 'text-gray-300';
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
  const healthy = ['healthy', 'success', 'sent', 'live'].includes(status);
  const warning = ['unknown', 'degraded', 'suppressed', 'paused', 'connecting', 'reconnecting'].includes(status);
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
  const [liveOperations, setLiveOperations] = useState<LiveOperations | null>(null);
  const [liveConnection, setLiveConnection] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');
  const [liveError, setLiveError] = useState('');
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [localRuntime, setLocalRuntime] = useState<LocalRuntimeStatus | null>(null);
  const [localQueue, setLocalQueue] = useState<LocalQueueStatus | null>(null);
  const [queueConnection, setQueueConnection] = useState<'idle' | 'connecting' | 'live' | 'reconnecting'>('idle');
  const [queueStreamError, setQueueStreamError] = useState('');
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [requests, setRequests] = useState<UsageRequest[]>([]);
  const [requestSummary, setRequestSummary] = useState<RequestSummary | null>(null);
  const [audits, setAudits] = useState<AuditEvent[]>([]);
  const [requestPage, setRequestPage] = useState(1);
  const [requestPages, setRequestPages] = useState(1);
  const [auditPage, setAuditPage] = useState(1);
  const [auditPages, setAuditPages] = useState(1);
  const [requestStatus, setRequestStatus] = useState('all');
  const [requestProvider, setRequestProvider] = useState('all');
  const [requestSearch, setRequestSearch] = useState('');
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
  const [detailSelection, setDetailSelection] = useState<DetailSelection | null>(null);
  const [detailData, setDetailData] = useState<Record<string, unknown> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

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

  const loadLiveOperations = useCallback(async () => {
    setLiveOperations(await adminJson<LiveOperations>('/api/admin/ai-runtime/live'));
  }, []);

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

  const loadLocalGateway = useCallback(async () => {
    const runtime = await adminJson<LocalRuntimeStatus>('/api/admin/ai-runtime/local/status');
    setLocalRuntime(runtime);
  }, []);

  const loadLocalQueue = useCallback(async () => {
    const queueStatus = await adminJson<LocalQueueStatus>('/api/admin/ai-runtime/local/queue');
    setLocalQueue(queueStatus);
  }, []);

  const loadLocalRuntime = useCallback(async () => {
    await Promise.all([loadLocalGateway(), loadLocalQueue()]);
  }, [loadLocalGateway, loadLocalQueue]);

  const loadRequests = useCallback(async () => {
    const params = new URLSearchParams({ range, page: String(requestPage), limit: '25' });
    if (requestStatus !== 'all') params.set('status', requestStatus);
    if (requestProvider !== 'all') params.set('provider', requestProvider);
    if (requestSearch.trim()) params.set('search', requestSearch.trim());
    if (organizationFilter) params.set('organizationId', organizationFilter);
    if (actorFilter) params.set('actorId', actorFilter);
    const data = await adminJson<{ items: UsageRequest[]; summary: RequestSummary; pagination: { pages: number } }>(`/api/admin/ai-runtime/requests?${params}`);
    setRequests(data.items);
    setRequestSummary(data.summary);
    setRequestPages(Math.max(1, data.pagination.pages));
  }, [actorFilter, organizationFilter, range, requestPage, requestProvider, requestSearch, requestStatus]);

  const loadAudits = useCallback(async () => {
    const data = await adminJson<{ items: AuditEvent[]; pagination: { pages: number } }>(`/api/admin/ai-runtime/audit?page=${auditPage}&limit=25`);
    setAudits(data.items);
    setAuditPages(Math.max(1, data.pagination.pages));
  }, [auditPage]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadOverview(), loadLiveOperations(), loadSettings(), loadAudits(), loadLocalRuntime()]);
      if (tab === 'requests') await loadRequests();
    } catch (error) {
      toast({ title: 'Unable to load AI runtime', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [loadAudits, loadLiveOperations, loadLocalRuntime, loadOverview, loadRequests, loadSettings, tab, toast]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    let stopped = false;
    let reconnectTimer: number | undefined;
    let activeController: AbortController | null = null;
    const connect = async () => {
      if (stopped) return;
      setLiveConnection((current) => current === 'live' ? 'reconnecting' : 'connecting');
      activeController = new AbortController();
      try {
        const token = localStorage.getItem('adminToken') || '';
        const response = await apiRequest('/api/admin/ai-runtime/live/stream', {
          headers: { Accept: 'text/event-stream', 'x-admin-auth-token': token },
          signal: activeController.signal
        });
        if (!response.ok || !response.body) throw new Error(`Live operations stream returned HTTP ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        setLiveConnection('live');
        setLiveError('');
        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) throw new Error('Live operations stream ended');
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseServerSentEventBuffer(buffer);
          buffer = parsed.remainder;
          for (const frame of parsed.frames) {
            if (frame.event === 'snapshot') {
              setLiveOperations(JSON.parse(frame.data) as LiveOperations);
              setLiveConnection('live');
              setLiveError('');
            } else if (frame.event === 'telemetry-error') {
              setLiveError(JSON.parse(frame.data)?.message || 'Live AI telemetry is temporarily unavailable');
            }
          }
        }
      } catch (error) {
        if (stopped || (error instanceof DOMException && error.name === 'AbortError')) return;
        setLiveConnection('reconnecting');
        setLiveError(error instanceof Error ? error.message : 'Live operations connection failed');
        reconnectTimer = window.setTimeout(() => void connect(), 3_000);
      }
    };
    void connect();
    return () => {
      stopped = true;
      activeController?.abort();
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
    };
  }, []);
  useEffect(() => {
    if (tab !== 'requests') return;
    const timer = window.setTimeout(() => {
      loadRequests().catch((error) => toast({ title: 'Unable to load requests', description: error.message, variant: 'destructive' }));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [loadRequests, tab, toast]);
  useEffect(() => {
    if (tab !== 'local') return;
    const timer = window.setInterval(() => {
      loadLocalGateway().catch(() => {});
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [loadLocalGateway, tab]);
  useEffect(() => {
    if (tab !== 'local') {
      setQueueConnection('idle');
      return;
    }
    let stopped = false;
    let reconnectTimer: number | undefined;
    let activeController: AbortController | null = null;

    const connect = async () => {
      if (stopped) return;
      setQueueConnection((current) => current === 'live' ? 'reconnecting' : 'connecting');
      activeController = new AbortController();
      try {
        const token = localStorage.getItem('adminToken') || '';
        const response = await apiRequest('/api/admin/ai-runtime/local/queue/stream', {
          headers: {
            Accept: 'text/event-stream',
            'x-admin-auth-token': token
          },
          signal: activeController.signal
        });
        if (!response.ok || !response.body) throw new Error(`Live queue stream returned HTTP ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        setQueueConnection('live');
        setQueueStreamError('');

        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) throw new Error('Live queue stream ended');
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseServerSentEventBuffer(buffer);
          buffer = parsed.remainder;
          for (const frame of parsed.frames) {
            if (frame.event === 'snapshot') {
              setLocalQueue(JSON.parse(frame.data) as LocalQueueStatus);
              setQueueConnection('live');
              setQueueStreamError('');
            } else if (frame.event === 'telemetry-error') {
              const message = JSON.parse(frame.data)?.message;
              setQueueStreamError(message || 'Queue telemetry is temporarily unavailable');
            }
          }
        }
      } catch (error) {
        if (stopped || (error instanceof DOMException && error.name === 'AbortError')) return;
        setQueueConnection('reconnecting');
        setQueueStreamError(error instanceof Error ? error.message : 'Live queue connection failed');
        reconnectTimer = window.setTimeout(() => void connect(), 3_000);
      }
    };

    void connect();
    return () => {
      stopped = true;
      activeController?.abort();
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
    };
  }, [tab]);
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
      routes: current.routes.map((route) => {
        if (route.activity !== activity) return route;
        const selectedProvider = patch.model
          ? current.models.find((model) => model.id === patch.model)?.provider
          : undefined;
        return { ...route, ...patch, ...(selectedProvider ? { provider: selectedProvider } : {}) };
      })
    } : current);
  }

  async function setLocalQueuePaused(paused: boolean) {
    setBusy('local-queue');
    try {
      await adminJson(`/api/admin/ai-runtime/local/queue/${paused ? 'pause' : 'resume'}`, {
        method: 'POST',
        body: '{}'
      });
      await loadLocalRuntime();
      toast({ title: paused ? 'CV queue paused' : 'CV queue resumed' });
    } catch (error) {
      toast({
        title: 'Queue control failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      setBusy('');
    }
  }

  async function runLocalHealthCheck() {
    setBusy('local-health');
    try {
      await adminJson('/api/admin/ai-runtime/local/health-check', { method: 'POST', body: '{}' });
      await Promise.all([loadLocalRuntime(), loadSettings()]);
      toast({ title: 'Local AI health checked', description: 'Effective routing now reflects the latest local runtime state.' });
    } catch (error) {
      toast({
        title: 'Health check failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      setBusy('');
    }
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

  async function openOperationalDetail(kind: DetailKind, id: string, title: string) {
    setDetailSelection({ kind, id, title });
    setDetailData(null);
    setDetailLoading(true);
    const path = kind === 'request'
      ? `/api/admin/ai-runtime/requests/${encodeURIComponent(id)}`
      : kind === 'queue'
        ? `/api/admin/ai-runtime/local/queue/jobs/${encodeURIComponent(id)}`
        : `/api/admin/ai-runtime/audit/${encodeURIComponent(id)}`;
    try {
      setDetailData(await adminJson<Record<string, unknown>>(path));
    } catch (error) {
      toast({
        title: 'Unable to load audit detail',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
      setDetailSelection(null);
    } finally {
      setDetailLoading(false);
    }
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
                <p className="mt-1 text-sm text-gray-400">Groq for general AI; signed managed local or local-cloud routing and a durable queue for CV extraction.</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={liveConnection} />
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
                  <TabsTrigger value="local" className="h-11 rounded-none border-b-2 border-transparent bg-transparent text-gray-400 data-[state=active]:border-blue-500 data-[state=active]:bg-transparent data-[state=active]:text-white">Local AI</TabsTrigger>
                  {canConfigure && <TabsTrigger value="test" className="h-11 rounded-none border-b-2 border-transparent bg-transparent text-gray-400 data-[state=active]:border-blue-500 data-[state=active]:bg-transparent data-[state=active]:text-white">Test</TabsTrigger>}
                  {canConfigure && <TabsTrigger value="routing" className="h-11 rounded-none border-b-2 border-transparent bg-transparent text-gray-400 data-[state=active]:border-blue-500 data-[state=active]:bg-transparent data-[state=active]:text-white">Routing</TabsTrigger>}
                  {canConfigure && <TabsTrigger value="credentials" className="h-11 rounded-none border-b-2 border-transparent bg-transparent text-gray-400 data-[state=active]:border-blue-500 data-[state=active]:bg-transparent data-[state=active]:text-white">Credentials</TabsTrigger>}
                  <TabsTrigger value="requests" className="h-11 rounded-none border-b-2 border-transparent bg-transparent text-gray-400 data-[state=active]:border-blue-500 data-[state=active]:bg-transparent data-[state=active]:text-white">Activity audit</TabsTrigger>
                  <TabsTrigger value="alerts" className="h-11 rounded-none border-b-2 border-transparent bg-transparent text-gray-400 data-[state=active]:border-blue-500 data-[state=active]:bg-transparent data-[state=active]:text-white">Alerts</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="overview" className="mt-5 space-y-5">
                {loading && !overview ? <div className="flex h-48 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-blue-400" /></div> : (
                  <>
                    <LiveOperationsPanel
                      data={liveOperations}
                      connection={liveConnection}
                      error={liveError}
                      definitions={definitions}
                      onInspect={(request) => void openOperationalDetail('request', request._id, `AI request ${request.requestId}`)}
                    />
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

              <TabsContent value="local" className="mt-5 space-y-5">
                <section className="overflow-hidden rounded-md border border-gray-800 bg-gray-900">
                  <div className="flex flex-col gap-3 border-b border-gray-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-sm font-semibold text-white">Managed local runtime</h2>
                      <p className="mt-1 text-xs text-gray-500">CV parsing and question generation use the best available managed runtime. Other activities remain on Groq until changed in Routing.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={localRuntime?.reachable && localRuntime?.health?.ok !== false && localRuntime?.cvLocalEligible !== false ? 'healthy' : 'unavailable'} />
                      {canConfigure && <Button variant="outline" size="sm" disabled={busy === 'local-health'} onClick={runLocalHealthCheck} className="border-gray-700">Check and route now</Button>}
                      <Button variant="outline" size="sm" onClick={loadLocalRuntime} className="border-gray-700">
                        <RefreshCw className="mr-2 h-4 w-4" />Refresh
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-px bg-gray-800 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                       ['Active engine', localRuntime?.engine === 'codex' ? 'Codex CLI (local-cloud)' : localRuntime?.engine === 'vllm' ? 'vLLM (local GPU)' : 'Ollama (local GPU)'],
                       ['Active model', localRuntime?.model || 'Not reported'],
                       ['Local routing', localRuntime?.cvLocalEligible === false ? 'Blocked — local engine required' : 'Available to all activities'],
                       ['Automatic failover', localRuntime?.failover?.active ? 'Groq active' : 'Local primary'],
                       ['Health schedule', `Every ${localRuntime?.failover?.intervalMinutes || 30} minutes`],
                       ['Last health check', localRuntime?.failover?.checkedAt ? formatDate(localRuntime.failover.checkedAt) : 'Not checked'],
                       ['Gateway', localRuntime?.reachable ? 'Reachable through tunnel' : 'Unavailable'],
                      ['Engine health', localRuntime?.health?.ok === false ? 'Offline' : localRuntime?.reachable ? 'Online' : 'Unknown'],
                      ['Ingress', localRuntime?.state?.ingressEnabled ? 'Enabled' : 'Disabled'],
                      ['Active inference', String(localRuntime?.active ?? 0)],
                      ['Gateway waiting', String(localRuntime?.waiting ?? 0)],
                      ['Concurrency', String(localRuntime?.state?.concurrency ?? localQueue?.concurrency ?? 1)],
                      ['Average latency', `${formatNumber(localRuntime?.averageLatencyMs)} ms`]
                    ].map(([label, value]) => (
                      <div key={label} className="bg-gray-900 px-4 py-4">
                        <div className="text-xs text-gray-500">{label}</div>
                        <div className="mt-1 text-sm font-medium text-gray-100">{value}</div>
                      </div>
                    ))}
                   </div>
                   {localRuntime?.reachable && localRuntime?.cvLocalEligible === false && (
                     <div className="border-t border-amber-900 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
                       Local dispatch is blocked because no verified managed local or local-cloud engine is selected. CV uploads will remain queued.
                     </div>
                   )}
                   {localRuntime?.failover?.active && (
                     <div className="border-t border-amber-900 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
                       Local-primary routes are temporarily executing on Groq because the local runtime failed its health check. CV work will return to local inference automatically after a healthy check.
                     </div>
                   )}
                   {localRuntime?.error && <div className="border-t border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-200">{localRuntime.error}</div>}
                </section>

                <section className="overflow-hidden rounded-md border border-gray-800 bg-gray-900">
                  <div className="border-b border-gray-800 px-4 py-3">
                    <h2 className="text-sm font-semibold text-white">Local engines and models</h2>
                    <p className="mt-1 text-xs text-gray-500">The selected Control Center profile serves every route assigned to Managed local / local-cloud.</p>
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow className="border-gray-800"><TableHead>Engine</TableHead><TableHead>Model</TableHead><TableHead>Routing state</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {(localRuntime?.engines || []).map((engine) => (
                          <TableRow key={engine.id} className="border-gray-800">
                            <TableCell>{engine.label}</TableCell>
                            <TableCell className="font-mono text-xs">{engine.model}</TableCell>
                            <TableCell className={engine.selected ? 'text-green-300' : 'text-gray-500'}>{engine.selected ? 'Selected' : 'Available in Control Center'}</TableCell>
                          </TableRow>
                        ))}
                        {!localRuntime?.engines?.length && <TableRow><TableCell colSpan={3} className="h-20 text-center text-gray-500">Engine inventory is unavailable.</TableCell></TableRow>}
                      </TableBody>
                    </Table>
                  </div>
                </section>

                <section className="overflow-hidden rounded-md border border-gray-800 bg-gray-900">
                  <div className="flex flex-col gap-3 border-b border-gray-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-semibold text-white">Durable CV queue</h2>
                        <StatusBadge status={!localQueue?.available ? 'unavailable' : localQueue?.paused ? 'paused' : 'healthy'} />
                      </div>
                      <p className="mt-1 text-xs text-gray-500">Uploads remain stored while the runtime is offline. BullMQ dispatch and durable Mongo state are shown separately.</p>
                      <div aria-live="polite" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span className={queueConnection === 'live' ? 'flex items-center gap-1.5 text-green-300' : 'flex items-center gap-1.5 text-amber-300'}>
                          <Activity className="h-3.5 w-3.5" />
                          {queueConnection === 'live' ? 'Live updates' : queueConnection === 'reconnecting' ? 'Reconnecting' : 'Connecting'}
                        </span>
                        <span className="text-gray-500">Every 2 seconds</span>
                        <span className="text-gray-500">Updated {formatTime(localQueue?.sampledAt)}</span>
                        {queueStreamError && <span className="text-amber-300">{queueStreamError}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={loadLocalQueue} className="border-gray-700">
                        <RefreshCw className="mr-2 h-4 w-4" />Refresh
                      </Button>
                      {canConfigure && (
                        <Button variant="outline" size="sm" disabled={busy === 'local-queue'} onClick={() => setLocalQueuePaused(!localQueue?.paused)} className="border-gray-700">
                          {localQueue?.paused ? <Play className="mr-2 h-4 w-4" /> : <ShieldAlert className="mr-2 h-4 w-4" />}
                          {localQueue?.paused ? 'Resume queue' : 'Pause queue'}
                        </Button>
                      )}
                    </div>
                  </div>
                  <dl className="grid gap-px border-b border-gray-800 bg-gray-800 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      ['Dispatch', localQueue?.paused ? 'Paused' : localQueue?.available ? 'Accepting work' : 'Redis unavailable'],
                      ['Worker', localQueue?.worker?.running ? 'Running' : 'Starting'],
                      ['Capacity', `${formatNumber(localQueue?.worker?.active)} / ${formatNumber(localQueue?.worker?.concurrency ?? localQueue?.concurrency)} active`],
                      ['Available slots', formatNumber(localQueue?.worker?.availableSlots)],
                      ['Oldest wait', formatDuration(localQueue?.oldestWaitMs)],
                      ['Completed · 5 min', formatNumber(localQueue?.rates?.completedLast5Minutes)],
                      ['Completed · 1 hour', formatNumber(localQueue?.rates?.completedLastHour)],
                      ['Failed · 1 hour', formatNumber(localQueue?.rates?.failedLastHour)],
                      ['Average processing', formatDuration(localQueue?.rates?.averageProcessingMs)],
                      ['P95 processing', formatDuration(localQueue?.rates?.p95ProcessingMs)],
                      ['Worker utilisation', `${formatNumber(localQueue?.worker?.utilizationPercent)}%`],
                      ['Queue name', localQueue?.queue || 'Not reported']
                    ].map(([label, value]) => (
                      <div key={label} className="bg-gray-900 px-4 py-3">
                        <dt className="text-xs text-gray-500">{label}</dt>
                        <dd className="mt-1 text-sm font-medium text-gray-100">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="border-b border-gray-800">
                    <div className="px-4 py-3">
                      <h3 className="text-sm font-medium text-white">Queue state</h3>
                      <p className="mt-1 text-xs text-gray-500">BullMQ counts are dispatch records; durable counts are the 30-day processing ledger.</p>
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-gray-800">
                            <TableHead>State</TableHead>
                            <TableHead>BullMQ</TableHead>
                            <TableHead>Durable</TableHead>
                            <TableHead>Meaning</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {[
                            ['Waiting', localQueue?.counts?.waitingTotal, localQueue?.durable?.queued, 'Ready for dispatch'],
                            ['Waiting for runtime', localQueue?.counts?.delayed, localQueue?.durable?.waitingForRuntime, 'Held during local outages'],
                            ['Processing', localQueue?.counts?.active, localQueue?.durable?.processing, 'Currently executing'],
                            ['Completed', localQueue?.counts?.completed, localQueue?.durable?.completed, 'Retained successful jobs'],
                            ['Failed', localQueue?.counts?.failed, localQueue?.durable?.failed, 'Terminal failures'],
                            ['Retrying', undefined, localQueue?.durable?.retrying, 'Non-terminal jobs after another attempt']
                          ].map(([label, bullCount, durableCount, meaning]) => (
                            <TableRow key={String(label)} className="border-gray-800">
                              <TableCell className="font-medium text-gray-200">{label}</TableCell>
                              <TableCell>{bullCount == null ? '—' : formatNumber(Number(bullCount))}</TableCell>
                              <TableCell>{formatNumber(Number(durableCount || 0))}</TableCell>
                              <TableCell className="text-gray-500">{meaning}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                  <div className="px-4 py-3">
                    <h3 className="text-sm font-medium text-white">Recent jobs</h3>
                    <p className="mt-1 text-xs text-gray-500">Admin-only attribution for operational investigation. Select a row to inspect the complete processing audit.</p>
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-gray-800">
                          <TableHead>Job</TableHead>
                          <TableHead>Organization / uploader</TableHead>
                          <TableHead>CV</TableHead>
                          <TableHead>Source</TableHead>
                          <TableHead>State</TableHead>
                          <TableHead>Progress</TableHead>
                          <TableHead>Attempts</TableHead>
                          <TableHead>Queue wait</TableHead>
                          <TableHead>Processing</TableHead>
                          <TableHead>Updated</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(localQueue?.recentJobs || []).map((job) => (
                          <TableRow
                            key={job.jobId}
                            className="cursor-pointer border-gray-800 hover:bg-gray-800/70"
                            onClick={() => void openOperationalDetail('queue', job.jobId, `CV queue job ${job.jobId}`)}
                          >
                            <TableCell className="font-mono text-xs text-gray-300" title={job.jobId}>{job.jobId.slice(0, 15)}</TableCell>
                            <TableCell>
                              <div className="font-medium text-gray-200">{job.organization?.name || 'Unknown organization'}</div>
                              <div className="text-xs text-gray-500">{job.uploader?.name || 'Unknown uploader'}{job.uploader?.email ? ` · ${job.uploader.email}` : ''}</div>
                            </TableCell>
                            <TableCell>
                              <div className="max-w-56 truncate text-sm text-gray-300" title={job.file?.name}>{job.file?.name || 'Not reported'}</div>
                              <div className="text-xs text-gray-500">{job.application?.title || job.candidate?.name || 'No job linked'}</div>
                            </TableCell>
                            <TableCell>{job.source.replace('-', ' ')}</TableCell>
                            <TableCell>
                              <div className={`font-medium ${queueStateClass(job.state)}`}>{job.state.replace(/_/g, ' ')}</div>
                              {job.errorCode && <div className="mt-1 font-mono text-xs text-red-300">{job.errorCode}</div>}
                            </TableCell>
                            <TableCell>{formatNumber(job.progress)}%</TableCell>
                            <TableCell>{formatNumber(job.attempts)}</TableCell>
                            <TableCell>{formatDuration(job.waitMs)}</TableCell>
                            <TableCell>{formatDuration(job.processingMs)}</TableCell>
                            <TableCell>{formatTime(job.updatedAt)}</TableCell>
                          </TableRow>
                        ))}
                        {!localQueue?.recentJobs?.length && (
                          <TableRow>
                            <TableCell colSpan={10} className="h-20 text-center text-gray-500">No CV processing jobs have been recorded.</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </section>
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
                    <RuntimeTestDatum label="Output contract" value={testResult.execution.structuredOutput ? 'Strict JSON Schema' : 'Text'} />
                  </dl>
                  <div className="border-t border-gray-800 bg-gray-950/40 px-5 py-3"><span className="text-xs text-gray-500">Request ID </span><span className="break-all font-mono text-xs text-gray-300">{testResult.execution.requestId}</span></div>
                </section>}
              </TabsContent>

              <TabsContent value="routing" className="mt-5">
                <section className="overflow-hidden rounded-md border border-gray-800 bg-gray-900">
                  <div className="flex flex-col gap-3 border-b border-gray-800 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                    <div><div className="flex items-center gap-2"><h2 className="text-sm font-semibold text-white">Activity routing</h2>{settings?.routingHealth && <StatusBadge status={settings.routingHealth.valid ? 'healthy' : 'failed'} />}</div><p className="mt-1 text-xs text-gray-500">{settings?.routingHealth ? `${settings.routingHealth.configured} of ${settings.routingHealth.expected} activities configured; ${settings.routingHealth.enabled} enabled.` : 'Checking route coverage.'}</p></div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={String(settings?.rollout.groqPercent || 100)} onValueChange={(value) => setSettings((current) => current ? { ...current, rollout: { ...current.rollout, groqPercent: Number(value) as 10 | 50 | 100 } } : current)}>
                        <SelectTrigger className="w-44 border-gray-700 bg-gray-950"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="10">Groq canary 10%</SelectItem><SelectItem value="50">Groq canary 50%</SelectItem><SelectItem value="100">Groq only 100%</SelectItem></SelectContent>
                      </Select>
                      <Button size="sm" onClick={saveRollout} disabled={busy === 'rollout'}><Save className="mr-2 h-4 w-4" />Save rollout</Button>
                      <Button variant="outline" size="sm" onClick={syncModels} disabled={busy === 'model-sync'} className="border-gray-700 bg-gray-950"><RefreshCw className={`mr-2 h-4 w-4 ${busy === 'model-sync' ? 'animate-spin' : ''}`} />Sync models</Button>
                    </div>
                  </div>
                  {settings?.routingHealth && !settings.routingHealth.valid && <div role="alert" className="border-b border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{settings.routingHealth.issues.map((issue) => <p key={`${issue.activity}:${issue.code}`}><span className="font-mono">{issue.activity}</span>: {issue.message}</p>)}</div>}
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow className="border-gray-800"><TableHead>Activity</TableHead><TableHead>Provider</TableHead><TableHead>Model</TableHead><TableHead>Reasoning</TableHead><TableHead>Enabled</TableHead><TableHead className="text-right">Save</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {(settings?.routes || []).map((route) => (
                          <TableRow key={route.activity} className="border-gray-800">
                            <TableCell><div className="font-medium text-gray-200">{definitions.get(route.activity)?.label || route.activity}</div><div className="text-xs text-gray-500">{definitions.get(route.activity)?.group} / v{route.routeVersion}{definitions.get(route.activity)?.lockedProvider ? ' / local provider locked' : ''}</div></TableCell>
                            <TableCell className={route.provider === 'groq' ? 'text-gray-300' : 'text-green-300'}>{route.provider === 'groq' ? 'Groq' : 'Managed local'}</TableCell>
                            <TableCell><Select disabled={definitions.get(route.activity)?.lockedProvider} value={route.model} onValueChange={(model) => editRoute(route.activity, { model })}><SelectTrigger className="w-56 border-gray-700 bg-gray-950"><SelectValue /></SelectTrigger><SelectContent>{settings?.models.filter((model) => model.enabled && model.available !== false && (!definitions.get(route.activity)?.lockedProvider || model.provider === route.provider)).map((model) => <SelectItem key={model.id} value={model.id}>{model.label}</SelectItem>)}</SelectContent></Select></TableCell>
                            <TableCell><Select value={route.reasoningEffort} onValueChange={(reasoningEffort) => editRoute(route.activity, { reasoningEffort: reasoningEffort as ActivityRoute['reasoningEffort'] })}><SelectTrigger className="w-28 border-gray-700 bg-gray-950"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem></SelectContent></Select></TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Switch aria-label={`${definitions.get(route.activity)?.label || route.activity} route`} checked={route.enabled} onCheckedChange={(enabled) => editRoute(route.activity, { enabled })} />
                                <span className={route.enabled ? 'text-xs text-green-300' : 'text-xs text-gray-500'}>{route.enabled ? 'Enabled' : 'Off'}</span>
                              </div>
                            </TableCell>
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
                  <div className="flex flex-wrap gap-2">
                    <Input
                      value={requestSearch}
                      onChange={(event) => { setRequestSearch(event.target.value); setRequestPage(1); }}
                      placeholder="Search person, company, activity or request"
                      aria-label="Search AI activity audit"
                      className="w-full border-gray-700 bg-gray-900 sm:w-72"
                    />
                    <Select value={requestProvider} onValueChange={(value) => { setRequestProvider(value); setRequestPage(1); }}>
                      <SelectTrigger className="w-40 border-gray-700 bg-gray-900"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="all">All providers</SelectItem><SelectItem value="groq">Groq</SelectItem><SelectItem value="local-ollama">Managed local</SelectItem><SelectItem value="azure-openai">Azure</SelectItem></SelectContent>
                    </Select>
                    <Select value={requestStatus} onValueChange={(value) => { setRequestStatus(value); setRequestPage(1); }}>
                      <SelectTrigger className="w-36 border-gray-700 bg-gray-900"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="success">Success</SelectItem><SelectItem value="failed">Failed</SelectItem></SelectContent>
                    </Select>
                    {organizationFilter && <Button variant="outline" onClick={() => setOrganizationFilter('')} className="border-gray-700">Clear organization</Button>}
                    {actorFilter && <Button variant="outline" onClick={() => setActorFilter('')} className="border-gray-700">Clear person</Button>}
                  </div>
                  <span className="text-xs text-gray-500">Detailed events are retained for 90 days.</span>
                </div>
                <section className="overflow-hidden rounded-md border border-gray-800 bg-gray-900">
                  <div className="border-b border-gray-800 px-4 py-3"><h2 className="text-sm font-semibold text-white">Overall AI totals</h2><p className="mt-1 text-xs text-gray-500">Complete totals for the selected date range. All time is calculated from permanent daily rollups.</p></div>
                  <RequestTotals totals={stats} />
                </section>
                  <section className="overflow-hidden rounded-md border border-gray-800 bg-gray-900">
                    <div className="border-b border-gray-800 px-4 py-3"><h2 className="text-sm font-semibold text-white">Filtered request totals</h2><p className="mt-1 text-xs text-gray-500">{requestSummary?.detailWindow === 'retained-90d' ? 'Filtered request details cover the retained 90-day window; the overall totals above remain all-time.' : 'Totals for the status, organization, and person filters applied below.'}</p></div>
                  <RequestTotals totals={requestSummary} includeFailovers />
                </section>
                <section className="overflow-hidden rounded-md border border-gray-800 bg-gray-900"><div className="overflow-x-auto"><Table>
                  <TableHeader><TableRow className="border-gray-800"><TableHead>Time</TableHead><TableHead>Activity</TableHead><TableHead>Application</TableHead><TableHead>Organization / person</TableHead><TableHead>Model</TableHead><TableHead>Tokens</TableHead><TableHead>Est. cost</TableHead><TableHead>Attempts</TableHead><TableHead>Latency</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>{requests.map((request) => <TableRow key={request._id} className="cursor-pointer border-gray-800 hover:bg-gray-800/70" onClick={() => void openOperationalDetail('request', request._id, `AI request ${request.requestId}`)}><TableCell className="whitespace-nowrap text-gray-400">{formatDate(request.createdAt)}</TableCell><TableCell><div>{definitions.get(request.activity)?.label || request.activity}</div><div className="font-mono text-xs text-gray-500">{request.requestId.slice(0, 12)}</div></TableCell><TableCell>{request.sourceApp}</TableCell><TableCell><div>{request.organizationName || 'Unresolved organization'}</div><div className="text-xs text-gray-500">{request.actorName || request.actorEmail || 'System'}</div></TableCell><TableCell><div className="text-xs text-gray-500">{request.provider}</div><div className="font-mono text-xs">{request.model}</div></TableCell><TableCell>{formatNumber(request.totalTokens)}</TableCell><TableCell>${formatNumber(request.estimatedCostUsd, 6)}</TableCell><TableCell>{request.failovers + 1}</TableCell><TableCell>{formatNumber(request.latencyMs)} ms</TableCell><TableCell><StatusBadge status={request.status} />{request.errorCode && <div className="mt-1 text-xs text-red-400">{request.errorCode}</div>}{request.errorMessage && <details className="mt-2 max-w-72 text-xs text-gray-400"><summary className="cursor-pointer text-gray-300">Error details</summary><p className="mt-1 whitespace-normal break-words">{request.errorMessage}</p>{request.attemptErrors?.map((attempt, index) => <p key={index} className="mt-1 break-words font-mono text-[11px]">{attempt.code || 'provider_error'}{attempt.providerStatus ? ` (${attempt.providerStatus})` : ''}: {attempt.message || 'No provider message'}</p>)}</details>}</TableCell></TableRow>)}</TableBody>
                </Table></div>{!requests.length && <div className="py-16 text-center text-sm text-gray-500">No requests match these filters.</div>}</section>
                <div className="flex items-center justify-end gap-2"><Button variant="outline" size="icon" disabled={requestPage <= 1} onClick={() => setRequestPage((page) => page - 1)} className="border-gray-700"><ChevronLeft className="h-4 w-4" /></Button><span className="min-w-24 text-center text-sm text-gray-400">{requestPage} of {requestPages}</span><Button variant="outline" size="icon" disabled={requestPage >= requestPages} onClick={() => setRequestPage((page) => page + 1)} className="border-gray-700"><ChevronRight className="h-4 w-4" /></Button></div>
              </TabsContent>

              <TabsContent value="alerts" className="mt-5 grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
                {canConfigure ? <form onSubmit={saveAlerts} className="h-fit rounded-md border border-gray-800 bg-gray-900 p-5">
                  <div className="mb-5 flex items-start justify-between gap-4"><div><h2 className="text-sm font-semibold text-white">Notifications</h2><p className="mt-1 text-xs text-gray-500">Daily quota, monthly estimate, credential health, and recovery emails.</p></div><Switch checked={alertForm.enabled} onCheckedChange={(enabled) => setAlertForm((form) => ({ ...form, enabled }))} /></div>
                  <div className="space-y-4"><div className="space-y-2"><Label htmlFor="alert-recipients">Additional recipients</Label><Input id="alert-recipients" value={alertForm.recipients} onChange={(event) => setAlertForm((form) => ({ ...form, recipients: event.target.value }))} placeholder="ops@example.com, finance@example.com" className="border-gray-700 bg-gray-950" /><p className="text-xs text-gray-500">Active super admins are always included.</p></div><div className="space-y-2"><Label htmlFor="monthly-budget">Monthly estimated budget (USD)</Label><Input id="monthly-budget" type="number" min="0" step="0.01" value={alertForm.monthlyBudgetUsd} onChange={(event) => setAlertForm((form) => ({ ...form, monthlyBudgetUsd: event.target.value }))} placeholder="No budget limit" className="border-gray-700 bg-gray-950" /></div><Button type="submit" disabled={busy === 'alerts'} className="w-full"><Save className="mr-2 h-4 w-4" />Save alert settings</Button></div>
                </form> : <div className="h-fit rounded-md border border-gray-800 bg-gray-900 p-5"><ShieldAlert className="h-5 w-5 text-amber-400" /><p className="mt-3 text-sm text-gray-300">System settings permission is required to change alert rules.</p></div>}
                <section className="overflow-hidden rounded-md border border-gray-800 bg-gray-900"><div className="border-b border-gray-800 px-4 py-3"><h2 className="text-sm font-semibold text-white">Alert and configuration audit</h2><p className="mt-1 text-xs text-gray-500">Select any record to inspect its actor, target, status and redacted metadata.</p></div><div className="overflow-x-auto"><Table><TableHeader><TableRow className="border-gray-800"><TableHead>Time</TableHead><TableHead>Category</TableHead><TableHead>Event</TableHead><TableHead>Target</TableHead><TableHead>Status</TableHead><TableHead>Admin</TableHead></TableRow></TableHeader><TableBody>{audits.map((event) => <TableRow key={event._id} className="cursor-pointer border-gray-800 hover:bg-gray-800/70" onClick={() => void openOperationalDetail('audit', event._id, `Audit event ${event.action}`)}><TableCell className="whitespace-nowrap text-gray-400">{formatDate(event.createdAt)}</TableCell><TableCell>{event.category}</TableCell><TableCell><div>{event.message}</div><div className="text-xs text-gray-500">{event.action}</div></TableCell><TableCell><div>{event.targetType || 'Runtime'}</div><div className="max-w-56 truncate font-mono text-xs text-gray-500">{event.targetId || 'global'}</div></TableCell><TableCell><StatusBadge status={event.status} /></TableCell><TableCell className="text-gray-400">{event.actorEmail || 'System'}</TableCell></TableRow>)}</TableBody></Table></div>{!audits.length && <div className="py-16 text-center text-sm text-gray-500">No alert or configuration events yet.</div>}<div className="flex items-center justify-end gap-2 border-t border-gray-800 px-4 py-3"><Button variant="outline" size="icon" disabled={auditPage <= 1} onClick={() => setAuditPage((page) => page - 1)} className="border-gray-700"><ChevronLeft className="h-4 w-4" /></Button><span className="min-w-24 text-center text-sm text-gray-400">{auditPage} of {auditPages}</span><Button variant="outline" size="icon" disabled={auditPage >= auditPages} onClick={() => setAuditPage((page) => page + 1)} className="border-gray-700"><ChevronRight className="h-4 w-4" /></Button></div></section>
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>

      <Dialog open={Boolean(detailSelection)} onOpenChange={(open) => {
        if (!open) {
          setDetailSelection(null);
          setDetailData(null);
        }
      }}>
        <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto border-gray-700 bg-gray-900 text-gray-100">
          <DialogHeader>
            <DialogTitle>{detailSelection?.title || 'Operational audit detail'}</DialogTitle>
            <DialogDescription className="text-gray-400">
              Admin-only runtime metadata. Prompts, CV contents and provider credentials are not included.
            </DialogDescription>
          </DialogHeader>
          {detailLoading
            ? <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-blue-400" /></div>
            : detailSelection && detailData
              ? <OperationalDetail kind={detailSelection.kind} data={detailData} />
              : <div className="py-12 text-center text-sm text-gray-500">No detail is available.</div>}
        </DialogContent>
      </Dialog>

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

function LiveOperationsPanel({
  data,
  connection,
  error,
  definitions,
  onInspect
}: {
  data: LiveOperations | null;
  connection: 'connecting' | 'live' | 'reconnecting';
  error: string;
  definitions: Map<string, ActivityDefinition>;
  onInspect: (request: UsageRequest) => void;
}) {
  const five = data?.totals.fiveMinutes;
  const hour = data?.totals.hour;
  const timeline = (data?.timeline || []).slice(-30);
  const peak = Math.max(1, ...timeline.map((point) => point.calls));
  return (
    <section className="overflow-hidden rounded-md border border-gray-800 bg-gray-900">
      <div className="flex flex-col gap-3 border-b border-gray-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-white">Live operations</h2>
            <StatusBadge status={connection} />
          </div>
          <p className="mt-1 text-xs text-gray-500">All Groq and managed-local AI activity, refreshed every three seconds.</p>
        </div>
        <div className="text-xs text-gray-500">{error || `Sampled ${formatTime(data?.sampledAt)}`}</div>
      </div>
      <dl className="grid gap-px border-b border-gray-800 bg-gray-800 sm:grid-cols-3 xl:grid-cols-6">
        {[
          ['Calls · 5 min', formatNumber(five?.calls)],
          ['Failures · 5 min', formatNumber(five?.failures)],
          ['Calls · 1 hour', formatNumber(hour?.calls)],
          ['Success · 1 hour', `${formatNumber(hour?.successRate, 1)}%`],
          ['Average latency', `${formatNumber(hour?.averageLatencyMs)} ms`],
          ['Tokens · 1 hour', formatNumber(hour?.tokens)]
        ].map(([label, value]) => (
          <div key={label} className="bg-gray-900 px-4 py-3">
            <dt className="text-xs text-gray-500">{label}</dt>
            <dd className="mt-1 text-base font-semibold text-gray-100">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="border-b border-gray-800 px-4 py-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-white">Request volume · last 30 minutes</h3>
            <p className="mt-1 text-xs text-gray-500">Red segments are failed calls.</p>
          </div>
          <span className="text-xs text-gray-500">Peak {formatNumber(peak)} / min</span>
        </div>
        <div className="mt-3 flex h-20 items-end gap-1" aria-label="AI requests by minute">
          {timeline.map((point) => {
            const totalHeight = Math.max(4, Math.round((point.calls / peak) * 72));
            const failureHeight = point.calls ? Math.round((point.failures / point.calls) * totalHeight) : 0;
            return (
              <div key={point.minute} className="group relative flex min-w-0 flex-1 flex-col justify-end" style={{ height: `${totalHeight}px` }} title={`${formatTime(point.minute)}: ${point.calls} calls, ${point.failures} failed`}>
                <div className="w-full bg-blue-500/70" style={{ height: `${Math.max(0, totalHeight - failureHeight)}px` }} />
                {failureHeight > 0 && <div className="w-full bg-red-500/80" style={{ height: `${failureHeight}px` }} />}
              </div>
            );
          })}
          {!timeline.length && <div className="flex h-full w-full items-center justify-center text-xs text-gray-500">No AI activity in the last hour.</div>}
        </div>
      </div>
      <div className="grid xl:grid-cols-2">
        <div className="border-b border-gray-800 xl:border-b-0 xl:border-r">
          <div className="border-b border-gray-800 px-4 py-3"><h3 className="text-sm font-medium text-white">Provider health · 1 hour</h3></div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow className="border-gray-800"><TableHead>Provider</TableHead><TableHead>Calls</TableHead><TableHead>Success</TableHead><TableHead>Avg / max</TableHead><TableHead>Cost</TableHead></TableRow></TableHeader>
              <TableBody>
                {(data?.providers || []).map((provider) => (
                  <TableRow key={provider.id} className="border-gray-800">
                    <TableCell><div className="font-medium text-gray-200">{provider.id === 'local-ollama' ? 'Managed local' : provider.id}</div><div className="text-xs text-gray-500">{formatTime(provider.lastRequestAt)}</div></TableCell>
                    <TableCell>{formatNumber(provider.calls)}</TableCell>
                    <TableCell className={provider.failures ? 'text-amber-300' : 'text-green-300'}>{formatNumber(provider.successRate, 1)}%</TableCell>
                    <TableCell>{formatNumber(provider.averageLatencyMs)} / {formatNumber(provider.maxLatencyMs)} ms</TableCell>
                    <TableCell>${formatNumber(provider.estimatedCostUsd, 6)}</TableCell>
                  </TableRow>
                ))}
                {!data?.providers.length && <TableRow><TableCell colSpan={5} className="h-20 text-center text-gray-500">No provider calls in the last hour.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </div>
        <div>
          <div className="border-b border-gray-800 px-4 py-3"><h3 className="text-sm font-medium text-white">Latest AI activity</h3></div>
          <div className="divide-y divide-gray-800">
            {(data?.recent || []).slice(0, 8).map((request) => (
              <button key={request._id} type="button" onClick={() => onInspect(request)} className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-gray-800/70">
                <div className="min-w-0">
                  <div className="truncate text-sm text-gray-200">{definitions.get(request.activity)?.label || request.activity}</div>
                  <div className="truncate text-xs text-gray-500">{request.organizationName || 'No organization'} · {request.actorName || request.actorEmail || 'System'} · {request.provider}</div>
                </div>
                <div className="shrink-0 text-right">
                  <StatusBadge status={request.status} />
                  <div className="mt-1 text-xs text-gray-500">{formatTime(request.createdAt)}</div>
                </div>
              </button>
            ))}
            {!data?.recent.length && <div className="py-12 text-center text-sm text-gray-500">No recent AI requests.</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textValue(value: unknown, fallback = 'Not reported') {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function DetailDatum({ label, value, mono = false }: { label: string; value: unknown; mono?: boolean }) {
  return (
    <div className="min-w-0 border-b border-gray-800 px-4 py-3">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={`mt-1 break-words text-sm text-gray-200 ${mono ? 'font-mono' : ''}`}>{textValue(value)}</dd>
    </div>
  );
}

function OperationalDetail({ kind, data }: { kind: DetailKind; data: Record<string, unknown> }) {
  if (kind === 'queue') {
    const organization = recordValue(data.organization);
    const uploader = recordValue(data.uploader);
    const file = recordValue(data.file);
    const application = recordValue(data.application);
    const candidate = recordValue(data.candidate);
    return (
      <div className="space-y-5">
        <section className="overflow-hidden rounded-md border border-gray-800">
          <div className="border-b border-gray-800 px-4 py-3"><h3 className="text-sm font-semibold text-white">Uploader and company</h3></div>
          <dl className="grid sm:grid-cols-2">
            <DetailDatum label="Organization" value={organization.name} />
            <DetailDatum label="Organization ID" value={organization.id} mono />
            <DetailDatum label="Uploader" value={uploader.name} />
            <DetailDatum label="Uploader email" value={uploader.email || uploader.type} />
            <DetailDatum label="Job applied for" value={application.title} />
            <DetailDatum label="Candidate created" value={candidate.name || 'Not yet'} />
          </dl>
        </section>
        <section className="overflow-hidden rounded-md border border-gray-800">
          <div className="border-b border-gray-800 px-4 py-3"><h3 className="text-sm font-semibold text-white">Queue execution</h3></div>
          <dl className="grid sm:grid-cols-2">
            <DetailDatum label="Job ID" value={data.jobId} mono />
            <DetailDatum label="State" value={textValue(data.state).replace(/_/g, ' ')} />
            <DetailDatum label="Source" value={data.source} />
            <DetailDatum label="Progress" value={`${textValue(data.progress, '0')}%`} />
            <DetailDatum label="Attempts" value={data.attempts} />
            <DetailDatum label="Queue wait" value={formatDuration(Number(data.waitMs || 0))} />
            <DetailDatum label="Processing time" value={formatDuration(data.processingMs == null ? null : Number(data.processingMs))} />
            <DetailDatum label="Last updated" value={formatDate(textValue(data.updatedAt, ''))} />
            <DetailDatum label="CV file" value={file.name} />
            <DetailDatum label="File size / type" value={`${formatFileSize(Number(file.size || 0))} · ${textValue(file.type)}`} />
            <DetailDatum label="Error code" value={data.errorCode} mono />
          </dl>
        </section>
      </div>
    );
  }
  if (kind === 'audit') {
    return (
      <div className="space-y-5">
        <section className="overflow-hidden rounded-md border border-gray-800">
          <dl className="grid sm:grid-cols-2">
            <DetailDatum label="Created" value={formatDate(textValue(data.createdAt, ''))} />
            <DetailDatum label="Status" value={data.status} />
            <DetailDatum label="Category" value={data.category} />
            <DetailDatum label="Action" value={data.action} mono />
            <DetailDatum label="Admin" value={data.actorEmail || 'System'} />
            <DetailDatum label="Target" value={`${textValue(data.targetType, 'Runtime')} · ${textValue(data.targetId, 'global')}`} />
            <DetailDatum label="Model" value={data.model} mono />
            <DetailDatum label="Quota group" value={data.quotaGroup} mono />
            <DetailDatum label="IP address" value={data.ipAddress} mono />
            <DetailDatum label="User agent" value={data.userAgent} />
          </dl>
        </section>
        <section className="rounded-md border border-gray-800 p-4">
          <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">Message</h3>
          <p className="mt-2 text-sm leading-6 text-gray-200">{textValue(data.message)}</p>
          {data.metadata != null && <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-gray-800 pt-4 font-mono text-xs text-gray-400">{JSON.stringify(data.metadata, null, 2)}</pre>}
        </section>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-md border border-gray-800">
        <div className="border-b border-gray-800 px-4 py-3"><h3 className="text-sm font-semibold text-white">Identity and routing</h3></div>
        <dl className="grid sm:grid-cols-2">
          <DetailDatum label="Organization" value={data.organizationName || data.organizationId} />
          <DetailDatum label="Person" value={data.actorName || data.actorEmail || 'System'} />
          <DetailDatum label="Activity" value={data.activity} mono />
          <DetailDatum label="Application" value={data.sourceApp} />
          <DetailDatum label="Provider" value={data.provider} />
          <DetailDatum label="Model" value={data.model} mono />
          <DetailDatum label="Request ID" value={data.requestId} mono />
          <DetailDatum label="Provider request ID" value={data.providerRequestId} mono />
          <DetailDatum label="Created" value={formatDate(textValue(data.createdAt, ''))} />
          <DetailDatum label="Status" value={data.status} />
        </dl>
      </section>
      <section className="overflow-hidden rounded-md border border-gray-800">
        <div className="border-b border-gray-800 px-4 py-3"><h3 className="text-sm font-semibold text-white">Execution metrics</h3></div>
        <dl className="grid sm:grid-cols-2 lg:grid-cols-3">
          <DetailDatum label="Latency" value={`${formatNumber(Number(data.latencyMs || 0))} ms`} />
          <DetailDatum label="Attempts" value={data.attempts} />
          <DetailDatum label="Failovers" value={data.failovers} />
          <DetailDatum label="Input tokens" value={formatNumber(Number(data.inputTokens || 0))} />
          <DetailDatum label="Cached input" value={formatNumber(Number(data.cachedInputTokens || 0))} />
          <DetailDatum label="Output tokens" value={formatNumber(Number(data.outputTokens || 0))} />
          <DetailDatum label="Reasoning tokens" value={formatNumber(Number(data.reasoningTokens || 0))} />
          <DetailDatum label="Total tokens" value={formatNumber(Number(data.totalTokens || 0))} />
          <DetailDatum label="Estimated cost" value={`$${formatNumber(Number(data.estimatedCostUsd || 0), 6)}`} />
          <DetailDatum label="Prompt bytes" value={formatNumber(Number(data.promptBytes || 0))} />
          <DetailDatum label="Response bytes" value={formatNumber(Number(data.responseBytes || 0))} />
          <DetailDatum label="Quota group" value={data.quotaGroup} mono />
        </dl>
      </section>
      {Boolean(data.errorCode || data.errorMessage || data.attemptErrors) && (
        <section className="rounded-md border border-red-900 bg-red-950/20 p-4">
          <h3 className="text-sm font-semibold text-red-200">{textValue(data.errorCode, 'Request failure')}</h3>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-red-300">{textValue(data.errorMessage)}</p>
          {data.attemptErrors != null && <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words border-t border-red-900 pt-3 font-mono text-xs text-red-300">{JSON.stringify(data.attemptErrors, null, 2)}</pre>}
        </section>
      )}
    </div>
  );
}

function RequestTotals({ totals, includeFailovers = false }: { totals: Partial<RequestSummary> | null | undefined; includeFailovers?: boolean }) {
  const values = [
    ['Calls', formatNumber(totals?.calls)],
    ['Successful', formatNumber(totals?.successes)],
    ['Failed', formatNumber(totals?.failures)],
    ['Success rate', `${formatNumber(totals?.successRate, 1)}%`],
    ['Input tokens', formatNumber(totals?.inputTokens)],
    ['Cached input', formatNumber(totals?.cachedInputTokens)],
    ['Output tokens', formatNumber(totals?.outputTokens)],
    ['Reasoning tokens', formatNumber(totals?.reasoningTokens)],
    ['All tokens', formatNumber(totals?.totalTokens)],
    ['Estimated cost', `$${formatNumber(totals?.estimatedCostUsd, 6)}`],
    ['Average latency', `${formatNumber(totals?.averageLatencyMs)} ms`],
    ['P50 latency', `${formatNumber(totals?.p50LatencyMs)} ms`],
    ['P95 latency', `${formatNumber(totals?.p95LatencyMs)} ms`]
  ];
  if (includeFailovers) values.push(['Failovers', formatNumber(totals?.failovers)]);
  return <dl className="grid sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">{values.map(([label, value]) => <RuntimeTestDatum key={label} label={label} value={value} />)}</dl>;
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
