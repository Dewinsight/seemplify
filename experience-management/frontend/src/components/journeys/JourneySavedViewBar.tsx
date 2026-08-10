import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Copy, Download, Eye, Image, Loader2, RotateCcw, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { bindJourneySavedViewBrand, listJourneyExportBrands, readJourneyExportBrandAccess, readJourneySavedViewBrand,
  type JourneyExportBrandAccess, type JourneyExportBrandBinding, type JourneyExportBrandCatalog } from '@/lib/journeyExportBrand';
import { readJourneyRichMap, type JourneyChannelSnapshot } from '@/lib/journeyRichCards';
import { listJourneyMetricSegments, type JourneyMetricSegment } from '@/lib/journeyMetrics';
import type { JourneyMapExportFormat, JourneyMapIndex, JourneyMapReadModel } from '@/lib/journeyMaps';
import { cardKindLabels, evidenceStateLabels, laneLabels } from '@/lib/journeyMaps';
import {
  createJourneySavedView, deleteJourneySavedView, duplicateJourneySavedView, emptyJourneySavedViewFilters,
  listJourneySavedViewEvidenceOptions, listJourneySavedViews, readJourneySavedView, resetJourneySavedView,
  selectDefaultJourneySavedView,
  updateJourneySavedView, type JourneySavedView, type JourneySavedViewConfiguration,
  type JourneySavedViewEvidenceOption, type JourneySavedViewList, type JourneySavedViewResolved,
  type JourneySavedViewVisibility
} from '@/lib/journeySavedViews';

type Props = {
  map: JourneyMapReadModel;
  /** The unfiltered authoritative map. Filter option lists must never be drawn
   * from a map that a previously applied saved view has already narrowed, or
   * the editor can only ever narrow a view further and never broaden it. */
  optionsMap?: JourneyMapReadModel;
  index: JourneyMapIndex;
  currentUserId: string;
  spaceRole: 'owner' | 'admin' | 'member';
  metricsEnabled: boolean;
  richCardsEnabled: boolean;
  evidenceEnabled: boolean;
  exportsEnabled: boolean;
  onApply: (resolved: JourneySavedViewResolved) => void;
  onReset: () => void | Promise<void>;
  onPresent: (resolved: JourneySavedViewResolved) => void;
  onExport: (format: JourneyMapExportFormat, view: JourneySavedView) => void | Promise<void>;
};

type Busy = '' | 'load' | 'apply' | 'save' | 'update' | 'duplicate' | 'default' | 'reset' | 'delete' | 'present' | 'export';

const exportFormats: JourneyMapExportFormat[] = ['pdf', 'png', 'pptx', 'csv', 'json'];

