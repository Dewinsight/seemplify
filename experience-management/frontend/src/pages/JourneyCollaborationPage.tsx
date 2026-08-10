import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Ban, Check, Copy, Eye, EyeOff, History, Link2, Loader2, RefreshCw, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { JourneyCollaborationEmailPanel } from '@/components/journeys/JourneyCollaborationEmailPanel';
import { useAuthSession, useSessionFeature } from '@/lib/authSessionContext';
import { ApiError } from '@/lib/api';
import { listJourneyMaps } from '@/lib/journeyMaps';
import { listJourneyPortfolioItems } from '@/lib/journeyPortfolio';
import {
  assignRole, collaborationRoles, createComment, createReadOnlyShare, decideReview, deleteComment, editComment,
  getCollaborationContext, getCollaborationSettings, governanceTargetTypes, listActivity,
  listCommentHistory, listComments, listNotifications, listReadOnlyShares, listReviews, listRoles, listWatchers,
  requestReview, revokeReadOnlyShare, revokeRole, rotateReadOnlyShare, setWatcher, transitionComment, transitionReview, updateCollaborationSettings,
  updateNotification, type CollaborationActivity, type CollaborationComment, type CollaborationContext,
  type CollaborationNotification, type CollaborationRole, type GovernanceReview, type JourneyReadOnlyShare, type RoleAssignment,
  type TargetRef
} from '@/lib/journeyCollaboration';

type TargetOption = TargetRef & { title: string; group: string };
type Tab = 'discussion' | 'inbox' | 'governance' | 'access' | 'shares' | 'activity' | 'settings';
const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'discussion', label: 'Discussion' }, { id: 'inbox', label: 'Inbox' },
  { id: 'governance', label: 'Governance' }, { id: 'access', label: 'Access' }, { id: 'shares', label: 'Read-only links' },
  { id: 'activity', label: 'Activity' }, { id: 'settings', label: 'Settings' }
];
const fieldClass = 'h-9 w-full rounded-md border bg-background px-3 text-sm';
const panelClass = 'border bg-card p-4 sm:p-5';

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
}

