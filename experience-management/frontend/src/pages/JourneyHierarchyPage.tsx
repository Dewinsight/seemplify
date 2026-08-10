import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, Download, GitBranch, LoaderCircle, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { JourneyWorkspaceSavedViewBar } from '@/components/journeys/JourneyWorkspaceSavedViewBar';
import { useAuthSession, useSessionFeature } from '@/lib/authSessionContext';
import type { JourneyHierarchyViewConfiguration } from '@/lib/journeyWorkspaceSavedViews';
import {
  assignJourneyTaxonomyTerm,
  calculateJourneyHierarchyHealthSnapshots,
  createJourneyHierarchyHealthPolicy,
  createJourneyHierarchyLink,
  createJourneyTaxonomyTerm,
  downloadJourneyHierarchy,
  journeyHierarchyLinkTypes,
  journeyHierarchyReviewStates,
  journeyHierarchyVariantDimensions,
  journeyTaxonomyKinds,
  listJourneyHierarchy,
  listJourneyHierarchyHealthPolicies,
  listJourneyHierarchyHealthSnapshots,
  listJourneyTaxonomyTerms,
  readJourneyHierarchyHealthSnapshot,
  readJourneyHierarchySettings,
  readJourneyHierarchyBreadcrumbs,
  readJourneyHierarchyTraversal,
  unassignJourneyTaxonomyTerm,
  updateJourneyHierarchyHealthPolicy,
  updateJourneyHierarchyLink,
  updateJourneyHierarchySettings,
  updateJourneyTaxonomyTerm,
  type JourneyHierarchy,
  type JourneyHierarchyBreadcrumbs,
  type JourneyHierarchyHealthPolicy,
  type JourneyHierarchyHealthSnapshot,
  type JourneyHierarchyLink,
  type JourneyHierarchyLinkDraft,
  type JourneyHierarchyLinkType,
  type JourneyHierarchyNode,
  type JourneyHierarchyTraversal,
  type JourneyHierarchySettings,
  type JourneyHierarchyVariantDimension,
  type JourneyTaxonomyKind,
  type JourneyTaxonomyTerm
} from '@/lib/journeyHierarchy';

const linkLabels: Record<JourneyHierarchyLinkType, string> = {
  parent_child: 'Parent and child', stage_subjourney: 'Stage drill-down', variant: 'Journey variant',
  handoff: 'Cross-journey handoff', related: 'Related journey'
};
const taxonomyLabels: Record<JourneyTaxonomyKind, string> = {
  product: 'Product', geography: 'Geography', channel: 'Channel', segment: 'Segment', tag: 'Tag', business_unit: 'Business unit'
};
const reviewLabels = { draft: 'Draft', in_review: 'In review', approved: 'Approved', changes_requested: 'Changes requested' } as const;

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function nodeName(nodes: JourneyHierarchyNode[], definitionId: string) {
  return nodes.find((node) => node.definitionId === definitionId)?.name || 'Unavailable journey';
}

function HierarchyTree({ hierarchy, selectedId, onSelect }: {
  hierarchy: JourneyHierarchy; selectedId: string; onSelect: (definitionId: string) => void;
}) {
  const nodeById = new Map(hierarchy.nodes.map((node) => [node.definitionId, node]));
  const parentCounts = new Map<string, number>();
  hierarchy.validation.childEntries.forEach((entry) => entry.childDefinitionIds.forEach((id) =>
    parentCounts.set(id, (parentCounts.get(id) || 0) + 1)));
  const renderBranch = (definitionId: string, ancestors: Set<string>): React.ReactNode => {
    const node = nodeById.get(definitionId); if (!node) return null;
    const children = hierarchy.validation.childIdsByParent[definitionId] || [];
    const nextAncestors = new Set(ancestors).add(definitionId);
    return <li key={`${[...ancestors].join('/')}/${definitionId}`}>
      <button type="button" aria-current={selectedId === definitionId ? 'true' : undefined}
        className="flex min-h-9 w-full items-center gap-2 border-l-2 border-transparent px-2 text-left text-sm hover:bg-muted aria-[current=true]:border-primary aria-[current=true]:bg-muted"
        onClick={() => onSelect(definitionId)}>
        <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{node.name || 'Untitled journey'}</span>
        {(parentCounts.get(definitionId) || 0) > 1 && <span className="text-xs text-muted-foreground">Shared by {parentCounts.get(definitionId)} parents</span>}
      </button>
      {children.length > 0 && <ul className="ml-5 border-l pl-2">
        {children.filter((childId) => !nextAncestors.has(childId)).map((childId) => renderBranch(childId, nextAncestors))}
      </ul>}
    </li>;
  };
  return <nav aria-label="Journey hierarchy tree" data-testid="journey-hierarchy-tree" className="min-w-0 border">
    <div className="border-b px-3 py-2 text-sm font-medium">Hierarchy</div>
    <ul className="max-h-[38rem] overflow-auto p-2">
      {hierarchy.validation.roots.map((rootId) => renderBranch(rootId, new Set()))}
    </ul>
  </nav>;
}

