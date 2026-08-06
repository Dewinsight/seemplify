import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, FilePlus2, LoaderCircle, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  deprecateJourneyEventSchemaVersion,
  listJourneyEventSchemas,
  publishJourneyEventSchemaVersion,
  readJourneyEventSchema,
  type JourneyEventSchema,
  type JourneyEventSchemaVersion,
  type JourneyEventSource
} from '@/lib/journeyEventControlPlane';
import { SchemaVersionDialog } from '@/components/journey-events/SchemaVersionDialog';
import {
  ConfirmationDialog,
  controlSelectClass,
  formatControlPlaneDate,
  SectionFrame,
  StatusLabel
} from '@/components/journey-events/shared';
import { cn } from '@/lib/utils';

function semverDescending(left: JourneyEventSchemaVersion, right: JourneyEventSchemaVersion) {
  const [leftMajor, leftMinor] = left.version.split('.').map(Number);
  const [rightMajor, rightMinor] = right.version.split('.').map(Number);
  return rightMajor - leftMajor || rightMinor - leftMinor;
}

function VersionDetail({ version, canManage, working, onPublish, onDeprecate }: {
  version: JourneyEventSchemaVersion;
  canManage: boolean;
  working: boolean;
  onPublish: () => void;
  onDeprecate: () => void;
}) {
  const issues = version.compatibility?.issues || [];
  const compatible = version.compatibility?.compatible !== false && !issues.some((issue) => issue.severity === 'error');
  return <details className="border" open={version.state === 'draft'}>
    <summary className="flex cursor-pointer list-none flex-col gap-2 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between">
      <span className="flex items-center gap-2"><span className="font-mono text-sm font-semibold">v{version.version}</span><StatusLabel status={version.state} /></span>
      <span className="text-xs text-muted-foreground">Created {formatControlPlaneDate(version.createdAt)} · {version.properties.length} properties</span>
    </summary>
    <div className="border-t">
      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs">
          {compatible ? <CheckCircle2 className="h-4 w-4 text-emerald-700" /> : <AlertCircle className="h-4 w-4 text-destructive" />}
          <span>{compatible ? 'Compatible with the preceding version' : 'Breaking issues must be resolved before publication'}</span>
        </div>
        {canManage && <div className="flex gap-2">
          {version.state === 'draft' && <Button size="sm" disabled={working || !compatible} title={!compatible ? 'Resolve every error before publishing.' : undefined} onClick={onPublish}>Publish</Button>}
          {version.state === 'published' && <Button size="sm" variant="outline" disabled={working} onClick={onDeprecate}>Deprecate</Button>}
        </div>}
      </div>
      {issues.length > 0 && <div className="border-b px-4 py-3">
        <h4 className="text-xs font-semibold">Compatibility and privacy review</h4>
        <ul className="mt-2 space-y-2">{issues.map((issue) => <li key={`${issue.code}-${issue.path}`} className="flex items-start gap-2 text-xs leading-5">
          <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', issue.severity === 'error' ? 'bg-red-600' : 'bg-amber-600')} aria-hidden="true" />
          <span><span className="font-medium">{issue.path}</span> — {issue.message} <span className="text-muted-foreground">({issue.code})</span></span>
        </li>)}</ul>
      </div>}
      {version.properties.length === 0 ? <p className="px-4 py-4 text-sm text-muted-foreground">This event has no properties.</p>
        : <div className="overflow-x-auto">
          <table className="data-table min-w-[720px]">
            <caption className="sr-only">Properties in event schema version {version.version}</caption>
            <thead><tr><th scope="col">Property</th><th scope="col">Type</th><th scope="col">Required</th><th scope="col">Data class</th><th scope="col">Purpose</th></tr></thead>
            <tbody>{version.properties.map((property) => <tr key={property.name}><th scope="row" className="border-b px-4 py-3 text-left"><code className="text-xs">{property.name}</code></th><td>{property.type}</td><td>{property.required ? 'Yes' : 'No'}</td><td>{property.dataClass.replaceAll('_', ' ')}</td><td className="max-w-md text-xs text-muted-foreground">{property.description}</td></tr>)}</tbody>
          </table>
        </div>}
    </div>
  </details>;
}