export function JourneyCollaborationPage() {
  const enabled = useSessionFeature('journeyCollaboration');
  const portfolioEnabled = useSessionFeature('journeyPortfolio');
  const session = useAuthSession();
  const [targets, setTargets] = useState<TargetOption[]>([]);
  const [selected, setSelected] = useState<TargetRef | null>(null);
  const [context, setContext] = useState<CollaborationContext | null>(null);
  const [comments, setComments] = useState<CollaborationComment[]>([]);
  const [notifications, setNotifications] = useState<CollaborationNotification[]>([]);
  const [roles, setRoles] = useState<RoleAssignment[]>([]);
  const [reviews, setReviews] = useState<GovernanceReview[]>([]);
  const [activity, setActivity] = useState<CollaborationActivity[]>([]);
  const [shares, setShares] = useState<JourneyReadOnlyShare[]>([]);
  const [watchState, setWatchState] = useState<'watching' | 'muted' | null>(null);
  const [settings, setSettings] = useState<CollaborationContext['plan']['settings'] | null>(null);
  const [tab, setTab] = useState<Tab>('discussion');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState('');

  const can = useCallback((capability: string) => Boolean(context && !context.readOnly && context.capabilities.includes(capability)), [context]);

  const discover = useCallback(async () => {
    if (!enabled) return;
    setLoading(true); setError('');
    try {
      const [index, portfolio] = await Promise.all([
        listJourneyMaps(),
        portfolioEnabled ? listJourneyPortfolioItems({ limit: 100 }).catch(() => ({ items: [] })) : Promise.resolve({ items: [] })
      ]);
      const found: TargetOption[] = [
        ...index.journeyMaps.map((item) => ({ targetType: 'journey_map' as const, targetId: item.id, title: item.name, group: 'Journey maps' })),
        ...index.personas.map((item) => ({ targetType: 'persona' as const, targetId: item.id, title: item.name, group: 'Personas' })),
        ...portfolio.items.filter((item) => item.state === 'active').map((item) => ({ targetType: 'portfolio_item' as const, targetId: item.id, title: item.title, group: 'Portfolio' }))
      ];
      setTargets(found);
      setSelected((current) => current && found.some((item) => item.targetId === current.targetId && item.targetType === current.targetType)
        ? current : found[0] ? { targetType: found[0].targetType, targetId: found[0].targetId } : null);
    } catch (reason) { setError(errorMessage(reason, 'Collaboration targets could not be discovered.')); }
    finally { setLoading(false); }
  }, [enabled, portfolioEnabled]);

  const loadTarget = useCallback(async (target: TargetRef) => {
    setLoading(true); setError(''); setConflict('');
    try {
      const nextContext = await getCollaborationContext(target);
      setContext(nextContext);
      const reads = await Promise.all([
        listComments(target), listWatchers(target), listNotifications(), listReviews(target), listActivity(target),
        nextContext.capabilities.includes('journeys.manage_roles') ? listRoles() : Promise.resolve({ items: [], nextCursor: null }),
        nextContext.capabilities.includes('journeys.manage_shares') ? getCollaborationSettings() : Promise.resolve(null),
        nextContext.capabilities.includes('journeys.manage_shares') ? listReadOnlyShares() : Promise.resolve({ items: [] })
      ]);
      setComments(reads[0].items); setWatchState(reads[1].items.find((item) => item.user.id === session?.user?.id)?.state || null);
      setNotifications(reads[2].items); setReviews(reads[3].items); setActivity(reads[4].items); setRoles(reads[5].items);
      if (reads[6]) setSettings(reads[6].settings); else setSettings(nextContext.plan.settings);
      setShares(reads[7].items);
    } catch (reason) { setError(errorMessage(reason, 'This collaboration workspace could not be loaded.')); }
    finally { setLoading(false); }
  }, [session?.user?.id]);

  useEffect(() => { void discover(); }, [discover]);
  useEffect(() => { if (selected) void loadTarget(selected); }, [selected, loadTarget]);

  async function mutate(label: string, operation: () => Promise<unknown>, refresh = true) {
    setBusy(label); setError(''); setConflict('');
    try { await operation(); if (selected && refresh) await loadTarget(selected); }
    catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) setConflict(`${reason.message} Reloaded current records; review them before trying again.`);
      else setError(errorMessage(reason, 'The change could not be saved.'));
      if (selected) await loadTarget(selected);
    } finally { setBusy(''); }
  }

  if (!enabled) return <main className="mx-auto max-w-6xl p-4 sm:p-6"><h1 className="text-2xl font-semibold">Journey collaboration</h1><p className="mt-3 border p-4 text-sm text-muted-foreground">Journey collaboration is not included in this space plan.</p></main>;
  if (loading && targets.length === 0) return <main className="grid min-h-[50vh] place-items-center" aria-label="Loading journey collaboration"><Loader2 className="animate-spin" /></main>;

  const selectedValue = selected ? `${selected.targetType}:${selected.targetId}` : '';
  const visibleTabs = tabs.filter((item) => item.id === 'access'
    ? context?.capabilities.includes('journeys.manage_roles')
    : item.id === 'shares' || item.id === 'settings'
      ? context?.capabilities.includes('journeys.manage_shares')
      : true);
  return <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6" data-testid="journey-collaboration-workspace">
    <header className="flex flex-col justify-between gap-4 border-b pb-5 lg:flex-row lg:items-end">
      <div><h1 className="text-2xl font-semibold tracking-tight">Journey collaboration</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Discuss journey evidence, assign responsibility, and move exact revisions through governance.</p></div>
      <div className="w-full lg:w-[28rem]"><Label htmlFor="collaboration-target">Working target</Label><select id="collaboration-target" className={`${fieldClass} mt-1`} value={selectedValue} onChange={(event) => {
        const option = targets.find((item) => `${item.targetType}:${item.targetId}` === event.target.value);
        if (option) setSelected({ targetType: option.targetType, targetId: option.targetId });
      }}><option value="">Select a target</option>{targets.map((item) => <option key={`${item.targetType}:${item.targetId}`} value={`${item.targetType}:${item.targetId}`}>{item.group} · {item.title}</option>)}</select></div>
    </header>
    {error && <div role="alert" className="border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
    {conflict && <div role="alert" className="border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">{conflict}</div>}
    {!targets.length && !loading && <div className={panelClass}><h2 className="font-medium">No collaboration targets</h2><p className="mt-1 text-sm text-muted-foreground">Create a journey map, persona, or portfolio item first.</p></div>}
    {context && selected && <>
      <section className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between" aria-label="Effective access">
        <div className="text-sm"><span className="font-medium capitalize">{context.role}</span> <span className="text-muted-foreground">via {context.roleSource.replaceAll('_', ' ')}</span>{context.target && <span className="ml-3 text-muted-foreground">Revision {context.target.revision} · checksum <code>{context.target.checksum.slice(0, 12)}</code></span>}</div>
        {context.readOnly && <span className="text-sm font-medium text-amber-800">Read-only: collaboration writes are disabled</span>}
      </section>
      <nav className="overflow-x-auto border-b" aria-label="Collaboration workspace sections"><div role="tablist" className="flex min-w-max gap-5">{visibleTabs.map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} className={`border-b-2 px-1 pb-2 text-sm ${tab === item.id ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground'}`} onClick={() => setTab(item.id)}>{item.label}</button>)}</div></nav>
      {tab === 'discussion' && <DiscussionPanel comments={comments} target={selected} currentUserId={session?.user?.id || ''} can={can} busy={busy} watchState={watchState} mutate={mutate} />}
      {tab === 'inbox' && <InboxPanel items={notifications} busy={busy} mutate={mutate} />}
      {tab === 'governance' && <GovernancePanel target={selected} context={context} items={reviews} currentUserId={session?.user?.id || ''} can={can} busy={busy} mutate={mutate} />}
      {tab === 'access' && <AccessPanel targets={targets} items={roles} canManage={can('journeys.manage_roles')} busy={busy} mutate={mutate} />}
      {tab === 'shares' && settings && <SharesPanel target={selected} items={shares} settings={settings}
        canManage={can('journeys.manage_shares')} busy={busy} mutate={mutate} />}
      {tab === 'activity' && <ActivityPanel items={activity} />}
      {tab === 'settings' && settings && <SettingsPanel value={settings} canManage={can('journeys.manage_shares')} busy={busy} mutate={mutate} />}
    </>}
  </main>;
}