function RelationshipForm({ nodes, busy, onCreate }: {
  nodes: JourneyHierarchyNode[]; busy: boolean; onCreate: (draft: JourneyHierarchyLinkDraft) => Promise<void>;
}) {
  const [type, setType] = useState<JourneyHierarchyLinkType>('parent_child');
  const [fromDefinitionId, setFromDefinitionId] = useState('');
  const [toDefinitionId, setToDefinitionId] = useState('');
  const [fromStageKey, setFromStageKey] = useState('');
  const [variantDimension, setVariantDimension] = useState<JourneyHierarchyVariantDimension>('persona');
  const [variantValueId, setVariantValueId] = useState('');
  const [handoffOwnerUserId, setHandoffOwnerUserId] = useState('');
  const source = nodes.find((node) => node.definitionId === fromDefinitionId);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const draft: JourneyHierarchyLinkDraft = { type, fromDefinitionId, toDefinitionId };
    if (type === 'stage_subjourney') draft.fromStageKey = fromStageKey;
    if (type === 'variant') { draft.variantDimension = variantDimension; draft.variantValueId = variantValueId.trim(); }
    if (type === 'handoff' && handoffOwnerUserId.trim()) draft.handoffOwnerUserId = handoffOwnerUserId.trim();
    await onCreate(draft); setToDefinitionId(''); setFromStageKey(''); setVariantValueId(''); setHandoffOwnerUserId('');
  }
  const complete = fromDefinitionId && toDefinitionId && fromDefinitionId !== toDefinitionId
    && (type !== 'stage_subjourney' || fromStageKey) && (type !== 'variant' || variantValueId.trim());
  return <form className="border p-4" onSubmit={(event) => void submit(event)} aria-labelledby="new-hierarchy-link-heading">
    <h2 id="new-hierarchy-link-heading" className="text-base font-semibold">Add relationship</h2>
    <div className="mt-3 grid gap-3 lg:grid-cols-3">
      <div className="grid gap-1.5"><Label htmlFor="hierarchy-link-type">Relationship</Label><select id="hierarchy-link-type" className="h-9 rounded-md border bg-background px-3 text-sm" value={type} onChange={(event) => { setType(event.target.value as JourneyHierarchyLinkType); setFromStageKey(''); }}>
        {journeyHierarchyLinkTypes.map((value) => <option key={value} value={value}>{linkLabels[value]}</option>)}
      </select></div>
      <div className="grid gap-1.5"><Label htmlFor="hierarchy-link-from">From journey</Label><select id="hierarchy-link-from" required className="h-9 min-w-0 rounded-md border bg-background px-3 text-sm" value={fromDefinitionId} onChange={(event) => { setFromDefinitionId(event.target.value); setFromStageKey(''); }}><option value="">Choose journey</option>{nodes.map((node) => <option key={node.definitionId} value={node.definitionId}>{node.name}</option>)}</select></div>
      <div className="grid gap-1.5"><Label htmlFor="hierarchy-link-to">To journey</Label><select id="hierarchy-link-to" required className="h-9 min-w-0 rounded-md border bg-background px-3 text-sm" value={toDefinitionId} onChange={(event) => setToDefinitionId(event.target.value)}><option value="">Choose journey</option>{nodes.filter((node) => node.definitionId !== fromDefinitionId).map((node) => <option key={node.definitionId} value={node.definitionId}>{node.name}</option>)}</select></div>
      {type === 'stage_subjourney' && <div className="grid gap-1.5"><Label htmlFor="hierarchy-stage">Source stage</Label><select id="hierarchy-stage" required className="h-9 rounded-md border bg-background px-3 text-sm" value={fromStageKey} onChange={(event) => setFromStageKey(event.target.value)}><option value="">Choose stage</option>{(source?.stageKeys || []).map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select></div>}
      {type === 'variant' && <><div className="grid gap-1.5"><Label htmlFor="hierarchy-variant-dimension">Variant dimension</Label><select id="hierarchy-variant-dimension" className="h-9 rounded-md border bg-background px-3 text-sm" value={variantDimension} onChange={(event) => setVariantDimension(event.target.value as JourneyHierarchyVariantDimension)}>{journeyHierarchyVariantDimensions.map((dimension) => <option key={dimension}>{dimension}</option>)}</select></div><div className="grid gap-1.5"><Label htmlFor="hierarchy-variant-value">Canonical value ID</Label><Input id="hierarchy-variant-value" required value={variantValueId} onChange={(event) => setVariantValueId(event.target.value)} /></div></>}
      {type === 'handoff' && <div className="grid gap-1.5"><Label htmlFor="hierarchy-handoff-owner">Handoff owner user ID</Label><Input id="hierarchy-handoff-owner" value={handoffOwnerUserId} onChange={(event) => setHandoffOwnerUserId(event.target.value)} /></div>}
    </div>
    <div className="mt-4"><Button type="submit" disabled={busy || !complete}><Plus className="h-4 w-4" />Add relationship</Button></div>
  </form>;
}

