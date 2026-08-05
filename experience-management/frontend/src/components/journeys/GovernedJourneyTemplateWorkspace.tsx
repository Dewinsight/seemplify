import { useEffect, useMemo, useState } from 'react';
import { Archive, Check, FilePlus2, History, Loader2, RefreshCw, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  JourneyTemplateContentEditor, journeyTemplateContentIssues
} from '@/components/journeys/JourneyTemplateContentEditor';
import { JourneyTemplatePreview, JourneyTemplateState } from '@/components/journeys/JourneyTemplatePreview';
import {
  blankJourneyTemplateContent, contentFromJourneyTemplateVersion,
  createPlatformJourneyTemplate, createPlatformJourneyTemplateVersion, createSpaceJourneyTemplate,
  createSpaceJourneyTemplateVersion, listPlatformJourneyTemplateAuditEvents, listSpaceJourneyTemplateAuditEvents,
  publishPlatformJourneyTemplateVersion, publishSpaceJourneyTemplateVersion,
  rejectPlatformJourneyTemplateReview,
  retirePlatformJourneyTemplateVersion, retireSpaceJourneyTemplateVersion,
  submitPlatformJourneyTemplateForReview, updatePlatformJourneyTemplateDraft, updateSpaceJourneyTemplateDraft,
  type JourneyTemplate, type JourneyTemplateAuditAction, type JourneyTemplateAuditEvent,
  type JourneyTemplateContent, type JourneyTemplateScope, type JourneyTemplateVersion
} from '@/lib/journeyTemplates';

type Work = '' | 'create' | 'save' | 'version' | 'review' | 'reject' | 'publish' | 'retire' | 'refresh';

const auditActionLabels: Record<JourneyTemplateAuditAction, string> = {
  seeded: 'Template seeded',
  created: 'Template created',
  draft_updated: 'Draft updated',
  version_created: 'Draft version created',
  submitted_for_review: 'Submitted for review',
  review_rejected: 'Review rejected',
  published: 'Version published',
  retired: 'Version retired',
  map_created: 'Journey map created'
};

function auditTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function message(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

export function GovernedJourneyTemplateWorkspace({ scope, templates, canManage, currentUserId, onRefresh }: {
  scope: JourneyTemplateScope;
  templates: JourneyTemplate[];
  canManage: boolean;
  currentUserId?: string;
  onRefresh: () => Promise<void>;
}) {
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [draft, setDraft] = useState<JourneyTemplateContent>(blankJourneyTemplateContent);
  const [newKey, setNewKey] = useState('');
  const [newContent, setNewContent] = useState<JourneyTemplateContent>(blankJourneyTemplateContent);
  const [reason, setReason] = useState('');
  const [work, setWork] = useState<Work>('');
  const [error, setError] = useState('');
  const [auditEvents, setAuditEvents] = useState<JourneyTemplateAuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [auditReload, setAuditReload] = useState(0);
  const [auditOpen, setAuditOpen] = useState(scope === 'system');

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) || null,
    [selectedTemplateId, templates]
  );
  const selectedVersion = useMemo(
    () => selectedTemplate?.versions.find((version) => version.id === selectedVersionId) || null,
    [selectedTemplate, selectedVersionId]
  );

  useEffect(() => {
    if (!templates.length) {
      setSelectedTemplateId('');
      setSelectedVersionId('');
      return;
    }
    if (templates.some((template) => template.id === selectedTemplateId)) return;
    const first = templates[0];
    setSelectedTemplateId(first.id);
    setSelectedVersionId(first.currentVersionId || first.versions[0]?.id || '');
  }, [selectedTemplateId, templates]);

  useEffect(() => {
    if (!selectedTemplate) return;
    if (selectedTemplate.versions.some((version) => version.id === selectedVersionId)) return;
    setSelectedVersionId(selectedTemplate.currentVersionId || selectedTemplate.versions[0]?.id || '');
  }, [selectedTemplate, selectedVersionId]);

  useEffect(() => {
    if (selectedVersion) setDraft(contentFromJourneyTemplateVersion(selectedVersion));
  }, [selectedVersion?.id, selectedVersion?.revision]);

  useEffect(() => {
    let current = true;
    if (!selectedTemplate) {
      setAuditEvents([]);
      setAuditError('');
      setAuditHasMore(false);
      return () => { current = false; };
    }
    setAuditLoading(true);
    setAuditError('');
    const request = scope === 'system'
      ? listPlatformJourneyTemplateAuditEvents(selectedTemplate.id, 20)
      : listSpaceJourneyTemplateAuditEvents(selectedTemplate.id, 20);
    void request.then((result) => {
      if (!current) return;
      setAuditEvents(result.events);
      setAuditHasMore(Boolean(result.nextBefore));
    }).catch((cause) => {
      if (!current) return;
      setAuditEvents([]);
      setAuditHasMore(false);
      setAuditError(message(cause, 'Template activity could not be loaded.'));
    }).finally(() => {
      if (current) setAuditLoading(false);
    });
    return () => { current = false; };
  }, [auditReload, scope, selectedTemplate?.id, selectedTemplate?.revision]);

  const draftIssues = journeyTemplateContentIssues(draft);
  const createIssues = journeyTemplateContentIssues(newContent);
  const editable = canManage && selectedVersion?.state === 'draft';
  const reasonReady = reason.trim().length >= 3;
  const draftDirty = Boolean(selectedVersion && JSON.stringify(draft) !== JSON.stringify(
    contentFromJourneyTemplateVersion(selectedVersion)
  ));
  const isReviewAuthor = Boolean(scope === 'system' && selectedVersion?.state === 'in_review'
    && currentUserId && selectedVersion.reviewedByUserId === currentUserId);

  async function run(action: Work, task: () => Promise<unknown>, success: string) {
    setWork(action); setError('');
    try {
      await task();
      await onRefresh();
      setAuditReload((value) => value + 1);
      toast.success(success);
      return true;
    } catch (cause) {
      const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code || '') : '';
      const detail = code === 'JOURNEY_TEMPLATE_REVISION_CONFLICT'
        ? 'This template changed in another session. It has been refreshed; review the latest version before trying again.'
        : message(cause, 'The template change could not be completed.');
      setError(detail);
      toast.error(detail);
      if (code === 'JOURNEY_TEMPLATE_REVISION_CONFLICT') await onRefresh();
      return false;
    } finally { setWork(''); }
  }

  async function createTemplate() {
    if (!canManage || createIssues.length || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(newKey)) return;
    const created: { current: JourneyTemplate | null } = { current: null };
    const okay = await run('create', async () => {
      created.current = scope === 'system'
        ? await createPlatformJourneyTemplate(newKey, newContent)
        : await createSpaceJourneyTemplate(newKey, newContent);
    }, 'Template draft created.');
    if (okay && created.current) {
      setSelectedTemplateId(created.current.id);
      setSelectedVersionId(created.current.currentVersionId || created.current.versions[0]?.id || '');
      setNewKey(''); setNewContent(blankJourneyTemplateContent());
    }
  }

  async function saveDraft() {
    if (!selectedTemplate || !selectedVersion || !editable || draftIssues.length) return;
    await run('save', () => scope === 'system'
      ? updatePlatformJourneyTemplateDraft(selectedTemplate.id, selectedVersion.id, selectedTemplate.revision,
        selectedVersion.revision, draft)
      : updateSpaceJourneyTemplateDraft(selectedTemplate.id, selectedVersion.id, selectedTemplate.revision,
        selectedVersion.revision, draft), 'Template draft saved.');
  }

  async function createVersion() {
    if (!selectedTemplate || !selectedVersion || !canManage) return;
    const created: { current: JourneyTemplate | null } = { current: null };
    const content = contentFromJourneyTemplateVersion(selectedVersion);
    const okay = await run('version', async () => {
      created.current = scope === 'system'
        ? await createPlatformJourneyTemplateVersion(selectedTemplate.id, selectedTemplate.revision, content)
        : await createSpaceJourneyTemplateVersion(selectedTemplate.id, selectedTemplate.revision, content);
    }, 'A new editable draft version was created.');
    if (okay && created.current) {
      setSelectedVersionId(created.current.currentVersionId || created.current.versions[0]?.id || '');
    }
  }

  async function transition(action: 'review' | 'reject' | 'publish' | 'retire') {
    if (!selectedTemplate || !selectedVersion || !canManage || !reasonReady) return;
    const args = [selectedTemplate.id, selectedVersion.id, selectedTemplate.revision,
      selectedVersion.revision, reason.trim()] as const;
    const task = action === 'review'
      ? () => submitPlatformJourneyTemplateForReview(...args)
      : action === 'reject'
        ? () => rejectPlatformJourneyTemplateReview(...args)
      : action === 'publish'
        ? () => scope === 'system'
          ? publishPlatformJourneyTemplateVersion(...args)
          : publishSpaceJourneyTemplateVersion(...args)
        : () => scope === 'system'
          ? retirePlatformJourneyTemplateVersion(...args)
          : retireSpaceJourneyTemplateVersion(...args);
    const labels = {
      review: 'Template submitted for review.', reject: 'Template returned to an editable draft.',
      publish: 'Template version published.', retire: 'Template version retired.'
    };
    const okay = await run(action, task, labels[action]);
    if (okay) setReason('');
  }

  return <div className="space-y-5" data-testid={`${scope}-journey-template-governance`}>
    {error && <p className="border border-destructive/35 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{error}</p>}

    {canManage && <details className="border bg-card" data-testid={`create-${scope}-journey-template`}>
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        Create template
      </summary>
      <div className="space-y-5 border-t p-4">
        <div className="max-w-md"><Label htmlFor={`${scope}-template-key`}>Template key</Label><Input
          id={`${scope}-template-key`} value={newKey} maxLength={100} placeholder="subscription-renewal"
          onChange={(event) => setNewKey(event.target.value.toLowerCase().replace(/[^a-z0-9-]/gu, '-'))} />
          <p className="mt-1 text-xs text-muted-foreground">Stable lower-kebab-case identifier. It cannot be changed later.</p>
        </div>
        <JourneyTemplateContentEditor idPrefix={`${scope}-new-template`} value={newContent} onChange={setNewContent}
          disabled={Boolean(work)} />
        {createIssues.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-destructive">
          {createIssues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>}
        <Button type="button" size="sm" disabled={Boolean(work) || createIssues.length > 0
          || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(newKey)} onClick={() => void createTemplate()}>
          {work === 'create' ? <Loader2 className="animate-spin" /> : <FilePlus2 />}Create draft
        </Button>
      </div>
    </details>}

    <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <section className="overflow-hidden border bg-card" aria-labelledby={`${scope}-template-list-heading`}>
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div><h2 id={`${scope}-template-list-heading`} className="text-sm font-semibold">Templates</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{templates.length} total</p></div>
          <Button type="button" size="icon" variant="ghost" aria-label="Refresh journey templates" disabled={Boolean(work)}
            onClick={() => void run('refresh', onRefresh, 'Templates refreshed.')}>
            <RefreshCw className={work === 'refresh' ? 'animate-spin' : ''} />
          </Button>
        </div>
        <div className="divide-y">{templates.map((template) => {
          const current = template.versions.find((version) => version.id === template.currentVersionId)
            || template.versions[0];
          return <button type="button" className={`w-full px-4 py-3 text-left hover:bg-muted/50 ${
            template.id === selectedTemplateId ? 'bg-muted' : ''}`}
            aria-pressed={template.id === selectedTemplateId} key={template.id} onClick={() => {
              setSelectedTemplateId(template.id);
              setSelectedVersionId(template.currentVersionId || template.versions[0]?.id || '');
            }}>
            <span className="block truncate text-sm font-medium">{current?.name || template.key}</span>
            <span className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="truncate">{template.key}</span><span>{template.versions.length} version{template.versions.length === 1 ? '' : 's'}</span>
            </span>
          </button>;
        })}</div>
        {!templates.length && <p className="p-5 text-sm leading-6 text-muted-foreground">No governed templates exist in this scope.</p>}
      </section>

      {selectedTemplate && selectedVersion ? <section className="min-w-0 border bg-card" aria-labelledby={`${scope}-template-editor-heading`}>
        <div className="flex flex-col justify-between gap-3 border-b px-5 py-4 sm:flex-row sm:items-start">
          <div><div className="flex flex-wrap items-center gap-2"><h2 id={`${scope}-template-editor-heading`} className="text-base font-semibold">
            {selectedVersion.name}</h2><JourneyTemplateState state={selectedVersion.state} /></div>
            <p className="mt-1 text-xs text-muted-foreground">{selectedTemplate.key} / template revision {selectedTemplate.revision}</p></div>
          <div className="flex flex-wrap gap-2">
            {canManage && selectedVersion.state !== 'draft' && <Button type="button" size="sm" variant="outline"
              disabled={Boolean(work)} onClick={() => void createVersion()}>
              {work === 'version' ? <Loader2 className="animate-spin" /> : <FilePlus2 />}New draft version
            </Button>}
            {editable && <Button type="button" size="sm" disabled={Boolean(work) || !draftDirty || draftIssues.length > 0}
              onClick={() => void saveDraft()}>{work === 'save' ? <Loader2 className="animate-spin" /> : <Save />}Save draft</Button>}
          </div>
        </div>
        <div className="space-y-5 p-5">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end">
            <div><Label htmlFor={`${scope}-template-version`}>Version</Label><select id={`${scope}-template-version`}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={selectedVersionId}
              onChange={(event) => setSelectedVersionId(event.target.value)}>
              {selectedTemplate.versions.map((version) => <option value={version.id} key={version.id}>
                Version {version.versionNumber} / {version.state.replace('_', ' ')}
              </option>)}
            </select></div>
            <p className="text-xs text-muted-foreground">Content checksum {selectedVersion.contentChecksum.slice(0, 12)}…</p>
          </div>

          {selectedVersion.state === 'draft' ? <>
            <JourneyTemplateContentEditor idPrefix={`${scope}-template-${selectedVersion.id}`} value={draft}
              onChange={setDraft} disabled={!editable || Boolean(work)} />
            {draftIssues.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-destructive">
              {draftIssues.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>}
          </> : <JourneyTemplatePreview version={selectedVersion} />}

          {canManage && <div className="space-y-3 border-t pt-5">
            <div><Label htmlFor={`${scope}-template-reason`}>Change reason</Label><Textarea
              id={`${scope}-template-reason`} rows={2} value={reason} maxLength={1000}
              placeholder="Required for review, publication, or retirement" disabled={Boolean(work)}
              onChange={(event) => setReason(event.target.value)} /></div>
            <div className="flex flex-wrap gap-2">
              {scope === 'system' && selectedVersion.state === 'draft' && <Button type="button" size="sm"
                disabled={Boolean(work) || draftDirty || draftIssues.length > 0 || !reasonReady}
                onClick={() => void transition('review')}>
                {work === 'review' ? <Loader2 className="animate-spin" /> : <ShieldCheck />}Submit for review
              </Button>}
              {scope === 'system' && selectedVersion.state === 'in_review' && <Button type="button" size="sm"
                data-testid="publish-reviewed-template" disabled={Boolean(work) || !reasonReady || isReviewAuthor}
                title={isReviewAuthor ? 'A different administrator must publish this reviewed version.' : undefined}
                onClick={() => void transition('publish')}>
                {work === 'publish' ? <Loader2 className="animate-spin" /> : <Check />}Publish reviewed version
              </Button>}
              {scope === 'system' && selectedVersion.state === 'in_review' && <Button type="button" size="sm"
                variant="outline" data-testid="reject-reviewed-template" disabled={Boolean(work) || !reasonReady}
                onClick={() => void transition('reject')}>
                {work === 'reject' ? <Loader2 className="animate-spin" /> : <RotateCcw />}Reject to draft
              </Button>}
              {scope === 'space' && selectedVersion.state === 'draft' && <Button type="button" size="sm"
                disabled={Boolean(work) || draftDirty || draftIssues.length > 0 || !reasonReady}
                onClick={() => void transition('publish')}>
                {work === 'publish' ? <Loader2 className="animate-spin" /> : <Check />}Publish version
              </Button>}
              {selectedVersion.state !== 'retired' && <Button type="button" size="sm"
                variant="destructive" disabled={Boolean(work) || draftDirty || !reasonReady} onClick={() => void transition('retire')}>
                {work === 'retire' ? <Loader2 className="animate-spin" /> : <Archive />}Retire version
              </Button>}
            </div>
            {scope === 'system' && selectedVersion.state === 'draft' && <p className="text-xs leading-5 text-muted-foreground">
              System publication is blocked until this draft is submitted for review. Save any edits before submitting it.
            </p>}
            {scope === 'system' && selectedVersion.state === 'in_review' && <div
              className={`flex items-start gap-2 border px-3 py-3 text-xs leading-5 ${isReviewAuthor
                ? 'border-amber-300 bg-amber-50/60 text-amber-950'
                : 'border-emerald-200 bg-emerald-50/60 text-emerald-950'}`}
              data-testid="template-two-person-status">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{isReviewAuthor
                ? 'You submitted this version for review. A different administrator must publish it; you can return it to draft with a reason.'
                : 'This version was reviewed by a different administrator. Enter a change reason to publish it, or return it to draft.'}</p>
            </div>}
          </div>}

          <details className="border" open={auditOpen} onToggle={(event) => setAuditOpen(event.currentTarget.open)}
            data-testid={`${scope}-template-audit`}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              <span className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4" />Activity history</span>
              <span className="text-xs font-normal text-muted-foreground">Latest 20 events</span>
            </summary>
            <div className="border-t">
              <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
                <p className="text-xs leading-5 text-muted-foreground">Read-only governance history for this template.</p>
                <Button type="button" size="sm" variant="ghost" disabled={auditLoading}
                  aria-label="Refresh template activity" onClick={() => setAuditReload((value) => value + 1)}>
                  <RefreshCw className={auditLoading ? 'animate-spin' : ''} />Refresh
                </Button>
              </div>
              {auditError && <p className="m-4 border border-destructive/35 bg-destructive/5 p-3 text-sm text-destructive"
                role="alert">{auditError}</p>}
              {auditLoading && !auditEvents.length
                ? <p className="px-4 py-6 text-sm text-muted-foreground">Loading template activity…</p>
                : auditEvents.length > 0 ? <ol className="divide-y" aria-label="Template activity history">
                  {auditEvents.map((event) => {
                    const version = selectedTemplate.versions.find((item) => item.id === event.templateVersionId);
                    const actor = event.actorUserId === currentUserId ? 'You'
                      : event.actorUserId ? `Administrator ${event.actorUserId.slice(0, 8)}` : 'System';
                    return <li className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-5" key={event.id}>
                      <div className="min-w-0"><div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-medium">{auditActionLabels[event.action] || event.action}</span>
                        {version && <span className="text-xs text-muted-foreground">Version {version.versionNumber}</span>}
                      </div>
                      {event.reason && <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{event.reason}</p>}
                      </div>
                      <div className="text-xs leading-5 text-muted-foreground sm:text-right"><div>{actor}</div>
                        <time dateTime={event.createdAt}>{auditTime(event.createdAt)}</time></div>
                    </li>;
                  })}
                </ol> : !auditError && <p className="px-4 py-6 text-sm text-muted-foreground">No template activity has been recorded.</p>}
              {auditHasMore && <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
                Older events remain available through the bounded audit API.
              </p>}
            </div>
          </details>
        </div>
      </section> : <div className="border bg-card p-6 text-sm text-muted-foreground">Select a template to inspect its versions.</div>}
    </div>
  </div>;
}