function DiscussionPanel({ comments, target, currentUserId, can, busy, watchState, mutate }: { comments: CollaborationComment[]; target: TargetRef; currentUserId: string; can: (value: string) => boolean; busy: string; watchState: 'watching' | 'muted' | null; mutate: (label: string, operation: () => Promise<unknown>) => Promise<void> }) {
  const [body, setBody] = useState(''); const [mentions, setMentions] = useState(''); const [replyTo, setReplyTo] = useState<string | null>(null);
  const roots = comments.filter((item) => item.parentCommentId === null);
  const submit = (event: FormEvent) => { event.preventDefault(); if (!body.trim()) return; void mutate('comment', () => createComment(target, body.trim(), mentions.split(',').map((v) => v.trim()).filter(Boolean), replyTo || undefined)).then(() => { setBody(''); setMentions(''); setReplyTo(null); }); };
  return <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_15rem]">
    <div className="space-y-4"><form className={panelClass} onSubmit={submit}><h2 className="font-medium">{replyTo ? 'Write a reply' : 'Start a discussion'}</h2><Textarea className="mt-3 min-h-24" maxLength={8000} value={body} onChange={(e) => setBody(e.target.value)} disabled={!can('journeys.comment')} aria-label="Comment" /><Label htmlFor="mention-users" className="mt-3 block">Mention user IDs <span className="font-normal text-muted-foreground">(comma separated)</span></Label><Input id="mention-users" value={mentions} onChange={(e) => setMentions(e.target.value)} disabled={!can('journeys.comment')} /><div className="mt-3 flex gap-2"><Button disabled={!can('journeys.comment') || !body.trim() || busy === 'comment'}>{busy === 'comment' && <Loader2 className="animate-spin" />}{replyTo ? 'Post reply' : 'Post comment'}</Button>{replyTo && <Button type="button" variant="outline" onClick={() => setReplyTo(null)}>Cancel reply</Button>}</div>{!can('journeys.comment') && <p className="mt-2 text-sm text-muted-foreground">Your effective access does not allow comments.</p>}</form>
      {!roots.length ? <div className={panelClass}><p className="text-sm text-muted-foreground">No comments yet.</p></div> : <ol className="space-y-3">{roots.map((root) => <CommentItem key={root.id} item={root} replies={comments.filter((item) => item.rootCommentId === root.id && item.id !== root.id)} currentUserId={currentUserId} can={can} busy={busy} onReply={setReplyTo} mutate={mutate} />)}</ol>}
    </div>
    <aside className={`${panelClass} h-fit`}><h2 className="font-medium">Watching</h2><p className="mt-1 text-sm text-muted-foreground">Choose whether this target appears in your inbox.</p><Button className="mt-3 w-full" variant="outline" disabled={!can('journeys.watch') || busy === 'watch'} onClick={() => void mutate('watch', () => setWatcher(target, watchState === 'watching' ? 'muted' : 'watching'))}>{watchState === 'watching' ? <EyeOff /> : <Eye />}{watchState === 'watching' ? 'Mute target' : 'Watch target'}</Button></aside>
  </section>;
}

