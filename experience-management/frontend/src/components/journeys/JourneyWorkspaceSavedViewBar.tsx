import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bookmark, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  createJourneyWorkspaceSavedView,
  journeyWorkspaceViewAudiences,
  listJourneyWorkspaceSavedViews,
  retireJourneyWorkspaceSavedView,
  reviseJourneyWorkspaceSavedView,
  setJourneyWorkspaceDefaultView,
  type JourneyWorkspaceSavedView,
  type JourneyWorkspaceViewAudience,
  type JourneyWorkspaceViewConfiguration,
  type JourneyWorkspaceViewSurface
} from '@/lib/journeyWorkspaceSavedViews';

const audienceLabels: Record<JourneyWorkspaceViewAudience,string> = {
  internal: 'Internal', executive: 'Executive', research: 'Research', delivery: 'Delivery', external: 'External'
};

export function JourneyWorkspaceSavedViewBar({ surface, configuration, onApply }: {
  surface: JourneyWorkspaceViewSurface;
  configuration: JourneyWorkspaceViewConfiguration;
  onApply: (configuration: JourneyWorkspaceViewConfiguration) => void;
}) {
  const [views, setViews] = useState<JourneyWorkspaceSavedView[]>([]);
  const [defaultViewId, setDefaultViewId] = useState<string | null>(null);
  const [preferenceRevision, setPreferenceRevision] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [audience, setAudience] = useState<JourneyWorkspaceViewAudience>('internal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = useMemo(() => views.find((view) => view.id === selectedId) || null, [selectedId, views]);
  const load = useCallback(async (preferredId?: string) => {
    const result = await listJourneyWorkspaceSavedViews(surface);
    setViews(result.views); setDefaultViewId(result.defaultViewId); setPreferenceRevision(result.preferenceRevision);
    setSelectedId((current) => result.views.some((view) => view.id === (preferredId || current))
      ? (preferredId || current) : result.defaultViewId || '');
  }, [surface]);
  useEffect(() => { setError(''); void load().catch((reason) => setError(reason instanceof Error
    ? reason.message : 'Saved views could not be loaded.')); }, [load]);
  useEffect(() => {
    if (!selected) return;
    setName(selected.name); setAudience(selected.audience);
  }, [selected]);
  async function act(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Saved view could not be changed.'); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!name.trim()) return;
    await act(async () => {
      if (selected) {
        await reviseJourneyWorkspaceSavedView(selected, { name: name.trim(), audience, configuration }, crypto.randomUUID());
        await load(selected.id);
      } else {
        const created = await createJourneyWorkspaceSavedView({ surface, audience, name: name.trim(), configuration,
          makeDefault: false }, crypto.randomUUID());
        await load(created.viewId);
      }
    });
  }
  return <section className="border" aria-labelledby={`${surface}-saved-views-heading`}
    data-testid={`${surface}-saved-views`}>
    <div className="flex flex-wrap items-end gap-3 p-3">
      <div className="grid min-w-52 gap-1.5">
        <Label id={`${surface}-saved-views-heading`} htmlFor={`${surface}-saved-view`}>Saved view</Label>
        <select id={`${surface}-saved-view`} className="h-9 rounded-md border bg-background px-3 text-sm"
          value={selectedId} disabled={busy} onChange={(event) => setSelectedId(event.target.value)}>
          <option value="">New view</option>
          {views.map((view) => <option key={view.id} value={view.id}>{view.name}{view.id === defaultViewId ? ' · default' : ''}</option>)}
        </select>
      </div>
      <div className="grid min-w-52 flex-1 gap-1.5"><Label htmlFor={`${surface}-saved-view-name`}>Name</Label>
        <Input id={`${surface}-saved-view-name`} maxLength={160} value={name} disabled={busy}
          onChange={(event) => setName(event.target.value)} /></div>
      <div className="grid gap-1.5"><Label htmlFor={`${surface}-saved-view-audience`}>Use</Label>
        <select id={`${surface}-saved-view-audience`} className="h-9 rounded-md border bg-background px-3 text-sm"
          value={audience} disabled={busy} onChange={(event) => setAudience(event.target.value as JourneyWorkspaceViewAudience)}>
          {journeyWorkspaceViewAudiences.map((value) => <option key={value} value={value}>{audienceLabels[value]}</option>)}
        </select></div>
      <div className="flex flex-wrap gap-2">
        {selected && <Button type="button" variant="outline" disabled={busy} onClick={() => onApply(selected.configuration)}>
          <Bookmark className="h-4 w-4" />Apply</Button>}
        <Button type="button" disabled={busy || !name.trim()} onClick={() => void save()}>
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Bookmark className="h-4 w-4" />}
          {selected ? 'Update view' : 'Save view'}</Button>
        {selected && <Button type="button" variant="outline" disabled={busy || selected.id === defaultViewId}
          onClick={() => void act(async () => { await setJourneyWorkspaceDefaultView(surface, selected.id,
            preferenceRevision, crypto.randomUUID()); await load(selected.id); })}>Set default</Button>}
        {defaultViewId && <Button type="button" variant="outline" disabled={busy}
          onClick={() => void act(async () => { await setJourneyWorkspaceDefaultView(surface, null,
            preferenceRevision, crypto.randomUUID()); await load(selectedId); })}>Reset default</Button>}
        {selected && <Button type="button" variant="outline" disabled={busy}
          onClick={() => void act(async () => { await retireJourneyWorkspaceSavedView(selected, crypto.randomUUID());
            setSelectedId(''); setName(''); await load(); })}><Trash2 className="h-4 w-4" />Retire</Button>}
        {selected && <Button type="button" variant="ghost" disabled={busy} onClick={() => {
          setSelectedId(''); setName(''); setAudience('internal');
        }}><Plus className="h-4 w-4" />New</Button>}
      </div>
    </div>
    {selected && <p className="border-t px-3 py-2 text-xs text-muted-foreground">Revision {selected.revision} · version {selected.versionNumber} · {audienceLabels[selected.audience]}</p>}
    {error && <p role="alert" className="border-t px-3 py-2 text-sm text-destructive">{error}</p>}
  </section>;
}