function RelationshipTable({ hierarchy, canManage, busy, onUpdate, onSelect }: {
  hierarchy: JourneyHierarchy; canManage: boolean; busy: boolean;
  onUpdate: (link: JourneyHierarchyLink, input: Parameters<typeof updateJourneyHierarchyLink>[1]) => Promise<void>;
  onSelect: (id: string) => void;
}) {
  return <div className="overflow-x-auto border" data-testid="journey-hierarchy-relationship-table"><table className="w-full min-w-[900px] text-left text-sm">
    <caption className="sr-only">Journey hierarchy relationships and governance state</caption>
    <thead className="border-b bg-muted/50"><tr><th className="px-3 py-2">Relationship</th><th className="px-3 py-2">From</th><th className="px-3 py-2">To</th><th className="px-3 py-2">Context</th><th className="px-3 py-2">Review</th><th className="px-3 py-2">Lifecycle</th></tr></thead>
    <tbody>{hierarchy.links.map((link) => <tr key={link.id} className="border-b last:border-0">
      <td className="px-3 py-2 font-medium">{linkLabels[link.type]}</td>
      <td className="px-3 py-2"><button type="button" className="text-left underline-offset-4 hover:underline" onClick={() => onSelect(link.fromDefinitionId)}>{nodeName(hierarchy.nodes, link.fromDefinitionId)}</button></td>
      <td className="px-3 py-2"><button type="button" className="text-left underline-offset-4 hover:underline" onClick={() => onSelect(link.toDefinitionId)}>{nodeName(hierarchy.nodes, link.toDefinitionId)}</button></td>
      <td className="px-3 py-2 text-muted-foreground">{link.fromStageKey ? `Stage: ${link.fromStageKey}` : link.variantDimension ? `${link.variantDimension}: ${link.variantValueId}` : link.handoffOwnerUserId ? `Owner: ${link.handoffOwnerUserId}` : 'Journey level'}</td>
      <td className="px-3 py-2">{canManage ? <select aria-label={`Review ${nodeName(hierarchy.nodes, link.fromDefinitionId)} to ${nodeName(hierarchy.nodes, link.toDefinitionId)}`} className="h-8 rounded-md border bg-background px-2" value={link.reviewState} disabled={busy} onChange={(event) => void onUpdate(link, { reviewState: event.target.value as JourneyHierarchyLink['reviewState'] })}>{journeyHierarchyReviewStates.map((state) => <option key={state} value={state}>{reviewLabels[state]}</option>)}</select> : reviewLabels[link.reviewState]}</td>
      <td className="px-3 py-2">{canManage ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void onUpdate(link, { lifecycle: link.lifecycle === 'active' ? 'retired' : 'active' })}>{link.lifecycle === 'active' ? 'Retire' : 'Reactivate'}</Button> : link.lifecycle}</td>
    </tr>)}</tbody>
  </table>{hierarchy.links.length === 0 && <p className="p-4 text-sm text-muted-foreground">No hierarchy relationships have been created.</p>}</div>;
}

function ImpactPanel({ hierarchy, selectedId, traversal, breadcrumbs, direction, onDirection }: {
  hierarchy: JourneyHierarchy; selectedId: string; traversal: JourneyHierarchyTraversal | null;
  breadcrumbs: JourneyHierarchyBreadcrumbs | null; direction: 'upstream' | 'downstream' | 'both';
  onDirection: (value: 'upstream' | 'downstream' | 'both') => void;
}) {
  return <section className="border" aria-labelledby="hierarchy-impact-heading" data-testid="journey-hierarchy-impact">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"><div><h2 id="hierarchy-impact-heading" className="font-semibold">Impact and navigation</h2><p className="text-sm text-muted-foreground">{nodeName(hierarchy.nodes, selectedId)}</p></div><select aria-label="Impact direction" className="h-9 rounded-md border bg-background px-3 text-sm" value={direction} onChange={(event) => onDirection(event.target.value as typeof direction)}><option value="both">Upstream and downstream</option><option value="upstream">Upstream parents</option><option value="downstream">Downstream dependencies</option></select></div>
    <div className="grid gap-5 p-4 lg:grid-cols-2">
      <div><h3 className="text-sm font-medium">Breadcrumb paths</h3><ul className="mt-2 space-y-2">{breadcrumbs?.trails.map((trail, index) => <li key={`${trail.definitionIds.join('/')}-${index}`} className="flex flex-wrap items-center gap-1 text-sm">{trail.hasInaccessibleAncestor && <span className="text-muted-foreground">Unavailable parent <ArrowRight className="inline h-3 w-3" /></span>}{trail.definitionIds.map((id, itemIndex) => <span key={id} className="inline-flex items-center gap-1"><span>{nodeName(hierarchy.nodes, id)}</span>{itemIndex < trail.definitionIds.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}</span>)}</li>)}</ul>{breadcrumbs?.trails.length === 0 && <p className="mt-2 text-sm text-muted-foreground">This journey has no visible containment path.</p>}{breadcrumbs?.truncated && <p className="mt-2 text-sm text-muted-foreground">Additional paths were omitted at the safety limit.</p>}</div>
      <div><h3 className="text-sm font-medium">Affected journeys</h3><ul className="mt-2 space-y-1 text-sm">{traversal?.definitionIds.filter((id) => id !== selectedId).map((id) => <li key={id}>{nodeName(hierarchy.nodes, id)}</li>)}</ul>{traversal && traversal.definitionIds.length <= 1 && <p className="mt-2 text-sm text-muted-foreground">No other visible journeys are affected in this direction.</p>}{traversal?.inaccessibleLinkCount ? <p className="mt-2 text-sm text-muted-foreground">{traversal.inaccessibleLinkCount} inaccessible relationship{traversal.inaccessibleLinkCount === 1 ? '' : 's'} omitted.</p> : null}{traversal?.truncated && <p className="mt-2 text-sm text-muted-foreground">Results reached the traversal limit.</p>}</div>
    </div>
  </section>;
}

