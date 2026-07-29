import { useCallback, useEffect, useState } from 'react';
import { Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { api, json } from '@/lib/api';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import type { Survey } from '@/types';

type Ticket = { id: string; survey_id: string; response_id: string; title: string; priority: string; status: string; owner: string | null; notes: string | null; created_at: string };
export function TicketsPage() {
  const [surveys, setSurveys] = useState<Survey[]>([]); const [tickets, setTickets] = useState<Ticket[]>([]);
  const load = useCallback(async () => { const next = await api<Survey[]>('/api/surveys'); setSurveys(next); const rows = await Promise.all(next.map((survey) => api<Ticket[]>(`/api/surveys/${survey.id}/tickets`))); setTickets(rows.flat().sort((a, b) => b.created_at.localeCompare(a.created_at))); }, []);
  useEffect(() => { load(); }, [load]); useLiveRefresh(load);
  async function update(item: Ticket, status: string) { try { await api(`/api/tickets/${item.id}`, json('PATCH', { status })); toast.success('Recovery case updated'); load(); } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not update case'); } }
  const name = (id: string) => surveys.find((survey) => survey.id === id)?.title || id.slice(0, 8);
  return <div className="space-y-6"><div><h1 className="page-title">Service recovery</h1><p className="page-description">Close the loop on urgent and negative feedback identified by Terra.</p></div>{tickets.length ? <div className="overflow-hidden rounded-lg border bg-card"><div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Case</th><th>Survey</th><th>Priority</th><th>Status</th><th>Owner</th><th>Created</th><th /></tr></thead><tbody>{tickets.map((item) => <tr key={item.id}><td className="max-w-md"><div className="font-medium">{item.title}</div><div className="mt-1 font-mono text-[11px] text-muted-foreground">Response {item.response_id.slice(0, 8)}</div></td><td>{name(item.survey_id)}</td><td className="capitalize">{item.priority}</td><td className="capitalize">{item.status.replaceAll('_', ' ')}</td><td>{item.owner || 'Unassigned'}</td><td>{new Date(item.created_at).toLocaleDateString()}</td><td><div className="flex justify-end gap-1">{item.status === 'open' && <Button size="sm" variant="outline" onClick={() => update(item, 'in_progress')}>Start</Button>}{item.status !== 'closed' && <Button size="sm" onClick={() => update(item, 'closed')}>Close</Button>}</div></td></tr>)}</tbody></table></div></div> : <EmptyState icon={Inbox} title="No recovery cases" description="Terra creates a case when completed feedback is negative or urgent." />}</div>;
}
