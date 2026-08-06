import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeft, Check, CircleAlert, FileCheck2, GitCompareArrows, History, LoaderCircle, Pencil,
  Plus, RefreshCw, Search, ShieldCheck, UserRound, UsersRound
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { useAuthSession } from '@/lib/authSessionContext';
import {
  attachEvidence, discoverableEvidenceSourceTypes, evidenceSourceLabels, searchEvidenceSources,
  type DiscoverableEvidenceSourceType, type JourneyEvidenceSourceView
} from '@/lib/journeyMaps';
import {
  attachPersonaClaimEvidence, createLibraryPersona, listPersonaLibrary, listPersonaVersions,
  readPersonaUsage, readPersonaVersion, readPersonaWorkspace, reviewPersonaVersion,
  submitPersonaForReview, updateLibraryPersona, withdrawPersonaReview,
  type PersonaClaim, type PersonaRecord, type PersonaSourceEvidence, type PersonaUsage,
  type PersonaVersion, type PersonaWriteInput
} from '@/lib/journeyPersonas';

type EditorDraft = {
  name: string; summary: string; attributes: string; goals: string; behaviours: string;
  needs: string; barriers: string; reviewAt: string;
};

const emptyDraft: EditorDraft = {
  name: '', summary: '', attributes: '', goals: '', behaviours: '', needs: '', barriers: '', reviewAt: ''
};

function lines(value: string) {
  return value.split(/\r?\n/gu).map((item) => item.trim()).filter(Boolean);
}

function attributes(value: string) {
  const result: Record<string, string> = {};
  for (const [index, line] of lines(value).entries()) {
    const separator = line.indexOf('=');
    if (separator < 1 || !line.slice(separator + 1).trim()) {
      throw new Error(`Attribute line ${index + 1} must use Name = value.`);
    }
    result[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return result;
}

function editorDraft(persona: PersonaRecord | null): EditorDraft {
  if (!persona) return emptyDraft;
  return {
    name: persona.name,
    summary: persona.summary,
    attributes: Object.entries(persona.attributes).map(([key, value]) => `${key} = ${value}`).join('\n'),
    goals: persona.goals.join('\n'),
    behaviours: persona.behaviours.join('\n'),
    needs: persona.needs.join('\n'),
    barriers: persona.barriers.join('\n'),
    reviewAt: persona.reviewAt?.slice(0, 10) || ''
  };
}

function writeInput(draft: EditorDraft): PersonaWriteInput {
  if (!draft.name.trim()) throw new Error('Persona name is required.');
  return {
    name: draft.name.trim(), summary: draft.summary.trim(), attributes: attributes(draft.attributes),
    goals: lines(draft.goals), behaviours: lines(draft.behaviours), needs: lines(draft.needs),
    barriers: lines(draft.barriers), reviewAt: draft.reviewAt ? new Date(`${draft.reviewAt}T00:00:00.000Z`).toISOString() : null
  };
}

function readable(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not set';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium', timeStyle: 'short'
  }).format(date);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The persona request failed.';
}

function StateLabel({ children }: { children: string }) {
  return <span className="inline-flex rounded-md border bg-background px-2 py-0.5 text-xs text-muted-foreground">
    {readable(children)}
  </span>;
}

function ErrorNotice({ error, onRefresh }: { error: string; onRefresh?: () => void }) {
  if (!error) return null;
  return <div className="flex items-start justify-between gap-3 border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-900" role="alert">
    <div className="flex min-w-0 items-start gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><p>{error}</p></div>
    {onRefresh && <Button type="button" size="sm" variant="outline" onClick={onRefresh}>Refresh</Button>}
  </div>;
}