function TaxonomyCorrectionForm({ terms, busy, onUpdate }: {
  terms: JourneyTaxonomyTerm[]; busy: boolean;
  onUpdate: (term: JourneyTaxonomyTerm, input: Parameters<typeof updateJourneyTaxonomyTerm>[1]) => Promise<void>;
}) {
  const [termId, setTermId] = useState(''); const term = terms.find((entry) => entry.id === termId) || null;
  const [name, setName] = useState(''); const [parentTermId, setParentTermId] = useState('');
  useEffect(() => { setName(term?.name || ''); setParentTermId(term?.parentTermId || ''); }, [term]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!term) return;
    await onUpdate(term, { name: name.trim(), parentTermId: parentTermId || null });
  }
  return <form className="border p-4" onSubmit={(event) => void submit(event)} aria-labelledby="taxonomy-correct-heading">
    <h2 id="taxonomy-correct-heading" className="font-semibold">Correct taxonomy term</h2>
    <div className="mt-3 grid gap-3"><div className="grid gap-1.5"><Label htmlFor="taxonomy-correct-term">Term</Label>
      <select id="taxonomy-correct-term" className="h-9 min-w-0 rounded-md border bg-background px-3 text-sm" value={termId}
        onChange={(event) => setTermId(event.target.value)}><option value="">Choose term</option>
        {terms.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.lifecycle}</option>)}</select></div>
      <div className="grid gap-1.5"><Label htmlFor="taxonomy-correct-name">Corrected name</Label><Input id="taxonomy-correct-name"
        disabled={!term} maxLength={160} value={name} onChange={(event) => setName(event.target.value)} /></div>
      <div className="grid gap-1.5"><Label htmlFor="taxonomy-correct-parent">Parent term</Label><select id="taxonomy-correct-parent"
        disabled={!term} className="h-9 min-w-0 rounded-md border bg-background px-3 text-sm" value={parentTermId}
        onChange={(event) => setParentTermId(event.target.value)}><option value="">No parent</option>
        {terms.filter((entry) => entry.id !== term?.id && entry.kind === term?.kind && entry.lifecycle === 'active')
          .map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></div>
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || !term || !name.trim()}>Save correction</Button>
        {term && <Button type="button" variant="outline" disabled={busy} onClick={() => void onUpdate(term, {
          lifecycle: term.lifecycle === 'active' ? 'retired' : 'active'
        })}>{term.lifecycle === 'active' ? 'Retire term' : 'Reactivate term'}</Button>}</div>
      {term && <p className="text-xs text-muted-foreground">Revision {term.revision}. Retirement is blocked while active children or assignments remain.</p>}
    </div>
  </form>;
}

function TaxonomyWorkspace({ hierarchy, terms, selectedId, canManage, busy, onCreate, onToggle, onUpdate }: {
  hierarchy: JourneyHierarchy; terms: JourneyTaxonomyTerm[]; selectedId: string; canManage: boolean; busy: boolean;
  onCreate: (input: { kind: JourneyTaxonomyKind; name: string; parentTermId?: string | null }) => Promise<void>;
  onToggle: (term: JourneyTaxonomyTerm, assigned: boolean) => Promise<void>;
  onUpdate: (term: JourneyTaxonomyTerm, input: Parameters<typeof updateJourneyTaxonomyTerm>[1]) => Promise<void>;
}) {
  const [kind, setKind] = useState<JourneyTaxonomyKind>('tag'); const [name, setName] = useState(''); const [parentTermId, setParentTermId] = useState('');
  const selected = hierarchy.nodes.find((node) => node.definitionId === selectedId);
  async function submit(event: FormEvent) { event.preventDefault(); await onCreate({ kind, name: name.trim(), parentTermId: parentTermId || null }); setName(''); }
  return <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
    <section className="min-w-0 border" aria-labelledby="taxonomy-assignment-heading"><div className="border-b px-4 py-3"><h2 id="taxonomy-assignment-heading" className="font-semibold">Assignments</h2><p className="text-sm text-muted-foreground">{selected?.name || 'Choose a journey from the hierarchy tab'}</p></div><div className="max-w-full overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><caption className="sr-only">Journey taxonomy assignments</caption><thead className="border-b bg-muted/50"><tr><th className="px-3 py-2">Type</th><th className="px-3 py-2">Term</th><th className="px-3 py-2">Parent</th><th className="px-3 py-2">Assignment</th></tr></thead><tbody>{terms.map((term) => { const assigned = Boolean(selected?.taxonomyTermIds?.includes(term.id)); return <tr key={term.id} className="border-b last:border-0"><td className="px-3 py-2">{taxonomyLabels[term.kind]}</td><td className="px-3 py-2 font-medium">{term.name}</td><td className="px-3 py-2 text-muted-foreground">{terms.find((parent) => parent.id === term.parentTermId)?.name || '—'}</td><td className="px-3 py-2">{canManage ? <Button size="sm" variant="outline" disabled={busy || !selected} onClick={() => void onToggle(term, assigned)}>{assigned ? 'Remove' : 'Assign'}</Button> : assigned ? 'Assigned' : 'Not assigned'}</td></tr>; })}</tbody></table>{terms.length === 0 && <p className="p-4 text-sm text-muted-foreground">No taxonomy terms have been created.</p>}</div></section>
    {canManage && <div className="grid h-fit gap-4"><form className="min-w-0 border p-4" onSubmit={(event) => void submit(event)} aria-labelledby="taxonomy-create-heading"><h2 id="taxonomy-create-heading" className="font-semibold">Create taxonomy term</h2><div className="mt-3 grid gap-3"><div className="grid gap-1.5"><Label htmlFor="taxonomy-kind">Type</Label><select id="taxonomy-kind" className="h-9 min-w-0 rounded-md border bg-background px-3 text-sm" value={kind} onChange={(event) => { setKind(event.target.value as JourneyTaxonomyKind); setParentTermId(''); }}>{journeyTaxonomyKinds.map((value) => <option key={value} value={value}>{taxonomyLabels[value]}</option>)}</select></div><div className="grid gap-1.5"><Label htmlFor="taxonomy-name">Name</Label><Input id="taxonomy-name" required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} /></div><div className="grid gap-1.5"><Label htmlFor="taxonomy-parent">Parent term</Label><select id="taxonomy-parent" className="h-9 min-w-0 rounded-md border bg-background px-3 text-sm" value={parentTermId} onChange={(event) => setParentTermId(event.target.value)}><option value="">No parent</option>{terms.filter((term) => term.kind === kind && term.lifecycle === 'active').map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}</select></div><Button type="submit" disabled={busy || !name.trim()}><Plus className="h-4 w-4" />Create term</Button></div></form><TaxonomyCorrectionForm terms={terms} busy={busy} onUpdate={onUpdate} /></div>}
  </div>;
}

