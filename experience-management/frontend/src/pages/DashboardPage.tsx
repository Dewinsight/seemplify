import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CircleAlert, ClipboardList, Inbox, MailCheck, MessageSquareText } from 'lucide-react';
import { Link } from '@/lib/router';
import { api } from '@/lib/api';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { formatDate, humanizeActivity } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/EmptyState';
import { SurveyStatus, JobStatus } from '@/components/StatusBadge';
import type { AiJob, Survey } from '@/types';

type Bootstrap = { surveys: Survey[]; overview: { surveys: number; liveSurveys: number; responses: number; openTickets: number }; recentJobs: AiJob[]; email: { configured: boolean; mode: string } };

export function DashboardPage() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const load = useCallback(() => api<Bootstrap>('/api/bootstrap').then(setData), []);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load);
  if (!data) return <div className="h-64 animate-pulse bg-muted" />;
  return <div className="min-w-0 space-y-6">
    <div className="flex min-w-0 flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div className="min-w-0"><h1 className="page-title">Experience overview</h1><p className="page-description">Create research, collect feedback, and turn every response into an action your team can track.</p></div>
      <Button variant="outline" asChild><Link to="/surveys">View all surveys<ArrowRight /></Link></Button>
    </div>
    <Card>
      <div className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
        {[
          ['Surveys', data.overview.surveys, `${data.overview.liveSurveys} live`],
          ['Responses', data.overview.responses, 'All collectors'],
          ['Recovery cases', data.overview.openTickets, 'Open or in progress'],
          ['Email delivery', data.email.configured ? 'Ready' : 'Needs key', data.email.configured ? 'Shared Brevo account' : 'Configure Brevo locally']
        ].map(([label, value, note]) => <div className="p-5" key={label}><div className="text-sm text-muted-foreground">{label}</div><div className="metric-value mt-2">{value}</div><div className="mt-1 text-xs text-muted-foreground">{note}</div></div>)}
      </div>
    </Card>
    <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="min-w-0">
        <CardHeader className="flex-row items-center justify-between"><CardTitle>Recently updated surveys</CardTitle><Button variant="ghost" size="sm" asChild><Link to="/surveys">Manage</Link></Button></CardHeader>
        <CardContent className="min-w-0 px-0 pb-0">
          {data.surveys.length ? <div className="max-w-full overflow-x-auto"><table className="data-table"><thead><tr><th>Survey</th><th>Status</th><th>Responses</th><th>Updated</th><th /></tr></thead><tbody>{data.surveys.slice(0, 7).map((survey) => <tr key={survey.id}><td><div className="font-medium">{survey.title}</div><div className="mt-0.5 text-xs text-muted-foreground">{survey.purpose.replaceAll('_', ' ')}</div></td><td><SurveyStatus status={survey.status} /></td><td>{survey.responseCount || 0}</td><td>{formatDate(survey.updatedAt)}</td><td className="text-right"><Button size="sm" variant="ghost" asChild><Link to={`/surveys/${survey.id}`}>Open</Link></Button></td></tr>)}</tbody></table></div> : <EmptyState icon={ClipboardList} title="No surveys yet" description="Start with an expert template or ask Terra to design one from your objective." action={<Button asChild><Link to="/surveys/new">Create survey</Link></Button>} className="border-x-0 border-b-0" />}
        </CardContent>
      </Card>
      <div className="min-w-0 space-y-6">
        {!data.email.configured && <div className="flex gap-3 border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><div><div className="font-semibold">Brevo is not configured locally</div><p className="mt-1 text-amber-800">Survey links work now. Email collectors will be ready when the shared Seemplify key is available to this service.</p></div></div>}
        <Card><CardHeader><CardTitle>Recent AI work</CardTitle></CardHeader><CardContent className="space-y-0 px-0 pb-0">{data.recentJobs.length ? data.recentJobs.slice(0, 6).map((job) => <Link to="/ai-queue" key={job.id} className="flex items-center justify-between border-t px-5 py-3 text-sm hover:bg-muted/30"><div><div className="font-medium">{humanizeActivity(job.kind)}</div><div className="text-xs text-muted-foreground">{formatDate(job.createdAt)}</div></div><JobStatus job={job} /></Link>) : <div className="border-t px-5 py-8 text-center text-sm text-muted-foreground">Terra activity will appear here.</div>}</CardContent></Card>
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1"><Button variant="outline" className="h-auto justify-start py-3" asChild><Link to="/assistant"><MailCheck />Personal assistant</Link></Button><Button variant="outline" className="h-auto justify-start py-3" asChild><Link to="/ai-queue"><MessageSquareText />AI queue</Link></Button><Button variant="outline" className="h-auto justify-start py-3" asChild><Link to="/tickets"><Inbox />Recovery</Link></Button></div>
      </div>
    </div>
  </div>;
}