function CommentItem({ item, replies, currentUserId, can, busy, onReply, mutate }: { item: CollaborationComment; replies: CollaborationComment[]; currentUserId: string; can: (value: string) => boolean; busy: string; onReply: (id: string) => void; mutate: (label: string, operation: () => Promise<unknown>) => Promise<void> }) {
  const [editing, setEditing] = useState(false); const [draft, setDraft] = useState(item.plainText || ''); const [history, setHistory] = useState<Array<{ id: string; versionNumber: number; plainText: string | null; editor: { name: string }; createdAt: string }> | null>(null);
  const own = item.author.id === currentUserId;
  return <li className={panelClass}><article><div className="flex flex-wrap items-center justify-between gap-2"><div><span className="text-sm font-medium">{item.author.name}</span><span className="ml-2 text-xs text-muted-foreground">{date(item.createdAt)} · revision {item.revision} · {item.state}</span></div></div>{editing ? <div className="mt-3"><Textarea value={draft} onChange={(e) => setDraft(e.target.value)} /><div className="mt-2 flex gap-2"><Button size="sm" disabled={!draft.trim()} onClick={() => void mutate('edit', () => editComment(item, draft.trim(), [])).then(() => setEditing(false))}>Save edit</Button><Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button></div></div> : <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{item.plainText || (item.state === 'deleted' ? 'Comment deleted.' : '')}</p>}{item.mentions.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Mentions: {item.mentions.map((mention) => mention.name).join(', ')}</p>}<div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!can('journeys.comment')} onClick={() => onReply(item.id)}>Reply</Button>{own && item.state === 'active' && <Button size="sm" variant="outline" disabled={!can('journeys.comment')} onClick={() => setEditing(true)}>Edit</Button>}{own && item.state !== 'deleted' && <Button size="sm" variant="outline" disabled={!can('journeys.comment') || busy === 'delete'} onClick={() => void mutate('delete', () => deleteComment(item))}><Trash2 />Delete</Button>}{item.parentCommentId === null && item.state === 'active' && <Button size="sm" variant="outline" disabled={!can('journeys.comment')} onClick={() => void mutate('resolve', () => transitionComment(item, 'resolve'))}><Check />Resolve</Button>}{item.parentCommentId === null && item.state === 'resolved' && <Button size="sm" variant="outline" disabled={!can('journeys.comment')} onClick={() => void mutate('reopen', () => transitionComment(item, 'reopen'))}><RefreshCw />Reopen</Button>}<Button size="sm" variant="ghost" onClick={() => void listCommentHistory(item.id).then((result) => setHistory(result.items))}><History />History</Button></div>{history && <ol className="mt-3 border-l pl-3">{history.map((entry) => <li key={entry.id} className="py-2 text-xs"><span className="font-medium">Version {entry.versionNumber}</span> by {entry.editor.name}, {date(entry.createdAt)}<p className="mt-1 whitespace-pre-wrap text-muted-foreground">{entry.plainText || 'Content removed.'}</p></li>)}</ol>}</article>{replies.length > 0 && <ol className="mt-4 space-y-3 border-l pl-4">{replies.map((reply) => <CommentItem key={reply.id} item={reply} replies={[]} currentUserId={currentUserId} can={can} busy={busy} onReply={onReply} mutate={mutate} />)}</ol>}</li>;
}