function PersonaEditor({ open, persona, busy, onOpenChange, onSave }: {
  open: boolean; persona: PersonaRecord | null; busy: boolean;
  onOpenChange: (open: boolean) => void; onSave: (input: PersonaWriteInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<EditorDraft>(() => editorDraft(persona));
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setDraft(editorDraft(persona)); setError(''); } }, [open, persona]);
  const field = (key: keyof EditorDraft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try { setError(''); await onSave(writeInput(draft)); }
    catch (failure) { setError(errorMessage(failure)); }
  };
  return <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
    <DialogContent className="sm:max-w-3xl" data-testid="persona-editor-dialog">
      <form onSubmit={submit} className="space-y-5">
        <DialogHeader>
          <DialogTitle>{persona ? 'Edit persona' : 'Create persona'}</DialogTitle>
          <DialogDescription>
            Each save creates an immutable working version. Evidence and review are managed after saving.
          </DialogDescription>
        </DialogHeader>
        <ErrorNotice error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="persona-name">Name</Label>
            <Input id="persona-name" value={draft.name} onChange={(event) => field('name')(event.target.value)} maxLength={200} required />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="persona-summary">Summary</Label>
            <Textarea id="persona-summary" value={draft.summary} onChange={(event) => field('summary')(event.target.value)} rows={3} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="persona-attributes">Attributes</Label>
            <Textarea id="persona-attributes" value={draft.attributes}
              onChange={(event) => field('attributes')(event.target.value)} rows={5} placeholder={'Region = North\nDevice = Mobile'} />
            <p className="text-xs text-muted-foreground">One Name = value pair per line.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="persona-goals">Goals</Label>
            <Textarea id="persona-goals" value={draft.goals} onChange={(event) => field('goals')(event.target.value)} rows={5}
              placeholder="One goal per line" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="persona-behaviours">Behaviours</Label>
            <Textarea id="persona-behaviours" value={draft.behaviours}
              onChange={(event) => field('behaviours')(event.target.value)} rows={5} placeholder="One behaviour per line" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="persona-needs">Needs</Label>
            <Textarea id="persona-needs" value={draft.needs} onChange={(event) => field('needs')(event.target.value)} rows={5}
              placeholder="One need per line" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="persona-barriers">Barriers</Label>
            <Textarea id="persona-barriers" value={draft.barriers}
              onChange={(event) => field('barriers')(event.target.value)} rows={5} placeholder="One barrier per line" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="persona-review-date">Review date</Label>
            <Input id="persona-review-date" type="date" value={draft.reviewAt}
              onChange={(event) => field('reviewAt')(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy && <LoaderCircle className="h-4 w-4 animate-spin" />}{persona ? 'Save version' : 'Create persona'}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

function EvidencePicker({ open, persona, busy, onOpenChange, onAttached }: {
  open: boolean; persona: PersonaRecord | null; busy: boolean; onOpenChange: (open: boolean) => void;
  onAttached: () => Promise<void>;
}) {
  const [sourceType, setSourceType] = useState<DiscoverableEvidenceSourceType>('survey_response');
  const [query, setQuery] = useState('');
  const [sources, setSources] = useState<JourneyEvidenceSourceView[]>([]);
  const [selected, setSelected] = useState('');
  const [assessment, setAssessment] = useState<'supports' | 'contradicts' | 'neutral'>('supports');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const search = useCallback(async () => {
    try {
      setSearching(true); setError('');
      const response = await searchEvidenceSources(sourceType, query, 20);
      setSources(response.sources); setSelected((current) => response.sources.some((item) => item.sourceRef === current) ? current : '');
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setSearching(false); }
  }, [query, sourceType]);
  useEffect(() => { if (open) void search(); }, [open, search]);
  const attach = async () => {
    if (!persona || !selected) return;
    try {
      setError('');
      await attachEvidence({ targetType: 'persona', targetId: persona.id, sourceType, sourceRef: selected, assessment });
      await onAttached(); onOpenChange(false); toast.success('Evidence added to the persona.');
    } catch (failure) { setError(errorMessage(failure)); }
  };
  return <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
    <DialogContent className="sm:max-w-2xl" data-testid="persona-evidence-picker">
      <DialogHeader>
        <DialogTitle>Add persona evidence</DialogTitle>
        <DialogDescription>Select an authorised source. You can then bind it to one or more exact persona claims.</DialogDescription>
      </DialogHeader>
      <ErrorNotice error={error} />
      <div className="grid gap-3 sm:grid-cols-[190px_minmax(0,1fr)_auto]">
        <div className="space-y-2"><Label htmlFor="persona-source-type">Source type</Label>
          <select id="persona-source-type" className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={sourceType} onChange={(event) => setSourceType(event.target.value as DiscoverableEvidenceSourceType)}>
            {discoverableEvidenceSourceTypes.map((type) => <option value={type} key={type}>{evidenceSourceLabels[type]}</option>)}
          </select>
        </div>
        <div className="space-y-2"><Label htmlFor="persona-source-search">Search</Label>
          <Input id="persona-source-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or reference" />
        </div>
        <div className="self-end"><Button type="button" variant="outline" onClick={() => void search()} disabled={searching}>
          {searching ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Search
        </Button></div>
      </div>
      <div className="max-h-72 overflow-y-auto border" role="radiogroup" aria-label="Authorised evidence sources">
        {sources.length === 0 && !searching
          ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">No authorised sources matched this search.</p>
          : sources.map((source) => <label key={`${source.sourceType}:${source.sourceRef}`}
            className="flex cursor-pointer items-start gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-muted/30">
            <input type="radio" name="persona-source" className="mt-1" checked={selected === source.sourceRef}
              onChange={() => setSelected(source.sourceRef)} />
            <span className="min-w-0"><span className="block text-sm font-medium">{source.label}</span>
              <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">{source.excerpt || source.sourceRef}</span></span>
          </label>)}
      </div>
      <div className="space-y-2"><Label htmlFor="persona-source-assessment">Relationship to the persona</Label>
        <select id="persona-source-assessment" className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={assessment} onChange={(event) => setAssessment(event.target.value as typeof assessment)}>
          <option value="supports">Supports</option><option value="contradicts">Contradicts</option><option value="neutral">Context only</option>
        </select>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        <Button type="button" onClick={() => void attach()} disabled={busy || !selected}>Add evidence</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function PersonaComparison({ personas }: { personas: PersonaRecord[] }) {
  if (personas.length !== 2) return null;
  const rows: Array<[string, (persona: PersonaRecord) => string]> = [
    ['Summary', (persona) => persona.summary || 'Not recorded'],
    ['Goals', (persona) => persona.goals.join('; ') || 'None'],
    ['Behaviours', (persona) => persona.behaviours.join('; ') || 'None'],
    ['Needs', (persona) => persona.needs.join('; ') || 'None'],
    ['Barriers', (persona) => persona.barriers.join('; ') || 'None']
  ];
  return <section className="border bg-card" aria-labelledby="persona-comparison-heading" data-testid="persona-library-comparison">
    <div className="border-b px-4 py-3"><h2 id="persona-comparison-heading" className="text-sm font-semibold">Current persona comparison</h2>
      <p className="mt-1 text-xs text-muted-foreground">This compares the current reusable records. Published maps keep their pinned versions.</p></div>
    <div className="overflow-x-auto"><table className="min-w-[640px] w-full text-left text-sm">
      <thead><tr className="border-b bg-muted/30"><th className="w-36 px-4 py-2 font-medium">Field</th>
        {personas.map((persona) => <th key={persona.id} className="px-4 py-2 font-medium">{persona.name}</th>)}</tr></thead>
      <tbody>{rows.map(([label, value]) => <tr key={label} className="border-b last:border-b-0"><th className="px-4 py-3 align-top font-medium">{label}</th>
        {personas.map((persona) => <td key={persona.id} className="px-4 py-3 align-top text-muted-foreground">{value(persona)}</td>)}</tr>)}</tbody>
    </table></div>
  </section>;
}

function ClaimRow({ claim, rootEvidence, sourceAccess, canEdit, busy, onAttach }: {
  claim: PersonaClaim; rootEvidence: PersonaSourceEvidence[]; sourceAccess: Record<string, 'available' | 'inaccessible'>;
  canEdit: boolean; busy: boolean; onAttach: (claimId: string, evidenceLinkId: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState('');
  const available = rootEvidence.filter((evidence) => evidence.sourceAccess === 'available' && !evidence.invalidatedAt
    && !claim.evidence.some((linked) => linked.evidenceLinkId === evidence.id));
  return <li className="border-b px-4 py-4 last:border-b-0" data-testid={`persona-claim-${claim.id}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><p className="text-xs font-medium text-muted-foreground">{readable(claim.type)}{claim.label ? ` · ${claim.label}` : ''}</p>
        <p className="mt-1 text-sm">{claim.value}</p></div>
      <span className="text-xs text-muted-foreground">{claim.evidence.length} source{claim.evidence.length === 1 ? '' : 's'}</span>
    </div>
    {claim.evidence.length > 0 && <ul className="mt-3 space-y-2">
      {claim.evidence.map((evidence) => <li key={evidence.id} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <FileCheck2 className="h-3.5 w-3.5" />
        <span>{evidence.assessmentAtLink}</span><StateLabel>{evidence.state}</StateLabel>
        {sourceAccess[evidence.evidenceLinkId] === 'inaccessible' && <span className="text-amber-800">Source is no longer accessible</span>}
      </li>)}
    </ul>}
    {canEdit && <div className="mt-3 flex flex-col gap-2 sm:flex-row">
      <select className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm" value={selected}
        aria-label={`Evidence for ${claim.label || claim.type}`} onChange={(event) => setSelected(event.target.value)}>
        <option value="">Choose persona evidence</option>
        {available.map((evidence) => <option key={evidence.id} value={evidence.id}>
          {evidence.sourceLabel || readable(evidence.sourceType)} · {evidence.assessment}
        </option>)}
      </select>
      <Button type="button" size="sm" variant="outline" disabled={!selected || busy}
        onClick={() => void onAttach(claim.id, selected).then(() => setSelected(''))}>Bind to claim</Button>
    </div>}
  </li>;
}

export function JourneyPersonaLibrary() {
  const session = useAuthSession();
  const canEdit = session?.activeSpace?.role === 'owner' || session?.activeSpace?.role === 'admin';
  const [personas, setPersonas] = useState<PersonaRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [persona, setPersona] = useState<PersonaRecord | null>(null);
  const [rootEvidence, setRootEvidence] = useState<PersonaSourceEvidence[]>([]);
  const [versions, setVersions] = useState<PersonaVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [selectedVersion, setSelectedVersion] = useState<PersonaVersion | null>(null);
  const [sourceAccess, setSourceAccess] = useState<Record<string, 'available' | 'inaccessible'>>({});
  const [usage, setUsage] = useState<PersonaUsage>({ workingJourneys: [], publishedSnapshots: [] });
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [reviewComment, setReviewComment] = useState('');

  const loadList = useCallback(async () => {
    try {
      setLoadingList(true); setError('');
      const next = await listPersonaLibrary(); setPersonas(next);
      setSelectedId((current) => current && next.some((item) => item.id === current) ? current : (next[0]?.id || ''));
      setCompareIds((current) => current.filter((id) => next.some((item) => item.id === id)).slice(0, 2));
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setLoadingList(false); }
  }, []);

  const loadPersona = useCallback(async (personaId: string, preferredVersionId = '') => {
    if (!personaId) { setPersona(null); setVersions([]); setSelectedVersion(null); return; }
    try {
      setLoadingDetail(true); setError('');
      const [workspace, history, nextUsage] = await Promise.all([
        readPersonaWorkspace(personaId), listPersonaVersions(personaId), readPersonaUsage(personaId)
      ]);
      const versionId = history.some((item) => item.id === preferredVersionId) ? preferredVersionId : (history[0]?.id || '');
      const detail = versionId ? await readPersonaVersion(personaId, versionId) : null;
      setPersona(workspace.persona); setRootEvidence(workspace.evidence); setVersions(history); setUsage(nextUsage);
      setSelectedVersionId(versionId); setSelectedVersion(detail?.version || null); setSourceAccess(detail?.sourceAccess || {});
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setLoadingDetail(false); }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { void loadPersona(selectedId); }, [loadPersona, selectedId]);

  const chooseVersion = async (versionId: string) => {
    if (!persona) return;
    try {
      setLoadingDetail(true); setError('');
      const detail = await readPersonaVersion(persona.id, versionId);
      setSelectedVersionId(versionId); setSelectedVersion(detail.version); setSourceAccess(detail.sourceAccess);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setLoadingDetail(false); }
  };

  const refreshSelected = useCallback(async (preferredVersionId = '') => {
    await Promise.all([loadList(), selectedId ? loadPersona(selectedId, preferredVersionId) : Promise.resolve()]);
  }, [loadList, loadPersona, selectedId]);

  const savePersona = async (input: PersonaWriteInput) => {
    try {
      setBusy(true); setError('');
      if (persona && !creating) {
        const saved = await updateLibraryPersona(persona.id, persona.revision, input);
        setEditorOpen(false); setCreating(false); await refreshSelected(); toast.success(`Version saved for ${saved.name}.`);
      } else {
        const created = await createLibraryPersona(input);
        setEditorOpen(false); setCreating(false); await loadList(); setSelectedId(created.id); toast.success('Persona created.');
      }
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'JOURNEY_PERSONA_REVISION_CONFLICT') {
        setError('This persona changed in another session. Refresh before saving again.');
      }
      throw failure;
    } finally { setBusy(false); }
  };

  const retire = async () => {
    if (!persona || !window.confirm(`Retire ${persona.name}? Existing published pins will remain available.`)) return;
    try {
      setBusy(true); setError('');
      await updateLibraryPersona(persona.id, persona.revision, { lifecycleState: 'retired' });
      await refreshSelected(); toast.success('Persona retired.');
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  };

  const attachToClaim = async (claimId: string, evidenceLinkId: string) => {
    if (!persona || !selectedVersion) return;
    try {
      setBusy(true); setError('');
      const result = await attachPersonaClaimEvidence({
        personaId: persona.id, versionId: selectedVersion.id, claimId, evidenceLinkId, expectedRevision: persona.revision
      });
      await refreshSelected(result.id); toast.success('Evidence bound to the claim.');
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  };

  const governance = async (action: 'submit' | 'withdraw' | 'approved' | 'changes_requested') => {
    if (!persona || !selectedVersion || reviewComment.trim().length < 3) {
      setError('Add a review comment of at least three characters.'); return;
    }
    try {
      setBusy(true); setError('');
      const result = action === 'submit'
        ? await submitPersonaForReview(persona.id, selectedVersion.id, persona.revision, reviewComment.trim())
        : action === 'withdraw'
          ? await withdrawPersonaReview(persona.id, selectedVersion.id, persona.revision, reviewComment.trim())
          : await reviewPersonaVersion(persona.id, selectedVersion.id, persona.revision, action, reviewComment.trim());
      setReviewComment(''); await refreshSelected(result.id); toast.success(action === 'approved' ? 'Persona approved.' : 'Review updated.');
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'JOURNEY_PERSONA_TWO_PERSON_APPROVAL_REQUIRED') {
        setError('A different space owner or administrator must approve this version.');
      } else if (failure instanceof ApiError && failure.code === 'JOURNEY_PERSONA_REVISION_CONFLICT') {
        setError('This persona changed while you were reviewing it. Refresh to continue.');
      } else setError(errorMessage(failure));
    } finally { setBusy(false); }
  };

  const toggleCompare = (id: string) => setCompareIds((current) => current.includes(id)
    ? current.filter((item) => item !== id)
    : current.length < 2 ? [...current, id] : [current[1], id]);
  const filtered = useMemo(() => personas.filter((item) => {
    const search = query.trim().toLocaleLowerCase();
    return (stateFilter === 'all' || item.lifecycleState === stateFilter)
      && (!search || `${item.name} ${item.summary}`.toLocaleLowerCase().includes(search));
  }), [personas, query, stateFilter]);
  const compared = compareIds.map((id) => personas.find((item) => item.id === id)).filter(Boolean) as PersonaRecord[];
  const currentVersionId = versions[0]?.id || '';
  const selectedIsCurrent = selectedVersionId === currentVersionId;
  const selfAuthored = Boolean(selectedVersion?.createdByUserId && selectedVersion.createdByUserId === session?.user?.id);
  const canGovern = Boolean(canEdit && selectedIsCurrent && persona?.lifecycleState !== 'retired');
  const coverage = selectedVersion?.evidenceCoverage;

  return <div className="space-y-5" data-testid="journey-persona-library">
    <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div><h1 className="text-2xl font-semibold tracking-tight">Personas</h1>
        <p className="mt-1 text-sm text-muted-foreground">Reusable, versioned customer models with exact evidence and independent approval.</p></div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => void refreshSelected()} disabled={loadingList || loadingDetail}>
          <RefreshCw className="h-4 w-4" />Refresh
        </Button>
        {canEdit && <Button type="button" onClick={() => { setCreating(true); setEditorOpen(true); }}><Plus className="h-4 w-4" />Create persona</Button>}
      </div>
    </div>
    <ErrorNotice error={error} onRefresh={() => void refreshSelected(selectedVersionId)} />
    {compareIds.length === 1 && <p className="border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
      Choose one more persona to compare current records.
    </p>}
    <PersonaComparison personas={compared} />
    <div className="grid min-h-[640px] border bg-card lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className={`${selectedId ? 'hidden lg:block' : 'block'} min-w-0 border-r`} aria-label="Persona library list">
        <div className="space-y-3 border-b p-3">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Search personas" aria-label="Search personas" />
          </div>
          <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={stateFilter}
            onChange={(event) => setStateFilter(event.target.value)} aria-label="Filter persona lifecycle">
            <option value="all">All lifecycle states</option><option value="draft">Draft</option><option value="in_review">In review</option>
            <option value="active">Active</option><option value="retired">Retired</option>
          </select>
        </div>
        {loadingList ? <div className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />Loading personas
        </div> : filtered.length === 0 ? <div className="px-4 py-12 text-center"><UserRound className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No personas found</p><p className="mt-1 text-xs text-muted-foreground">Adjust the filter or create the first reusable persona.</p>
        </div> : <ul>{filtered.map((item) => <li key={item.id} className="border-b last:border-b-0">
          <div className={`${selectedId === item.id ? 'bg-muted/40' : ''} flex items-start gap-3 px-3 py-3 hover:bg-muted/30`}>
            <input type="checkbox" checked={compareIds.includes(item.id)} onChange={() => toggleCompare(item.id)}
              className="mt-1" aria-label={`Compare ${item.name}`} />
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelectedId(item.id)}>
              <span className="block truncate text-sm font-medium">{item.name}</span>
              <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">{item.summary || 'No summary'}</span>
              <span className="mt-2 flex flex-wrap items-center gap-2"><StateLabel>{item.lifecycleState}</StateLabel>
                <span className="text-xs text-muted-foreground">{item.linkedJourneyCount} journey{item.linkedJourneyCount === 1 ? '' : 's'}</span></span>
            </button>
          </div>
        </li>)}</ul>}
      </aside>
      <main className={`${selectedId ? 'block' : 'hidden lg:block'} min-w-0`}>
        {!selectedId ? <div className="flex min-h-[520px] items-center justify-center px-6 text-center">
          <div><UsersRound className="mx-auto h-7 w-7 text-muted-foreground" /><p className="mt-3 text-sm font-medium">Select a persona</p>
            <p className="mt-1 text-sm text-muted-foreground">Inspect evidence, versions, review history, and journey usage.</p></div>
        </div> : loadingDetail && !persona ? <div className="flex min-h-[520px] items-center justify-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />Loading persona
        </div> : persona && <div>
          <div className="border-b px-4 py-4 sm:px-5">
            <Button type="button" size="sm" variant="ghost" className="mb-3 -ml-2 lg:hidden" onClick={() => setSelectedId('')}>
              <ArrowLeft className="h-4 w-4" />All personas
            </Button>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">{persona.name}</h2>
                <StateLabel>{persona.lifecycleState}</StateLabel></div>
                <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{persona.summary || 'No summary recorded.'}</p>
                <p className="mt-2 text-xs text-muted-foreground">Revision {persona.revision} · Review {formatDate(persona.reviewAt)}</p>
              </div>
              {canEdit && <div className="flex shrink-0 gap-2">
                <Button type="button" size="sm" variant="outline" disabled={busy || selectedVersion?.reviewState === 'in_review' || persona.lifecycleState === 'retired'}
                  onClick={() => { setCreating(false); setEditorOpen(true); }}><Pencil className="h-4 w-4" />Edit</Button>
                {persona.lifecycleState !== 'retired' && <Button type="button" size="sm" variant="outline" disabled={busy}
                  onClick={() => void retire()}>Retire</Button>}
              </div>}
            </div>
          </div>
          <div className="grid lg:grid-cols-[minmax(0,1fr)_250px]">
            <div className="min-w-0 space-y-5 p-4 sm:p-5">
              <section className="border" aria-labelledby="persona-claims-heading">
                <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                  <div><h3 id="persona-claims-heading" className="text-sm font-semibold">Claims and evidence</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {coverage ? `${coverage.evidencedClaimCount} of ${coverage.claimCount} claims have linked evidence; ${coverage.currentSupportingLinks} current supporting link${coverage.currentSupportingLinks === 1 ? '' : 's'}.` : 'No coverage recorded.'}
                    </p></div>
                  {canEdit && selectedIsCurrent && selectedVersion?.reviewState !== 'in_review' && <Button type="button" size="sm" variant="outline"
                    onClick={() => setEvidenceOpen(true)}><Plus className="h-4 w-4" />Add source evidence</Button>}
                </div>
                {(coverage?.changedLinks || coverage?.invalidatedLinks) ? <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Review is blocked: {coverage.changedLinks} changed and {coverage.invalidatedLinks} invalidated or deleted evidence links require a new version.
                </div> : null}
                {selectedVersion?.claims.length ? <ul>{selectedVersion.claims.map((claim) => <ClaimRow key={claim.id} claim={claim}
                  rootEvidence={rootEvidence} sourceAccess={sourceAccess}
                  canEdit={Boolean(canEdit && selectedIsCurrent && ['draft', 'changes_requested'].includes(selectedVersion.reviewState))}
                  busy={busy} onAttach={attachToClaim} />)}</ul>
                  : <p className="px-4 py-8 text-center text-sm text-muted-foreground">This version has no explicit claims. Add structured persona content in a new version.</p>}
              </section>

              <section className="border" aria-labelledby="persona-review-heading">
                <div className="border-b px-4 py-3"><div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 id="persona-review-heading" className="text-sm font-semibold">Review and approval</h3>
                  {selectedVersion && <StateLabel>{selectedVersion.reviewState}</StateLabel>}</div>
                  <p className="mt-1 text-xs text-muted-foreground">Approval must come from a different owner or administrator than the version author.</p>
                </div>
                <div className="space-y-3 px-4 py-4">
                  {canGovern && selectedVersion && selectedVersion.reviewState !== 'approved' && <>
                    <div className="space-y-2"><Label htmlFor="persona-review-comment">Review comment</Label>
                      <Textarea id="persona-review-comment" value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} rows={3}
                        placeholder="Record why this version is ready, approved, or needs changes." /></div>
                    <div className="flex flex-wrap gap-2">
                      {['draft', 'changes_requested'].includes(selectedVersion.reviewState) && <Button type="button" size="sm" disabled={busy}
                        onClick={() => void governance('submit')}><ShieldCheck className="h-4 w-4" />Submit for review</Button>}
                      {selectedVersion.reviewState === 'in_review' && <>
                        <Button type="button" size="sm" disabled={busy || selfAuthored} title={selfAuthored ? 'A different administrator must approve.' : undefined}
                          onClick={() => void governance('approved')}><Check className="h-4 w-4" />Approve</Button>
                        <Button type="button" size="sm" variant="outline" disabled={busy}
                          onClick={() => void governance('changes_requested')}>Request changes</Button>
                        <Button type="button" size="sm" variant="outline" disabled={busy}
                          onClick={() => void governance('withdraw')}>Withdraw submission</Button>
                      </>}
                    </div>
                    {selfAuthored && selectedVersion.reviewState === 'in_review' && <p className="text-xs text-amber-800">You authored this version. Another space owner or administrator must approve it.</p>}
                  </>}
                  {!canEdit && <p className="text-sm text-muted-foreground">You have read-only access to persona governance.</p>}
                  {!selectedIsCurrent && <p className="text-sm text-muted-foreground">Historical versions are immutable and cannot re-enter review.</p>}
                  {selectedVersion?.reviewEvents.length ? <ol className="mt-4 space-y-3 border-t pt-4">
                    {selectedVersion.reviewEvents.map((event) => <li key={event.id} className="grid gap-1 text-sm sm:grid-cols-[120px_minmax(0,1fr)]">
                      <span className="font-medium">{readable(event.action)}</span><span className="text-muted-foreground">{event.comment} · {formatDate(event.createdAt)}</span>
                    </li>)}
                  </ol> : <p className="text-sm text-muted-foreground">No review events recorded for this version.</p>}
                </div>
              </section>

              <section className="border" aria-labelledby="persona-usage-heading">
                <div className="border-b px-4 py-3"><h3 id="persona-usage-heading" className="text-sm font-semibold">Journey usage</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Working maps follow the current version. Published maps retain the exact version shown below.</p></div>
                <div className="grid sm:grid-cols-2">
                  <div className="border-b px-4 py-4 sm:border-b-0 sm:border-r"><h4 className="text-xs font-medium text-muted-foreground">Working journeys</h4>
                    {usage.workingJourneys.length ? <ul className="mt-3 space-y-2">{usage.workingJourneys.map((item) => <li key={item.definitionId}>
                      <a className="text-sm font-medium underline-offset-4 hover:underline" href={`/journey-maps?definitionId=${encodeURIComponent(item.definitionId)}`}>{item.name}</a>
                    </li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">Not linked to a working journey.</p>}
                  </div>
                  <div className="px-4 py-4"><h4 className="text-xs font-medium text-muted-foreground">Published pins</h4>
                    {usage.publishedSnapshots.length ? <ul className="mt-3 space-y-3">{usage.publishedSnapshots.map((item) => <li key={`${item.mapVersionId}:${item.personaVersionId}`} className="text-sm">
                      <span className="font-medium">{item.name}</span><span className="block text-xs text-muted-foreground">Map v{item.mapVersionNumber} · persona {versions.find((version) => version.id === item.personaVersionId)?.versionNumber ? `v${versions.find((version) => version.id === item.personaVersionId)?.versionNumber}` : item.personaVersionId.slice(0, 8)} · {readable(item.reviewState)}</span>
                    </li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">No published map pins.</p>}
                  </div>
                </div>
              </section>
            </div>
            <aside className="border-t bg-muted/10 lg:border-l lg:border-t-0" aria-label="Persona version history">
              <div className="border-b px-4 py-3"><div className="flex items-center gap-2"><History className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Versions</h3></div></div>
              <ol>{versions.map((version) => <li key={version.id} className="border-b last:border-b-0">
                <button type="button" onClick={() => void chooseVersion(version.id)}
                  className={`${selectedVersionId === version.id ? 'bg-background' : ''} w-full px-4 py-3 text-left hover:bg-background`}>
                  <span className="flex items-center justify-between gap-2"><span className="text-sm font-medium">Version {version.versionNumber}</span>
                    {version.id === currentVersionId && <span className="text-xs text-muted-foreground">Current</span>}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{readable(version.reviewState)} · {formatDate(version.createdAt)}</span>
                  <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground" title={version.checksum}>{version.checksum.slice(0, 12)}</span>
                </button>
              </li>)}</ol>
              <div className="border-t px-4 py-4 text-xs text-muted-foreground">
                <GitCompareArrows className="mb-2 h-4 w-4" />Use the checkboxes in the library list to compare two current persona records.
              </div>
            </aside>
          </div>
        </div>}
      </main>
    </div>
    <PersonaEditor open={editorOpen} persona={creating ? null : persona} busy={busy} onOpenChange={(next) => {
      setEditorOpen(next); if (!next) setCreating(false);
    }} onSave={savePersona} />
    <EvidencePicker open={evidenceOpen} persona={persona} busy={busy} onOpenChange={setEvidenceOpen}
      onAttached={() => refreshSelected(selectedVersionId)} />
  </div>;
}