function SettingsWorkspace({ settings, canManage, busy, onUpdate }: {
  settings: JourneyHierarchySettings; canManage: boolean; busy: boolean;
  onUpdate: (input: Parameters<typeof updateJourneyHierarchySettings>[1]) => Promise<void>;
}) {
  const [hierarchyEnabled, setHierarchyEnabled] = useState(settings.hierarchyEnabled);
  const [blueprintsEnabled, setBlueprintsEnabled] = useState(settings.blueprintsEnabled);
  const [maximumDepth, setMaximumDepth] = useState(String(settings.maximumDepth));
  const [maximumLinks, setMaximumLinks] = useState(String(settings.maximumLinks));
  useEffect(() => { setHierarchyEnabled(settings.hierarchyEnabled); setBlueprintsEnabled(settings.blueprintsEnabled);
    setMaximumDepth(String(settings.maximumDepth)); setMaximumLinks(String(settings.maximumLinks)); }, [settings]);
  return <section className="max-w-3xl border" aria-labelledby="hierarchy-settings-heading" data-testid="journey-hierarchy-settings">
    <div className="border-b px-4 py-3"><h2 id="hierarchy-settings-heading" className="font-semibold">Hierarchy settings</h2>
      <p className="text-sm text-muted-foreground">Revision {settings.revision}. Limits apply to active hierarchy relationships.</p></div>
    <div className="grid gap-4 p-4 sm:grid-cols-2">
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={hierarchyEnabled}
        disabled={!canManage || busy} onChange={(event) => setHierarchyEnabled(event.target.checked)} /><span><span className="block font-medium">Hierarchy enabled</span><span className="text-muted-foreground">Allow hierarchy, taxonomy, and health writes.</span></span></label>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={blueprintsEnabled}
        disabled={!canManage || busy} onChange={(event) => setBlueprintsEnabled(event.target.checked)} /><span><span className="block font-medium">Service blueprints enabled</span><span className="text-muted-foreground">Allow governed blueprint authoring.</span></span></label>
      <div className="grid gap-1.5"><Label htmlFor="hierarchy-maximum-depth">Maximum depth</Label><Input id="hierarchy-maximum-depth"
        type="number" min={1} max={32} disabled={!canManage || busy} value={maximumDepth} onChange={(event) => setMaximumDepth(event.target.value)} /></div>
      <div className="grid gap-1.5"><Label htmlFor="hierarchy-maximum-links">Maximum links</Label><Input id="hierarchy-maximum-links"
        type="number" min={1} max={100000} disabled={!canManage || busy} value={maximumLinks} onChange={(event) => setMaximumLinks(event.target.value)} /></div>
    </div>
    {canManage && <div className="border-t px-4 py-3"><Button disabled={busy || !Number(maximumDepth) || !Number(maximumLinks)}
      onClick={() => void onUpdate({ hierarchyEnabled, blueprintsEnabled, maximumDepth: Number(maximumDepth),
        maximumLinks: Number(maximumLinks) })}>Save settings</Button></div>}
  </section>;
}

