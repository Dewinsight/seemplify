import { useMemo, useState, type FormEvent } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  JourneyIdentityAudit, JourneyIdentityCommandResult, JourneyIdentityCorrectionEntry,
  JourneyIdentityProfile, JourneyIdentityProfileDetail
} from '@/lib/journeyIdentity';

type CommandInput = { commandId: string; occurredAt: string; reason: string };

function newCommandId(prefix: 'merge' | 'split') {
  return `${prefix}-${crypto.randomUUID()}`;
}

function propagationLabel(entry: JourneyIdentityCorrectionEntry | undefined) {
  const checkpoint = entry?.result.privacyPropagation;
  if (!entry) return 'Correction status has not been recorded yet.';
  if (!checkpoint) return 'Derived identity views were rebuilt. Privacy propagation status is pending.';
  if (checkpoint.status === 'completed') return 'Identity correction and privacy propagation completed.';
  if (checkpoint.status === 'operator_required') return 'Identity correction is waiting for an operator-required privacy step.';
  if (checkpoint.status === 'waiting') return 'Identity correction is waiting for a downstream privacy target.';
  return 'Identity correction privacy propagation is running.';
}

function IdentityComparison({ source, target }: { source: JourneyIdentityProfile; target: JourneyIdentityProfile }) {
  const rows = [
    ['Profile type', source.kind, target.kind], ['State', source.status, target.status],
    ['Exact identifiers', String(source.identifierCount), String(target.identifierCount)],
    ['Active memberships', String(source.activeMembershipCount), String(target.activeMembershipCount)],
    ['Canonical profile', source.canonicalProfileId, target.canonicalProfileId]
  ];
  return <div className="max-w-full overflow-x-auto border" data-testid="identity-merge-preflight">
    <table className="w-full min-w-[640px] text-left text-sm">
      <caption className="sr-only">Source and target profile comparison before merge</caption>
      <thead className="border-b bg-muted/50"><tr><th className="px-3 py-2">Field</th><th className="px-3 py-2">Source profile</th><th className="px-3 py-2">Target profile</th></tr></thead>
      <tbody>{rows.map(([label, left, right]) => <tr className="border-b last:border-0" key={label}><th scope="row" className="px-3 py-2 font-medium">{label}</th><td className="break-all px-3 py-2">{left}</td><td className="break-all px-3 py-2">{right}</td></tr>)}</tbody>
    </table>
  </div>;
}

