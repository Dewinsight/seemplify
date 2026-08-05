import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, LoaderCircle, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuthSession } from '@/lib/authSessionContext';
import { ApiError } from '@/lib/api';
import { Link, useNavigate, useParams } from '@/lib/router';
import {
  applyJourneySuggestion, readJourneySuggestion, reviewJourneySuggestionChange,
  type JourneySuggestionChange, type JourneySuggestionDecisionValue, type JourneySuggestionDetail,
  type JourneySuggestionEvidence, type JourneySuggestionState
} from '@/lib/journeySuggestions';

type ReviewDraft = { decision: JourneySuggestionDecisionValue | ''; reason: string };

const stateLabels: Record<JourneySuggestionState, string> = {
  queued: 'Queued', generating: 'Generating', review: 'In review', ready_to_apply: 'Ready to apply',
  applied: 'Applied', dismissed: 'Dismissed', superseded: 'Base changed', failed: 'Failed'
};

function stateVariant(state: JourneySuggestionState): 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' {
  if (state === 'applied') return 'success';
  if (state === 'failed' || state === 'superseded') return 'destructive';
  if (state === 'review' || state === 'ready_to_apply') return 'warning';
  if (state === 'dismissed') return 'outline';
  return 'secondary';
}

function readable(value: string) {
  return value.replace(/[._-]+/gu, ' ').replace(/^./u, (letter) => letter.toUpperCase());
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return 'Not set';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function changedFields(change: JourneySuggestionChange) {
  const before = change.before || {};
  return [...new Set([...Object.keys(before), ...Object.keys(change.after)])]
    .filter((field) => !['cardRef', 'stageKey', 'laneKey', 'ordinal'].includes(field))
    .filter((field) => before[field] !== change.after[field]);
}

function EvidenceReferences({ change, evidence }: {
  change: JourneySuggestionChange; evidence: Map<string, JourneySuggestionEvidence>;
}) {
  if (!change.evidenceRefs.length) return <p className="mt-3 flex items-center gap-2 text-xs text-amber-800">
    <AlertTriangle className="size-3.5" /> No selected evidence supports this proposed change.
  </p>;
  return <div className="mt-3 space-y-2">
    <p className="text-xs font-medium text-muted-foreground">Cited selected evidence</p>
    {change.evidenceRefs.map((sourceRef) => {
      const source = evidence.get(sourceRef);
      return <div key={sourceRef} className="border-l-2 border-l-border pl-3 text-xs">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{source?.sourceLabel || sourceRef}</span>
          <span className="text-muted-foreground">{source ? readable(source.sourceType) : 'Unavailable source'}</span>
          {source?.assessment === 'contradicts' && <span className="text-destructive">Contradictory</span>}
          {source?.currentAccess === 'inaccessible' && <span className="text-destructive">Access removed</span>}
        </div>
        <code className="mt-1 block break-all text-[11px] text-muted-foreground">{sourceRef}</code>
        {source?.excerpt && <p className="mt-1 line-clamp-3 text-muted-foreground">{source.excerpt}</p>}
      </div>;
    })}
  </div>;
}

function ChangeReview({ change, evidence, draft, canManage, busy, onDraft, onSave }: {
  change: JourneySuggestionChange;
  evidence: Map<string, JourneySuggestionEvidence>;
  draft: ReviewDraft;
  canManage: boolean;
  busy: boolean;
  onDraft: (draft: ReviewDraft) => void;
  onSave: () => void;
}) {
  const fields = changedFields(change);
  const editable = canManage;
  return <article className="min-w-0 border bg-card" data-testid={`suggestion-change-${change.ordinal}`}>
    <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Change {change.ordinal + 1}</span>
          <Badge variant="outline">{readable(change.operation)}</Badge>
          {change.decision && <Badge variant={change.decision.decision === 'accepted' ? 'success' : 'destructive'}>
            {readable(change.decision.decision)}
          </Badge>}
        </div>
        <h2 className="mt-2 text-base font-semibold">{readable(change.targetType)} · {change.targetRef}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{change.rationale}</p>
      </div>
      {change.warningCodes.length > 0 && <div className="flex flex-wrap gap-1.5 sm:max-w-64 sm:justify-end">
        {change.warningCodes.map((warning) => <Badge key={warning} variant="warning">{readable(warning)}</Badge>)}
      </div>}
    </div>
    <div className="grid min-w-0 gap-0 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 px-4 py-4 lg:border-r">
        <h3 className="text-sm font-semibold">Proposed difference</h3>
        {fields.length ? <div className="mt-3 overflow-x-auto border">
          <table className="w-full min-w-[520px] table-fixed text-left text-sm">
            <thead className="border-b bg-muted/35 text-xs text-muted-foreground">
              <tr><th className="w-32 px-3 py-2 font-medium">Field</th><th className="px-3 py-2 font-medium">Current</th><th className="px-3 py-2 font-medium">Proposed</th></tr>
            </thead>
            <tbody className="divide-y">
              {fields.map((field) => <tr key={field}>
                <th className="px-3 py-3 align-top text-xs font-medium text-muted-foreground">{readable(field)}</th>
                <td className="whitespace-pre-wrap break-words px-3 py-3 align-top text-muted-foreground">{displayValue(change.before?.[field])}</td>
                <td className="whitespace-pre-wrap break-words px-3 py-3 align-top">{displayValue(change.after[field])}</td>
              </tr>)}
            </tbody>
          </table>
        </div> : <p className="mt-3 text-sm text-muted-foreground">This operation adds a new structured item.</p>}
        <EvidenceReferences change={change} evidence={evidence} />
      </div>
      <div className="bg-muted/15 px-4 py-4">
        <h3 className="text-sm font-semibold">Human decision</h3>
        {change.decision && <p className="mt-1 text-xs text-muted-foreground">
          Latest decision saved {new Date(change.decision.createdAt).toLocaleString()}. A new decision keeps the prior one in the audit history.
        </p>}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button type="button" size="sm" variant={draft.decision === 'accepted' ? 'default' : 'outline'}
            disabled={!editable || busy} aria-pressed={draft.decision === 'accepted'}
            onClick={() => onDraft({ ...draft, decision: 'accepted' })}><Check /> Accept</Button>
          <Button type="button" size="sm" variant={draft.decision === 'rejected' ? 'destructive' : 'outline'}
            disabled={!editable || busy} aria-pressed={draft.decision === 'rejected'}
            onClick={() => onDraft({ ...draft, decision: 'rejected' })}><X /> Reject</Button>
        </div>
        <label className="mt-3 block text-xs font-medium" htmlFor={`review-reason-${change.id}`}>Decision reason</label>
        <Textarea id={`review-reason-${change.id}`} className="mt-1 min-h-24" maxLength={2_000}
          placeholder="Record why this change should or should not enter the draft."
          disabled={!editable || busy} value={draft.reason}
          onChange={(event) => onDraft({ ...draft, reason: event.target.value })} />
        <Button type="button" size="sm" className="mt-3 w-full" variant="secondary" disabled={!editable || busy || !draft.decision || draft.reason.trim().length < 3}
          onClick={onSave}>{busy && <LoaderCircle className="animate-spin" />} Save decision</Button>
      </div>
    </div>
  </article>;
}

export function JourneySuggestionReviewPage() {
  const { runId = '' } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const session = useAuthSession();
  const canManage = Boolean(session?.activeSpace && session.activeSpace.role !== 'member');
  const [detail, setDetail] = useState<JourneySuggestionDetail | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!runId) return;
    try {
      const result = await readJourneySuggestion(runId);
      setDetail(result);
      setDrafts((current) => Object.fromEntries(result.changes.map((change) => [change.id, current[change.id] || {
        decision: change.decision?.decision || '', reason: change.decision?.reason || ''
      }])));
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The suggestion review could not be loaded.');
    } finally { setLoading(false); }
  }, [runId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!detail || !['queued', 'generating'].includes(detail.run.state)) return;
    const timer = window.setInterval(() => { void load(); }, 1_500);
    return () => window.clearInterval(timer);
  }, [detail, load]);

  const evidence = useMemo(() => new Map((detail?.evidence || []).map((item) => [item.sourceRef, item])), [detail]);
  const reviewed = detail?.changes.filter((change) => change.decision).length || 0;

  async function saveDecision(change: JourneySuggestionChange) {
    if (!detail) return;
    const draft = drafts[change.id];
    if (!draft?.decision || draft.reason.trim().length < 3) return;
    setBusy(change.id); setError('');
    try {
      setDetail(await reviewJourneySuggestionChange(detail.run.id, change.id, {
        expectedRunRevision: detail.run.revision, decision: draft.decision, reason: draft.reason.trim()
      }));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) await load();
      setError(caught instanceof Error ? caught.message : 'The review decision could not be saved.');
    } finally { setBusy(''); }
  }

  async function applyReview() {
    if (!detail) return;
    setBusy('apply'); setError('');
    try {
      const result = await applyJourneySuggestion(detail.run.id, {
        expectedRunRevision: detail.run.revision,
        expectedDefinitionRevision: detail.run.baseDefinitionRevision
      });
      setDetail(result.suggestion);
      if (result.outcome === 'applied') navigate('/journey-maps');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) await load();
      setError(caught instanceof Error ? caught.message : 'The reviewed changes could not be applied.');
    } finally { setBusy(''); }
  }

  if (loading) return <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground" role="status">
    <LoaderCircle className="mr-2 animate-spin" /> Loading suggestion review…
  </div>;
  if (!detail) return <div className="mx-auto max-w-3xl space-y-4 py-10">
    <Link to="/journey-maps" className="inline-flex items-center gap-2 text-sm font-medium text-primary"><ArrowLeft /> Journey maps</Link>
    <div className="border border-red-200 bg-red-50 px-4 py-4 text-sm text-destructive" role="alert">{error || 'Suggestion review not found.'}</div>
  </div>;

  const generating = ['queued', 'generating'].includes(detail.run.state);
  const terminalMessage = detail.run.state === 'superseded'
    ? 'The draft changed after this request. Create a new suggestion run from the current draft.'
    : detail.run.state === 'failed' ? `Generation failed${detail.run.failureCode ? ` (${detail.run.failureCode})` : ''}.` : '';

  return <div className="mx-auto w-full max-w-[1180px] space-y-5 pb-12">
    <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <Link to="/journey-maps" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft /> Journey maps</Link>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Review AI journey suggestions</h1>
          <Badge variant={stateVariant(detail.run.state)}>{stateLabels[detail.run.state]}</Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          The AI produced a versioned change set. Nothing enters the journey draft until every change has a recorded human decision.
        </p>
      </div>
      <Button variant="outline" onClick={() => void load()} disabled={busy !== ''}><RefreshCw /> Refresh</Button>
    </div>

    {error && <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-destructive" role="alert">{error}</div>}
    {terminalMessage && <div className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">{terminalMessage}</div>}
    {!canManage && <div className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
      data-testid="journey-suggestion-read-only">
      You have read-only access to this review. A space owner or admin must record decisions and apply accepted changes.
    </div>}

    <section className="border bg-card" aria-labelledby="suggestion-summary-heading">
      <div className="grid gap-px bg-border md:grid-cols-[minmax(0,1fr)_180px_180px]">
        <div className="bg-background px-4 py-4">
          <h2 id="suggestion-summary-heading" className="text-sm font-semibold">Request and summary</h2>
          <p className="mt-2 text-sm leading-6">{detail.run.summary || (generating ? 'The AI is producing a typed change set.' : 'No summary was returned.')}</p>
          {detail.run.focus && <p className="mt-2 text-xs text-muted-foreground">Focus: {detail.run.focus}</p>}
        </div>
        <div className="bg-background px-4 py-4"><p className="text-xs text-muted-foreground">Review progress</p><p className="mt-1 text-lg font-semibold">{reviewed} / {detail.changes.length}</p></div>
        <div className="bg-background px-4 py-4"><p className="text-xs text-muted-foreground">Selected evidence</p><p className="mt-1 text-lg font-semibold">{detail.run.selectedEvidenceCount}</p></div>
      </div>
      <div className="flex items-start gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        <span>Base revision {detail.run.baseDefinitionRevision} · contract {detail.run.promptContractVersion} · change schema v{detail.run.changeSchemaVersion}</span>
      </div>
    </section>

    {generating ? <section className="border bg-card px-5 py-12 text-center" aria-live="polite">
      <LoaderCircle className="mx-auto size-5 animate-spin text-muted-foreground" />
      <h2 className="mt-3 text-sm font-semibold">Generating reviewable changes</h2>
      <p className="mt-1 text-sm text-muted-foreground">You can leave this page. The durable request will continue in the AI queue.</p>
    </section> : <div className="space-y-4">
      {detail.changes.map((change) => <ChangeReview key={change.id} change={change} evidence={evidence}
        draft={drafts[change.id] || { decision: '', reason: '' }} canManage={canManage && ['review', 'ready_to_apply'].includes(detail.run.state)}
        busy={busy !== ''} onDraft={(draft) => setDrafts((current) => ({ ...current, [change.id]: draft }))}
        onSave={() => void saveDecision(change)} />)}
    </div>}

    {detail.run.state === 'ready_to_apply' && <div className="sticky bottom-4 border bg-background px-4 py-4 shadow-panel sm:flex sm:items-center sm:justify-between">
      <div><p className="text-sm font-semibold">Every proposed change has a decision.</p><p className="mt-1 text-xs text-muted-foreground">Accepted changes create a new draft version atomically. Rejected changes remain in the audit.</p></div>
      <Button className="mt-3 w-full sm:mt-0 sm:w-auto" disabled={!canManage || busy !== ''} onClick={() => void applyReview()}>
        {busy === 'apply' && <LoaderCircle className="animate-spin" />} Apply reviewed changes
      </Button>
    </div>}
    {detail.run.state === 'applied' && <div className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
      Reviewed changes were applied to draft version {detail.run.appliedVersionId}.
    </div>}
    {detail.run.state === 'dismissed' && <div className="border px-4 py-3 text-sm text-muted-foreground">
      Every proposed change was rejected. The journey draft was not changed.
    </div>}
  </div>;
}