function HealthWorkspace({ nodes, policies, snapshots, detail, canManage, busy, onCreatePolicy, onPolicyLifecycle,
  onCalculate, onRead }: {
  nodes: JourneyHierarchyNode[]; policies: JourneyHierarchyHealthPolicy[]; snapshots: JourneyHierarchyHealthSnapshot[];
  detail: JourneyHierarchyHealthSnapshot | null; canManage: boolean; busy: boolean;
  onCreatePolicy: (input: Parameters<typeof createJourneyHierarchyHealthPolicy>[0]) => Promise<void>;
  onPolicyLifecycle: (policy: JourneyHierarchyHealthPolicy) => Promise<void>;
  onCalculate: (input: Parameters<typeof calculateJourneyHierarchyHealthSnapshots>[0]) => Promise<void>;
  onRead: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState(''); const [policyId, setPolicyId] = useState('');
  const [missingChild, setMissingChild] = useState<'exclude' | 'unknown'>('unknown');
  const [scores, setScores] = useState<Record<string, string>>({}); const [sourceRevision, setSourceRevision] = useState('manual-1');
  const activePolicies = policies.filter((policy) => policy.lifecycle === 'active');
  useEffect(() => { if (!activePolicies.some((policy) => policy.id === policyId)) setPolicyId(activePolicies[0]?.id || ''); }, [policies, policyId]);
  async function createPolicy(event: FormEvent) { event.preventDefault(); await onCreatePolicy({ name: name.trim(), policy: {
    version: `policy-${Date.now()}`, ownWeight: 0.5, missingChild, healthyAt: 80, watchAt: 60
  } }); setName(''); }
  async function calculate() {
    await onCalculate({ policyId, observations: Object.entries(scores).filter(([, value]) => value !== '').map(([definitionId, value]) => ({
      definitionId, score: Number(value), observedAt: new Date().toISOString(), sourceRevision
    })) });
  }
  return <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]" data-testid="journey-hierarchy-health">
    <div className="min-w-0 space-y-5">
      <section className="border"><div className="border-b px-4 py-3"><h2 className="font-semibold">Health observations</h2>
        <p className="text-sm text-muted-foreground">Blank values remain unknown; they are never converted to zero.</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><caption className="sr-only">Journey health observations</caption>
          <thead className="border-b bg-muted/50"><tr><th className="px-3 py-2">Journey</th><th className="px-3 py-2">Score</th></tr></thead>
          <tbody>{nodes.map((node) => <tr key={node.definitionId} className="border-b last:border-0"><td className="px-3 py-2 font-medium">{node.name}</td>
            <td className="px-3 py-2"><Input aria-label={`Health score ${node.name}`} className="w-28" type="number" min={0} max={100}
              disabled={!canManage || busy} placeholder="Unknown" value={scores[node.definitionId] || ''}
              onChange={(event) => setScores((current) => ({ ...current, [node.definitionId]: event.target.value }))} /></td></tr>)}</tbody></table></div>
        {canManage && <div className="grid gap-3 border-t p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div className="grid gap-1.5"><Label htmlFor="health-policy-select">Policy</Label><select id="health-policy-select"
            className="h-9 rounded-md border bg-background px-3 text-sm" value={policyId} onChange={(event) => setPolicyId(event.target.value)}>
            <option value="">Choose active policy</option>{activePolicies.map((policy) => <option key={policy.id} value={policy.id}>{policy.name}</option>)}</select></div>
          <div className="grid gap-1.5"><Label htmlFor="health-source-revision">Source revision</Label><Input id="health-source-revision"
            value={sourceRevision} onChange={(event) => setSourceRevision(event.target.value)} /></div>
          <Button className="self-end" disabled={busy || !policyId || !sourceRevision.trim()} onClick={() => void calculate()}>Calculate snapshots</Button>
        </div>}
      </section>
      <section className="border"><div className="border-b px-4 py-3"><h2 className="font-semibold">Snapshot history</h2></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><caption className="sr-only">Hierarchy health snapshot history</caption>
          <thead className="border-b bg-muted/50"><tr><th className="px-3 py-2">Journey</th><th className="px-3 py-2">Result</th><th className="px-3 py-2">Policy</th><th className="px-3 py-2">Calculated</th><th className="px-3 py-2"></th></tr></thead>
          <tbody>{snapshots.map((snapshot) => <tr key={snapshot.id} className="border-b last:border-0"><td className="px-3 py-2 font-medium">{nodeName(nodes, snapshot.definitionId)}</td>
            <td className="px-3 py-2">{snapshot.score === null ? 'Unknown · no score' : `${snapshot.score} · ${snapshot.status.replace('_', ' ')}`}</td>
            <td className="px-3 py-2">{snapshot.policy.version} · revision {snapshot.policy.revision}</td><td className="px-3 py-2">{new Date(snapshot.calculatedAt).toLocaleString()}</td>
            <td className="px-3 py-2"><Button size="sm" variant="outline" onClick={() => void onRead(snapshot.id)}>Inspect</Button></td></tr>)}</tbody></table>
          {snapshots.length === 0 && <p className="p-4 text-sm text-muted-foreground">No health snapshots have been calculated.</p>}</div></section>
      {detail && <section className="border" aria-labelledby="health-detail-heading"><div className="border-b px-4 py-3"><h2 id="health-detail-heading" className="font-semibold">Snapshot detail</h2>
        <p className="text-sm text-muted-foreground">{detail.explanation}</p></div><dl className="grid gap-3 border-b p-4 text-sm sm:grid-cols-3"><div><dt className="text-muted-foreground">Result</dt><dd>{detail.score === null ? 'Unknown · no score' : `${detail.score} · ${detail.status}`}</dd></div><div><dt className="text-muted-foreground">Own weight</dt><dd>{detail.policy.rules.ownWeight}</dd></div><div><dt className="text-muted-foreground">Missing child rule</dt><dd>{detail.policy.rules.missingChild}</dd></div></dl>
        <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><caption className="sr-only">Snapshot child values and rules</caption><thead className="border-b bg-muted/50"><tr><th className="px-3 py-2">Child</th><th className="px-3 py-2">Value</th><th className="px-3 py-2">Effective weight</th></tr></thead><tbody>{detail.children.map((child) => <tr key={child.definitionId} className="border-b last:border-0"><td className="px-3 py-2">{nodeName(nodes, child.definitionId)}</td><td className="px-3 py-2">{child.score === null ? 'Unknown' : child.score}</td><td className="px-3 py-2">{child.effectiveWeight}</td></tr>)}</tbody></table>{detail.children.length === 0 && <p className="p-4 text-sm text-muted-foreground">This snapshot has no direct-child inputs.</p>}</div></section>}
    </div>
    <aside className="h-fit border"><div className="border-b px-4 py-3"><h2 className="font-semibold">Health policies</h2></div>
      <ul className="divide-y">{policies.map((policy) => <li key={policy.id} className="p-4 text-sm"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{policy.name}</p><p className="text-muted-foreground">{policy.version} · revision {policy.revision} · {policy.lifecycle}</p><p className="mt-1 text-muted-foreground">Own {policy.ownWeight}; missing children {policy.missingChild}; healthy ≥ {policy.healthyAt}; watch ≥ {policy.watchAt}</p></div>{canManage && <Button size="sm" variant="outline" disabled={busy} onClick={() => void onPolicyLifecycle(policy)}>{policy.lifecycle === 'active' ? 'Retire' : 'Activate'}</Button>}</div></li>)}</ul>
      {canManage && <form className="grid gap-3 border-t p-4" onSubmit={(event) => void createPolicy(event)}><div className="grid gap-1.5"><Label htmlFor="health-policy-name">Policy name</Label><Input id="health-policy-name" maxLength={160} value={name} onChange={(event) => setName(event.target.value)} /></div><div className="grid gap-1.5"><Label htmlFor="health-missing-child">Missing child rule</Label><select id="health-missing-child" className="h-9 rounded-md border bg-background px-3 text-sm" value={missingChild} onChange={(event) => setMissingChild(event.target.value as typeof missingChild)}><option value="unknown">Require every child</option><option value="exclude">Exclude unknown children</option></select></div><Button type="submit" disabled={busy || !name.trim()}>Create policy</Button></form>}
    </aside>
  </div>;
}

