import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Plus, Search } from 'lucide-react';
import { Link } from '@/lib/router';
import { api } from '@/lib/api';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/EmptyState';
import { SurveyStatus } from '@/components/StatusBadge';
import type { Survey } from '@/types';

export function SurveysPage() {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [search, setSearch] = useState('');
  const load = useCallback(() => api<Survey[]>('/api/surveys').then(setSurveys), []);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load);
  const visible = surveys.filter((survey) => `${survey.title} ${survey.description} ${survey.audience}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h1 className="page-title">Surveys</h1><p className="page-description">Build, distribute, and analyse customer, employee, and market-research programmes.</p></div><Button asChild><Link to="/surveys/new"><Plus />Create survey</Link></Button></div>
    <div className="flex items-center gap-3 border-b pb-4"><div className="relative max-w-sm flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search surveys" value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="text-sm text-muted-foreground">{visible.length} survey{visible.length === 1 ? '' : 's'}</div></div>
    {visible.length ? <div className="overflow-hidden rounded-lg border bg-card"><div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Name</th><th>Status</th><th>Metric</th><th>Collectors</th><th>Responses</th><th>Updated</th><th /></tr></thead><tbody>{visible.map((survey) => <tr key={survey.id}><td className="min-w-72"><div className="font-medium">{survey.title}</div><div className="mt-1 line-clamp-1 text-xs text-muted-foreground">{survey.description || survey.audience}</div></td><td><SurveyStatus status={survey.status} /></td><td className="uppercase">{survey.primaryMetric}</td><td>{survey.collectorCount || 0}</td><td>{survey.responseCount || 0}</td><td>{formatDate(survey.updatedAt)}</td><td className="text-right"><Button size="sm" variant="outline" asChild><Link to={`/surveys/${survey.id}`}>Open</Link></Button></td></tr>)}</tbody></table></div></div> : <EmptyState icon={ClipboardList} title={search ? 'No matching surveys' : 'Create your first survey'} description={search ? 'Try another title, audience, or keyword.' : 'Use a research template, start from scratch, or have Terra build the first draft.'} action={!search && <Button asChild><Link to="/surveys/new">Create survey</Link></Button>} />}
  </div>;
}