function InboxPanel({ items, busy, mutate }: { items: CollaborationNotification[]; busy: string; mutate: (label: string, operation: () => Promise<unknown>) => Promise<void> }) {
  const [filter, setFilter] = useState<'all' | 'unread' | 'read' | 'dismissed'>('all'); const visible = filter === 'all' ? items : items.filter((item) => item.state === filter);
  return <div className="space-y-5"><JourneyCollaborationEmailPanel panelClass={panelClass} /><section className={panelClass}><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-medium">Personal inbox</h2><p className="mt-1 text-sm text-muted-foreground">Mentions, replies, and governance events for you.</p></div><div><Label htmlFor="notification-filter">State</Label><select id="notification-filter" className={`${fieldClass} mt-1`} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}><option value="all">All</option><option value="unread">Unread</option><option value="read">Read</option><option value="dismissed">Dismissed</option></select></div></div>{!visible.length ? <p className="mt-5 text-sm text-muted-foreground">No notifications match this filter.</p> : <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[42rem] text-left text-sm"><thead><tr className="border-b"><th className="py-2">Event</th><th>Actor</th><th>State</th><th>Received</th><th className="text-right">Actions</th></tr></thead><tbody>{visible.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="py-3">{item.kind.replaceAll('_', ' ')}</td><td>{item.actor?.name || 'System'}</td><td>{item.state}</td><td>{date(item.createdAt)}</td><td><div className="flex justify-end gap-2">{item.state === 'unread' && <Button size="sm" variant="outline" disabled={busy === item.id} onClick={() => void mutate(item.id, () => updateNotification(item, 'read'))}>Mark read</Button>}{item.state !== 'dismissed' && <Button size="sm" variant="ghost" onClick={() => void mutate(item.id, () => updateNotification(item, 'dismissed'))}>Dismiss</Button>}</div></td></tr>)}</tbody></table></div>}</section></div>;
}

function GovernancePanel({ target, context, items, currentUserId, can, busy, mutate }: { target: TargetRef; context: CollaborationContext; items: GovernanceReview[]; currentUserId: string; can: (value: string) => boolean; busy: string; mutate: (label: string, operation: () => Promise<unknown>) => Promise<void> }) {
  const [summary, setSummary] = useState(''); const [reason, setReason] = useState(''); const eligible = governanceTargetTypes.includes(target.targetType as typeof governanceTargetTypes[number]);
  return <section className="space-y-4"><form className={panelClass} onSubmit={(e) => { e.preventDefault(); if (eligible) void mutate('request-review', () => requestReview(target, summary, reason)).then(() => { setSummary(''); setReason(''); }); }}><h2 className="font-medium">Request governance review</h2>{context.target && <p className="mt-1 text-sm text-muted-foreground">The request will pin revision {context.target.revision} and checksum <code>{context.target.checksum}</code>.</p>}<div className="mt-4 grid gap-3 md:grid-cols-2"><div><Label htmlFor="review-summary">Summary</Label><Input id="review-summary" value={summary} maxLength={1000} onChange={(e) => setSummary(e.target.value)} disabled={!can('journeys.request_review') || !eligible} /></div><div><Label htmlFor="review-reason">Reason</Label><Input id="review-reason" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} disabled={!can('journeys.request_review') || !eligible} /></div></div><Button className="mt-3" disabled={!can('journeys.request_review') || !eligible || !summary.trim() || !reason.trim() || busy === 'request-review'}><ShieldCheck />Request review</Button>{!eligible && <p className="mt-2 text-sm text-muted-foreground">This target type cannot enter governance.</p>}</form>
    <div className={panelClass}><h2 className="font-medium">Review record</h2>{!items.length ? <p className="mt-3 text-sm text-muted-foreground">No reviews for this target.</p> : <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[58rem] text-left text-sm"><thead><tr className="border-b"><th className="py-2">State</th><th>Exact target</th><th>Request</th><th>Decision</th><th className="text-right">Actions</th></tr></thead><tbody>{items.map((item) => <ReviewRow key={item.id} item={item} currentUserId={currentUserId} can={can} mutate={mutate} />)}</tbody></table></div>}</div></section>;
}

function ReviewRow({ item, currentUserId, can, mutate }: { item: GovernanceReview; currentUserId: string; can: (value: string) => boolean; mutate: (label: string, operation: () => Promise<unknown>) => Promise<void> }) {
  const [summary, setSummary] = useState(''); const [reason, setReason] = useState(''); const requester = item.requestedByUserId === currentUserId;
  return <tr className="border-b align-top last:border-0"><td className="py-3 capitalize">{item.state}<div className="text-xs text-muted-foreground">review rev {item.revision}</div></td><td>Revision {item.targetRevision}<div className="max-w-44 truncate font-mono text-xs" title={item.targetChecksum}>{item.targetChecksum}</div></td><td className="max-w-56">{item.requestSummary}</td><td><Input aria-label={`Decision summary for ${item.id}`} placeholder="Decision summary" value={summary} onChange={(e) => setSummary(e.target.value)} /><Input className="mt-1" aria-label={`Decision reason for ${item.id}`} placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} /></td><td><div className="flex justify-end gap-1">{item.state === 'pending' && !requester && can('journeys.review') && <><Button size="sm" onClick={() => void mutate(item.id, () => decideReview(item, 'approve', summary, reason))} disabled={!summary || !reason}>Approve</Button><Button size="sm" variant="outline" onClick={() => void mutate(item.id, () => decideReview(item, 'reject', summary, reason))} disabled={!summary || !reason}>Reject</Button></>}{item.state === 'pending' && requester && <Button size="sm" variant="outline" onClick={() => void mutate(item.id, () => transitionReview(item, 'withdraw', reason))} disabled={!reason}>Withdraw</Button>}{item.state === 'approved' && !requester && can('journeys.publish') && <Button size="sm" onClick={() => void mutate(item.id, () => transitionReview(item, 'publish', reason))} disabled={!reason}>Publish</Button>}</div></td></tr>;
}

