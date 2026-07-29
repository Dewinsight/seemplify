import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Loader2, Plus, Radar, RefreshCw, Trash2, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { api, json } from '@/lib/api';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { AiJob, SocialMention } from '@/types';

const sourceLabels: Record<SocialMention['source'], string> = {
  x: 'X / Twitter', google_play: 'Google Play', app_store: 'App Store', review: 'Review site', forum: 'Forum', other: 'Other'
};

const sentimentStyle: Record<string, string> = {
  positive: 'bg-emerald-500', neutral: 'bg-slate-400', mixed: 'bg-amber-500', negative: 'bg-red-500'
};

function riskVariant(risk?: string) {
  if (risk === 'critical' || risk === 'high') return 'destructive' as const;
  if (risk === 'medium') return 'warning' as const;
  return 'secondary' as const;
}

export function SocialListeningPage() {
  const [mentions, setMentions] = useState<SocialMention[]>([]);
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [source, setSource] = useState<SocialMention['source']>('review');
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const load = useCallback(() => Promise.all([
    api<SocialMention[]>('/api/social/mentions?limit=500'), api<AiJob[]>('/api/ai/jobs?limit=500')
  ]).then(([nextMentions, nextJobs]) => { setMentions(nextMentions); setJobs(nextJobs); }), []);

  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(load);

  const socialJobs = useMemo(() => jobs.filter((job) => job.kind === 'social.analyze'), [jobs]);
  const activeJobs = socialJobs.filter((job) => job.state === 'queued' || job.state === 'processing');
  const latestAnalysis = socialJobs.find((job) => job.state === 'completed')?.result?.output;
  const analyzed = mentions.filter((mention) => mention.analysis);
  const sentimentCounts = Object.fromEntries(['positive', 'neutral', 'mixed', 'negative'].map((sentiment) => [sentiment, analyzed.filter((mention) => mention.analysis?.sentiment === sentiment).length]));
  const highRisk = analyzed.filter((mention) => ['high', 'critical'].includes(mention.analysis?.risk)).length;

  async function importMentions() {
    const lines = draft.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return toast.error('Paste at least one public mention, one per line.');
    setSubmitting(true);
    try {
      const result = await api<{ mentions: SocialMention[]; jobId: string | null }>('/api/social/mentions', json('POST', {
        mentions: lines.map((content) => ({ source, content, publishedAt: new Date().toISOString() })), analyze: true
      }));
      setDraft('');
      toast.success(`${result.mentions.length} mention${result.mentions.length === 1 ? '' : 's'} imported and queued for Terra.`);
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not import mentions.'); }
    finally { setSubmitting(false); }
  }

  async function analyzeAll() {
    if (!mentions.length) return toast.error('Import mentions before starting an analysis.');
    setSubmitting(true);
    try {
      await api('/api/social/analyze', json('POST', {}));
      toast.success('Social listening analysis queued.');
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not queue analysis.'); }
    finally { setSubmitting(false); }
  }

  async function removeMention(id: string) {
    try { await api(`/api/social/mentions/${id}`, { method: 'DELETE' }); await load(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not remove mention.'); }
  }

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
      <div><h1 className="page-title">Social listening</h1><p className="page-description">Import public mentions from approved sources, then use Terra to find sentiment, themes, emerging risks, and opportunities.</p></div>
      <div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw />Refresh</Button><Button size="sm" onClick={analyzeAll} disabled={submitting || !mentions.length}>{submitting ? <Loader2 className="animate-spin" /> : <Radar />}Analyze all</Button></div>
    </div>

    <div className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-2 xl:grid-cols-4">
      {[
        ['Imported mentions', mentions.length, `${new Set(mentions.map((mention) => mention.source)).size} sources`],
        ['Analyzed', analyzed.length, `${activeJobs.length} active jobs`],
        ['Positive', sentimentCounts.positive || 0, analyzed.length ? `${Math.round(((sentimentCounts.positive || 0) / analyzed.length) * 100)}% of analyzed` : 'Awaiting analysis'],
        ['High-risk mentions', highRisk, highRisk ? 'Review recommended' : 'No high risk detected']
      ].map(([label, value, note]) => <div className="border-b border-r p-4" key={label}><div className="text-xs font-medium text-muted-foreground">{label}</div><div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div><div className="mt-1 text-xs text-muted-foreground">{note}</div></div>)}
    </div>

    <div className="grid items-start gap-6 xl:grid-cols-[390px_minmax(0,1fr)]">
      <Card>
        <CardHeader><CardTitle>Import mentions</CardTitle><CardDescription>Paste one public post or review per line. Imported data is analyzed as a bounded dataset; the product does not claim to scrape an entire network.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2"><Label htmlFor="mention-source">Source</Label><select id="mention-source" aria-label="Mention source" value={source} onChange={(event) => setSource(event.target.value as SocialMention['source'])} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <div className="space-y-2"><Label htmlFor="mention-content">Public mentions</Label><Textarea id="mention-content" value={draft} onChange={(event) => setDraft(event.target.value)} rows={9} placeholder={'Delivery was quick, but setup took too long.\nSupport solved my issue in minutes.'} /><p className="text-xs leading-5 text-muted-foreground">Up to 200 lines per import. Use only data you are permitted to process.</p></div>
          <Button className="w-full" onClick={importMentions} disabled={submitting}>{submitting ? <Loader2 className="animate-spin" /> : <Plus />}Import and analyze</Button>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader className="border-b"><div className="flex items-start justify-between gap-4"><div><CardTitle>Terra intelligence</CardTitle><CardDescription className="mt-1">The latest completed analysis across the selected imported dataset.</CardDescription></div>{activeJobs.length ? <Badge variant="warning">{activeJobs.length} in queue</Badge> : latestAnalysis ? <Badge variant="success">Current</Badge> : <Badge variant="secondary">No analysis</Badge>}</div></CardHeader>
          <CardContent className="pt-5">
            {latestAnalysis ? <div className="space-y-6">
              <p className="max-w-4xl text-sm leading-6 text-foreground">{latestAnalysis.executiveSummary}</p>
              <div className="grid gap-5 lg:grid-cols-2">
                <section><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><BarChart3 className="h-4 w-4 text-primary" />Sentiment mix</div><div className="space-y-3">{['positive', 'neutral', 'mixed', 'negative'].map((sentiment) => { const value = Number(latestAnalysis.sentiment?.[sentiment] || 0); const total = Object.values(latestAnalysis.sentiment || {}).reduce((sum: number, count) => sum + Number(count), 0) || 1; return <div key={sentiment}><div className="mb-1 flex justify-between text-xs"><span className="capitalize">{sentiment}</span><span className="text-muted-foreground">{value}</span></div><div className="h-1.5 overflow-hidden bg-muted"><div className={`h-full ${sentimentStyle[sentiment]}`} style={{ width: `${Math.min(100, (value / total) * 100)}%` }} /></div></div>; })}</div></section>
                <section><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><TrendingUp className="h-4 w-4 text-primary" />Leading themes</div><div className="space-y-2">{latestAnalysis.themes?.slice(0, 5).map((theme: any) => <div key={theme.name} className="flex items-center justify-between border-b py-2 text-sm"><span>{theme.name}</span><span className="text-xs text-muted-foreground">{theme.mentions} mentions · {theme.sentiment}</span></div>)}</div></section>
              </div>
              {(latestAnalysis.risks?.length || latestAnalysis.opportunities?.length) && <div className="grid gap-4 lg:grid-cols-2">
                <section className="border p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-amber-600" />Reputation risks</div><div className="space-y-3">{latestAnalysis.risks?.slice(0, 4).map((risk: any) => <div key={risk.issue}><div className="flex items-start justify-between gap-3 text-sm"><span className="font-medium">{risk.issue}</span><Badge variant={riskVariant(risk.severity)}>{risk.severity}</Badge></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{risk.action}</p></div>)}</div></section>
                <section className="border p-4"><div className="mb-3 text-sm font-semibold">Opportunities</div><div className="space-y-3">{latestAnalysis.opportunities?.slice(0, 4).map((item: any) => <div key={item.opportunity}><div className="text-sm font-medium">{item.opportunity}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.action}</p></div>)}</div></section>
              </div>}
            </div> : <div className="py-12 text-center"><Radar className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-sm font-medium">No listening analysis yet</div><p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">Import a small set of permitted public mentions. Terra will analyze them through the durable local queue.</p></div>}
          </CardContent>
        </Card>
      </div>
    </div>

    <Card>
      <CardHeader><CardTitle>Mention history</CardTitle><CardDescription>Every imported mention remains visible with its source, Terra classification, and processing state.</CardDescription></CardHeader>
      <CardContent className="px-0 pb-0"><div className="overflow-x-auto"><table className="data-table min-w-[850px]"><thead><tr><th>Source</th><th>Mention</th><th>Sentiment</th><th>Themes</th><th>Risk</th><th>Published</th><th /></tr></thead><tbody>{mentions.length ? mentions.map((mention) => <tr key={mention.id}><td><Badge variant="outline">{sourceLabels[mention.source]}</Badge></td><td className="max-w-xl"><div className="line-clamp-2 text-sm leading-5">{mention.content}</div>{mention.author && <div className="mt-1 text-xs text-muted-foreground">{mention.author}</div>}</td><td className="capitalize">{mention.analysis?.sentiment || <span className="text-muted-foreground">Queued</span>}</td><td><div className="flex max-w-xs flex-wrap gap-1">{mention.analysis?.themes?.slice(0, 3).map((theme: string) => <Badge variant="secondary" key={theme}>{theme}</Badge>) || '—'}</div></td><td>{mention.analysis?.risk ? <Badge variant={riskVariant(mention.analysis.risk)}>{mention.analysis.risk}</Badge> : '—'}</td><td className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(mention.publishedAt)}</td><td><Button variant="ghost" size="icon" aria-label="Remove mention" onClick={() => void removeMention(mention.id)}><Trash2 /></Button></td></tr>) : <tr><td colSpan={7} className="py-16 text-center text-sm text-muted-foreground">No mentions have been imported.</td></tr>}</tbody></table></div></CardContent>
    </Card>
  </div>;
}