export function JourneyHierarchyPage() {
  const enabled = useSessionFeature('journeyHierarchy'); const session = useAuthSession();
  const exportsEnabled = useSessionFeature('journeyExports');
  const canManage = Boolean(session?.activeSpace && session.activeSpace.role !== 'member');
  const [hierarchy, setHierarchy] = useState<JourneyHierarchy | null>(null); const [terms, setTerms] = useState<JourneyTaxonomyTerm[]>([]);
  const [settings, setSettings] = useState<JourneyHierarchySettings | null>(null);
  const [policies, setPolicies] = useState<JourneyHierarchyHealthPolicy[]>([]);
  const [snapshots, setSnapshots] = useState<JourneyHierarchyHealthSnapshot[]>([]);
  const [snapshotDetail, setSnapshotDetail] = useState<JourneyHierarchyHealthSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState(''); const [direction, setDirection] = useState<'upstream' | 'downstream' | 'both'>('both');
  const [traversal, setTraversal] = useState<JourneyHierarchyTraversal | null>(null); const [breadcrumbs, setBreadcrumbs] = useState<JourneyHierarchyBreadcrumbs | null>(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!enabled) return; setLoading(true); setError('');
    try { const [nextHierarchy, nextTerms, nextSettings, nextPolicies, nextSnapshots] = await Promise.all([
      listJourneyHierarchy(true), listJourneyTaxonomyTerms(true), readJourneyHierarchySettings(),
      listJourneyHierarchyHealthPolicies(true), listJourneyHierarchyHealthSnapshots(undefined, 50)
    ]); setHierarchy({ ...nextHierarchy, settings: nextSettings }); setTerms(nextTerms); setSettings(nextSettings);
      setPolicies(nextPolicies); setSnapshots(nextSnapshots); setSelectedId((current) => nextHierarchy.nodes.some((node) => node.definitionId === current) ? current : nextHierarchy.validation.roots[0] || nextHierarchy.nodes[0]?.definitionId || ''); }
    catch (reason) { setError(errorMessage(reason, 'Journey hierarchy could not be loaded.')); } finally { setLoading(false); }
  }, [enabled]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!enabled || !selectedId) { setTraversal(null); setBreadcrumbs(null); return; }
    let active = true; Promise.all([readJourneyHierarchyTraversal(selectedId, direction), readJourneyHierarchyBreadcrumbs(selectedId)])
      .then(([nextTraversal, nextBreadcrumbs]) => { if (active) { setTraversal(nextTraversal); setBreadcrumbs(nextBreadcrumbs); } })
      .catch((reason) => { if (active) setError(errorMessage(reason, 'Impact navigation could not be loaded.')); });
    return () => { active = false; };
  }, [direction, enabled, selectedId, hierarchy?.links.length]);
  const mutate = useCallback(async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); await load(); } catch (reason) { setError(errorMessage(reason, 'The hierarchy change could not be saved.')); throw reason; } finally { setBusy(false); } }, [load]);
  async function downloadExport(format: 'json' | 'csv') {
    setBusy(true); setError('');
    try {
      const artifact = await downloadJourneyHierarchy(format); const url = URL.createObjectURL(artifact.blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = artifact.filename;
      anchor.rel = 'noopener'; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (reason) { setError(errorMessage(reason, 'The hierarchy export failed.')); } finally { setBusy(false); }
  }
  const selected = useMemo(() => hierarchy?.nodes.find((node) => node.definitionId === selectedId) || null, [hierarchy, selectedId]);
  const canMutateHierarchy = canManage && Boolean(settings?.hierarchyEnabled);
  if (!enabled) return null;
  if (loading && !hierarchy) return <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />Loading journey hierarchy…</div>;
  return <div className="mx-auto w-full max-w-[1440px] space-y-5 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">Journey hierarchy</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Connect macro journeys, reusable subjourneys, variants, and operational handoffs without cloning their source maps.</p></div><div className="flex flex-wrap gap-2">{exportsEnabled && <><Button variant="outline" disabled={busy} onClick={() => void downloadExport('json')}><Download className="h-4 w-4" />JSON</Button><Button variant="outline" disabled={busy} onClick={() => void downloadExport('csv')}><Download className="h-4 w-4" />CSV</Button></>}<Button variant="outline" onClick={() => void load()} disabled={loading || busy}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</Button></div></header>
    {!canManage && <p className="border px-4 py-3 text-sm text-muted-foreground">You have read-only access. Owners and administrators manage relationships, review state, lifecycle, and taxonomy.</p>}
    {canManage && settings && !settings.hierarchyEnabled && <p className="border px-4 py-3 text-sm text-muted-foreground">Hierarchy writes are disabled for this space. Existing relationships, taxonomy, and health history remain readable.</p>}
    {error && <div role="alert" className="border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>}
    {hierarchy && <>
      <JourneyWorkspaceSavedViewBar surface="hierarchy" configuration={{
        version: 1, includeRetired: true, rootDefinitionId: selectedId || null, direction,
        taxonomyKinds: [], reviewStates: [], lifecycles: ['active', 'retired']
      }} onApply={(configuration) => {
        const saved = configuration as JourneyHierarchyViewConfiguration;
        if (saved.rootDefinitionId && hierarchy.nodes.some((node) => node.definitionId === saved.rootDefinitionId)) {
          setSelectedId(saved.rootDefinitionId);
        }
        setDirection(saved.direction);
      }} />
      <div className="flex flex-wrap gap-x-5 gap-y-1 border px-4 py-3 text-sm"><span>{hierarchy.nodes.length} journeys</span><span>{hierarchy.links.length} relationships</span><span>Maximum depth {hierarchy.validation.maximumDepth} of {hierarchy.settings.maximumDepth}</span><span>{hierarchy.settings.enabled ? 'Hierarchy enabled' : 'Hierarchy disabled'}</span></div>
      <Tabs defaultValue="hierarchy"><TabsList aria-label="Hierarchy workspace views"><TabsTrigger value="hierarchy">Hierarchy</TabsTrigger><TabsTrigger value="relationships">Relationships</TabsTrigger><TabsTrigger value="taxonomy">Taxonomy</TabsTrigger><TabsTrigger value="health">Health</TabsTrigger><TabsTrigger value="settings">Settings</TabsTrigger></TabsList>
        <TabsContent value="hierarchy"><div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]"><HierarchyTree hierarchy={hierarchy} selectedId={selectedId} onSelect={setSelectedId} /><div className="space-y-5"><ImpactPanel hierarchy={hierarchy} selectedId={selectedId} traversal={traversal} breadcrumbs={breadcrumbs} direction={direction} onDirection={setDirection} /><details className="border"><summary className="cursor-pointer px-4 py-3 text-sm font-medium">Relationship table alternative</summary><RelationshipTable hierarchy={hierarchy} canManage={false} busy={busy} onUpdate={async () => {}} onSelect={setSelectedId} /></details></div></div></TabsContent>
        <TabsContent value="relationships" className="space-y-5">{canMutateHierarchy && <RelationshipForm nodes={hierarchy.nodes} busy={busy} onCreate={async (draft) => { await mutate(() => createJourneyHierarchyLink(draft)); }} />}<RelationshipTable hierarchy={hierarchy} canManage={canMutateHierarchy} busy={busy} onUpdate={async (link, input) => { await mutate(() => updateJourneyHierarchyLink(link, input)); }} onSelect={setSelectedId} /></TabsContent>
        <TabsContent value="taxonomy"><TaxonomyWorkspace hierarchy={hierarchy} terms={terms} selectedId={selected?.definitionId || ''} canManage={canMutateHierarchy} busy={busy} onCreate={async (input) => { await mutate(() => createJourneyTaxonomyTerm(input)); }} onToggle={async (term, assigned) => { if (!selected) return; await mutate(() => assigned ? unassignJourneyTaxonomyTerm(selected.definitionId, term.id) : assignJourneyTaxonomyTerm(selected.definitionId, term.id)); }} onUpdate={async (term, input) => { await mutate(() => updateJourneyTaxonomyTerm(term, input)); }} /></TabsContent>
        <TabsContent value="health"><HealthWorkspace nodes={hierarchy.nodes} policies={policies} snapshots={snapshots}
          detail={snapshotDetail} canManage={canMutateHierarchy} busy={busy}
          onCreatePolicy={async (input) => { await mutate(() => createJourneyHierarchyHealthPolicy(input)); }}
          onPolicyLifecycle={async (policy) => { await mutate(() => updateJourneyHierarchyHealthPolicy(policy, {
            lifecycle: policy.lifecycle === 'active' ? 'retired' : 'active'
          })); }} onCalculate={async (input) => { await mutate(() => calculateJourneyHierarchyHealthSnapshots(input)); }}
          onRead={async (snapshotId) => { setBusy(true); setError(''); try { setSnapshotDetail(await readJourneyHierarchyHealthSnapshot(snapshotId)); }
            catch (reason) { setError(errorMessage(reason, 'The health snapshot could not be read.')); } finally { setBusy(false); } }} /></TabsContent>
        <TabsContent value="settings">{settings && <SettingsWorkspace settings={settings} canManage={canManage} busy={busy}
          onUpdate={async (input) => { await mutate(() => updateJourneyHierarchySettings(settings, input)); }} />}</TabsContent>
      </Tabs>
    </>}
    {!hierarchy && !loading && !error && <p className="border p-5 text-sm text-muted-foreground">No hierarchy data is available.</p>}
  </div>;
}