function AccessPanel({ targets, items, canManage, busy, mutate }: { targets: TargetOption[]; items: RoleAssignment[]; canManage: boolean; busy: string; mutate: (label: string, operation: () => Promise<unknown>) => Promise<void> }) {
  const [userId, setUserId] = useState(''); const [role, setRole] = useState<CollaborationRole>('viewer'); const [scope, setScope] = useState<'space' | 'journey'>('space'); const journeys = targets.filter((item) => item.targetType === 'journey_map'); const [journeyId, setJourneyId] = useState('');
  return <section className="space-y-4"><form className={panelClass} onSubmit={(e) => { e.preventDefault(); void mutate('assign', () => assignRole({ userId, role, scopeType: scope, journeyDefinitionId: scope === 'journey' ? journeyId : undefined })).then(() => setUserId('')); }}><h2 className="font-medium">Assign collaboration role</h2><p className="mt-1 text-sm text-muted-foreground">Use an exact member user ID. Access is always confined to the current space.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div><Label htmlFor="role-user">User ID</Label><Input id="role-user" value={userId} onChange={(e) => setUserId(e.target.value)} disabled={!canManage} /></div><div><Label htmlFor="role-name">Role</Label><select id="role-name" className={fieldClass} value={role} onChange={(e) => setRole(e.target.value as CollaborationRole)} disabled={!canManage}>{collaborationRoles.map((value) => <option key={value}>{value}</option>)}</select></div><div><Label htmlFor="role-scope">Scope</Label><select id="role-scope" className={fieldClass} value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} disabled={!canManage}><option value="space">Current space</option><option value="journey">One journey</option></select></div>{scope === 'journey' && <div><Label htmlFor="role-journey">Journey</Label><select id="role-journey" className={fieldClass} value={journeyId} onChange={(e) => setJourneyId(e.target.value)}><option value="">Select journey</option>{journeys.map((item) => <option key={item.targetId} value={item.targetId}>{item.title}</option>)}</select></div>}</div><Button className="mt-3" disabled={!canManage || !userId || (scope === 'journey' && !journeyId) || busy === 'assign'}>Assign role</Button>{!canManage && <p className="mt-2 text-sm text-muted-foreground">Only managers and administrators can change role assignments.</p>}</form>
    <div className={panelClass}><h2 className="font-medium">Active assignments</h2>{!items.length ? <p className="mt-3 text-sm text-muted-foreground">No explicit role assignments.</p> : <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[42rem] text-left text-sm"><thead><tr className="border-b"><th className="py-2">Person</th><th>Role</th><th>Scope</th><th>Revision</th><th className="text-right">Action</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="py-3">{item.userName}<div className="text-xs text-muted-foreground">{item.userId}</div></td><td className="capitalize">{item.role}</td><td>{item.scopeType === 'journey' ? 'One journey' : 'Current space'}</td><td>{item.revision}</td><td className="text-right"><Button size="sm" variant="outline" disabled={!canManage} onClick={() => void mutate(item.id, () => revokeRole(item))}>Revoke</Button></td></tr>)}</tbody></table></div>}</div></section>;
}

