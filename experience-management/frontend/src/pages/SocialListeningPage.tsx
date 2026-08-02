import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import {
  AlertTriangle, AtSign, BarChart3, Check, CheckSquare, Clipboard, Copy, Database, ExternalLink, FileText, Loader2,
  MessageSquareReply, MessageSquareText, Plus, Radar, RefreshCw, Search, Settings2, Square, Trash2, Users
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, json } from '@/lib/api';
import { getKnowledgeBases } from '@/lib/knowledgeBases';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { KnowledgeBasePicker } from '@/components/knowledge/KnowledgeBasePicker';
import type {
  KnowledgeBase, SocialIntelligencePublication, SocialIntelligenceReport, SocialMention, SocialReplyDraft, XCollectionStream, XConnection, XExpansionEstimate,
  XIntegrationStatus, XListeningQuery, XSyncJob
} from '@/types';

type View = 'listening' | 'queries' | 'intelligence' | 'replies' | 'history' | 'connection';
type Stream = 'all' | 'account_post' | 'mention' | 'search';
type RefreshReason = 'initial' | 'manual' | 'live';
const syncIntervals = [[15, 'Every 15 minutes'], [30, 'Every 30 minutes'], [60, 'Every hour'], [180, 'Every 3 hours'], [360, 'Every 6 hours'], [720, 'Every 12 hours'], [1440, 'Every day']] as const;
const emptyCredentials = { clientId: '', clientSecret: '', bearerToken: '', consumerKey: '', consumerSecret: '' };
const normalSyncLimit = 50;
const savedPageSize = 50;
const expansionLimits = [100, 200, 500] as const;
const allExpansionStreams: XCollectionStream[] = ['account_posts', 'mentions', 'searches'];

function formatDate(value?: string | null) {
  if (!value) return 'Not yet';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}
function streamLabel(stream?: string | null) {
  return stream === 'account_post' ? 'Account post' : stream === 'mention' ? 'Mention' : stream === 'search' ? 'Search result' : 'X post';
}
function jobBadge(job?: XSyncJob) {
  if (!job) return <Badge variant="secondary">No sync yet</Badge>;
  if (job.state === 'completed') return <Badge variant="success">Completed</Badge>;
  if (job.state === 'failed') return <Badge variant="destructive">Failed</Badge>;
  if (job.state === 'cancelled') return <Badge variant="secondary">Cancelled</Badge>;
  if (job.state === 'waiting_billing') return <Badge variant="warning">Credits required</Badge>;
  if (job.state === 'waiting_rate_limit') return <Badge variant="warning">Rate-limit wait</Badge>;
  return <Badge variant="warning">{job.state === 'processing' ? 'Syncing' : 'Queued'}</Badge>;
}
function connectionLabel(connection: XConnection) {
  return connection.account?.username ? `@${connection.account.username}` : connection.account?.name || 'Pending account';
}

function reportPeriod(report: SocialIntelligenceReport, mentionsById: ReadonlyMap<string, SocialMention>) {
  const sources = report.mentionIds.map((id) => mentionsById.get(id)).filter((mention): mention is SocialMention => Boolean(mention));
  const times = sources.map((mention) => new Date(mention.publishedAt).getTime()).filter(Number.isFinite);
  const fallbackBreakdown = sources.reduce<Record<string, number>>((counts, mention) => {
    const key = mention.ingestionKind || 'saved_posts'; counts[key] = (counts[key] || 0) + 1; return counts;
  }, {});
  const reportedBreakdown = report.observationWindow?.breakdown;
  const suppliedBreakdown = reportedBreakdown && typeof reportedBreakdown === 'object'
    ? Object.fromEntries(Object.entries(reportedBreakdown).filter(([, value]) => Number.isFinite(Number(value)) && Number(value) >= 0).map(([key, value]) => [key, Number(value)]))
    : {};
  const reportedPostCount = report.observationWindow?.postCount;
  const postCount = Number.isFinite(Number(reportedPostCount)) ? Number(reportedPostCount) : report.mentionIds.length;
  return {
    start: report.observationWindow?.periodStart || (times.length ? new Date(Math.min(...times)).toISOString() : null),
    end: report.observationWindow?.periodEnd || (times.length ? new Date(Math.max(...times)).toISOString() : null),
    asOf: report.observationWindow?.asOf || report.completedAt || report.updatedAt,
    postCount,
    breakdown: Object.keys(suppliedBreakdown).length ? suppliedBreakdown : Object.keys(fallbackBreakdown).length ? fallbackBreakdown : { saved_posts: postCount }
  };
}

function labelBreakdown(key: string) {
  const labels: Record<string, string> = { account_post: 'Account posts', account_posts: 'Account posts', accountPosts: 'Account posts', mention: 'Mentions', mentions: 'Mentions', search: 'Search results', searches: 'Search results', search_results: 'Search results', searchResults: 'Search results', unclassified: 'Other saved posts', saved_posts: 'Saved posts' };
  return labels[key] || key.replaceAll('_', ' ');
}

function runtimeFacts(runtime: any) {
  if (!runtime || typeof runtime !== 'object') return [] as Array<[string, string]>;
  const usage = runtime.usage && typeof runtime.usage === 'object' ? runtime.usage : {};
  const facts: Array<[string, unknown]> = [
    ['Provider', runtime.providerLabel || runtime.provider], ['Model', runtime.model],
    ['Latency', Number.isFinite(Number(runtime.latencyMs)) ? `${Number(runtime.latencyMs)} ms` : null],
    ['Input tokens', usage.inputTokens ?? runtime.inputTokens], ['Output tokens', usage.outputTokens ?? runtime.outputTokens],
    ['Total tokens', usage.totalTokens ?? runtime.totalTokens], ['Execution', runtime.executionId || runtime.gatewayExecutionId]
  ];
  return facts.filter((entry): entry is [string, string | number] => entry[1] !== null && entry[1] !== undefined && entry[1] !== '')
    .map(([label, value]) => [label, String(value)]);
}

