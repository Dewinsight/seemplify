import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilePlus2, LayoutTemplate, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GovernedJourneyTemplateWorkspace } from '@/components/journeys/GovernedJourneyTemplateWorkspace';
import { JourneyTemplatePreview } from '@/components/journeys/JourneyTemplatePreview';
import { useAuthSession, useSessionFeature } from '@/lib/authSessionContext';
import {
  createJourneyMapFromPublishedTemplate, listJourneyTemplates, previewJourneyTemplate,
  type JourneyTemplate, type JourneyTemplateVersion
} from '@/lib/journeyTemplates';

function detail(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

export function JourneyTemplateManager({ onMapCreated }: { onMapCreated: (definitionId: string) => void }) {
  const enabled = useSessionFeature('journeyTemplates');
  const session = useAuthSession();
  const canManage = ['owner', 'admin'].includes(session?.activeSpace?.role || '');
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<JourneyTemplate[]>([]);
  const [selected, setSelected] = useState<JourneyTemplateVersion | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [query, setQuery] = useState('');
  const [mapName, setMapName] = useState('');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const selectedVersionRef = useRef('');
  selectedVersionRef.current = selected?.id || '';

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true); setError('');
    try {
      const result = await listJourneyTemplates(canManage);
      setTemplates(result.templates);
      const available = result.templates.flatMap((template) => template.versions.map((version) => ({ template, version })))
        .filter(({ template, version }) => version.state === 'published' && version.id === template.publishedVersionId);
      const retained = available.find(({ version }) => version.id === selectedVersionRef.current);
      const next = retained || available[0];
      setSelected(next?.version || null);
      setSelectedTemplateId(next?.template.id || '');
      if (!retained) setMapName(next?.version.name || '');
    } catch (cause) {
      setError(detail(cause, 'Journey templates could not be loaded.'));
    } finally { setLoading(false); }
  }, [canManage, enabled]);

  useEffect(() => { if (open) void load(); }, [load, open]);

  const gallery = useMemo(() => templates.flatMap((template) => template.versions
    .filter((version) => version.state === 'published' && version.id === template.publishedVersionId)
    .map((version) => ({ template, version })))
    .filter(({ template, version }) => {
      const haystack = `${template.key} ${version.name} ${version.description} ${version.industry} ${version.useCase}`.toLowerCase();
      return haystack.includes(query.trim().toLowerCase());
    }), [query, templates]);

  async function selectVersion(template: JourneyTemplate, version: JourneyTemplateVersion) {
    setSelectedTemplateId(template.id); setMapName(version.name); setError('');
    try {
      const result = await previewJourneyTemplate(template.id, version.id);
      setSelected(result.templateVersion);
    } catch (cause) { setError(detail(cause, 'The template preview could not be loaded.')); }
  }

  async function createMap() {
    if (!selected || !selectedTemplateId || creating) return;
    setCreating(true); setError('');
    try {
      const result = await createJourneyMapFromPublishedTemplate(selectedTemplateId, selected.id, mapName);
      onMapCreated(result.definition.id);
      setOpen(false);
      toast.success(`“${result.definition.name}” was created from template version ${selected.versionNumber}.`);
    } catch (cause) {
      const message = detail(cause, 'The journey map could not be created from this template.');
      setError(message); toast.error(message);
    } finally { setCreating(false); }
  }

  // Entitlements change the information architecture, not just the button
  // state. Disabled plans do not render or request the template surface.
  if (!enabled) return null;

  const spaceTemplates = templates.filter((template) => template.scope === 'space');
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" variant="outline" size="sm" data-testid="open-journey-templates">
      <LayoutTemplate />Templates
    </Button></DialogTrigger>
    <DialogContent className="sm:max-w-[min(1180px,calc(100vw-2rem))]" data-testid="journey-template-manager">
      <DialogHeader>
        <DialogTitle>Journey templates</DialogTitle>
        <DialogDescription>Start from a published, version-pinned template. New maps remain designed hypotheses until evidence is attached.</DialogDescription>
      </DialogHeader>
      {error && <p className="border border-destructive/35 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{error}</p>}
      {loading ? <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />Loading templates…
      </div> : <Tabs defaultValue="gallery">
        <TabsList>
          <TabsTrigger value="gallery">Published templates</TabsTrigger>
          {canManage && <TabsTrigger value="manage">Manage space templates</TabsTrigger>}
        </TabsList>
        <TabsContent value="gallery">
          <div className="mb-4 max-w-md">
            <Label htmlFor="journey-template-search" className="sr-only">Search templates</Label>
            <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input id="journey-template-search" value={query} className="pl-9" placeholder="Search by name, industry, or use case"
                onChange={(event) => setQuery(event.target.value)} />
            </div>
          </div>
          {gallery.length ? <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="max-h-[64vh] divide-y overflow-y-auto border" role="list" aria-label="Published journey templates">
              {gallery.map(({ template, version }) => <button type="button" role="listitem"
                data-testid={`journey-template-${template.id}`} key={`${template.id}-${version.id}`}
                aria-pressed={selected?.id === version.id} onClick={() => void selectVersion(template, version)}
                className={`w-full p-4 text-left hover:bg-muted/50 ${selected?.id === version.id ? 'bg-muted' : ''}`}>
                <span className="block text-sm font-medium">{version.name}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {version.industry || 'Any industry'} · {version.useCase || 'General use'}
                </span>
                <span className="mt-2 block text-[11px] text-muted-foreground">
                  {template.scope === 'system' ? 'System template' : 'Space template'} · version {version.versionNumber}
                </span>
              </button>)}
            </div>
            {selected ? <div className="min-w-0 space-y-4">
              <div><h3 className="text-base font-semibold">{selected.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">Published {selected.publishedAt ? new Date(selected.publishedAt).toLocaleString() : 'date unavailable'}</p></div>
              <JourneyTemplatePreview version={selected} />
              <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1"><Label htmlFor="journey-template-map-name">New map name</Label><Input
                  id="journey-template-map-name" value={mapName} maxLength={160}
                  onChange={(event) => setMapName(event.target.value)} /></div>
                <Button type="button" disabled={creating || !mapName.trim()} data-testid="create-map-from-template"
                  onClick={() => void createMap()}>
                  {creating ? <Loader2 className="animate-spin" /> : <FilePlus2 />}Create map
                </Button>
              </div>
            </div> : <div className="border p-6 text-sm text-muted-foreground">Select a template to preview it.</div>}
          </div> : <div className="border p-8 text-center">
            <LayoutTemplate className="mx-auto h-5 w-5 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No published templates match</p>
            <p className="mt-1 text-xs text-muted-foreground">A template appears here only after its governed version is published.</p>
          </div>}
        </TabsContent>
        {canManage && <TabsContent value="manage">
          <GovernedJourneyTemplateWorkspace scope="space" templates={spaceTemplates} canManage onRefresh={load} />
        </TabsContent>}
      </Tabs>}
    </DialogContent>
  </Dialog>;
}