function defaultConfiguration(map: JourneyMapReadModel): JourneySavedViewConfiguration {
  return {
    schemaVersion: 1,
    binding: { policy: 'exact', versionId: map.version.id },
    filters: emptyJourneySavedViewFilters(),
    comparisonTarget: null,
    presentation: {
      density: 'comfortable', showEvidenceLegend: true, showResearchGaps: true,
      showEmptyLanes: true, title: ''
    }
  };
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function toggleOrdered(values: string[], value: string, checked: boolean) {
  if (checked) return values.includes(value) ? values : [...values, value];
  return values.filter((item) => item !== value);
}

function utcInputIso(value: string, fallback: string) {
  if (!value) return fallback;
  const parsed = new Date(`${value}:00.000Z`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}

function MultiFilter(props: {
  label: string;
  values: string[];
  options: Array<{ id: string; label: string }>;
  disabled?: boolean;
  onChange: (values: string[]) => void;
}) {
  // A selected identity that no longer appears in the option list is still
  // stored in the configuration and still filters the map. Rendering it as an
  // unchecked box would state the filter is off while it is on, so orphaned
  // selections are surfaced explicitly and stay removable.
  const orphaned = props.values.filter((value) => !props.options.some((option) => option.id === value));
  const entries = [...props.options, ...orphaned.map((id) => ({ id, label: `${id} · no longer available`, orphaned: true }))];
  return <fieldset className="border-t pt-3">
    <legend className="px-1 text-sm font-medium">{props.label}</legend>
    {!entries.length
      ? <p className="mt-2 text-xs text-muted-foreground">No options are available for this map.</p>
      : <div className="mt-2 grid max-h-32 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
        {entries.map((option) => <label key={option.id}
          className={`flex min-w-0 items-center gap-2 text-sm${'orphaned' in option ? ' text-amber-800' : ''}`}>
          <input type="checkbox" checked={props.values.includes(option.id)}
            disabled={props.disabled && !('orphaned' in option)}
            onChange={(event) => props.onChange(toggleOrdered(props.values, option.id, event.currentTarget.checked))} />
          <span className="truncate" title={option.label}>{option.label}</span>
        </label>)}
      </div>}
  </fieldset>;
}

function isAvailable(view: JourneySavedViewList['views'][number]): view is JourneySavedView {
  return view.config !== null;
}

export function JourneySavedViewBar({
  map, optionsMap, index, currentUserId, spaceRole, metricsEnabled, richCardsEnabled, evidenceEnabled, exportsEnabled,
  onApply, onReset, onPresent, onExport
}: Props) {
  const filterMap = optionsMap || map;
  const [catalog, setCatalog] = useState<JourneySavedViewList | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState<Busy>('load');
  const [error, setError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [mode, setMode] = useState<'new' | 'edit'>('new');
  const exportMenuRef = useRef<HTMLDetailsElement | null>(null);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<JourneySavedViewVisibility>('private');
  const [configuration, setConfiguration] = useState<JourneySavedViewConfiguration>(() => defaultConfiguration(map));
  const [segments, setSegments] = useState<JourneyMetricSegment[]>([]);
  const [channels, setChannels] = useState<JourneyChannelSnapshot[]>([]);
  const [evidenceOptions, setEvidenceOptions] = useState<JourneySavedViewEvidenceOption[]>([]);
  const autoAppliedKey = useRef('');
  const [deleteReason, setDeleteReason] = useState('No longer needed in this journey workspace.');
  const [brandOpen,setBrandOpen]=useState(false),[brandBusy,setBrandBusy]=useState(false),[brandError,setBrandError]=useState('');
  const [brandAccess,setBrandAccess]=useState<JourneyExportBrandAccess|null>(null),[brandCatalog,setBrandCatalog]=useState<JourneyExportBrandCatalog|null>(null);
  const [brandBinding,setBrandBinding]=useState<JourneyExportBrandBinding|null>(null),[brandPolicy,setBrandPolicy]=useState<'space_default'|'pinned'>('space_default');
  const [brandProfileKey,setBrandProfileKey]=useState('');
  const canEditShared = spaceRole === 'owner' || spaceRole === 'admin';
  const selected = useMemo(() => catalog?.views.find((view) => view.id === selectedId) || null,
    [catalog?.views, selectedId]);
  const availableSelected = selected && isAvailable(selected) ? selected : null;
  const canManageSelected = Boolean(availableSelected
    && (availableSelected.visibility === 'space' ? canEditShared : availableSelected.ownerUserId === currentUserId));
  // Saved-view names are deliberately not unique (see the saved-view section of
  // the master plan): private and shared views from different owners routinely
  // share a name. Colliding names are disambiguated here instead.
  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const view of catalog?.views || []) {
      const key = view.name.toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  }, [catalog?.views]);

  const refresh = useCallback(async () => {
    setBusy('load');
    try {
      const [views, metricSegments, richMap, exactEvidence] = await Promise.all([
        listJourneySavedViews(map.definition.id),
        metricsEnabled ? listJourneyMetricSegments(map.definition.id) : Promise.resolve([]),
        richCardsEnabled ? readJourneyRichMap(map.definition.id, map.version.id) : Promise.resolve(null),
        evidenceEnabled
          ? listJourneySavedViewEvidenceOptions(map.definition.id, map.version.id)
          : Promise.resolve([])
      ]);
      setCatalog(views);
      setSegments(metricSegments.filter((segment) => segment.state === 'active'));
      setChannels((richMap?.catalog.channels || []).filter((channel) => channel.status === 'active'));
      setEvidenceOptions(exactEvidence);
      setSelectedId((current) => views.views.some((view) => view.id === current)
        ? current : (views.selected?.viewId || views.views.find(isAvailable)?.id || ''));
      setError('');
    } catch (reason) {
      setError(errorMessage(reason, 'Saved views could not be loaded.'));
    } finally { setBusy(''); }
  }, [map.definition.id, map.version.id, metricsEnabled, richCardsEnabled, evidenceEnabled]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    setConfiguration(defaultConfiguration(filterMap));
    setName('');
    setSelectedId('');
    setMode('new');
    autoAppliedKey.current = '';
  }, [map.definition.id]);

  useEffect(() => {
    const selection = catalog?.selected;
    const view = selection
      ? catalog.views.find((candidate) => candidate.id === selection.viewId && isAvailable(candidate))
      : null;
    if (!selection || !view) return;
    const key = `${map.definition.id}:${selection.viewId}:${selection.viewRevision}`;
    if (autoAppliedKey.current === key) return;
    autoAppliedKey.current = key;
    void readJourneySavedView(map.definition.id, selection.viewId, selection.viewRevision)
      .then((resolved) => onApply(resolved))
      .catch((reason) => {
        autoAppliedKey.current = '';
        setError(errorMessage(reason, 'The default saved view could not be applied.'));
      });
  }, [catalog, map.definition.id, onApply]);

  // The editor's primary action is driven by the mode it was opened in, never
  // by which view happens to be selected. Inferring it from selection made
  // "Save current" overwrite the selected view with a blank configuration.
  function openEditor(next: 'new' | 'edit') {
    const editing = next === 'edit' && Boolean(availableSelected) && canManageSelected;
    setMode(editing ? 'edit' : 'new');
    if (editing && availableSelected) {
      setName(availableSelected.name);
      setVisibility(availableSelected.visibility);
      setConfiguration(structuredClone(availableSelected.config));
    } else {
      setName(''); setVisibility('private'); setConfiguration(defaultConfiguration(filterMap));
    }
    setEditorOpen(true); setError('');
  }

  async function applySelected() {
    if (!availableSelected) return;
    setBusy('apply');
    try {
      const resolved = await readJourneySavedView(map.definition.id, availableSelected.id, availableSelected.revision);
      onApply(resolved);
      toast.success(`Applied “${availableSelected.name}”.`);
    } catch (reason) { setError(errorMessage(reason, 'The saved view could not be applied.')); }
    finally { setBusy(''); }
  }

  async function saveNew() {
    setBusy('save');
    try {
      const created = await createJourneySavedView(map.definition.id, { name, visibility, config: configuration });
      await refresh(); setSelectedId(created.view.id); setEditorOpen(false);
      toast.success('Saved view created.');
    } catch (reason) { setError(errorMessage(reason, 'The view could not be saved.')); }
    finally { setBusy(''); }
  }

  async function saveChanges() {
    if (mode !== 'edit' || !availableSelected || !canManageSelected) return;
    setBusy('update');
    try {
      const updated = await updateJourneySavedView(map.definition.id, availableSelected.id, {
        expectedRevision: availableSelected.revision, name, visibility, config: configuration
      });
      await refresh(); setSelectedId(updated.view.id); setEditorOpen(false);
      toast.success('Saved view updated.');
    } catch (reason) { setError(errorMessage(reason, 'The view could not be updated.')); }
    finally { setBusy(''); }
  }

  async function duplicateSelected() {
    if (!availableSelected) return;
    setBusy('duplicate');
    try {
      const copy = await duplicateJourneySavedView(map.definition.id, availableSelected);
      await refresh(); setSelectedId(copy.view.id); toast.success('Private copy created.');
    } catch (reason) { setError(errorMessage(reason, 'The view could not be duplicated.')); }
    finally { setBusy(''); }
  }

  async function setDefault() {
    if (!availableSelected) return;
    setBusy('default');
    try { await selectDefaultJourneySavedView(map.definition.id, availableSelected); await refresh(); toast.success('Default view updated.'); }
    catch (reason) { setError(errorMessage(reason, 'The default view could not be updated.')); }
    finally { setBusy(''); }
  }

  async function reset() {
    setBusy('reset');
    try { await resetJourneySavedView(map.definition.id); await onReset(); await refresh(); toast.success('Returned to the unfiltered current map.'); }
    catch (reason) { setError(errorMessage(reason, 'The view could not be reset.')); }
    finally { setBusy(''); }
  }

  async function removeSelected() {
    if (mode !== 'edit' || !availableSelected || !canManageSelected) return;
    setBusy('delete');
    try {
      await deleteJourneySavedView(map.definition.id, availableSelected, deleteReason);
      setEditorOpen(false); await onReset(); await refresh(); toast.success('Saved view moved to retention.');
    } catch (reason) { setError(errorMessage(reason, 'The saved view could not be deleted.')); }
    finally { setBusy(''); }
  }

  async function presentSelected() {
    if (!availableSelected) return;
    setBusy('present');
    try { onPresent(await readJourneySavedView(map.definition.id, availableSelected.id, availableSelected.revision)); }
    catch (reason) { setError(errorMessage(reason, 'Presentation mode could not open this view.')); }
    finally { setBusy(''); }
  }

  async function exportSelected(format: JourneyMapExportFormat) {
    if (!availableSelected) return;
    exportMenuRef.current?.removeAttribute('open');
    setBusy('export');
    try { await onExport(format, availableSelected); }
    catch (reason) { setError(errorMessage(reason, 'The selected view could not be exported.')); }
    finally { setBusy(''); }
  }

  async function loadBrand(){if(!availableSelected)return;setBrandBusy(true);try{const[nextAccess,nextCatalog,nextBinding]=await Promise.all([
      readJourneyExportBrandAccess(),listJourneyExportBrands(),readJourneySavedViewBrand(availableSelected.id)]);setBrandAccess(nextAccess);setBrandCatalog(nextCatalog);setBrandBinding(nextBinding);
      setBrandPolicy(nextBinding.brandPolicy);setBrandProfileKey(nextBinding.profileId&&nextBinding.profileVersion?`${nextBinding.profileId}:${nextBinding.profileVersion}`:
        nextCatalog.settings.defaultProfileId&&nextCatalog.settings.defaultProfileVersion?`${nextCatalog.settings.defaultProfileId}:${nextCatalog.settings.defaultProfileVersion}`:'');setBrandError('');}
    catch(reason){setBrandError(errorMessage(reason,'Saved-view branding could not be loaded.'));}finally{setBrandBusy(false);}}
  async function openBrand(){setBrandOpen(true);await loadBrand();}
  async function saveBrand(){if(!availableSelected||!brandBinding)return;const [profileId,profileVersion]=brandProfileKey.split(':');setBrandBusy(true);try{
      const updated=await bindJourneySavedViewBrand({viewId:availableSelected.id,viewRevision:availableSelected.revision,brandPolicy,
        profileId:brandPolicy==='pinned'?profileId:null,profileVersion:brandPolicy==='pinned'?Number(profileVersion):null,expectedRevision:brandBinding.revision});
      setBrandBinding(updated);toast.success('Saved-view export brand updated.');setBrandError('');}
    catch(reason){if(reason instanceof ApiError&&reason.status===409){setBrandError(`${reason.message} The latest binding has been reloaded.`);await loadBrand();}
      else setBrandError(errorMessage(reason,'Saved-view branding could not be updated.'));}finally{setBrandBusy(false);}}

  const patchFilters = (patch: Partial<JourneySavedViewConfiguration['filters']>) =>
    setConfiguration((current) => ({ ...current, filters: { ...current.filters, ...patch } }));

  return <>
    <section className="border px-3 py-2" aria-label="Saved journey views" data-testid="journey-saved-view-bar">
      <div className="flex flex-wrap items-center gap-2">
        <Bookmark className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <label className="sr-only" htmlFor="journey-saved-view-select">Saved view</label>
        <select id="journey-saved-view-select" className="h-8 min-w-0 max-w-64 rounded-md border bg-background px-2 text-sm"
          value={selectedId} disabled={busy === 'load'} onChange={(event) => setSelectedId(event.currentTarget.value)}>
          <option value="">Unfiltered current map</option>
          {(catalog?.views || []).map((view) => <option key={view.id} value={view.id} disabled={!isAvailable(view)}>
            {view.name}{view.visibility === 'space' ? ' · shared' : ''}{!isAvailable(view) ? ' · unavailable' : ''}
            {duplicateNames.has(view.name.toLowerCase())
              ? ` · ${view.ownerUserId === currentUserId ? 'mine' : 'other owner'} · ${view.id.slice(0, 8)}` : ''}
          </option>)}
        </select>
        <Button type="button" size="sm" variant="outline" disabled={!availableSelected || Boolean(busy)} onClick={() => void applySelected()}>
          {busy === 'apply' ? <Loader2 className="animate-spin" /> : <Eye />}Apply
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => openEditor('new')}>
          <Bookmark />Save current
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={!availableSelected || !canManageSelected || Boolean(busy)}
          onClick={() => openEditor('edit')}><Settings2 />Edit</Button>
        <Button type="button" size="sm" variant="ghost" disabled={!availableSelected || Boolean(busy)}
          onClick={() => void duplicateSelected()}><Copy />Duplicate</Button>
        <Button type="button" size="sm" variant="ghost" disabled={!availableSelected || Boolean(busy)}
          onClick={() => void setDefault()}>Set default</Button>
        {exportsEnabled&&<Button type="button" size="sm" variant="ghost" disabled={!availableSelected||Boolean(busy)} onClick={()=>void openBrand()}>
          <Image className="h-4 w-4"/>Brand</Button>}
        <Button type="button" size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void reset()}>
          <RotateCcw />Reset
        </Button>
        {availableSelected && <details className="relative" ref={exportMenuRef}>
          <summary className="flex h-8 cursor-pointer list-none items-center rounded-md border px-3 text-xs font-semibold"
            aria-label={`Export the saved view ${availableSelected.name}`} data-testid="journey-saved-view-export-menu">
            <Download className="mr-2 h-4 w-4" />Export view
          </summary>
          <div className="absolute right-0 z-30 mt-1 w-36 border bg-popover p-1 shadow-panel">
            {exportFormats.map((format) => <button key={format} type="button" className="block w-full px-3 py-2 text-left text-xs hover:bg-muted"
              onClick={() => void exportSelected(format)}>{format.toUpperCase()}</button>)}
          </div>
        </details>}
        <Button type="button" size="sm" variant="ghost" disabled={!availableSelected || Boolean(busy)}
          onClick={() => void presentSelected()}><Eye />Present view</Button>
      </div>
      {catalog?.selected && <p className="mt-2 text-xs text-muted-foreground">Default view applies when this map opens.</p>}
      {catalog?.unavailableCount ? <p className="mt-2 text-xs text-amber-800" role="status">
        {catalog.unavailableCount} saved {catalog.unavailableCount === 1 ? 'view is' : 'views are'} unavailable because a referenced item can no longer be accessed.
      </p> : null}
      {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
    </section>

    <Dialog open={brandOpen} onOpenChange={setBrandOpen}><DialogContent className="sm:max-w-lg" data-testid="journey-saved-view-brand-dialog"><DialogHeader>
      <DialogTitle>Saved-view export brand</DialogTitle><DialogDescription>The binding follows the exact saved-view revision shown here.</DialogDescription></DialogHeader>
      {brandBusy&&!brandBinding?<p className="flex items-center gap-2 py-5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>Loading saved-view branding…</p>:
        brandBinding&&<div className="space-y-4"><div className="border p-3 text-sm"><p className="font-medium">{availableSelected?.name}</p><p className="mt-1 text-xs text-muted-foreground">Saved-view revision {brandBinding.viewRevision} · binding revision {brandBinding.revision}</p></div>
          {canEditShared&&brandAccess?.canManageViews?<><div><Label htmlFor="saved-view-brand-policy">Brand source</Label><select id="saved-view-brand-policy" value={brandPolicy}
            className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" onChange={(event)=>setBrandPolicy(event.currentTarget.value as 'space_default'|'pinned')}>
            <option value="space_default">Follow the space default</option><option value="pinned">Pin an exact profile version</option></select></div>
            {brandPolicy==='pinned'&&<div><Label htmlFor="saved-view-brand-profile">Profile version</Label><select id="saved-view-brand-profile" value={brandProfileKey}
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" onChange={(event)=>setBrandProfileKey(event.currentTarget.value)}>
              <option value="">Choose a profile</option>{brandCatalog?.profiles.filter((entry)=>entry.profile.state==='active').map((entry)=><option key={entry.profile.id} value={`${entry.profile.id}:${entry.version.version}`}>{entry.profile.name} · version {entry.version.version}</option>)}</select>
              {brandBinding.brandPolicy==='pinned'&&brandBinding.profileId&&brandBinding.profileVersion&&!brandCatalog?.profiles.some((entry)=>entry.profile.id===brandBinding.profileId&&entry.version.version===brandBinding.profileVersion)&&
                <p className="mt-2 text-xs text-amber-800">The current binding pins historical version {brandBinding.profileVersion}. Choose an available current version to replace it.</p>}</div>}</>:
            <div className="text-sm"><p className="font-medium">{brandBinding.brandPolicy==='pinned'?'Pinned profile version':'Space default'}</p><p className="mt-1 text-muted-foreground" data-testid="journey-saved-view-brand-effective">
              {brandBinding.brandPolicy==='pinned'?`Profile ${brandBinding.profileId}, version ${brandBinding.profileVersion}`:
                brandCatalog?.settings.defaultProfileId?`${brandCatalog.profiles.find((entry)=>entry.profile.id===brandCatalog.settings.defaultProfileId)?.profile.name||'Space profile'}, version ${brandCatalog.settings.defaultProfileVersion}`:'Standard Seemplify export branding'}</p></div>}
        </div>}
      {brandError&&<p className="text-sm text-destructive" role="alert">{brandError}</p>}<DialogFooter><Button type="button" variant="outline" onClick={()=>setBrandOpen(false)}>Close</Button>
        {canEditShared&&brandAccess?.canManageViews&&<Button type="button" disabled={brandBusy||!brandBinding||(brandPolicy==='pinned'&&!brandProfileKey)} onClick={()=>void saveBrand()}>{brandBusy&&<Loader2 className="animate-spin"/>}Save binding</Button>}</DialogFooter>
    </DialogContent></Dialog>

    <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
      <DialogContent className="sm:max-w-2xl" data-testid="journey-saved-view-editor">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? 'Edit saved view' : 'Save journey view'}</DialogTitle>
          <DialogDescription>Filters are applied by stable identity to the exact version you choose. No title matching is used.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="saved-view-name">Name</Label><input id="saved-view-name" value={name} maxLength={160}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" onChange={(event) => setName(event.currentTarget.value)} /></div>
            <div><Label htmlFor="saved-view-visibility">Visibility</Label><select id="saved-view-visibility" value={visibility}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              onChange={(event) => setVisibility(event.currentTarget.value as JourneySavedViewVisibility)}>
              <option value="private">Private to me</option>
              <option value="space" disabled={!canEditShared}>Shared with this space</option>
            </select></div>
            <div><Label htmlFor="saved-view-binding">Version binding</Label><select id="saved-view-binding"
              value={configuration.binding.policy} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              onChange={(event) => setConfiguration((current) => ({ ...current, binding: event.currentTarget.value === 'exact'
                ? { policy: 'exact', versionId: filterMap.version.id } : { policy: 'follows_current', versionId: null } }))}>
              <option value="exact">Exact version {configuration.binding.policy === 'exact'
                && configuration.binding.versionId !== filterMap.version.id
                ? 'pinned by this view' : filterMap.version.versionNumber}</option>
              <option value="follows_current">Follow current version</option>
            </select></div>
            <div><Label htmlFor="saved-view-density">Presentation density</Label><select id="saved-view-density"
              value={configuration.presentation.density} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              onChange={(event) => setConfiguration((current) => ({ ...current, presentation: { ...current.presentation,
                density: event.currentTarget.value as 'comfortable' | 'compact' } }))}>
              <option value="comfortable">Comfortable</option><option value="compact">Compact</option>
            </select></div>
          </div>

          <MultiFilter label="Personas" values={configuration.filters.personaIds}
            options={filterMap.personas.map((persona) => ({ id: persona.id, label: persona.name }))}
            onChange={(personaIds) => patchFilters({ personaIds })} />
          <MultiFilter label="Segments" values={configuration.filters.segmentIds}
            options={segments.map((segment) => ({ id: segment.id, label: segment.name }))}
            disabled={!metricsEnabled} onChange={(segmentIds) => patchFilters({ segmentIds })} />
          <p className="text-xs text-muted-foreground">Cohort filters stay unavailable until the governed cohort catalogue provides distinct cohort identities and lineage.</p>
          <MultiFilter label="Channels" values={configuration.filters.channelIds}
            options={channels.map((channel) => ({ id: channel.id, label: channel.name }))}
            disabled={!richCardsEnabled} onChange={(channelIds) => patchFilters({ channelIds })} />
          <MultiFilter label="Exact evidence links" values={configuration.filters.evidenceLinkIds}
            options={evidenceOptions.map((option) => ({
              id: option.id,
              label: `${option.targetLabel} · ${option.sourceLabel} · ${option.assessment}`
            }))}
            disabled={!evidenceEnabled} onChange={(evidenceLinkIds) => patchFilters({ evidenceLinkIds })} />
          <MultiFilter label="Evidence state" values={configuration.filters.evidenceStates}
            options={Object.entries(evidenceStateLabels).map(([id, state]) => ({ id, label: state.label }))}
            onChange={(evidenceStates) => patchFilters({ evidenceStates: evidenceStates as JourneySavedViewConfiguration['filters']['evidenceStates'] })} />
          <MultiFilter label="Card kind" values={configuration.filters.cardKinds}
            options={[...new Set(filterMap.cards.map((card) => card.kind))].map((id) => ({ id, label: cardKindLabels[id] || id.replaceAll('_', ' ') }))}
            onChange={(cardKinds) => patchFilters({ cardKinds })} />
          <MultiFilter label="Lanes" values={configuration.filters.laneKeys}
            options={filterMap.lanes.map((lane) => ({ id: lane.laneType, label: lane.title || laneLabels[lane.laneType] || lane.laneType }))}
            onChange={(laneKeys) => patchFilters({ laneKeys })} />

          <fieldset className="border-t pt-3">
            <legend className="px-1 text-sm font-medium">Analytics window</legend>
            <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox"
              checked={Boolean(configuration.filters.timeWindow)} disabled={!metricsEnabled}
              onChange={(event) => patchFilters({ timeWindow: event.currentTarget.checked ? {
                from: new Date(Date.now() - 30 * 86_400_000).toISOString(), to: new Date().toISOString(), timezone: 'UTC'
              } : null })} />Limit metric observations to a time window</label>
            {configuration.filters.timeWindow && <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div><Label htmlFor="saved-view-from">From (UTC instant)</Label><input id="saved-view-from" type="datetime-local"
                value={configuration.filters.timeWindow.from.slice(0, 16)} className="mt-1 w-full rounded-md border px-2 py-2 text-sm"
                onChange={(event) => patchFilters({ timeWindow: { ...configuration.filters.timeWindow!,
                  from: utcInputIso(event.currentTarget.value, configuration.filters.timeWindow!.from) } })} /></div>
              <div><Label htmlFor="saved-view-to">To (UTC instant)</Label><input id="saved-view-to" type="datetime-local"
                value={configuration.filters.timeWindow.to.slice(0, 16)} className="mt-1 w-full rounded-md border px-2 py-2 text-sm"
                onChange={(event) => patchFilters({ timeWindow: { ...configuration.filters.timeWindow!,
                  to: utcInputIso(event.currentTarget.value, configuration.filters.timeWindow!.to) } })} /></div>
              <div><Label htmlFor="saved-view-timezone">Timezone</Label><input id="saved-view-timezone"
                value={configuration.filters.timeWindow.timezone} maxLength={80} className="mt-1 w-full rounded-md border px-2 py-2 text-sm"
                onChange={(event) => patchFilters({ timeWindow: { ...configuration.filters.timeWindow!, timezone: event.currentTarget.value } })} /></div>
              <p className="text-xs text-muted-foreground sm:col-span-3">The UTC instants bound observations; timezone controls analytics bucketing and display context.</p>
            </div>}
          </fieldset>

          <fieldset className="border-t pt-3">
            <legend className="px-1 text-sm font-medium">Comparison and presentation</legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="saved-view-compare">Future or ideal map</Label><select id="saved-view-compare"
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={configuration.comparisonTarget?.definitionId || ''}
                onChange={(event) => {
                  const definition = index.journeyMaps.find((item) => item.id === event.currentTarget.value);
                  setConfiguration((current) => ({ ...current, comparisonTarget: definition?.currentVersionId
                    ? { definitionId: definition.id, versionId: definition.currentVersionId } : null }));
                }}>
                <option value="">No comparison</option>
                {index.journeyMaps.filter((item) => item.id !== map.definition.id && item.currentVersionId)
                  .map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select></div>
              <div><Label htmlFor="saved-view-title">Presentation title</Label><input id="saved-view-title"
                value={configuration.presentation.title} maxLength={200} className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                onChange={(event) => setConfiguration((current) => ({ ...current, presentation: {
                  ...current.presentation, title: event.currentTarget.value } }))} /></div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {([
                ['showEvidenceLegend', 'Show evidence legend'], ['showResearchGaps', 'Show research gaps'],
                ['showEmptyLanes', 'Show empty lanes']
              ] as const).map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox"
                checked={configuration.presentation[key]} onChange={(event) => setConfiguration((current) => ({
                  ...current, presentation: { ...current.presentation, [key]: event.currentTarget.checked }
                }))} />{label}</label>)}
            </div>
          </fieldset>

          {mode === 'edit' && availableSelected && canManageSelected && <div className="border-t pt-3">
            <Label htmlFor="saved-view-delete-reason">Deletion reason</Label>
            <input id="saved-view-delete-reason" value={deleteReason} maxLength={500}
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm" onChange={(event) => setDeleteReason(event.currentTarget.value)} />
            <Button type="button" size="sm" variant="destructive" className="mt-2" disabled={Boolean(busy) || deleteReason.trim().length < 3}
              onClick={() => void removeSelected()}><Trash2 />Move to retention</Button>
          </div>}
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button>
          {mode === 'edit' && availableSelected && canManageSelected
            ? <Button type="button" data-testid="journey-saved-view-submit" disabled={!name.trim() || Boolean(busy)}
              onClick={() => void saveChanges()}>
              {busy === 'update' && <Loader2 className="animate-spin" />}Save changes</Button>
            : <Button type="button" data-testid="journey-saved-view-submit" disabled={!name.trim() || Boolean(busy)}
              onClick={() => void saveNew()}>
              {busy === 'save' && <Loader2 className="animate-spin" />}Create view</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
