import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2, Megaphone, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api, json } from '@/lib/api';
import { Link, useNavigate } from '@/lib/router';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Campaign, CampaignDetail, Survey } from '@/types';

function campaignVariant(status: Campaign['status']) {
  if (status === 'active') return 'success' as const;
  if (status === 'paused') return 'warning' as const;
  if (status === 'completed') return 'secondary' as const;
  return 'outline' as const;
}

export function CampaignsPage() {
  const navigate = useNavigate();
  const requestedSurvey = useMemo(() => new URLSearchParams(window.location.search).get('survey') || '', []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [name, setName] = useState('Customer feedback campaign');
  const [surveyId, setSurveyId] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const [campaignRows, surveyRows] = await Promise.all([api<Campaign[]>('/api/campaigns'), api<Survey[]>('/api/surveys')]);
      setCampaigns(campaignRows); setSurveys(surveyRows);
      setSurveyId((current) => {
        if (current && surveyRows.some((survey) => survey.id === current)) return current;
        return requestedSurvey && surveyRows.some((survey) => survey.id === requestedSurvey) ? requestedSurvey : '';
      });
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not load campaigns.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const selectedSurvey = surveys.find((survey) => survey.id === surveyId);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!selectedSurvey) return toast.error('Select the survey for this campaign.');
    try {
      setCreating(true);
      const result = await api<CampaignDetail>('/api/campaigns', json('POST', { name, surveyId }));
      toast.success('Campaign draft created');
      navigate(`/campaigns/${result.campaign.id}`);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not create campaign.'); }
    finally { setCreating(false); }
  }

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><h1 className="page-title">Campaigns</h1><p className="page-description">Send a survey to a defined audience, follow up automatically, and track every delivery and response.</p></div>
    </div>
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>All campaigns</CardTitle></CardHeader>
        <CardContent className="px-0 pb-0">
          {loading ? <div className="h-56 animate-pulse bg-muted/50" /> : campaigns.length ? <div className="overflow-x-auto"><table className="data-table min-w-[760px]"><thead><tr><th>Campaign</th><th>Status</th><th>Audience</th><th>Accepted</th><th>Responses</th><th>Updated</th><th /></tr></thead><tbody>
            {campaigns.map((campaign) => <tr key={campaign.id}><td><div className="font-medium">{campaign.name}</div><div className="mt-1 text-xs text-muted-foreground">{campaign.surveyTitle || 'Survey campaign'}</div></td><td><Badge variant={campaignVariant(campaign.status)} className="capitalize">{campaign.status}</Badge></td><td>{campaign.contactCount || 0}</td><td>{campaign.sentCount || 0}</td><td>{campaign.respondedCount || 0}</td><td>{formatDate(campaign.updatedAt)}</td><td className="text-right"><Button variant="ghost" size="sm" asChild><Link to={`/campaigns/${campaign.id}`}>Open <ArrowRight /></Link></Button></td></tr>)}
          </tbody></table></div> : <div className="px-6 py-16 text-center"><Megaphone className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-sm font-medium">No campaigns yet</div><p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">Create a campaign to attach a survey, import contacts, and build a measured email sequence.</p></div>}
        </CardContent>
      </Card>
      <Card className="h-fit xl:sticky xl:top-24"><CardHeader><CardTitle>Create campaign</CardTitle></CardHeader><CardContent><form className="space-y-4" onSubmit={create}>
        <div><Label className="field-label" htmlFor="campaign-name">Name</Label><Input id="campaign-name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} required /></div>
        <div><Label className="field-label" htmlFor="campaign-survey">Survey</Label><select id="campaign-survey" aria-describedby="campaign-survey-help" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={surveyId} onChange={(event) => setSurveyId(event.target.value)} required><option value="">Select the survey to send</option>{surveys.map((survey) => <option value={survey.id} key={survey.id}>{survey.title} ({survey.status})</option>)}</select><p id="campaign-survey-help" className="mt-1 text-xs leading-5 text-muted-foreground">{selectedSurvey ? `${selectedSurvey.title} is selected for this campaign. You can change it before creating the draft.` : 'Choose the exact survey for this campaign. No survey is selected automatically.'}</p></div>
        <Button className="w-full" disabled={loading || creating || !selectedSurvey}>{creating ? <Loader2 className="animate-spin" /> : <Plus />}{creating ? 'Creating' : 'Create campaign'}</Button>
        {!surveys.length && !loading && <p className="text-xs leading-5 text-muted-foreground">You need a survey before creating a campaign. <Link className="font-medium underline" to="/surveys/new">Create one now.</Link></p>}
      </form></CardContent></Card>
    </div>
  </div>;
}
