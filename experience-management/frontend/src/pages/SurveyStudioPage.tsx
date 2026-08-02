import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check, ExternalLink, Loader2, Save } from 'lucide-react';
import { Link, useParams } from '@/lib/router';
import { toast } from 'sonner';
import { api, json } from '@/lib/api';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SurveyStatus } from '@/components/StatusBadge';
import { BuilderTab } from '@/components/survey/BuilderTab';
import { CollectTab } from '@/components/survey/CollectTab';
import { ResponsesTab } from '@/components/survey/ResponsesTab';
import { AnalyticsTab } from '@/components/survey/AnalyticsTab';
import { AiTab } from '@/components/survey/AiTab';
import { SettingsTab } from '@/components/survey/SettingsTab';
import type { Survey, SurveyDetail } from '@/types';

export function SurveyStudioPage() {
  const { id = '' } = useParams();
  const [data, setData] = useState<SurveyDetail | null>(null);
  const [draft, setDraft] = useState<Survey | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  useUnsavedChanges(dirty);
  const load = useCallback(() => api<SurveyDetail>(`/api/surveys/${id}`).then((next) => { setData(next); setDraft((current) => dirty ? current : next.survey); setRefreshKey((value) => value + 1); }), [id, dirty]);
  useEffect(() => { load(); }, [id]);
  useLiveRefresh(() => { if (!dirty) load(); });
  function change(next: Survey) { setDraft(next); setDirty(true); }
  async function save() { if (!draft) return; try { setSaving(true); const saved = await api<Survey>(`/api/surveys/${id}`, json('PUT', draft)); setDraft(saved); setDirty(false); toast.success('Survey saved'); await load(); } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save survey'); } finally { setSaving(false); } }
  async function publish(status: 'live' | 'closed') { try { const saved = await api<Survey>(`/api/surveys/${id}/publish`, json('POST', { status })); setDraft(saved); setDirty(false); toast.success(status === 'live' ? 'Survey is live' : 'Survey closed'); await load(); } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not update survey'); } }
  function applyImprovement(output: any) { if (!draft || !output) return; change({ ...draft, title: output.revisedTitle || draft.title, description: output.revisedDescription || draft.description, questions: output.revisedQuestions?.map((question: any, index: number) => ({ ...question, id: question.id || crypto.randomUUID(), surveyId: draft.id, position: index, settings: question.settings || {}, logic: question.logic || [] })) || draft.questions }); toast.message('Terra suggestions applied as an unsaved draft'); }
  if (!draft || !data) return <div className="h-96 animate-pulse bg-muted" />;
  const publicUrl = data.collectors.find((item) => item.status === 'open')?.publicUrl;
  return <div className="space-y-5">
    <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end"><div><Button variant="ghost" size="sm" asChild className="-ml-3 mb-2"><Link to="/surveys"><ArrowLeft />All surveys</Link></Button><div className="flex items-center gap-3"><h1 className="page-title">{draft.title}</h1><SurveyStatus status={draft.status} /></div><p className="page-description">{draft.description || 'Add a description in Settings.'}</p></div><div className="flex flex-wrap items-center gap-2">{dirty && <span className="mr-1 text-xs font-medium text-amber-700">Unsaved changes</span>}{publicUrl && draft.status === 'live' && <Button variant="outline" size="sm" asChild><a href={publicUrl} target="_blank" rel="noreferrer"><ExternalLink />Open live survey</a></Button>}<Button variant="outline" size="sm" disabled={!dirty || saving} onClick={save}>{saving ? <Loader2 className="animate-spin" /> : dirty ? <Save /> : <Check />}{saving ? 'Saving' : dirty ? 'Save changes' : 'Saved'}</Button>{draft.status === 'live' ? <Button size="sm" variant="secondary" onClick={() => publish('closed')}>Close survey</Button> : <Button size="sm" onClick={async () => { if (dirty) await save(); await publish('live'); }}>Publish</Button>}</div></div>
    <Tabs defaultValue="build"><TabsList className="w-full justify-start overflow-x-auto"><TabsTrigger value="build">Build</TabsTrigger><TabsTrigger value="collect">Distribute</TabsTrigger><TabsTrigger value="responses">Responses</TabsTrigger><TabsTrigger value="analytics">Analytics</TabsTrigger><TabsTrigger value="ai">Terra AI</TabsTrigger><TabsTrigger value="settings">Settings</TabsTrigger></TabsList><TabsContent value="build"><BuilderTab survey={draft} onChange={change} /></TabsContent><TabsContent value="collect"><CollectTab survey={draft} collectors={data.collectors} onRefresh={load} /></TabsContent><TabsContent value="responses"><ResponsesTab survey={draft} refreshKey={refreshKey} /></TabsContent><TabsContent value="analytics"><AnalyticsTab survey={draft} refreshKey={refreshKey} /></TabsContent><TabsContent value="ai"><AiTab survey={draft} hasUnsavedChanges={dirty} onApplyImprovement={applyImprovement} refreshKey={refreshKey} /></TabsContent><TabsContent value="settings"><SettingsTab survey={draft} onChange={change} /></TabsContent></Tabs>
  </div>;
}