function SharesPanel({ target, items, settings, canManage, busy, mutate }: {
  target: TargetRef; items: JourneyReadOnlyShare[]; settings: CollaborationContext['plan']['settings'];
  canManage: boolean; busy: string;
  mutate: (label: string, operation: () => Promise<unknown>) => Promise<void>;
}) {
  const initialExpiry = useMemo(() => {
    const value = new Date(Date.now() + Math.min(settings.maximumShareDays, 7) * 86_400_000);
    return value.toISOString().slice(0, 16);
  }, [settings.maximumShareDays]);
  const [expiresAt, setExpiresAt] = useState(initialExpiry);
  const [allowExport, setAllowExport] = useState(false);
  const [allowDownload, setAllowDownload] = useState(false);
  const [latestUrl, setLatestUrl] = useState('');
  const [revokeReason, setRevokeReason] = useState('External review period completed.');
  useEffect(() => setExpiresAt(initialExpiry), [initialExpiry]);
  const eligible = target.targetType === 'journey_map' || target.targetType === 'persona';
  const active = items.filter((item) => item.state === 'active' && new Date(item.expiresAt) > new Date());
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const targetType = target.targetType === 'journey_map' || target.targetType === 'persona'
      ? target.targetType : null;
    if (!targetType) return;
    void mutate('share-create', async () => {
      const result = await createReadOnlyShare({ targetType, targetId: target.targetId,
        expiresAt: new Date(expiresAt).toISOString(), allowExport, allowDownload });
      setLatestUrl(result.url);
    });
  };
  return <section className="space-y-4" data-testid="journey-read-only-shares">
    <form className={panelClass} onSubmit={submit}>
      <h2 className="font-medium">Create a read-only link</h2>
      <p className="mt-1 text-sm text-muted-foreground">The link contains an immutable snapshot of the selected map or persona. It expires automatically and can be revoked immediately.</p>
      {!settings.sharingEnabled || !settings.securityReviewReference || !settings.securityReviewedAt
        ? <p className="mt-3 border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">Record the security/privacy review and enable external sharing in Settings before creating a link.</p>
        : null}
      {!eligible && <p className="mt-3 border p-3 text-sm text-muted-foreground">Select a journey map or persona to create a link. Portfolio-item links are not exposed as whole-portfolio snapshots.</p>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(15rem,1fr)_auto_auto] lg:items-end">
        <div><Label htmlFor="share-expiry">Expires</Label><Input id="share-expiry" type="datetime-local" value={expiresAt}
          onChange={(event) => setExpiresAt(event.target.value)} disabled={!canManage || !eligible} /></div>
        <label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" checked={allowExport}
          onChange={(event) => { setAllowExport(event.target.checked); if (!event.target.checked) setAllowDownload(false); }}
          disabled={!canManage || !eligible || !settings.externalDownloadsEnabled} />Allow export</label>
        <label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" checked={allowDownload}
          onChange={(event) => { setAllowDownload(event.target.checked); if (event.target.checked) setAllowExport(true); }}
          disabled={!canManage || !eligible || !settings.externalDownloadsEnabled} />Allow JSON download</label>
      </div>
      <Button className="mt-3" disabled={!canManage || !eligible || !settings.sharingEnabled
        || !settings.securityReviewReference || !settings.securityReviewedAt || busy === 'share-create'}>
        {busy === 'share-create' ? <Loader2 className="animate-spin" /> : <Link2 />}Create link
      </Button>
      {!canManage && <p className="mt-2 text-sm text-muted-foreground">Only Journey managers and administrators can manage external links.</p>}
      {latestUrl && <div className="mt-4 border p-3"><Label htmlFor="new-share-url">New link</Label><div className="mt-1 flex flex-col gap-2 sm:flex-row"><Input id="new-share-url" readOnly value={latestUrl} /><Button type="button" variant="outline" onClick={() => void navigator.clipboard.writeText(latestUrl)}><Copy />Copy</Button></div><p className="mt-2 text-xs text-muted-foreground">This bearer link grants read-only access until it expires or is revoked. Share it only with the intended audience.</p></div>}
    </form>
    <div className={panelClass}>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h2 className="font-medium">Managed links</h2><p className="mt-1 text-sm text-muted-foreground">{active.length} active of {items.length} retained links.</p></div><div className="w-full sm:w-80"><Label htmlFor="share-revoke-reason">Revocation reason</Label><Input id="share-revoke-reason" value={revokeReason} maxLength={500} onChange={(event) => setRevokeReason(event.target.value)} disabled={!canManage} /></div></div>
      {!items.length ? <p className="mt-4 text-sm text-muted-foreground">No read-only links have been created.</p>
        : <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[54rem] text-left text-sm"><caption className="sr-only">Read-only Journey links and their expiry and revocation status</caption><thead><tr className="border-b"><th className="py-2">Target</th><th>State</th><th>Permissions</th><th>Expires</th><th>Token prefix</th><th className="text-right">Actions</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-b align-top last:border-0"><td className="py-3">{item.targetType.replaceAll('_', ' ')}<div className="max-w-52 truncate font-mono text-xs text-muted-foreground" title={item.targetId}>{item.targetId}</div><div className="text-xs text-muted-foreground">revision {item.targetRevision}</div></td><td>{item.state === 'active' && new Date(item.expiresAt) <= new Date() ? 'expired' : item.state}</td><td>View{item.allowExport ? ', export' : ''}{item.allowDownload ? ', download' : ''}</td><td>{date(item.expiresAt)}</td><td className="font-mono text-xs">{item.tokenPrefix}</td><td><div className="flex justify-end gap-2">{item.state === 'active' && new Date(item.expiresAt) > new Date() && <><Button size="sm" variant="outline" disabled={!canManage || busy === `share-rotate-${item.id}`} onClick={() => void mutate(`share-rotate-${item.id}`, async () => { const result = await rotateReadOnlyShare(item); setLatestUrl(result.url); })}><RotateCcw />Rotate</Button><Button size="sm" variant="outline" disabled={!canManage || revokeReason.trim().length < 8 || busy === `share-revoke-${item.id}`} onClick={() => void mutate(`share-revoke-${item.id}`, () => revokeReadOnlyShare(item, revokeReason.trim()))}><Ban />Revoke</Button></>}</div></td></tr>)}</tbody></table></div>}
    </div>
  </section>;
}

