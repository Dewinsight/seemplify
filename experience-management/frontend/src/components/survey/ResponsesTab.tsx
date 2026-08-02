import { useEffect, useState } from 'react';
import { Eye, MessageSquareText, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api, json } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/EmptyState';
import { formatDate } from '@/lib/utils';
import type { ResponseRecord, Survey } from '@/types';

export function ResponsesTab({ survey, refreshKey }: { survey: Survey; refreshKey: number }) {
  const [responses, setResponses] = useState<ResponseRecord[]>([]);
  const [selected, setSelected] = useState<ResponseRecord | null>(null);
  const load = () => api<ResponseRecord[]>(`/api/surveys/${survey.id}/responses`).then(setResponses);
  useEffect(() => { load(); }, [survey.id, refreshKey]);
  async function analyze(item: ResponseRecord) { try { await api(`/api/responses/${item.id}/analyze`, json('POST')); toast.success('Analysis queued'); } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not queue analysis'); } }
  const question = (id: string) => survey.questions?.find((item) => item.id === id)?.title || id;
  return <div className="space-y-4">
    <div className="flex items-end justify-between gap-4"><div><h2 className="section-title">Individual responses</h2><p className="mt-1 text-sm text-muted-foreground">Inspect raw answers and Terra's evidence-grounded analysis.</p></div><Button variant="outline" size="sm" onClick={load}><RefreshCw />Refresh</Button></div>
    {responses.length ? <div className="overflow-hidden rounded-lg border bg-card"><div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Response</th><th>Status</th><th>Completed</th><th>Duration</th><th>AI analysis</th><th /></tr></thead><tbody>{responses.map((item) => <tr key={item.id}><td className="font-mono text-xs">{item.id.slice(0, 8)}</td><td className="capitalize">{item.status}</td><td>{formatDate(item.completedAt || item.startedAt)}</td><td>{item.durationSeconds == null ? '—' : `${item.durationSeconds}s`}</td><td>{item.aiAnalysis ? <span className="capitalize">{item.aiAnalysis.sentiment?.replaceAll('_', ' ') || 'Complete'}</span> : <Button variant="ghost" size="sm" onClick={() => analyze(item)}><MessageSquareText />Analyse</Button>}</td><td className="text-right"><Button variant="outline" size="sm" onClick={() => setSelected(item)}><Eye />Open</Button></td></tr>)}</tbody></table></div></div> : <EmptyState icon={MessageSquareText} title="No responses yet" description="Publish and share a collector. Responses will appear here in real time." />}
    <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}><DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Response {selected?.id.slice(0, 8)}</DialogTitle><DialogDescription>{selected ? formatDate(selected.completedAt || selected.startedAt) : ''}</DialogDescription></DialogHeader>{selected && <div className="space-y-5"><div className="divide-y border">{Object.entries(selected.answers).map(([id, value]) => <div className="p-4" key={id}><div className="text-xs font-medium text-muted-foreground">{question(id)}</div><div className="mt-1 whitespace-pre-wrap text-sm">{Array.isArray(value) ? value.join(', ') : String(value)}</div></div>)}</div>{selected.aiAnalysis ? <div className="border bg-muted/30 p-4"><div className="flex items-center justify-between"><div className="font-semibold">Terra analysis</div><span className="text-xs capitalize text-muted-foreground">{selected.aiAnalysis.sentiment?.replaceAll('_', ' ')}</span></div><p className="mt-3 text-sm leading-6">{selected.aiAnalysis.summary}</p>{selected.aiAnalysis.topics?.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{selected.aiAnalysis.topics.map((topic: any) => <span className="border bg-background px-2 py-1 text-xs" key={topic.name}>{topic.name}</span>)}</div>}</div> : <Button onClick={() => analyze(selected)}><MessageSquareText />Queue Terra analysis</Button>}</div>}</DialogContent></Dialog>
  </div>;
}