function SocialReportCard({ report, mentionsById, knowledgeBases, knowledgeBasesLoading, knowledgeBasesError, retrying, publishing, retry, publish, reloadKnowledgeBases }: {
  report: SocialIntelligenceReport;
  mentionsById: ReadonlyMap<string, SocialMention>;
  knowledgeBases: KnowledgeBase[];
  knowledgeBasesLoading: boolean;
  knowledgeBasesError: string;
  retrying: boolean; publishing: boolean;
  retry: (report: SocialIntelligenceReport) => void;
  publish: (report: SocialIntelligenceReport, knowledgeBaseId: string) => Promise<void>;
  reloadKnowledgeBases: () => void;
}) {
  const [publishDialog, setPublishDialog] = useState(false);
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState('');
  const [publicationReviewed, setPublicationReviewed] = useState(false);
  const period = reportPeriod(report, mentionsById);
  const result = report.result || {};
  const evidenceRefs = new Set<string>([
    ...(result.themes || []).flatMap((item: any) => item.evidence || []),
    ...(result.emergingTrends || []).flatMap((item: any) => item.evidence || []),
    ...(result.risks || []).flatMap((item: any) => item.evidence || []),
    ...(result.opportunities || []).flatMap((item: any) => item.evidence || []),
    ...(result.mentions || []).map((item: any) => item.evidence)
  ].map(String).map((value) => value.startsWith('x-post:') ? value.slice('x-post:'.length) : value).filter((value) => report.mentionIds.includes(value)));
  const sentiment = ['negative', 'neutral', 'positive', 'mixed'].map((key) => [key, Number(result.sentiment?.[key] || 0)] as const);
  const sentimentTotal = sentiment.reduce((total, [, count]) => total + count, 0);
  const publications = report.publications || [];
  const publishedKnowledgeBaseIds = new Set(publications.map((item) => item.knowledgeBaseId));
  const availableKnowledgeBases = knowledgeBases.filter((base) => !publishedKnowledgeBaseIds.has(base.id));
  const periodLabel = period.start && period.end ? `${formatDate(period.start)} – ${formatDate(period.end)}` : period.start || period.end ? formatDate(period.start || period.end) : 'Saved snapshot';

  useEffect(() => {
    if (publications.length) { setPublishDialog(false); setPublicationReviewed(false); setSelectedKnowledgeBaseId(''); }
  }, [publications.length]);

  const retryButton = <Button size="sm" variant="outline" disabled={retrying} onClick={() => retry(report)}>
    {retrying ? <Loader2 className="animate-spin" /> : <RefreshCw />}Retry report
  </Button>;
  return <Card>
    <CardHeader className="border-b">
      <div className="flex items-start justify-between gap-3">
        <div><CardTitle>{report.title}</CardTitle><CardDescription className="mt-1">{period.postCount} posts · as of {formatDate(period.asOf)}</CardDescription></div>
        <Badge variant={report.state === 'completed' ? 'success' : report.state === 'failed' ? 'destructive' : 'warning'}>{report.state}</Badge>
      </div>
    </CardHeader>
    <CardContent className="space-y-5 pt-5">
      {report.state === 'failed' ? <div className="flex flex-col items-start justify-between gap-4 border border-destructive/30 bg-destructive/5 px-4 py-3 sm:flex-row" role="alert">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-destructive"><AlertTriangle className="h-4 w-4" />Report could not be completed</div>
          <p className="mt-2 text-sm leading-6 text-destructive">{report.error || 'Terra could not produce a grounded report from the saved posts.'}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">The saved post snapshot is unchanged. Retry restarts the same durable job from the same sources.</p>
        </div>
        {retryButton}
      </div> : report.state === 'queued' ? <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin" />Waiting for Terra. This report is durable.
      </div> : report.result ? <>
        <section className="grid divide-y border bg-muted/10 sm:grid-cols-[minmax(220px,1.4fr)_minmax(150px,0.8fr)_minmax(220px,1fr)] sm:divide-x sm:divide-y-0">
          <div className="p-3"><div className="text-xs text-muted-foreground">Observation period</div><div className="mt-1 text-sm font-medium">{periodLabel}</div></div>
          <div className="p-3"><div className="text-xs text-muted-foreground">Snapshot</div><div className="mt-1 text-sm font-medium">{period.postCount} saved posts</div></div>
          <div className="p-3"><div className="text-xs text-muted-foreground">Discovery labels</div><div className="mt-1 text-sm font-medium">{Object.entries(period.breakdown).map(([key, value]) => `${labelBreakdown(key)} ${value}`).join(' · ')}</div><div className="mt-1 text-[11px] text-muted-foreground">A saved post can carry more than one label.</div></div>
        </section>
        <section><h3 className="text-sm font-semibold">Executive summary</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{report.result.executiveSummary}</p></section>
        {sentimentTotal > 0 && <section><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Sentiment</h3><span className="text-xs text-muted-foreground">{sentimentTotal} posts classified</span></div><div className="mt-2 flex h-2 overflow-hidden bg-muted" aria-label="Sentiment distribution">{sentiment.map(([key, count]) => count > 0 && <span key={key} title={`${labelBreakdown(key)} ${count}`} className={key === 'positive' ? 'bg-emerald-600' : key === 'negative' ? 'bg-red-600' : key === 'mixed' ? 'bg-amber-500' : 'bg-slate-400'} style={{ width: `${(count / sentimentTotal) * 100}%` }} />)}</div><div className="mt-2 grid grid-cols-2 divide-x border sm:grid-cols-4">{sentiment.map(([key, count]) => <div className="px-3 py-2" key={key}><div className="text-xs capitalize text-muted-foreground">{key}</div><div className="mt-0.5 text-sm font-semibold tabular-nums">{count} <span className="font-normal text-muted-foreground">({Math.round((count / sentimentTotal) * 100)}%)</span></div></div>)}</div></section>}
        {report.result.themes?.length > 0 && <section><h3 className="text-sm font-semibold">Themes</h3><div className="mt-2 divide-y border">{report.result.themes.map((theme: any, index: number) => <div className="flex items-start justify-between gap-4 p-3" key={`${theme.name}-${index}`}><div><div className="text-sm font-medium">{theme.name}</div><p className="mt-1 text-xs leading-5 capitalize text-muted-foreground">{theme.sentiment} · {theme.mentions} mentions</p></div><span className="shrink-0 text-xs text-muted-foreground">{theme.evidence?.length || 0} sources</span></div>)}</div></section>}
        {report.result.emergingTrends?.length > 0 && <section><h3 className="text-sm font-semibold">Emerging trends</h3><div className="mt-2 divide-y border">{report.result.emergingTrends.map((trend: any, index: number) => <div className="flex items-start justify-between gap-4 p-3" key={`${trend.trend}-${index}`}><p className="text-sm leading-6">{trend.trend}</p><div className="shrink-0 text-right"><Badge variant="outline" className="capitalize">{trend.direction}</Badge><div className="mt-1 text-[11px] text-muted-foreground">{trend.evidence?.length || 0} sources</div></div></div>)}</div></section>}
        {(report.result.opportunities?.length > 0 || report.result.risks?.length > 0) && <div className="grid gap-5 lg:grid-cols-2">
          {report.result.opportunities?.length > 0 && <section><h3 className="text-sm font-semibold">Opportunities</h3><div className="mt-2 divide-y border">{report.result.opportunities.map((item: any, index: number) => <div className="p-3" key={`${item.opportunity}-${index}`}><div className="text-sm font-medium">{item.opportunity}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.action}</p><div className="mt-2 text-[11px] text-muted-foreground">Grounded in {item.evidence?.length || 0} saved sources</div></div>)}</div></section>}
          {report.result.risks?.length > 0 && <section><h3 className="text-sm font-semibold">Risks</h3><div className="mt-2 divide-y border">{report.result.risks.map((risk: any, index: number) => <div className="p-3" key={`${risk.issue}-${index}`}><div className="flex items-start justify-between gap-3"><div className="text-sm font-medium">{risk.issue}</div><Badge variant={['high', 'critical'].includes(risk.severity) ? 'destructive' : 'outline'} className="capitalize">{risk.severity}</Badge></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{risk.action}</p><div className="mt-2 text-[11px] text-muted-foreground">Grounded in {risk.evidence?.length || 0} saved sources</div></div>)}</div></section>}
        </div>}
        <details className="border"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Evidence, provenance and runtime</summary><div className="space-y-5 border-t px-4 py-4">
          <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4"><div><span className="text-muted-foreground">Report ID</span><div className="mt-1 break-all font-mono">{report.id}</div></div><div><span className="text-muted-foreground">AI job</span><div className="mt-1 break-all font-mono">{report.aiJobId}</div></div><div><span className="text-muted-foreground">Captured</span><div className="mt-1">{formatDate(period.asOf)}</div></div><div><span className="text-muted-foreground">Source snapshot</span><div className="mt-1 break-all font-mono">{report.sourceSnapshotSha256 || 'Not retained for this older report'}</div></div></div>
          <div><div className="text-xs font-medium text-muted-foreground">Saved-source provenance ({report.mentionIds.length})</div><div className="mt-2 max-h-80 divide-y overflow-y-auto border">{report.mentionIds.map((sourceId) => { const source = mentionsById.get(sourceId); return <div className="px-3 py-2.5" key={sourceId}><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-medium">{source?.author || 'Saved X post'}</span><span className="font-mono text-[11px] text-muted-foreground">{sourceId}{evidenceRefs.has(sourceId) ? ' · cited' : ''}</span></div>{source ? <><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{source.content}</p><div className="mt-1 text-[11px] text-muted-foreground">{streamLabel(source.ingestionKind)} · {formatDate(source.publishedAt)}</div></> : <p className="mt-1 text-xs text-muted-foreground">The source remains part of the immutable report snapshot but is not in the current on-screen cache.</p>}</div>; })}</div></div>
          <div><div className="text-xs font-medium text-muted-foreground">Runtime</div>{runtimeFacts(report.runtime).length ? <div className="mt-2 grid divide-y border sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">{runtimeFacts(report.runtime).map(([label, value]) => <div className="p-3" key={label}><div className="text-[11px] text-muted-foreground">{label}</div><div className="mt-1 break-all text-xs font-medium">{value}</div></div>)}</div> : <p className="mt-1 text-xs text-muted-foreground">Runtime telemetry was not retained for this older report.</p>}</div>
        </div></details>
        <section className="border bg-muted/10 px-4 py-4"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><h3 className="text-sm font-semibold">Knowledge publication</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Reviewed publications are dated, derived artifacts. The original saved X posts remain their evidence.</p></div>{availableKnowledgeBases.length > 0 && <Button size="sm" variant="outline" onClick={() => setPublishDialog(true)}><Database />{publications.length ? 'Publish to another' : 'Publish to knowledge base'}</Button>}</div>{publications.length > 0 ? <div className="mt-3 divide-y border bg-background">{publications.map((item) => { const target = knowledgeBases.find((base) => base.id === item.knowledgeBaseId); const active = !['ready', 'completed', 'failed', 'deleted'].includes(item.state); return <div className="flex flex-col justify-between gap-3 px-3 py-3 sm:flex-row sm:items-center" key={`${item.knowledgeBaseId}-${item.documentId}`}><div><div className="text-sm font-medium">{item.knowledgeBaseName || target?.name || 'Knowledge base'}</div><div className="mt-1 text-xs text-muted-foreground">{item.publishedAt ? `Published ${formatDate(item.publishedAt)}` : 'Publication recorded'} · document <span className="font-mono">{item.documentId.slice(0, 8)}</span>{item.state === 'deleted' ? ' · deleted from knowledge base' : ''}</div></div><div className="flex items-center gap-2"><Badge variant={item.state === 'failed' ? 'destructive' : ['ready', 'completed'].includes(item.state) ? 'success' : item.state === 'deleted' ? 'secondary' : 'warning'} className="capitalize">{active ? 'Indexing' : item.state.replaceAll('_', ' ')}</Badge><Button size="sm" variant="outline" asChild><Link to={`/knowledge-bases/${encodeURIComponent(item.knowledgeBaseId)}`}>Open knowledge base</Link></Button></div></div>; })}</div> : <p className="mt-3 text-xs text-muted-foreground">This report has not been published to a knowledge base.</p>}{!knowledgeBasesLoading && !knowledgeBasesError && availableKnowledgeBases.length === 0 && knowledgeBases.length > 0 && <p className="mt-3 text-xs text-muted-foreground">This report already has a publication record for every available knowledge base. A deleted derived document stays as a provenance tombstone; generate a new report version before publishing it again.</p>}</section>
      </> : <div className="border px-4 py-3" role="alert">
        <p className="text-sm font-semibold">The completed report has no readable result</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">The saved sources are intact. Refresh once; if this remains, share the report ID with support.</p>
      </div>}
    </CardContent>
    <Dialog open={publishDialog} onOpenChange={(open) => { if (!publishing) { setPublishDialog(open); if (!open) setPublicationReviewed(false); } }}><DialogContent><DialogHeader><DialogTitle>Publish dated intelligence</DialogTitle><DialogDescription>Choose one knowledge base for this completed report. This action is duplicate-safe and does not alter the saved X evidence.</DialogDescription></DialogHeader><div className="space-y-4">
      <div><Label htmlFor={`publish-kb-${report.id}`}>Knowledge base</Label><select id={`publish-kb-${report.id}`} className="mt-2 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={selectedKnowledgeBaseId} disabled={publishing || knowledgeBasesLoading} onChange={(event) => setSelectedKnowledgeBaseId(event.target.value)}><option value="">{knowledgeBasesLoading ? 'Loading knowledge bases…' : 'Choose a knowledge base'}</option>{availableKnowledgeBases.map((base) => <option value={base.id} key={base.id}>{base.name} · {base.privacy === 'private' ? 'Private' : 'Space'}</option>)}</select>{knowledgeBasesError && <div className="mt-2 flex items-center justify-between gap-3 text-xs text-destructive" role="alert"><span>{knowledgeBasesError}</span><Button size="sm" variant="outline" onClick={reloadKnowledgeBases}>Retry</Button></div>}{!knowledgeBasesLoading && !knowledgeBasesError && knowledgeBases.length === 0 && <p className="mt-2 text-xs text-muted-foreground">Create a knowledge base before publishing. <Link className="font-medium underline" to="/knowledge-bases">Open knowledge bases</Link></p>}</div>
      <label className="flex items-start gap-3 border border-amber-300 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-950"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={publicationReviewed} onChange={(event) => setPublicationReviewed(event.target.checked)} /><span>I reviewed this report and understand it will be stored as a dated, AI-derived artifact. The original saved X posts remain the evidence and are not replaced.</span></label>
      <p className="text-xs leading-5 text-muted-foreground">One knowledge document is created for this report. Repeated publication requests resolve to that same document instead of creating duplicates.</p>
    </div><DialogFooter><Button variant="outline" disabled={publishing} onClick={() => setPublishDialog(false)}>Cancel</Button><Button disabled={publishing || !selectedKnowledgeBaseId || !publicationReviewed} onClick={() => void publish(report, selectedKnowledgeBaseId)}>{publishing ? <Loader2 className="animate-spin" /> : <Database />}{publishing ? 'Publishing' : 'Publish dated report'}</Button></DialogFooter></DialogContent></Dialog>
  </Card>;
}

export function SocialListeningPage() {
  const [status, setStatus] = useState<XIntegrationStatus | null>(null);
  const [mentions, setMentions] = useState<SocialMention[]>([]);
  const [reports, setReports] = useState<SocialIntelligenceReport[]>([]);
  const [replyDrafts, setReplyDrafts] = useState<SocialReplyDraft[]>([]);
  const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(''); const refreshSequence = useRef(0);
  const selectedConnectionRef = useRef<string | null>(null); const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [view, setView] = useState<View>('listening'); const [stream, setStream] = useState<Stream>('all');
  const [savedVisibleLimit, setSavedVisibleLimit] = useState(savedPageSize);
  const [reportLimit, setReportLimit] = useState<50 | 100 | 200>(normalSyncLimit);
  const [selectedMentions, setSelectedMentions] = useState<string[] | null>(null);
  const [credentialDialog, setCredentialDialog] = useState(false); const [queryDialog, setQueryDialog] = useState(false);
  const [expansionDialog, setExpansionDialog] = useState(false); const [expansionLimit, setExpansionLimit] = useState<100 | 200 | 500>(100);
  const [expansionStreams, setExpansionStreams] = useState<XCollectionStream[]>(allExpansionStreams);
  const [expansionEstimate, setExpansionEstimate] = useState<XExpansionEstimate | null>(null);
  const [expansionEstimateError, setExpansionEstimateError] = useState(''); const expansionSequence = useRef(0);
  const [expansionEstimateRevision, setExpansionEstimateRevision] = useState(0);
  const [replyMention, setReplyMention] = useState<SocialMention | null>(null);
  const [editingQuery, setEditingQuery] = useState<XListeningQuery | null>(null); const [working, setWorking] = useState('');
  const [credentials, setCredentials] = useState(emptyCredentials);
  const [queryDraft, setQueryDraft] = useState({ label: '', query: '', enabled: true });
  const [replyForm, setReplyForm] = useState({ tone: 'helpful', instructions: '' });
  const [reportTitle, setReportTitle] = useState('X listening intelligence');
  const [knowledgeBaseIds, setKnowledgeBaseIds] = useState<string[]>([]);
  const [publishKnowledgeBases, setPublishKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [publishKnowledgeBasesLoading, setPublishKnowledgeBasesLoading] = useState(true);
  const [publishKnowledgeBasesError, setPublishKnowledgeBasesError] = useState('');
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});
  const replyRequest = useRef({ fingerprint: '', key: '' }); const reportRequest = useRef({ fingerprint: '', key: '' });
  const expansionRequest = useRef({ fingerprint: '', key: '' });

  const loadPublishKnowledgeBases = useCallback(async () => {
    setPublishKnowledgeBasesLoading(true); setPublishKnowledgeBasesError('');
    try { setPublishKnowledgeBases(await getKnowledgeBases()); }
    catch (error) { setPublishKnowledgeBasesError(error instanceof Error ? error.message : 'Knowledge bases could not load.'); }
    finally { setPublishKnowledgeBasesLoading(false); }
  }, []);

  const load = useCallback(async (reason: RefreshReason = 'live', requestedConnectionId?: string | null) => {
    const sequence = ++refreshSequence.current; if (reason === 'manual') setRefreshing(true);
    const connectionId = requestedConnectionId === undefined ? selectedConnectionRef.current : requestedConnectionId;
    const connectionQuery = connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : '';
    const mentionQuery = connectionId ? `?limit=1000&connectionId=${encodeURIComponent(connectionId)}` : '?limit=1000';
    const reportQuery = connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : '';
    const results = await Promise.allSettled([
      api<XIntegrationStatus>(`/api/integrations/x${connectionQuery}`),
      api<SocialMention[]>(`/api/integrations/x/mentions${mentionQuery}`),
      api<SocialIntelligenceReport[]>(`/api/social/reports${reportQuery}`),
      api<SocialReplyDraft[]>('/api/social/reply-drafts')
    ]);
    if (sequence !== refreshSequence.current) return;
    const [nextStatus, nextMentions, nextReports, nextDrafts] = results;
    if (nextStatus.status === 'fulfilled') {
      setStatus(nextStatus.value);
      selectedConnectionRef.current = nextStatus.value.selectedConnectionId;
      setSelectedConnectionId(nextStatus.value.selectedConnectionId);
    }
    if (nextMentions.status === 'fulfilled') setMentions(nextMentions.value.filter((mention) => mention.source === 'x'));
    if (nextReports.status === 'fulfilled') setReports(nextReports.value);
    if (nextDrafts.status === 'fulfilled') {
      setReplyDrafts(nextDrafts.value);
      setDraftEdits((current) => Object.fromEntries(nextDrafts.value.map((draft) => [draft.id, current[draft.id] ?? draft.content])));
    }
    const failures = results.filter((result) => result.status === 'rejected') as PromiseRejectedResult[];
    setLoadError(failures.map((failure) => failure.reason instanceof Error ? failure.reason.message : 'A live data source could not refresh.').join(' '));
    setLoading(false); setRefreshing(false);
  }, []);

  useEffect(() => { void load('initial'); }, [load]);
  useEffect(() => { void loadPublishKnowledgeBases(); }, [loadPublishKnowledgeBases]);
  useLiveRefresh(useCallback(() => { void load('live'); }, [load]));
  useEffect(() => {
    const outcome = new URLSearchParams(window.location.search).get('x'); if (!outcome) return;
    if (outcome === 'connected') toast.success('X account connected. It is now available in the account switcher.');
    else if (outcome === 'denied') toast.error('X connection was cancelled.');
    else toast.error('X could not complete the connection. Confirm the exact callback URL and OAuth 2 credentials.');
    window.history.replaceState({}, '', '/social-listening');
  }, []);

  useEffect(() => {
    if (!expansionDialog || !selectedConnectionId || expansionStreams.length === 0) return;
    const sequence = ++expansionSequence.current;
    setExpansionEstimate(null); setExpansionEstimateError('');
    const query = new URLSearchParams({ limit: String(expansionLimit), streams: expansionStreams.join(',') });
    void api<XExpansionEstimate>(`/api/integrations/x/connections/${selectedConnectionId}/expansion-estimate?${query}`)
      .then((estimate) => { if (sequence === expansionSequence.current) setExpansionEstimate(estimate); })
      .catch((error) => { if (sequence === expansionSequence.current) setExpansionEstimateError(error instanceof Error ? error.message : 'The expansion estimate is unavailable.'); });
  }, [expansionDialog, expansionLimit, expansionStreams, selectedConnectionId, expansionEstimateRevision]);

  const connection = status?.connection || null;
  const latestSync = status?.syncJobs[0];
  const dispatchingSync = status?.syncJobs.find((job) => ['queued', 'processing', 'waiting_rate_limit'].includes(job.state));
  const visibleReplyDrafts = replyDrafts.filter((draft) => draft.connectionId === selectedConnectionId);
  const newestMentions = useMemo(() => [...mentions].sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime()), [mentions]);
  const mentionsById = useMemo(() => new Map(mentions.map((mention) => [mention.id, mention])), [mentions]);
  const filteredMentions = newestMentions.filter((mention) => stream === 'all' || mention.ingestionKind === stream || mention.metadata?.x?.streams?.includes(stream));
  const visibleMentions = filteredMentions.slice(0, savedVisibleLimit);
  const defaultReportMentionIds = useMemo(() => newestMentions.slice(0, reportLimit).map((mention) => mention.id), [newestMentions, reportLimit]);
  const reportMentionIds = selectedMentions ?? defaultReportMentionIds;
  const analysisMentionIds = reportMentionIds.slice(0, normalSyncLimit);
  const selected = new Set(reportMentionIds);
  const checkingCredits = status?.app.billing.status === 'checking_credits';
  const billingBlocked = ['credits_depleted', 'checking_credits'].includes(status?.app.billing.status || '') || latestSync?.state === 'waiting_billing';
  const canManageCollection = Boolean(status?.canManagePaidCollection);
  const canSync = canManageCollection && connection && ['connected', 'pending_verification', 'action_required'].includes(connection.status);
  const catchUpTargets = connection ? [
    connection.catchUp?.accountPosts.pending ? 'account posts' : null,
    connection.catchUp?.mentions.pending ? 'mentions' : null,
    status?.queries.some((query) => query.catchUpPending) ? 'saved searches' : null
  ].filter((value): value is string => Boolean(value)) : [];
  const activeReports = reports.filter((report) => report.state === 'queued').length;
  const activeDrafts = visibleReplyDrafts.filter((draft) => draft.state === 'queued').length;
  const activePublications = reports.some((report) => (report.publications || []).some((publication) => !['ready', 'completed', 'failed'].includes(publication.state)));
  const hasActiveSocialWork = Boolean(dispatchingSync || activeReports || activeDrafts || activePublications);
  useEffect(() => {
    if (!hasActiveSocialWork) return;
    const timer = window.setInterval(() => { void load('live'); }, 4_000);
    return () => window.clearInterval(timer);
  }, [hasActiveSocialWork, load]);
  const credentialsChanged = Object.values(credentials).some((value) => value.trim());
  const clientPair = Boolean(credentials.clientId.trim()) === Boolean(credentials.clientSecret.trim());
  const consumerPair = Boolean(credentials.consumerKey.trim()) === Boolean(credentials.consumerSecret.trim());
  const credentialsReady = credentialsChanged && clientPair && consumerPair
    && (Boolean(status?.app.configured) || Boolean(credentials.clientId.trim()) || Boolean(credentials.consumerKey.trim()));

  async function switchConnection(id: string) {
    selectedConnectionRef.current = id; setSelectedConnectionId(id); setSelectedMentions(null); setReportLimit(normalSyncLimit);
    setSavedVisibleLimit(savedPageSize); setStream('all'); await load('manual', id);
  }
  async function connect() {
    setWorking('connect');
    try { const result = await api<{ authorizeUrl: string }>('/api/integrations/x/connect', { method: 'POST' }); window.location.assign(result.authorizeUrl); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not start X sign-in.'); setWorking(''); }
  }
  async function syncNow() {
    if (!connection) return;
    setWorking('sync');
    try {
      const result = await api<{ created: boolean; resumed?: boolean }>(`/api/integrations/x/connections/${connection.id}/sync`, { method: 'POST' });
      toast.success(result.resumed ? 'Checking X credits and resuming the saved sync.' : result.created ? 'Latest-50 sync queued. Saved X posts will be reused.' : 'This account already has a sync waiting or running.');
      await load('manual');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not queue the X sync.'); }
    finally { setWorking(''); }
  }
  function toggleExpansionStream(value: XCollectionStream) {
    setExpansionStreams((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }
  async function expandCollection() {
    if (!connection || !expansionEstimate || expansionStreams.length === 0) return;
    setWorking('expand');
    try {
      const body = { limit: expansionLimit, streams: expansionStreams, planFingerprint: expansionEstimate.planFingerprint };
      const fingerprint = JSON.stringify(body);
      if (expansionRequest.current.fingerprint !== fingerprint) {
        expansionRequest.current = { fingerprint, key: crypto.randomUUID() };
      }
      const result = await api<{ created: boolean; estimate: XExpansionEstimate }>(`/api/integrations/x/connections/${connection.id}/expand`,
        { ...json('POST', body), headers: { 'idempotency-key': expansionRequest.current.key } });
      expansionRequest.current = { fingerprint: '', key: '' };
      setExpansionDialog(false);
      toast.success(result.created
        ? `Expansion queued for up to ${result.estimate.estimated.maximumProviderRows} X results. Saved IDs will be deduplicated locally.`
        : 'An equivalent collection run is already waiting or processing.');
      await load('manual');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not queue the X history expansion.');
      if (error instanceof ApiError && error.status === 409) {
        setExpansionEstimate(null); setExpansionEstimateError(''); setExpansionEstimateRevision((value) => value + 1);
      }
    }
    finally { setWorking(''); }
  }
  async function saveCredentials() {
    if (!clientPair) return toast.error('Enter the OAuth 2 client ID and client secret together.');
    if (!consumerPair) return toast.error('Enter the legacy consumer key and secret together.');
    const body = Object.fromEntries(Object.entries(credentials).filter(([, value]) => value.trim()));
    setWorking('credentials');
    try {
      await api('/api/integrations/x/app', json('PUT', body)); setCredentials(emptyCredentials); setCredentialDialog(false);
      toast.success('X developer credentials encrypted and saved.'); await load('manual');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save X credentials.'); }
    finally { setWorking(''); }
  }
  async function updateConnection(input: { autoSync?: boolean; syncIntervalMinutes?: number }) {
    if (!connection) return; setWorking('settings');
    try { await api(`/api/integrations/x/connections/${connection.id}`, json('PATCH', input)); await load('manual'); toast.success('Sync settings updated.'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not update X settings.'); }
    finally { setWorking(''); }
  }
  async function disconnect() {
    if (!connection || !window.confirm(`Disconnect ${connectionLabel(connection)}? Its retained posts and reports remain available until you delete history.`)) return;
    setWorking('disconnect');
    try { await api(`/api/integrations/x/connections/${connection.id}`, { method: 'DELETE' }); await load('manual'); toast.success('X account disconnected.'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not disconnect the X account.'); }
    finally { setWorking(''); }
  }
  async function deleteHistory() {
    if (!connection || !window.confirm(`Permanently delete the retained X posts, reply drafts, social reports, sync audit, and derived combined reports for ${connectionLabel(connection)}? Manually published knowledge documents remain and must be deleted from their knowledge base separately.`)) return;
    setWorking('delete-history');
    try { await api(`/api/integrations/x/connections/${connection.id}/history`, { method: 'DELETE' }); await load('manual'); toast.success('Retained X history and its saved reports were deleted. Published knowledge documents were kept.'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not delete X history.'); }
    finally { setWorking(''); }
  }
  async function removeApp() {
    if (!window.confirm('Remove the shared X developer app and disconnect all authorized accounts?')) return;
    setWorking('remove-app');
    try { await api('/api/integrations/x/app', { method: 'DELETE' }); setCredentialDialog(false); await load('manual', null); toast.success('X developer app removed.'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not remove the X developer app.'); }
    finally { setWorking(''); }
  }
  function openQuery(query?: XListeningQuery) {
    setEditingQuery(query || null); setQueryDraft(query ? { label: query.label, query: query.query, enabled: query.enabled } : { label: '', query: '', enabled: true }); setQueryDialog(true);
  }
  async function saveQuery() {
    if (!connection) return; setWorking('query');
    try {
      if (editingQuery) await api(`/api/integrations/x/queries/${editingQuery.id}`, json('PATCH', queryDraft));
      else await api(`/api/integrations/x/connections/${connection.id}/queries`, json('POST', queryDraft));
      setQueryDialog(false); await load('manual'); toast.success(editingQuery ? 'Listening query updated.' : 'Listening query added.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save the listening query.'); }
    finally { setWorking(''); }
  }
  async function deleteQuery(query: XListeningQuery) {
    if (!window.confirm(`Delete “${query.label}”?`)) return;
    try { await api(`/api/integrations/x/queries/${query.id}`, { method: 'DELETE' }); await load('manual'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not delete the query.'); }
  }
  async function createReplyDraft() {
    if (!replyMention) return; setWorking('reply');
    try {
      const fingerprint = JSON.stringify({ mentionId: replyMention.id, ...replyForm });
      if (replyRequest.current.fingerprint !== fingerprint) replyRequest.current = { fingerprint, key: crypto.randomUUID() };
      await api(`/api/social/mentions/${replyMention.id}/reply-drafts`, { ...json('POST', replyForm), headers: { 'idempotency-key': replyRequest.current.key } });
      replyRequest.current = { fingerprint: '', key: '' };
      setReplyMention(null); setReplyForm({ tone: 'helpful', instructions: '' }); setView('replies'); await load('manual');
      toast.success('Reply draft queued. Terra will never post it automatically.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not queue the reply draft.'); }
    finally { setWorking(''); }
  }
  async function saveReplyDraft(draft: SocialReplyDraft) {
    const content = draftEdits[draft.id]?.trim(); if (!content) return;
    setWorking(`draft:${draft.id}`);
    try { await api(`/api/social/reply-drafts/${draft.id}`, json('PATCH', { content })); await load('manual'); toast.success('Reply draft saved.'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save the reply draft.'); }
    finally { setWorking(''); }
  }
  function toggleReportMention(id: string) {
    setSelectedMentions((current) => {
      const selection = current ?? defaultReportMentionIds;
      if (selection.includes(id)) return selection.filter((mentionId) => mentionId !== id);
      if (selection.length >= 200) { toast.error('A social-intelligence report can include at most 200 saved posts.'); return selection; }
      return [...selection, id];
    });
  }
  function chooseReportLimit(value: 50 | 100 | 200) {
    setReportLimit(value); setSelectedMentions(null);
  }
  async function analyzeSelected() {
    if (analysisMentionIds.length === 0) return; setWorking('analyze');
    try {
      await api('/api/social/analyze', json('POST', { mentionIds: analysisMentionIds, knowledgeBaseIds }));
      toast.success(`${analysisMentionIds.length} saved ${analysisMentionIds.length === 1 ? 'post' : 'posts'} queued for grounded analysis.`);
      await load('manual');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not queue social analysis.'); }
    finally { setWorking(''); }
  }
  async function createReport() {
    if (!connection || reportMentionIds.length === 0) return; setWorking('report');
    try {
      const body = { connectionId: connection.id, title: reportTitle, mentionIds: reportMentionIds, knowledgeBaseIds };
      const fingerprint = JSON.stringify(body);
      if (reportRequest.current.fingerprint !== fingerprint) reportRequest.current = { fingerprint, key: crypto.randomUUID() };
      await api('/api/social/reports', { ...json('POST', body), headers: { 'idempotency-key': reportRequest.current.key } });
      reportRequest.current = { fingerprint: '', key: '' };
      setSelectedMentions(null); setReportLimit(normalSyncLimit); setView('intelligence'); await load('manual');
      toast.success(`Social-intelligence report queued with ${body.mentionIds.length} saved posts.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not queue social intelligence.'); }
    finally { setWorking(''); }
  }
  async function retryReport(report: SocialIntelligenceReport) {
    setWorking(`report:${report.id}`);
    try {
      await api(`/api/social/reports/${report.id}/retry`, json('POST', {}));
      await load('manual');
      toast.success(`Retry queued with the same ${report.mentionIds.length} saved posts and durable job.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not retry this report.');
    } finally { setWorking(''); }
  }
  async function publishReport(report: SocialIntelligenceReport, knowledgeBaseId: string) {
    if (!knowledgeBaseId || report.state !== 'completed') return;
    setWorking(`publish:${report.id}`);
    try {
      const response = await api<{
        report?: SocialIntelligenceReport; publication: SocialIntelligencePublication;
        deduplicated?: boolean; statusUrl?: string | null;
      }>(`/api/social/reports/${encodeURIComponent(report.id)}/publish`, json('POST', { knowledgeBaseId, reviewed: true }));
      const publication = { ...response.publication, statusUrl: response.statusUrl || response.publication.statusUrl || null };
      setReports((current) => current.map((item) => {
        if (item.id !== report.id) return item;
        const returned = response.report?.id === report.id ? response.report : item;
        const publications = (returned.publications || item.publications || []).filter((entry) => entry.knowledgeBaseId !== publication.knowledgeBaseId);
        return { ...returned, publications: [publication, ...publications] };
      }));
      toast.success(response.deduplicated ? 'This report is already published to that knowledge base.' : 'Reviewed intelligence published. Indexing has started.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not publish this intelligence report.'); }
    finally { setWorking(''); }
  }
  async function copyText(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); toast.success(`${label} copied.`); }
    catch { toast.error('Clipboard access was unavailable.'); }
  }

  if (!status && loading) return <div className="grid min-h-[55vh] place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!status) return <Card className="mx-auto mt-12 max-w-xl" role="alert"><CardHeader><CardTitle>X listening could not load</CardTitle><CardDescription>{loadError || 'The connector is unavailable.'}</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => void load('manual')}>Try again</Button></CardContent></Card>;

  const tabs: Array<[View, string]> = [
    ['listening', `Listening (${mentions.length})`], ['queries', `Queries (${status.queries.length})`], ['intelligence', `Intelligence (${reports.length})`],
    ['replies', `Reply drafts (${visibleReplyDrafts.length})`], ['history', 'Sync history'], ['connection', 'Connection']
  ];

  return <div className="space-y-5">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div><h1 className="text-2xl font-semibold tracking-tight">Social listening</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">Connect multiple X accounts, collect posts and mentions, preserve intelligence history, and draft human-reviewed replies.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={refreshing} onClick={() => void load('manual')}>{refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}Refresh</Button>{canSync && <Button size="sm" disabled={Boolean(dispatchingSync) || working === 'sync'} onClick={() => void syncNow()}>{working === 'sync' || dispatchingSync?.state === 'processing' ? <Loader2 className="animate-spin" /> : <Radar />}{billingBlocked ? 'Check credits and retry' : 'Sync latest 50'}</Button>}{canManageCollection && <Button size="sm" variant="outline" disabled={!status.app.configured || working === 'connect'} onClick={() => void connect()}>{working === 'connect' ? <Loader2 className="animate-spin" /> : <Plus />}Add X account</Button>}</div>
    </header>

    {loadError && <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">Some live data could not refresh. {loadError}</div>}
    {billingBlocked && <div className="flex flex-col justify-between gap-3 border border-amber-300 bg-amber-50 px-4 py-4 text-amber-950 sm:flex-row sm:items-center" role="alert"><div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><div className="text-sm font-semibold">{checkingCredits ? 'Checking X API credits' : 'X API credits are depleted'}</div><p className="mt-1 text-sm leading-6">{checkingCredits ? 'One saved sync is probing X now. Every other account remains safely queued until the check succeeds.' : 'The account login is valid, but X returns HTTP 402 for posts, mentions, and search. The saved sync will wait here without losing its cursor.'}</p>{latestSync?.error && <p className="mt-1 text-xs">{latestSync.error}</p>}</div></div><a className="text-sm font-semibold underline underline-offset-4" href="https://console.x.com" target="_blank" rel="noreferrer">Open X Developer Console</a></div>}

    <Card>
      <CardHeader className="border-b"><div className="flex flex-col justify-between gap-3 md:flex-row md:items-center"><div><CardTitle>X accounts</CardTitle><CardDescription className="mt-1">Each account authorizes independently through X. Tokens and refresh tokens remain encrypted.</CardDescription></div>{status.canManageAppCredentials && <Button size="sm" variant="outline" onClick={() => setCredentialDialog(true)}><Settings2 />Platform X settings</Button>}</div></CardHeader>
      <CardContent className="p-0">{status.connections.length ? <div className="divide-y">{status.connections.map((item) => <button key={item.id} onClick={() => void switchConnection(item.id)} aria-pressed={selectedConnectionId === item.id} className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors ${selectedConnectionId === item.id ? 'bg-muted/70' : 'hover:bg-muted/30'}`}><span className="flex min-w-0 items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border bg-background text-sm font-semibold">{item.account?.name?.slice(0, 1).toUpperCase() || 'X'}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{item.account?.name || 'X account'}</span><span className="block truncate text-xs text-muted-foreground">{connectionLabel(item)} · {item.authType === 'oauth2' ? 'OAuth 2' : 'Legacy OAuth 1'} · {item.counts?.collected || 0} posts</span></span></span><span className="flex items-center gap-3"><Badge variant={item.status === 'connected' ? 'success' : item.status === 'disconnected' ? 'secondary' : 'warning'}>{item.status.replaceAll('_', ' ')}</Badge>{selectedConnectionId === item.id && <Check className="h-4 w-4" />}</span></button>)}</div> : <div className="px-5 py-10"><div className="text-sm font-medium">No X account connected</div><p className="mt-1 text-sm text-muted-foreground">Configure the developer app, then use Add X account to authorize any X identity.</p></div>}</CardContent>
    </Card>

    {connection && <div className="grid grid-cols-2 border sm:grid-cols-3 lg:grid-cols-6">{[
      ['Collected', status.counts.collected], ['Account posts', status.counts.accountPosts], ['Mentions', status.counts.mentions],
      ['Search results', status.counts.searchResults], ['Terra analyzed', status.counts.analyzed], ['Saved reports', reports.length]
    ].map(([label, value]) => <div className="border-b border-r px-4 py-3 last:border-r-0 sm:border-b-0" key={String(label)}><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-xl font-semibold tabular-nums">{value}</div></div>)}</div>}

    {connection && <div className="flex flex-col justify-between gap-4 border bg-muted/20 px-4 py-4 md:flex-row md:items-center">
      <div className="flex min-w-0 gap-3"><Database className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" /><div><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{status.counts.collected} posts saved in this space</span>{catchUpTargets.length > 0 && <Badge variant="warning">Catch-up pending</Badge>}</div><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">Each routine sync reads at most {normalSyncLimit} provider results across the selected streams. Saved cursors resume unfinished pages; saved X IDs prevent duplicate storage and duplicate Terra analysis. Browsing the cache does not call X.</p>{catchUpTargets.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Next sync resumes {catchUpTargets.join(', ')} from the saved checkpoint.</p>}{latestSync && <p className="mt-1 text-xs text-muted-foreground">Latest run: {latestSync.importedCount} new · {latestSync.reusedCount ?? 0} already saved · {latestSync.providerRequests ?? 0} X requests{latestSync.deferredSearchQueries ? ` · ${latestSync.deferredSearchQueries} search ${latestSync.deferredSearchQueries === 1 ? 'query' : 'queries'} deferred` : ''}</p>}</div></div>
      {status.canManagePaidCollection ? <Button variant="outline" size="sm" className="shrink-0" disabled={Boolean(dispatchingSync)} onClick={() => setExpansionDialog(true)}>Estimate &amp; fetch older</Button> : <span className="max-w-48 text-xs leading-5 text-muted-foreground">A space owner or admin can approve additional paid history reads.</span>}
    </div>}

    <nav className="flex overflow-x-auto border-b" aria-label="Social listening sections">{tabs.map(([key, label]) => <button key={key} onClick={() => setView(key)} aria-current={view === key ? 'page' : undefined} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-medium ${view === key ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{label}</button>)}</nav>

    {!connection && <Card><CardContent className="py-14 text-center"><Users className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-sm font-medium">Connect an account to begin</div><p className="mt-1 text-sm text-muted-foreground">The same X developer app can authorize multiple X identities.</p></CardContent></Card>}

    {connection && view === 'listening' && <Card>
      <CardHeader className="border-b"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><CardTitle>Collected X posts</CardTitle><CardDescription className="mt-1">The newest {savedPageSize} saved posts are shown first. Selecting a post changes the report to a custom snapshot.</CardDescription></div><div className="flex flex-wrap gap-1">{(['all', 'account_post', 'mention', 'search'] as Stream[]).map((key) => <Button key={key} size="sm" variant={stream === key ? 'secondary' : 'ghost'} onClick={() => { setStream(key); setSavedVisibleLimit(savedPageSize); }}>{key === 'all' ? 'All' : streamLabel(key)}</Button>)}</div></div></CardHeader>
      <CardContent className="p-0">{visibleMentions.length ? <div className="divide-y">{visibleMentions.map((mention) => <article className="flex gap-3 p-5" key={mention.id}><button className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground" aria-label={`${selected.has(mention.id) ? 'Deselect' : 'Select'} post by ${mention.author}`} onClick={() => toggleReportMention(mention.id)}>{selected.has(mention.id) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}</button><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold text-foreground">{mention.author || 'X user'}</span><Badge variant="outline">{streamLabel(mention.ingestionKind)}</Badge><span className="text-muted-foreground">{formatDate(mention.publishedAt)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{mention.content}</p><div className="mt-3 flex flex-wrap items-center gap-2">{mention.analysis ? <><Badge variant="secondary" className="capitalize">{mention.analysis.sentiment}</Badge>{mention.analysis.themes?.slice(0, 3).map((theme: string) => <Badge variant="outline" key={theme}>{theme}</Badge>)}</> : <Badge variant="outline">Not analyzed</Badge>}<Button size="sm" variant="outline" onClick={() => setReplyMention(mention)}><MessageSquareReply />Draft reply</Button><a className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline" href={mention.url} target="_blank" rel="noreferrer">Open on X <ExternalLink className="h-3 w-3" /></a></div></div></article>)}</div> : <div className="px-5 py-14 text-center"><MessageSquareText className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-sm font-medium">No X posts collected yet</div><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{billingBlocked ? 'Add X API credits, then use Check credits and retry.' : 'Run the first sync to collect account posts and mentions.'}</p></div>}</CardContent>
      {filteredMentions.length > visibleMentions.length && <div className="flex flex-col justify-between gap-2 border-t px-5 py-3 sm:flex-row sm:items-center"><p className="text-xs text-muted-foreground">{visibleMentions.length} of {filteredMentions.length} saved posts shown. Loading more here uses the Seemplify cache and does not call X.</p><Button size="sm" variant="outline" onClick={() => setSavedVisibleLimit((current) => current + savedPageSize)}>Show {Math.min(savedPageSize, filteredMentions.length - visibleMentions.length)} more saved</Button></div>}
      {mentions.length > 0 && <div className="space-y-5 border-t bg-muted/20 px-5 py-4">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,380px)]">
          <div className="min-w-0"><Label htmlFor="social-report-scope">Posts for analysis and reporting</Label><div className="mt-2 flex flex-wrap items-center gap-2"><select id="social-report-scope" aria-label="Posts for analysis and reporting" value={selectedMentions === null ? String(reportLimit) : 'custom'} onChange={(event) => chooseReportLimit(Number(event.target.value) as 50 | 100 | 200)} className="h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="50">Latest 50 saved (default)</option><option value="100">Up to latest 100 saved</option><option value="200">Up to latest 200 saved</option>{selectedMentions !== null && <option value="custom" disabled>Custom selection ({selectedMentions.length})</option>}</select>{selectedMentions !== null && <Button size="sm" variant="ghost" onClick={() => { setSelectedMentions(null); setReportLimit(normalSyncLimit); }}>Reset to latest 50</Button>}</div><p className="mt-2 text-xs leading-5 text-muted-foreground">Reports use all {reportMentionIds.length} selected saved posts. Manual analysis is bounded to the first {analysisMentionIds.length} of this selection.</p></div>
          <KnowledgeBasePicker value={knowledgeBaseIds} onChange={setKnowledgeBaseIds} disabled={working === 'analyze' || working === 'report'} description="Optional. Ground manual post analysis and saved reports in up to five shared sources. Reply drafts remain based only on their X post." />
        </div>
        <div className="flex flex-col justify-between gap-3 border-t pt-4 sm:flex-row sm:items-end">
          <div className="w-full sm:max-w-sm"><Label htmlFor="social-report-title">Report title</Label><Input id="social-report-title" className="mt-2" value={reportTitle} onChange={(event) => setReportTitle(event.target.value)} /></div>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={working === 'analyze' || analysisMentionIds.length === 0} onClick={() => void analyzeSelected()}>{working === 'analyze' ? <Loader2 className="animate-spin" /> : <Radar />}Analyze {analysisMentionIds.length} {analysisMentionIds.length === 1 ? 'post' : 'posts'}</Button><Button size="sm" disabled={working === 'report' || reportTitle.trim().length < 2 || reportMentionIds.length === 0} onClick={() => void createReport()}>{working === 'report' ? <Loader2 className="animate-spin" /> : <BarChart3 />}Generate report</Button></div>
        </div>
      </div>}
    </Card>}

    {connection && view === 'queries' && <Card><CardHeader className="border-b"><div className="flex items-start justify-between gap-4"><div><CardTitle>Listening queries</CardTitle><CardDescription className="mt-1">Recent-search queries run for {connectionLabel(connection)} and consume X API credits.</CardDescription></div>{canManageCollection ? <Button size="sm" onClick={() => openQuery()}><Plus />Add query</Button> : <span className="text-xs text-muted-foreground">Owner/admin managed</span>}</div></CardHeader><CardContent className="p-0">{status.queries.length ? <div className="divide-y">{status.queries.map((query) => <div className="flex flex-col justify-between gap-3 p-5 md:flex-row md:items-center" key={query.id}><div><div className="flex items-center gap-2"><span className="text-sm font-semibold">{query.label}</span><Badge variant={query.enabled ? 'success' : 'secondary'}>{query.enabled ? 'Enabled' : 'Paused'}</Badge>{query.catchUpPending && <Badge variant="warning">Catch-up pending</Badge>}{query.historyExhausted && <Badge variant="secondary">History loaded</Badge>}</div><code className="mt-1 block break-all text-xs text-muted-foreground">{query.query}</code><div className="mt-2 text-xs text-muted-foreground">Last success: {formatDate(query.lastSuccessAt)}{query.lastError ? ` · ${query.lastError}` : ''}</div></div>{canManageCollection && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => openQuery(query)}>Edit</Button><Button size="icon" variant="ghost" aria-label={`Delete ${query.label}`} onClick={() => void deleteQuery(query)}><Trash2 /></Button></div>}</div>)}</div> : <div className="px-5 py-14 text-center"><Search className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-sm font-medium">No listening queries</div><p className="mt-1 text-sm text-muted-foreground">Account posts and mentions still sync without a public search query.</p></div>}</CardContent></Card>}

    {connection && view === 'intelligence' && <div className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Social intelligence history</h2><p className="mt-1 text-sm text-muted-foreground">Each report keeps its exact selected-post snapshot, dated observation window, provenance, and Terra runtime metadata.</p></div>{activeReports > 0 && <Badge variant="warning">{activeReports} processing</Badge>}</div>{reports.length ? reports.map((report) => <SocialReportCard key={report.id} report={report} mentionsById={mentionsById} knowledgeBases={publishKnowledgeBases} knowledgeBasesLoading={publishKnowledgeBasesLoading} knowledgeBasesError={publishKnowledgeBasesError} retrying={working === `report:${report.id}`} publishing={working === `publish:${report.id}`} retry={(item) => void retryReport(item)} publish={publishReport} reloadKnowledgeBases={() => void loadPublishKnowledgeBases()} />) : <Card><CardContent className="py-14 text-center"><FileText className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-sm font-medium">No saved social reports</div><p className="mt-1 text-sm text-muted-foreground">Select collected posts in Listening and generate the first report.</p></CardContent></Card>}</div>}

    {connection && view === 'replies' && <div className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Reply assistant</h2><p className="mt-1 text-sm text-muted-foreground">Drafts require human review. Seemplify does not post, like, follow, or message on X.</p></div>{activeDrafts > 0 && <Badge variant="warning">{activeDrafts} generating</Badge>}</div>{visibleReplyDrafts.length ? visibleReplyDrafts.map((draft) => { const mention = mentions.find((item) => item.id === draft.mentionId); return <Card key={draft.id}><CardHeader className="border-b"><div className="flex items-start justify-between"><div><CardTitle>{mention?.author || 'X reply draft'}</CardTitle><CardDescription className="mt-1">{draft.tone} · {formatDate(draft.createdAt)}</CardDescription></div><Badge variant={draft.state === 'failed' ? 'destructive' : draft.state === 'queued' ? 'warning' : 'success'}>{draft.state}</Badge></div></CardHeader><CardContent className="pt-5">{draft.state === 'queued' ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Terra is generating a draft.</div> : draft.state === 'failed' ? <p className="text-sm text-destructive">{draft.error}</p> : <div className="space-y-3"><Label htmlFor={`reply-${draft.id}`}>Editable draft</Label><Textarea id={`reply-${draft.id}`} maxLength={280} value={draftEdits[draft.id] ?? draft.content} onChange={(event) => setDraftEdits((current) => ({ ...current, [draft.id]: event.target.value }))} /><div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{(draftEdits[draft.id] ?? draft.content).length}/280 · Draft only — never posted automatically</span><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void copyText(draftEdits[draft.id] ?? draft.content, 'Reply draft')}><Copy />Copy</Button>{mention?.url && <Button size="sm" variant="outline" asChild><a href={mention.url} target="_blank" rel="noreferrer"><ExternalLink />Open on X</a></Button>}<Button size="sm" disabled={working === `draft:${draft.id}`} onClick={() => void saveReplyDraft(draft)}>{working === `draft:${draft.id}` ? <Loader2 className="animate-spin" /> : <Check />}Save draft</Button></div></div>{draft.rationale && <p className="border-t pt-3 text-xs leading-5 text-muted-foreground">Why Terra suggested this: {draft.rationale}</p>}</div>}</CardContent></Card>; }) : <Card><CardContent className="py-14 text-center"><MessageSquareReply className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-sm font-medium">No reply drafts</div><p className="mt-1 text-sm text-muted-foreground">Choose Draft reply beside a collected X post.</p></CardContent></Card>}</div>}

    {connection && view === 'history' && <Card><CardHeader><CardTitle>Sync history</CardTitle><CardDescription>Durable collection runs, including credit and rate-limit waits.</CardDescription></CardHeader><CardContent className="px-0 pb-0"><div className="overflow-x-auto"><table className="data-table min-w-[900px]"><thead><tr><th>Started</th><th>Account</th><th>Trigger</th><th>Status</th><th>Posts</th><th>Mentions</th><th>Search</th><th>New</th><th>Detail</th></tr></thead><tbody>{status.syncJobs.length ? status.syncJobs.map((job) => <tr key={job.id}><td className="whitespace-nowrap text-xs">{formatDate(job.startedAt || job.createdAt)}</td><td>{connectionLabel(connection)}</td><td className="capitalize">{job.trigger}</td><td>{jobBadge(job)}</td><td>{job.postsFetched}</td><td>{job.mentionsFetched}</td><td>{job.searchFetched}</td><td>{job.importedCount}</td><td className="max-w-sm text-xs text-muted-foreground">{job.error || job.stage.replaceAll('_', ' ')}{job.runAfter ? ` · resumes ${formatDate(job.runAfter)}` : ''}</td></tr>) : <tr><td colSpan={9} className="py-14 text-center text-sm text-muted-foreground">No sync history for this account.</td></tr>}</tbody></table></div></CardContent></Card>}

    {connection && view === 'connection' && <Card>
      <CardHeader className="border-b"><CardTitle>Connection settings</CardTitle><CardDescription>{connectionLabel(connection)} has independent scheduling, cursors, history, and OAuth access.</CardDescription></CardHeader>
      <CardContent className="space-y-6 pt-5">
        {!canManageCollection && <div className="border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">These controls are read-only for members. A space owner or admin manages API usage, authorization, and retained history.</div>}
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2"><div><Label htmlFor="sync-frequency">Sync frequency</Label><select id="sync-frequency" value={connection.syncIntervalMinutes} onChange={(event) => void updateConnection({ syncIntervalMinutes: Number(event.target.value) })} disabled={!canManageCollection || working === 'settings'} className="mt-2 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">{syncIntervals.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div><label className="flex items-center justify-between gap-4 border px-4 py-3"><span><span className="block text-sm font-medium">Automatic sync</span><span className="mt-0.5 block text-xs text-muted-foreground">Next: {connection.autoSync ? formatDate(connection.nextSyncAt) : 'Disabled'}</span></span><input type="checkbox" className="h-4 w-4" disabled={!canManageCollection || working === 'settings' || connection.status !== 'connected'} checked={connection.autoSync} onChange={(event) => void updateConnection({ autoSync: event.target.checked })} /></label></div>
        <div className="border-t pt-5"><div className="text-sm font-semibold">Authorization</div><p className="mt-1 text-sm text-muted-foreground">{connection.authType === 'oauth2' ? `OAuth 2 PKCE · scopes: ${connection.scopes.join(', ') || 'read access'} · token refreshes securely` : 'Legacy OAuth 1 connection. Reconnect after OAuth 2 configuration to receive scoped refreshable access.'}</p>{canManageCollection && (connection.status === 'disconnected' ? <Button className="mt-4" onClick={() => void connect()}><AtSign />Reconnect through X</Button> : <Button className="mt-4" variant="outline" disabled={working === 'disconnect'} onClick={() => void disconnect()}>{working === 'disconnect' ? <Loader2 className="animate-spin" /> : <Trash2 />}Disconnect account</Button>)}</div>
        <div className="border-t pt-5"><div className="text-sm font-semibold">Retained history</div><p className="mt-1 text-sm text-muted-foreground">Deleting removes collected posts unique to this account, reply drafts, social reports, dependent combined reports, and sync audit records. Manually published derived documents remain in their knowledge bases and must be deleted there separately.</p>{canManageCollection && <Button className="mt-4" variant="destructive" disabled={working === 'delete-history'} onClick={() => void deleteHistory()}>{working === 'delete-history' ? <Loader2 className="animate-spin" /> : <Trash2 />}Delete X history</Button>}</div>
      </CardContent>
    </Card>}

    <Dialog open={credentialDialog} onOpenChange={(open) => { if (!working) setCredentialDialog(open); }}><DialogContent className="max-h-[88vh] overflow-y-auto"><DialogHeader><DialogTitle>Platform X developer app</DialogTitle><DialogDescription>This is a platform-wide administrator setting used by every space. OAuth 2 lets members authorize their own X accounts; secrets are encrypted and never returned.</DialogDescription></DialogHeader><div className="space-y-4"><div className="border bg-muted/20 p-3"><div className="text-xs font-semibold">Callback URL</div><div className="mt-2 flex items-center gap-2"><code className="min-w-0 flex-1 select-all break-all text-xs">{status.callbackUrl}</code><Button variant="outline" size="icon" onClick={() => void copyText(status.callbackUrl, 'Callback URL')} aria-label="Copy callback URL"><Clipboard /></Button></div></div><div><Label htmlFor="x-client-id">OAuth 2 client ID</Label><Input id="x-client-id" type="password" autoComplete="off" value={credentials.clientId} onChange={(event) => setCredentials((current) => ({ ...current, clientId: event.target.value }))} placeholder={status.app.oauth2Configured ? 'Configured — leave blank to keep' : 'Required for Connect with X'} /></div><div><Label htmlFor="x-client-secret">OAuth 2 client secret</Label><Input id="x-client-secret" type="password" autoComplete="off" value={credentials.clientSecret} onChange={(event) => setCredentials((current) => ({ ...current, clientSecret: event.target.value }))} placeholder={status.app.oauth2Configured ? 'Configured — leave blank to keep' : 'Required for Connect with X'} /></div><div><Label htmlFor="x-bearer">Bearer token</Label><Input id="x-bearer" type="password" autoComplete="off" value={credentials.bearerToken} onChange={(event) => setCredentials((current) => ({ ...current, bearerToken: event.target.value }))} placeholder={status.app.bearerTokenConfigured ? 'Configured — leave blank to keep' : 'Optional app-only search token'} /></div><details className="border p-3"><summary className="cursor-pointer text-sm font-medium">Legacy OAuth 1 credentials</summary><div className="mt-4 space-y-4"><div><Label htmlFor="x-consumer-key">Consumer key</Label><Input id="x-consumer-key" type="password" value={credentials.consumerKey} onChange={(event) => setCredentials((current) => ({ ...current, consumerKey: event.target.value }))} placeholder={status.app.consumerCredentialsConfigured ? 'Configured — leave blank to keep' : 'Optional legacy support'} /></div><div><Label htmlFor="x-consumer-secret">Consumer key secret</Label><Input id="x-consumer-secret" type="password" value={credentials.consumerSecret} onChange={(event) => setCredentials((current) => ({ ...current, consumerSecret: event.target.value }))} placeholder={status.app.consumerCredentialsConfigured ? 'Configured — leave blank to keep' : 'Optional legacy support'} /></div></div></details>{status.app.configured && <div className="border-t pt-4"><div className="text-sm font-semibold">Remove platform integration</div><p className="mt-1 text-xs text-muted-foreground">Disconnects every space's X accounts and removes the shared developer credentials.</p><Button className="mt-3" variant="destructive" size="sm" disabled={Boolean(working)} onClick={() => void removeApp()}><Trash2 />Remove platform X app</Button></div>}</div><DialogFooter><Button variant="outline" onClick={() => setCredentialDialog(false)} disabled={Boolean(working)}>Cancel</Button><Button onClick={() => void saveCredentials()} disabled={Boolean(working) || !credentialsReady}>{working === 'credentials' ? <Loader2 className="animate-spin" /> : <Check />}Save platform settings</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={queryDialog} onOpenChange={setQueryDialog}><DialogContent><DialogHeader><DialogTitle>{editingQuery ? 'Edit listening query' : 'Add listening query'}</DialogTitle><DialogDescription>Recent-search syntax for {connection ? connectionLabel(connection) : 'the selected account'}.</DialogDescription></DialogHeader><div className="space-y-4"><div><Label htmlFor="query-label">Name</Label><Input id="query-label" value={queryDraft.label} onChange={(event) => setQueryDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Brand mentions" /></div><div><Label htmlFor="query-value">X query</Label><Input id="query-value" value={queryDraft.query} onChange={(event) => setQueryDraft((current) => ({ ...current, query: event.target.value }))} placeholder={'"Seemplify" -is:retweet'} /><p className="mt-1 text-xs text-muted-foreground">Up to 512 characters. Recent search currently covers seven days.</p></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={queryDraft.enabled} onChange={(event) => setQueryDraft((current) => ({ ...current, enabled: event.target.checked }))} />Run during sync</label></div><DialogFooter><Button variant="outline" onClick={() => setQueryDialog(false)}>Cancel</Button><Button onClick={() => void saveQuery()} disabled={working === 'query' || queryDraft.label.trim().length < 2 || queryDraft.query.trim().length < 2}>{working === 'query' ? <Loader2 className="animate-spin" /> : <Check />}{editingQuery ? 'Save changes' : 'Add query'}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={Boolean(replyMention)} onOpenChange={(open) => { if (!open && working !== 'reply') setReplyMention(null); }}><DialogContent><DialogHeader><DialogTitle>Draft a reply with Terra</DialogTitle><DialogDescription>Creates an editable suggestion only. Nothing is posted to X.</DialogDescription></DialogHeader>{replyMention && <div className="space-y-4"><div className="border bg-muted/20 p-3"><div className="text-xs font-semibold">{replyMention.author}</div><p className="mt-1 line-clamp-5 text-sm leading-6">{replyMention.content}</p></div><div><Label htmlFor="reply-tone">Tone</Label><select id="reply-tone" className="mt-2 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={replyForm.tone} onChange={(event) => setReplyForm((current) => ({ ...current, tone: event.target.value }))}><option value="helpful">Helpful</option><option value="empathetic">Empathetic</option><option value="concise">Concise</option><option value="professional">Professional</option><option value="warm">Warm</option></select></div><div><Label htmlFor="reply-guidance">Optional guidance</Label><Textarea id="reply-guidance" value={replyForm.instructions} onChange={(event) => setReplyForm((current) => ({ ...current, instructions: event.target.value }))} maxLength={1000} placeholder="What should the reply acknowledge or avoid?" /></div><div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-950">Draft only — no posting permission is requested and no automatic response is sent.</div></div>}<DialogFooter><Button variant="outline" onClick={() => setReplyMention(null)} disabled={working === 'reply'}>Cancel</Button><Button onClick={() => void createReplyDraft()} disabled={working === 'reply'}>{working === 'reply' ? <Loader2 className="animate-spin" /> : <MessageSquareReply />}Generate draft</Button></DialogFooter></DialogContent></Dialog>
    <ExpansionDialog
      open={expansionDialog} busy={working === 'expand'} blocked={Boolean(dispatchingSync)} billingBlocked={billingBlocked}
      limit={expansionLimit} streams={expansionStreams} estimate={expansionEstimate} error={expansionEstimateError}
      onOpenChange={setExpansionDialog} onLimitChange={setExpansionLimit} onToggleStream={toggleExpansionStream}
      onConfirm={() => void expandCollection()}
    />
  </div>;
}

function ExpansionDialog({ open, busy, blocked, billingBlocked, limit, streams, estimate, error, onOpenChange, onLimitChange, onToggleStream, onConfirm }: {
  open: boolean; busy: boolean; blocked: boolean; billingBlocked: boolean; limit: 100 | 200 | 500;
  streams: XCollectionStream[]; estimate: XExpansionEstimate | null; error: string;
  onOpenChange: (open: boolean) => void; onLimitChange: (limit: 100 | 200 | 500) => void;
  onToggleStream: (stream: XCollectionStream) => void; onConfirm: () => void;
}) {
  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}><DialogContent><DialogHeader><DialogTitle>Fetch older posts from X</DialogTitle><DialogDescription>Routine sync is limited to the latest {normalSyncLimit}. A larger history read is estimated first and only starts after you confirm it.</DialogDescription></DialogHeader><div className="space-y-5">
    <div><Label htmlFor="x-expansion-limit">Maximum X results to read</Label><select id="x-expansion-limit" value={limit} onChange={(event) => onLimitChange(Number(event.target.value) as 100 | 200 | 500)} className="mt-2 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{expansionLimits.map((value) => <option key={value} value={value}>Up to {value} provider results</option>)}</select></div>
    <fieldset><legend className="text-sm font-medium">Sources to expand</legend><div className="mt-2 divide-y border">{([['account_posts', 'Account posts'], ['mentions', 'Mentions'], ['searches', 'Saved listening queries']] as Array<[XCollectionStream, string]>).map(([value, label]) => <label key={value} className="flex items-center justify-between px-3 py-2.5 text-sm"><span>{label}</span><input type="checkbox" className="h-4 w-4" checked={streams.includes(value)} onChange={() => onToggleStream(value)} /></label>)}</div>{streams.length === 0 && <p className="mt-2 text-xs text-destructive">Choose at least one source.</p>}</fieldset>
    <div className="border bg-muted/20" aria-live="polite">{estimate ? <div className="divide-y"><div className="grid grid-cols-2 divide-x"><div className="p-3"><div className="text-xs text-muted-foreground">Already saved</div><div className="mt-1 text-lg font-semibold tabular-nums">{estimate.storedCount}</div></div><div className="p-3"><div className="text-xs text-muted-foreground">Maximum provider results</div><div className="mt-1 text-lg font-semibold tabular-nums">{estimate.estimated.maximumProviderRows}</div><div className="mt-1 text-xs text-muted-foreground">At most {estimate.estimated.maximumUniqueNewPosts} can be newly saved</div></div></div><div className="grid grid-cols-2 divide-x"><div className="p-3"><div className="text-xs text-muted-foreground">Estimated X requests</div><div className="mt-1 text-lg font-semibold tabular-nums">{estimate.estimated.providerRequests}</div></div><div className="p-3"><div className="text-xs text-muted-foreground">Payable-post upper bound</div><div className="mt-1 text-lg font-semibold tabular-nums">{estimate.estimated.payablePostsUpperBound}</div>{typeof estimate.estimated.maximumEstimatedCostUsd === 'number' && <div className="mt-1 text-xs text-muted-foreground">Up to US${estimate.estimated.maximumEstimatedCostUsd.toFixed(2)} at the standard read rate</div>}</div></div><div className="space-y-1 p-3 text-xs leading-5 text-muted-foreground"><p>This estimate reads only local saved state; it does not call X. Stored IDs are deduplicated after fetch, but X can return overlap across streams before Seemplify removes it.</p>{estimate.selectedQueryCount > 0 && <p>{estimate.selectedQueryCount} saved search {estimate.selectedQueryCount === 1 ? 'query is' : 'queries are'} included.</p>}{estimate.historyExhaustedStreams.length > 0 && <p>Skipped because all older history is already loaded: {estimate.historyExhaustedStreams.join(', ')}.</p>}<p>{estimate.disclaimer || 'The upper bound is not a currency quote; X billing depends on your developer plan.'}</p>{estimate.ownedReadNote && <p>{estimate.ownedReadNote}</p>}</div></div> : error ? <div className="p-3 text-sm text-destructive" role="alert">{error}</div> : <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Calculating from saved posts…</div>}</div>
    {billingBlocked && <div className="border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-950">X credits are currently unavailable. You can queue this expansion, but collection will wait durably for credits.</div>}
  </div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button><Button onClick={onConfirm} disabled={busy || !estimate || !estimate.canManagePaidCollection || streams.length === 0 || blocked}>{busy ? <Loader2 className="animate-spin" /> : <Radar />}Confirm &amp; read up to {estimate?.boundedLimit || limit}</Button></DialogFooter></DialogContent></Dialog>;
}