export function JourneyIdentityCorrectionWorkspace({ profiles, detail, canManage, busy, audits, corrections, outcome,
  onMerge, onSplit, onRefresh }: {
  profiles: JourneyIdentityProfile[]; detail: JourneyIdentityProfileDetail; canManage: boolean; busy: boolean;
  audits: JourneyIdentityAudit[]; corrections: JourneyIdentityCorrectionEntry[]; outcome: JourneyIdentityCommandResult['result'] | null;
  onMerge: (input: CommandInput & { sourceProfileId: string; targetProfileId: string }) => Promise<boolean>;
  onSplit: (input: CommandInput & { mergeAuditId: string }) => Promise<boolean>; onRefresh: () => Promise<void>;
}) {
  const [targetId, setTargetId] = useState('');
  const [mergeReason, setMergeReason] = useState(''); const [mergeConfirmation, setMergeConfirmation] = useState('');
  const [splitReason, setSplitReason] = useState(''); const [splitConfirmation, setSplitConfirmation] = useState('');
  const [mergeCommandId, setMergeCommandId] = useState(() => newCommandId('merge'));
  const [splitCommandId, setSplitCommandId] = useState(() => newCommandId('split'));
  const source = profiles.find((profile) => profile.profileId === detail.profile.profileId);
  const targets = profiles.filter((profile) => profile.profileId !== detail.profile.profileId && profile.status === 'active');
  const target = targets.find((profile) => profile.profileId === targetId) || null;
  const activeMerges = detail.merges.filter((merge) => merge.active);
  const latestCorrection = useMemo(() => outcome
    ? corrections.find((entry) => entry.run.commandId === outcome.commandId) : undefined, [corrections, outcome]);

  async function submitMerge(event: FormEvent) {
    event.preventDefault();
    if (!source || !target || mergeReason.trim().length < 8 || mergeConfirmation !== 'MERGE') return;
    const accepted = await onMerge({ commandId: mergeCommandId, occurredAt: new Date().toISOString(),
      sourceProfileId: source.profileId, targetProfileId: target.profileId, reason: mergeReason.trim() });
    if (accepted) { setMergeReason(''); setMergeConfirmation(''); setTargetId(''); setMergeCommandId(newCommandId('merge')); }
  }

  async function submitSplit(event: FormEvent<HTMLFormElement>, mergeAuditId: string) {
    event.preventDefault();
    if (splitReason.trim().length < 8 || splitConfirmation !== 'SPLIT') return;
    const accepted = await onSplit({ commandId: splitCommandId, occurredAt: new Date().toISOString(), mergeAuditId,
      reason: splitReason.trim() });
    if (accepted) { setSplitReason(''); setSplitConfirmation(''); setSplitCommandId(newCommandId('split')); }
  }

  return <section className="border" data-testid="identity-correction-workspace">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3"><div><h3 className="font-medium">Merge and correction history</h3><p className="mt-1 text-sm text-muted-foreground">Commands preserve original identity evidence. Derived views and privacy propagation are tracked separately.</p></div><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void onRefresh()}><RefreshCw className="h-4 w-4" />Refresh status</Button></header>
    {outcome && <div className={`border-b px-4 py-3 text-sm ${outcome.status === 'rejected' ? 'text-destructive' : ''}`} role="status" data-testid="identity-command-outcome">
      <p className="font-medium">{outcome.status === 'replayed' ? 'Idempotent command replay' : outcome.status === 'accepted' ? 'Identity command accepted' : 'Identity command rejected'} · {outcome.code}</p>
      <p className="mt-1 text-muted-foreground">{outcome.explanation}</p>
      {outcome.status !== 'rejected' && <p className="mt-1">{propagationLabel(latestCorrection)}</p>}
    </div>}
    {!canManage && <p className="border-b px-4 py-3 text-sm text-muted-foreground">Merge and split controls require an owner or administrator. Audit and merge state remain read-only.</p>}
    {canManage && source && <div className="grid gap-5 p-4 xl:grid-cols-2"><form className="space-y-4" onSubmit={(event) => void submitMerge(event)}>
      <div><h4 className="text-sm font-semibold">Merge selected profile</h4><p className="mt-1 text-xs leading-5 text-muted-foreground">The selected profile becomes the source. Choose the canonical target and compare both records before confirming.</p></div>
      <div className="grid gap-1.5"><Label htmlFor="identity-merge-target">Canonical target profile</Label><select id="identity-merge-target" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={targetId} onChange={(event) => { setTargetId(event.target.value); setMergeCommandId(newCommandId('merge')); }}><option value="">Select a target</option>{targets.map((profile) => <option value={profile.profileId} key={profile.profileId}>{profile.profileId}</option>)}</select></div>
      {target && <IdentityComparison source={source} target={target} />}
      <div className="grid gap-1.5"><Label htmlFor="identity-merge-reason">Reviewed reason</Label><Input id="identity-merge-reason" value={mergeReason} minLength={8} maxLength={400} required onChange={(event) => setMergeReason(event.target.value)} /><p className="text-xs text-muted-foreground">8–400 characters. Do not include customer content or credentials.</p></div>
      <div className="grid gap-1.5"><Label htmlFor="identity-merge-confirmation">Type MERGE to confirm</Label><Input id="identity-merge-confirmation" autoComplete="off" value={mergeConfirmation} onChange={(event) => setMergeConfirmation(event.target.value)} /></div>
      <Button type="submit" disabled={busy || !target || mergeReason.trim().length < 8 || mergeConfirmation !== 'MERGE'}>{busy && <LoaderCircle className="h-4 w-4 animate-spin" />}Merge profiles</Button>
    </form><div className="space-y-4"><div><h4 className="text-sm font-semibold">Active merges</h4><p className="mt-1 text-xs leading-5 text-muted-foreground">Split restores the prior canonical relationship; evidence and audit records remain.</p></div>{activeMerges.length ? activeMerges.map((merge) => <form className="space-y-3 border p-3" key={merge.mergeAuditId} onSubmit={(event) => void submitSplit(event, merge.mergeAuditId)}><dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">Source</dt><dd className="break-all font-mono text-xs">{merge.sourceProfileId}</dd></div><div><dt className="text-xs text-muted-foreground">Target</dt><dd className="break-all font-mono text-xs">{merge.canonicalTargetProfileId}</dd></div></dl><p className="text-xs text-muted-foreground">Merged {new Date(merge.mergedAt).toLocaleString()} · {merge.reason}</p><div className="grid gap-1.5"><Label htmlFor={`identity-split-reason-${merge.mergeAuditId}`}>Split reason</Label><Input id={`identity-split-reason-${merge.mergeAuditId}`} value={splitReason} minLength={8} maxLength={400} required onChange={(event) => setSplitReason(event.target.value)} /></div><div className="grid gap-1.5"><Label htmlFor={`identity-split-confirm-${merge.mergeAuditId}`}>Type SPLIT to confirm</Label><Input id={`identity-split-confirm-${merge.mergeAuditId}`} value={splitConfirmation} onChange={(event) => setSplitConfirmation(event.target.value)} /></div><Button type="submit" variant="outline" disabled={busy || splitReason.trim().length < 8 || splitConfirmation !== 'SPLIT'}>Split profiles</Button></form>) : <p className="border p-3 text-sm text-muted-foreground">No active merge involving this profile.</p>}</div></div>}
    <div className="grid gap-px border-t bg-border lg:grid-cols-2"><div className="bg-background"><h4 className="border-b px-4 py-3 text-sm font-semibold">Correction progress</h4>{corrections.length ? <ul className="divide-y">{corrections.slice(0, 10).map((entry) => <li className="px-4 py-3 text-sm" key={entry.run.id}><div className="flex flex-wrap justify-between gap-2"><span>Command {entry.run.commandId}</span><span>{entry.result.privacyPropagation?.status || 'propagation pending'}</span></div><p className="mt-1 text-xs text-muted-foreground">{propagationLabel(entry)}</p></li>)}</ul> : <p className="p-4 text-sm text-muted-foreground">No correction runs are visible for this profile.</p>}</div><div className="bg-background"><h4 className="border-b px-4 py-3 text-sm font-semibold">Recent identity audit</h4>{audits.length ? <ul className="divide-y">{audits.slice(0, 10).map((audit) => <li className="px-4 py-3 text-sm" key={audit.auditId}><div className="flex flex-wrap justify-between gap-2"><span>{audit.action} · {audit.code}</span><span>{audit.outcome}</span></div><p className="mt-1 text-xs text-muted-foreground">{audit.explanation}</p></li>)}</ul> : <p className="p-4 text-sm text-muted-foreground">No audit entries are available.</p>}</div></div>
  </section>;
}