function ActivityPanel({ items }: { items: CollaborationActivity[] }) {
  return <section className={panelClass}><h2 className="font-medium">Activity</h2><p className="mt-1 text-sm text-muted-foreground">Structured events only. Comment text and governance reasons are excluded.</p>{!items.length ? <p className="mt-4 text-sm text-muted-foreground">No activity for this target.</p> : <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[45rem] text-left text-sm"><thead><tr className="border-b"><th className="py-2">Event</th><th>Actor</th><th>Record reference</th><th>Time</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="py-3">{item.action.replaceAll('_', ' ')}</td><td>{item.actor?.name || 'System'}</td><td className="font-mono text-xs">{item.commentId ? `comment ${item.commentId}` : item.reviewId ? `review ${item.reviewId}` : `${item.targetType} ${item.targetId}`}</td><td>{date(item.createdAt)}</td></tr>)}</tbody></table></div>}</section>;
}

function SettingsPanel({ value, canManage, busy, mutate }: { value: CollaborationContext['plan']['settings']; canManage: boolean; busy: string; mutate: (label: string, operation: () => Promise<unknown>) => Promise<void> }) {
  const [draft, setDraft] = useState(value); useEffect(() => setDraft(value), [value]);
  const toggle = (key: 'enabled' | 'commentsEnabled' | 'sharingEnabled' | 'externalDownloadsEnabled', label: string) => <label className="flex items-center justify-between gap-4 border-b py-3 text-sm"><span>{label}</span><input type="checkbox" checked={draft[key]} disabled={!canManage} onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })} /></label>;
  return <form className={panelClass} onSubmit={(e) => { e.preventDefault(); void mutate('settings', () => updateCollaborationSettings(draft)); }}><h2 className="font-medium">Collaboration settings</h2><p className="mt-1 text-sm text-muted-foreground">Space kill switches and retention limits. Disabling collaboration makes all writes read-only.</p><div className="mt-3">{toggle('enabled', 'Collaboration enabled')}{toggle('commentsEnabled', 'Comments enabled')}{toggle('sharingEnabled', 'External sharing enabled')}{toggle('externalDownloadsEnabled', 'External downloads enabled')}</div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div><Label>Comment retention days</Label><Input type="number" min={1} max={3650} value={draft.commentRetentionDays} onChange={(e) => setDraft({ ...draft, commentRetentionDays: Number(e.target.value) })} disabled={!canManage} /></div><div><Label>View retention days</Label><Input type="number" min={1} max={3650} value={draft.viewRetentionDays} onChange={(e) => setDraft({ ...draft, viewRetentionDays: Number(e.target.value) })} disabled={!canManage} /></div><div><Label>Maximum share days</Label><Input type="number" min={1} max={365} value={draft.maximumShareDays} onChange={(e) => setDraft({ ...draft, maximumShareDays: Number(e.target.value) })} disabled={!canManage} /></div><div><Label>Security review reference</Label><Input value={draft.securityReviewReference || ''} onChange={(e) => setDraft({ ...draft, securityReviewReference: e.target.value || null })} disabled={!canManage} /></div></div><Button className="mt-4" disabled={!canManage || busy === 'settings'}>{busy === 'settings' && <Loader2 className="animate-spin" />}Save settings</Button></form>;
}