export function TrackingPlanWorkspace({ source, canManage }: { source: JourneyEventSource; canManage: boolean }) {
  const [schemas, setSchemas] = useState<JourneyEventSchema[]>([]);
  const [selectedSchemaId, setSelectedSchemaId] = useState('');
  const [schema, setSchema] = useState<JourneyEventSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [publishTarget, setPublishTarget] = useState<JourneyEventSchemaVersion | null>(null);
  const [deprecateTarget, setDeprecateTarget] = useState<JourneyEventSchemaVersion | null>(null);
  const [working, setWorking] = useState(false);

  const loadList = useCallback(async (preferredId = '') => {
    try {
      setLoading(true);
      setError('');
      const result = await listJourneyEventSchemas(source.id);
      setSchemas(result.schemas);
      setSelectedSchemaId((current) => preferredId || (result.schemas.some((item) => item.id === current) ? current : result.schemas[0]?.id || ''));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The tracking plan could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [source.id]);

  useEffect(() => {
    setSelectedSchemaId('');
    setSchema(null);
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selectedSchemaId) { setSchema(null); return; }
    let cancelled = false;
    setSchemaLoading(true);
    void readJourneyEventSchema(selectedSchemaId).then((result) => {
      if (!cancelled) setSchema(result.schema);
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'The event definition could not be loaded.');
    }).finally(() => { if (!cancelled) setSchemaLoading(false); });
    return () => { cancelled = true; };
  }, [selectedSchemaId]);

  const versions = useMemo(() => schema ? [...schema.versions].sort(semverDescending) : [], [schema]);

  async function saved(nextSchema: JourneyEventSchema) {
    setCreateOpen(false);
    setVersionOpen(false);
    setSchema(nextSchema);
    setSelectedSchemaId(nextSchema.id);
    await loadList(nextSchema.id);
  }

  async function publish() {
    if (!publishTarget || !canManage || working) return;
    try {
      setWorking(true);
      setError('');
      const result = await publishJourneyEventSchemaVersion(publishTarget.id);
      const refreshed = await readJourneyEventSchema(result.version.schemaId);
      setSchema(refreshed.schema);
      setPublishTarget(null);
      await loadList(refreshed.schema.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The schema version could not be published.');
    } finally { setWorking(false); }
  }

  async function deprecate() {
    if (!deprecateTarget || !canManage || working) return;
    try {
      setWorking(true);
      setError('');
      const result = await deprecateJourneyEventSchemaVersion(deprecateTarget.id);
      const refreshed = await readJourneyEventSchema(result.version.schemaId);
      setSchema(refreshed.schema);
      setDeprecateTarget(null);
      await loadList(refreshed.schema.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The schema version could not be deprecated.');
    } finally { setWorking(false); }
  }

  const mutable = canManage && source.status !== 'revoked';
  return <>
    <SectionFrame
      title="Tracking plan"
      description="Govern event names and properties before instrumentation. Published versions are immutable and retained for historical validation."
      action={mutable ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus />Add event</Button> : undefined}
    >
      {error && <div className="border-b bg-red-50 px-4 py-3 text-sm text-destructive" role="alert">{error}</div>}
      {loading ? <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />Loading tracking plan…</div>
        : schemas.length === 0 ? <div className="px-5 py-8"><p className="text-sm font-medium">No tracked events</p><p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">Create the first event definition, review its data classification, then publish it before switching this source to enforcement.</p></div>
          : <div className="grid min-h-[420px] lg:grid-cols-[260px_minmax(0,1fr)]">
            <aside className="border-b lg:border-b-0 lg:border-r" aria-label="Event catalogue">
              <div className="p-3 lg:hidden"><label className="sr-only" htmlFor="mobile-schema-select">Tracked event</label><select id="mobile-schema-select" className={controlSelectClass} value={selectedSchemaId} onChange={(event) => setSelectedSchemaId(event.target.value)}>{schemas.map((item) => <option key={item.id} value={item.id}>{item.eventName}</option>)}</select></div>
              <ul className="hidden divide-y lg:block">{schemas.map((item) => {
                const latest = [...item.versions].sort(semverDescending)[0];
                return <li key={item.id}><button type="button" aria-current={selectedSchemaId === item.id ? 'true' : undefined} className={cn('w-full px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', selectedSchemaId === item.id ? 'bg-muted' : 'hover:bg-muted/40')} onClick={() => setSelectedSchemaId(item.id)}><code className="block truncate text-xs font-semibold">{item.eventName}</code><span className="mt-1 block text-xs text-muted-foreground">{latest ? `v${latest.version}` : 'No versions'} · {item.versions.length} total</span></button></li>;
              })}</ul>
            </aside>
            <div className="min-w-0 p-4 sm:p-5">
              {schemaLoading || !schema ? <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />Loading event definition…</div>
                : <div className="space-y-4">
                  <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0"><code className="text-base font-semibold">{schema.eventName}</code><p className="mt-1 text-xs text-muted-foreground">Created {formatControlPlaneDate(schema.createdAt)} · {schema.versions.length} immutable version{schema.versions.length === 1 ? '' : 's'}</p></div>
                    {mutable && <Button size="sm" variant="outline" onClick={() => setVersionOpen(true)}><FilePlus2 />New version</Button>}
                  </div>
                  <div className="space-y-3">{versions.map((version) => <VersionDetail key={version.id} version={version} canManage={mutable} working={working} onPublish={() => setPublishTarget(version)} onDeprecate={() => setDeprecateTarget(version)} />)}</div>
                </div>}
            </div>
          </div>}
      <div className="flex justify-end border-t px-4 py-3"><Button type="button" size="sm" variant="ghost" disabled={loading} onClick={() => void loadList(selectedSchemaId)}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh</Button></div>
    </SectionFrame>

    <SchemaVersionDialog open={createOpen} sourceId={source.id} schema={null} onClose={() => setCreateOpen(false)} onSaved={(next) => void saved(next)} />
    {schema && <SchemaVersionDialog open={versionOpen} sourceId={source.id} schema={schema} onClose={() => setVersionOpen(false)} onSaved={(next) => void saved(next)} />}
    <ConfirmationDialog open={Boolean(publishTarget)} title={`Publish version ${publishTarget?.version || ''}?`} description="Published versions cannot be edited or deleted. New ingestion requests will validate against this version according to the source validation mode." confirmLabel="Publish version" busy={working} onCancel={() => setPublishTarget(null)} onConfirm={() => void publish()} />
    <ConfirmationDialog open={Boolean(deprecateTarget)} title={`Deprecate version ${deprecateTarget?.version || ''}?`} description="Existing historical events keep their version reference. New instrumentation should move to another published version." confirmLabel="Deprecate version" busy={working} onCancel={() => setDeprecateTarget(null)} onConfirm={() => void deprecate()} />
  </>;
}
