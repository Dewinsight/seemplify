import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Download, LoaderCircle, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { JourneyIdentityCorrectionWorkspace } from '@/components/journeys/JourneyIdentityCorrectionWorkspace';
import { useAuthSession, useSessionFeature } from '@/lib/authSessionContext';
import { ApiError } from '@/lib/api';
import {
  createJourneyIdentityGroup, createJourneyIdentitySegment, createJourneyProfileExport, createJourneyProfilePrivacyJob,
  journeyCustomer360Purposes, listJourneyIdentityAudit, listJourneyIdentityCorrectionRuns, listJourneyIdentityGroups, listJourneyIdentityProfiles,
  listJourneyIdentitySegments, listJourneyProfilePrivacy, listJourneyProfileSessions, listJourneyProfileTimeline,
  readJourneyAccount360, readJourneyIdentityGroup, readJourneyIdentityProfile, readJourneyIdentitySegment, readJourneyProfile360,
  mergeJourneyIdentityProfiles, splitJourneyIdentityMerge, updateJourneyProfilePrivacy, type JourneyCustomer360Purpose,
  type JourneyIdentityAudit, type JourneyIdentityCommandResult, type JourneyIdentityCorrectionEntry,
  type JourneyIdentityGroup, type JourneyIdentityGroupDetail, type JourneyIdentityProfile, type JourneyIdentityProfileDetail,
  type JourneyIdentitySegment, type JourneyIdentitySegmentDetail, type JourneyProfile360, type JourneyProfilePrivacyJob,
  type JourneyProfileExportJob, type JourneyProfilePrivacyState
} from '@/lib/journeyIdentity';

type Timeline = Awaited<ReturnType<typeof listJourneyProfileTimeline>>['events'];
type Sessions = Awaited<ReturnType<typeof listJourneyProfileSessions>>['sessions'];
type Account360 = Awaited<ReturnType<typeof readJourneyAccount360>>;

const purposeLabels: Record<JourneyCustomer360Purpose, string> = {
  analytics: 'Analytics', personalisation: 'Personalisation', research_contact: 'Research contact', marketing: 'Marketing'
};

function message(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}
function identityCommandMessage(reason: unknown) {
  if (reason instanceof ApiError && (reason.status === 403 || reason.status === 404)) {
    return 'The identity command could not be authorised for the active space.';
  }
  if (reason instanceof ApiError && reason.status === 409) return 'The identity records changed. Refresh the comparison and try again.';
  return message(reason, 'The identity command could not be submitted.');
}
function dateTime(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium', timeStyle: 'short'
  }).format(parsed);
}
function stateClass(state: string) {
  if (state === 'denied' || state === 'suppressed' || state === 'deleted') return 'text-destructive';
  if (state === 'queued') return 'text-amber-700 dark:text-amber-400';
  return 'text-foreground';
}

function Empty({ children }: { children: string }) {
  return <p className="border p-4 text-sm text-muted-foreground">{children}</p>;
}

function ProfileList({ profiles, selectedId, onSelect }: {
  profiles: JourneyIdentityProfile[]; selectedId: string; onSelect: (id: string) => void;
}) {
  if (!profiles.length) return <Empty>No identity profiles are available for these filters.</Empty>;
  return <div className="max-w-full overflow-x-auto border" data-testid="journey-identity-profile-list">
    <table className="w-full min-w-[680px] text-left text-sm">
      <caption className="sr-only">Identity profiles and deterministic binding summary</caption>
      <thead className="border-b bg-muted/50"><tr><th className="px-3 py-2">Profile</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">State</th><th className="px-3 py-2">Exact identifiers</th><th className="px-3 py-2">Memberships</th><th className="px-3 py-2">Canonical profile</th></tr></thead>
      <tbody>{profiles.map((profile) => <tr key={profile.profileId} className={`border-b last:border-0 ${selectedId === profile.profileId ? 'bg-muted/60' : ''}`}>
        <td className="px-3 py-2"><button className="font-medium underline-offset-4 hover:underline" onClick={() => onSelect(profile.profileId)}>{profile.profileId}</button></td>
        <td className="px-3 py-2">{profile.kind}</td><td className={`px-3 py-2 ${stateClass(profile.status)}`}>{profile.status}</td>
        <td className="px-3 py-2 tabular-nums">{profile.identifierCount}</td><td className="px-3 py-2 tabular-nums">{profile.activeMembershipCount}</td>
        <td className="px-3 py-2 font-mono text-xs">{profile.mergedIntoProfileId || profile.canonicalProfileId}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function PrivacyTable({ states, busy, onChange }: {
  states: JourneyProfilePrivacyState[]; busy: boolean;
  onChange: (state: JourneyProfilePrivacyState, next: JourneyProfilePrivacyState['state']) => Promise<void>;
}) {
  return <div className="max-w-full overflow-x-auto border"><table className="w-full min-w-[720px] text-left text-sm">
    <caption className="sr-only">Purpose-specific consent and privacy state</caption>
    <thead className="border-b bg-muted/50"><tr><th className="px-3 py-2">Purpose</th><th className="px-3 py-2">State</th><th className="px-3 py-2">Lawful basis</th><th className="px-3 py-2">Policy reference</th><th className="px-3 py-2">Updated</th></tr></thead>
    <tbody>{states.map((state) => <tr key={state.purpose} className="border-b last:border-0"><td className="px-3 py-2 font-medium">{purposeLabels[state.purpose]}</td>
      <td className="px-3 py-2"><select aria-label={`${purposeLabels[state.purpose]} privacy state`} className={`h-9 rounded-md border bg-background px-2 ${stateClass(state.state)}`} value={state.state} disabled={busy} onChange={(event) => void onChange(state, event.target.value as JourneyProfilePrivacyState['state'])}>
        {['unknown', 'granted', 'denied', 'suppressed'].map((value) => <option key={value}>{value}</option>)}</select></td>
      <td className="px-3 py-2">{state.lawfulBasis || 'Not recorded'}</td><td className="px-3 py-2">{state.policyReference || 'Not recorded'}</td><td className="px-3 py-2">{dateTime(state.updatedAt)}</td></tr>)}</tbody>
  </table></div>;
}

function ProfileDetail({ detail, timeline, sessions, customer360, privacy, corrections, canManage, purpose, busy, privacyJob, exportJob, onPurpose, onPrivacy, onExport, onPrivacyJob }: {
  detail: JourneyIdentityProfileDetail; timeline: Timeline; sessions: Sessions; customer360: JourneyProfile360 | null;
  privacy: JourneyProfilePrivacyState[]; corrections: JourneyIdentityCorrectionEntry[]; canManage: boolean;
  purpose: JourneyCustomer360Purpose; busy: boolean; privacyJob: JourneyProfilePrivacyJob | null; exportJob: JourneyProfileExportJob | null;
  onPurpose: (purpose: JourneyCustomer360Purpose) => void;
  onPrivacy: (state: JourneyProfilePrivacyState, next: JourneyProfilePrivacyState['state']) => Promise<void>;
  onExport: () => Promise<void>; onPrivacyJob: (operation: 'suppress' | 'erasure', reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  return <div className="space-y-5" data-testid="journey-identity-profile-detail">
    <section className="border"><div className="border-b px-4 py-3"><h2 className="font-semibold">Identity summary</h2><p className="text-sm text-muted-foreground">Deterministic resolution from exact identifier bindings. No inferred or probabilistic matches are shown.</p></div>
      <dl className="grid gap-px bg-border sm:grid-cols-3"><div className="bg-background p-4"><dt className="text-xs text-muted-foreground">Profile</dt><dd className="mt-1 break-all font-mono text-sm">{detail.profile.profileId}</dd></div><div className="bg-background p-4"><dt className="text-xs text-muted-foreground">Canonical profile</dt><dd className="mt-1 break-all font-mono text-sm">{detail.profile.canonicalProfileId}</dd></div><div className="bg-background p-4"><dt className="text-xs text-muted-foreground">Recorded facts</dt><dd className="mt-1 text-sm">{detail.sourceFacts.length} source facts · {detail.bindings.length} exact bindings</dd></div></dl>
      {detail.tombstone && <p className="border-t border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">Deleted {dateTime(detail.tombstone.deletedAt)}. Reason: {detail.tombstone.reason}</p>}
    </section>

    <Tabs defaultValue="facts"><TabsList aria-label="Profile detail views" className="max-w-full gap-4 overflow-x-auto"><TabsTrigger className="shrink-0" value="facts">Facts and bindings</TabsTrigger><TabsTrigger className="shrink-0" value="timeline">Interactions</TabsTrigger><TabsTrigger className="shrink-0" value="sessions">Sessions</TabsTrigger><TabsTrigger className="shrink-0" value="memberships">Memberships</TabsTrigger>{canManage && <TabsTrigger className="shrink-0" value="privacy">Privacy and governance</TabsTrigger>}</TabsList>
      <TabsContent value="facts" className="space-y-4"><div className="max-w-full overflow-x-auto border"><table className="w-full min-w-[640px] text-left text-sm"><caption className="sr-only">Exact identity bindings</caption><thead className="border-b bg-muted/50"><tr><th className="px-3 py-2">Identifier kind</th><th className="px-3 py-2">Namespace</th><th className="px-3 py-2">Opaque value</th><th className="px-3 py-2">Bound</th></tr></thead><tbody>{detail.bindings.map((binding) => <tr key={`${binding.identifier.kind}:${binding.identifier.namespace}:${binding.identifier.value}`} className="border-b last:border-0"><td className="px-3 py-2">{binding.identifier.kind}</td><td className="px-3 py-2">{binding.identifier.namespace}</td><td className="max-w-xs truncate px-3 py-2 font-mono text-xs" title={binding.identifier.value}>{binding.identifier.value}</td><td className="px-3 py-2">{dateTime(binding.boundAt)}</td></tr>)}</tbody></table>{!detail.bindings.length && <p className="p-4 text-sm text-muted-foreground">No exact identifier bindings are recorded.</p>}</div></TabsContent>
      <TabsContent value="timeline"><div className="max-w-full overflow-x-auto border"><table className="w-full min-w-[720px] text-left text-sm"><caption className="sr-only">Profile interaction timeline</caption><thead className="border-b bg-muted/50"><tr><th className="px-3 py-2">Occurred</th><th className="px-3 py-2">Interaction</th><th className="px-3 py-2">Summary</th><th className="px-3 py-2">Source</th></tr></thead><tbody>{timeline.map((event) => <tr key={event.id} className="border-b last:border-0"><td className="px-3 py-2">{dateTime(event.occurredAt)}</td><td className="px-3 py-2 font-medium">{event.title}</td><td className="px-3 py-2">{event.summary}</td><td className="px-3 py-2">{event.sourceType} · {event.sourceId}</td></tr>)}</tbody></table>{!timeline.length && <p className="p-4 text-sm text-muted-foreground">No interaction events are available. Suppressed profiles intentionally return an empty timeline.</p>}</div></TabsContent>
      <TabsContent value="sessions"><div className="max-w-full overflow-x-auto border"><table className="w-full min-w-[720px] text-left text-sm"><caption className="sr-only">Profile sessions</caption><thead className="border-b bg-muted/50"><tr><th className="px-3 py-2">Namespace</th><th className="px-3 py-2">Started</th><th className="px-3 py-2">Last seen</th><th className="px-3 py-2">Events</th><th className="px-3 py-2">Source facts</th></tr></thead><tbody>{sessions.map((session) => <tr key={session.id} className="border-b last:border-0"><td className="px-3 py-2">{session.identifierNamespace}</td><td className="px-3 py-2">{dateTime(session.startedAt)}</td><td className="px-3 py-2">{dateTime(session.lastSeenAt)}</td><td className="px-3 py-2">{session.eventCount}</td><td className="px-3 py-2">{session.sourceFactCount}</td></tr>)}</tbody></table>{!sessions.length && <p className="p-4 text-sm text-muted-foreground">No sessions are available.</p>}</div></TabsContent>
      <TabsContent value="memberships"><div className="max-w-full overflow-x-auto border"><table className="w-full min-w-[620px] text-left text-sm"><caption className="sr-only">Account and group memberships</caption><thead className="border-b bg-muted/50"><tr><th className="px-3 py-2">Type</th><th className="px-3 py-2">Group</th><th className="px-3 py-2">State</th><th className="px-3 py-2">Added</th></tr></thead><tbody>{detail.memberships.map((membership) => <tr key={membership.membershipId} className="border-b last:border-0"><td className="px-3 py-2">{membership.groupType}</td><td className="px-3 py-2 font-mono text-xs">{membership.groupId}</td><td className="px-3 py-2">{membership.active ? 'active' : 'removed'}</td><td className="px-3 py-2">{dateTime(membership.addedAt)}</td></tr>)}</tbody></table>{!detail.memberships.length && <p className="p-4 text-sm text-muted-foreground">No account or group memberships are recorded.</p>}</div></TabsContent>
      {canManage && <TabsContent value="privacy" className="space-y-5"><div className="flex flex-wrap items-end gap-3"><div className="grid gap-1.5"><Label htmlFor="identity-purpose">360 access purpose</Label><select id="identity-purpose" className="h-9 rounded-md border bg-background px-3 text-sm" value={purpose} onChange={(event) => onPurpose(event.target.value as JourneyCustomer360Purpose)}>{journeyCustomer360Purposes.map((value) => <option key={value} value={value}>{purposeLabels[value]}</option>)}</select></div><Button variant="outline" disabled={busy || !customer360} onClick={() => void onExport()}><Download className="h-4 w-4" />Create JSON export</Button></div>
        {customer360 ? <div className="border px-4 py-3 text-sm"><h3 className="font-medium">Customer 360 derived view</h3><p className="mt-1 text-muted-foreground">Allowed for {purposeLabels[purpose].toLowerCase()}: {customer360.identitySummary.identifierCount} identifiers, {customer360.sessions.length} sessions, {customer360.segmentMemberships.length} segment memberships, {customer360.journeyInstances.length} journey instances.</p><p className="mt-2">Observed consent: {customer360.consentSummary.states.length ? customer360.consentSummary.states.map((row) => `${row.state} (${row.count})`).join(', ') : 'no consent observations'}</p></div> : <p className="border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"><ShieldAlert className="mr-2 inline h-4 w-4" />This purpose is denied, suppressed, or unavailable. Customer 360 data is not displayed.</p>}
        {exportJob && <p className="border px-4 py-3 text-sm">Latest profile export job: <span className={stateClass(exportJob.state)}>{exportJob.state}</span> · JSON · completed {dateTime(exportJob.completedAt)}.</p>}
        <PrivacyTable states={privacy} busy={busy} onChange={onPrivacy} />
        <form className="border p-4" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const operation = String(new FormData(event.currentTarget).get('operation')) as 'suppress' | 'erasure'; void onPrivacyJob(operation, reason); }}><h3 className="font-medium">Governed privacy job</h3><p className="mt-1 text-sm text-muted-foreground">Suppression blocks reads immediately. Erasure can remain queued while downstream cleanup is pending.</p><div className="mt-3 flex flex-wrap items-end gap-3"><div className="grid gap-1.5"><Label htmlFor="privacy-operation">Operation</Label><select id="privacy-operation" name="operation" className="h-9 rounded-md border bg-background px-3 text-sm"><option value="suppress">Suppress for selected purpose</option><option value="erasure">Request erasure for all purposes</option></select></div><div className="min-w-64 flex-1 grid gap-1.5"><Label htmlFor="privacy-reason">Reason</Label><Input id="privacy-reason" required maxLength={400} value={reason} onChange={(event) => setReason(event.target.value)} /></div><Button type="submit" variant="destructive" disabled={busy || !reason.trim()}>Start governed job</Button></div></form>
        {privacyJob && <p className={`border px-4 py-3 text-sm ${stateClass(privacyJob.state)}`}>Latest {privacyJob.operation} job: {privacyJob.state}. {privacyJob.completedAt ? `Completed ${dateTime(privacyJob.completedAt)}.` : 'Downstream cleanup remains pending.'}</p>}
        <div className="border"><div className="border-b px-4 py-3"><h3 className="font-medium">Correction runs</h3><p className="text-sm text-muted-foreground">Recomputed derived timelines, sessions, and segment membership after identity changes.</p></div>{corrections.length ? <ul className="divide-y">{corrections.map(({ run }) => <li key={run.id} className="flex flex-wrap justify-between gap-2 px-4 py-3 text-sm"><span>{run.reason.replaceAll('_', ' ')} · command {run.commandId}</span><span>{run.state} {dateTime(run.completedAt)}</span></li>)}</ul> : <p className="p-4 text-sm text-muted-foreground">No correction runs are recorded.</p>}</div>
      </TabsContent>}
    </Tabs>
  </div>;
}

function GroupsWorkspace({ groups, selected, account360, purpose, canManage, busy, onPurpose, onSelect, onCreate }: {
  groups: JourneyIdentityGroup[]; selected: JourneyIdentityGroupDetail | null; account360: Account360 | null;
  purpose: JourneyCustomer360Purpose; canManage: boolean; busy: boolean; onPurpose: (purpose: JourneyCustomer360Purpose) => void;
  onSelect: (id: string) => void; onCreate: (input: { id: string; groupType: 'account' | 'group'; name: string; externalRef?: string | null }) => Promise<void>;
}) {
  const [id, setId] = useState(''); const [name, setName] = useState(''); const [groupType, setGroupType] = useState<'account' | 'group'>('account');
  return <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.7fr)]"><div className="max-w-full overflow-x-auto border"><table className="w-full min-w-[620px] text-left text-sm"><caption className="sr-only">Accounts and identity groups</caption><thead className="border-b bg-muted/50"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Members</th><th className="px-3 py-2">External reference</th></tr></thead><tbody>{groups.map((group) => <tr key={group.id} className="border-b last:border-0"><td className="px-3 py-2"><button className="font-medium hover:underline" onClick={() => onSelect(group.id)}>{group.name}</button></td><td className="px-3 py-2">{group.groupType}</td><td className="px-3 py-2">{group.activeMemberCount}</td><td className="px-3 py-2">{group.externalRef || '—'}</td></tr>)}</tbody></table>{!groups.length && <p className="p-4 text-sm text-muted-foreground">No accounts or groups have been created.</p>}</div>
    <div className="space-y-5">{selected && <section className="border p-4"><h2 className="font-semibold">{selected.group.name}</h2><p className="mt-1 text-sm text-muted-foreground">{selected.group.groupType} · {selected.memberships.filter((row) => row.active).length} active memberships</p><ul className="mt-3 divide-y border-t">{selected.members.map((member) => <li key={member.profileId} className="py-2 font-mono text-xs">{member.profileId} <span className="font-sans text-muted-foreground">({member.kind})</span></li>)}</ul>{!selected.members.length && <p className="mt-3 text-sm text-muted-foreground">No members are recorded.</p>}{selected.group.groupType === 'account' && canManage && <div className="mt-4 border-t pt-4"><div className="grid gap-1.5"><Label htmlFor="account-purpose">Account 360 purpose</Label><select id="account-purpose" className="h-9 rounded-md border bg-background px-3 text-sm" value={purpose} onChange={(event) => onPurpose(event.target.value as JourneyCustomer360Purpose)}>{journeyCustomer360Purposes.map((value) => <option key={value} value={value}>{purposeLabels[value]}</option>)}</select></div>{account360 ? <p className="mt-3 text-sm">Purpose-allowed account 360: {account360.memberCount} members, {account360.segmentMemberships.length} segments, {account360.journeyInstances.length} journey instances, and {account360.timeline.length} interactions.</p> : <p className="mt-3 text-sm text-destructive">Account 360 is unavailable for this purpose or is still loading.</p>}</div>}</section>}
      {canManage && <form className="border p-4" onSubmit={(event) => { event.preventDefault(); void onCreate({ id: id.trim(), name: name.trim(), groupType }); }}><h2 className="font-semibold">Create account or group</h2><div className="mt-3 grid gap-3"><div className="grid gap-1.5"><Label htmlFor="group-type">Type</Label><select id="group-type" className="h-9 rounded-md border bg-background px-3 text-sm" value={groupType} onChange={(event) => setGroupType(event.target.value as 'account' | 'group')}><option value="account">Account</option><option value="group">Group</option></select></div><div className="grid gap-1.5"><Label htmlFor="group-id">Stable ID</Label><Input id="group-id" required maxLength={128} value={id} onChange={(event) => setId(event.target.value)} /></div><div className="grid gap-1.5"><Label htmlFor="group-name">Name</Label><Input id="group-name" required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} /></div><Button type="submit" disabled={busy || !id.trim() || !name.trim()}>Create</Button></div></form>}</div></div>;
}

function SegmentsWorkspace({ segments, selected, canManage, busy, onSelect, onCreate }: {
  segments: JourneyIdentitySegment[]; selected: JourneyIdentitySegmentDetail | null; canManage: boolean; busy: boolean;
  onSelect: (id: string) => void; onCreate: (name: string, kind: 'anonymous' | 'known') => Promise<void>;
}) {
  const [name, setName] = useState(''); const [kind, setKind] = useState<'anonymous' | 'known'>('known');
  return <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.7fr)]"><div className="max-w-full overflow-x-auto border"><table className="w-full min-w-[620px] text-left text-sm"><caption className="sr-only">Deterministic identity segments and materialized membership</caption><thead className="border-b bg-muted/50"><tr><th className="px-3 py-2">Segment</th><th className="px-3 py-2">State</th><th className="px-3 py-2">Rule version</th><th className="px-3 py-2">Members</th></tr></thead><tbody>{segments.map((segment) => <tr key={segment.id} className="border-b last:border-0"><td className="px-3 py-2"><button className="font-medium hover:underline" onClick={() => onSelect(segment.id)}>{segment.name}</button><p className="text-xs text-muted-foreground">{segment.description}</p></td><td className="px-3 py-2">{segment.state}</td><td className="px-3 py-2">{segment.activeVersionNumber}</td><td className="px-3 py-2">{segment.materializedMemberCount}</td></tr>)}</tbody></table>{!segments.length && <p className="p-4 text-sm text-muted-foreground">No deterministic segments have been created.</p>}</div>
    <div className="space-y-5">{selected && <section className="border p-4"><h2 className="font-semibold">{selected.segment.name}</h2><p className="mt-1 text-sm text-muted-foreground">Materialized from version {selected.activeVersion?.versionNumber || '—'}; membership is a derived result, not an observed identity fact.</p><ul className="mt-3 divide-y border-t">{selected.memberships.map((member) => <li key={member.id} className="py-2 font-mono text-xs">{member.profileId}</li>)}</ul>{!selected.memberships.length && <p className="mt-3 text-sm text-muted-foreground">No profiles currently match.</p>}</section>}
      {canManage && <form className="border p-4" onSubmit={(event) => { event.preventDefault(); void onCreate(name.trim(), kind); }}><h2 className="font-semibold">Create deterministic segment</h2><div className="mt-3 grid gap-3"><div className="grid gap-1.5"><Label htmlFor="segment-name">Name</Label><Input id="segment-name" required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} /></div><div className="grid gap-1.5"><Label htmlFor="segment-kind">Profile type rule</Label><select id="segment-kind" className="h-9 rounded-md border bg-background px-3 text-sm" value={kind} onChange={(event) => setKind(event.target.value as 'anonymous' | 'known')}><option value="known">Known</option><option value="anonymous">Anonymous</option></select></div><Button type="submit" disabled={busy || !name.trim()}>Create</Button></div></form>}</div></div>;
}

export function JourneyIdentityPage() {
  const enabled = useSessionFeature('journeyProfiles'); const session = useAuthSession();
  const canManage = Boolean(session?.activeSpace && session.activeSpace.role !== 'member');
  const [profiles, setProfiles] = useState<JourneyIdentityProfile[]>([]); const [groups, setGroups] = useState<JourneyIdentityGroup[]>([]); const [segments, setSegments] = useState<JourneyIdentitySegment[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState(''); const [detail, setDetail] = useState<JourneyIdentityProfileDetail | null>(null); const [timeline, setTimeline] = useState<Timeline>([]); const [sessions, setSessions] = useState<Sessions>([]);
  const [selectedGroup, setSelectedGroup] = useState<JourneyIdentityGroupDetail | null>(null); const [selectedSegment, setSelectedSegment] = useState<JourneyIdentitySegmentDetail | null>(null);
  const [account360, setAccount360] = useState<Account360 | null>(null);
  const [purpose, setPurpose] = useState<JourneyCustomer360Purpose>('analytics'); const [customer360, setCustomer360] = useState<JourneyProfile360 | null>(null); const [privacy, setPrivacy] = useState<JourneyProfilePrivacyState[]>([]); const [corrections, setCorrections] = useState<JourneyIdentityCorrectionEntry[]>([]); const [privacyJob, setPrivacyJob] = useState<JourneyProfilePrivacyJob | null>(null);
  const [exportJob, setExportJob] = useState<JourneyProfileExportJob | null>(null);
  const [audits, setAudits] = useState<JourneyIdentityAudit[]>([]); const [commandOutcome, setCommandOutcome] = useState<JourneyIdentityCommandResult['result'] | null>(null);
  const [profileRevision, setProfileRevision] = useState(0);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const load = useCallback(async () => { if (!enabled) return; setLoading(true); setError(''); try { const [profileResult, groupResult, segmentResult, auditResult] = await Promise.all([listJourneyIdentityProfiles(), listJourneyIdentityGroups(), listJourneyIdentitySegments(), listJourneyIdentityAudit()]); setProfiles(profileResult.profiles); setGroups(groupResult.groups); setSegments(segmentResult.segments); setAudits(auditResult.audit); setSelectedProfileId((current) => profileResult.profiles.some((row) => row.profileId === current) ? current : profileResult.profiles[0]?.profileId || ''); } catch (reason) { setError(message(reason, 'Identity workspace could not be loaded.')); } finally { setLoading(false); } }, [enabled]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!selectedProfileId) { setDetail(null); return; } let active = true; setError(''); const common = Promise.all([readJourneyIdentityProfile(selectedProfileId), listJourneyProfileTimeline(selectedProfileId), listJourneyProfileSessions(selectedProfileId)]); const managed = canManage ? Promise.all([listJourneyProfilePrivacy(selectedProfileId), listJourneyIdentityCorrectionRuns(selectedProfileId), readJourneyProfile360(selectedProfileId, purpose).catch(() => null)]) : Promise.resolve(null); Promise.all([common, managed]).then(([base, governed]) => { if (!active) return; setDetail(base[0]); setTimeline(base[1].events); setSessions(base[2].sessions); if (governed) { setPrivacy(governed[0].states); setCorrections(governed[1].runs); setCustomer360(governed[2]); } else { setCorrections([]); } }).catch((reason) => { if (active) setError(message(reason, 'Profile detail could not be loaded.')); }); return () => { active = false; }; }, [canManage, profileRevision, purpose, selectedProfileId]);
  useEffect(() => { if (!canManage || selectedGroup?.group.groupType !== 'account') { setAccount360(null); return; } let active = true; readJourneyAccount360(selectedGroup.group.id, purpose).then((value) => { if (active) setAccount360(value); }).catch(() => { if (active) setAccount360(null); }); return () => { active = false; }; }, [canManage, purpose, selectedGroup]);
  const mutate = useCallback(async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); await load(); } catch (reason) { setError(message(reason, 'The identity change could not be completed.')); throw reason; } finally { setBusy(false); } }, [load]);
  const refreshCorrectionStatus = useCallback(async () => { await load(); setProfileRevision((value) => value + 1); }, [load]);
  const runIdentityCommand = useCallback(async (action: () => Promise<JourneyIdentityCommandResult>) => { setBusy(true); setError(''); try { const transition = await action(); setCommandOutcome(transition.result); await refreshCorrectionStatus(); return transition.result.status !== 'rejected'; } catch (reason) { setError(identityCommandMessage(reason)); return false; } finally { setBusy(false); } }, [refreshCorrectionStatus]);
  const selectedProfile = useMemo(() => profiles.find((row) => row.profileId === selectedProfileId) || null, [profiles, selectedProfileId]);
  if (!enabled) return null;
  if (loading && !profiles.length) return <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />Loading customer identities…</div>;
  return <div className="mx-auto w-full max-w-[1440px] space-y-5 p-4 sm:p-6"><header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">Customer identities</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Inspect deterministic profile resolution, customer and account context, interactions, consent, and governed privacy work.</p></div><Button variant="outline" onClick={() => void load()} disabled={loading || busy}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</Button></header>
    {!canManage && <p className="border px-4 py-3 text-sm text-muted-foreground">You have read-only access. Profile facts, interactions, sessions, groups, and segments remain inspectable; customer 360 and privacy controls require an owner or administrator.</p>}
    {error && <div role="alert" className="border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>}
    <Tabs defaultValue="profiles"><TabsList aria-label="Customer identity workspace views" className="max-w-full gap-4 overflow-x-auto"><TabsTrigger className="shrink-0" value="profiles">Profiles</TabsTrigger><TabsTrigger className="shrink-0" value="groups">Accounts and groups</TabsTrigger><TabsTrigger className="shrink-0" value="segments">Segments</TabsTrigger></TabsList>
      <TabsContent value="profiles" className="space-y-5"><ProfileList profiles={profiles} selectedId={selectedProfileId} onSelect={(id) => { setExportJob(null); setPrivacyJob(null); setCommandOutcome(null); setSelectedProfileId(id); }} />{selectedProfile && detail && <><ProfileDetail detail={detail} timeline={timeline} sessions={sessions} customer360={customer360} privacy={privacy} corrections={corrections} canManage={canManage} purpose={purpose} busy={busy} privacyJob={privacyJob} exportJob={exportJob} onPurpose={setPurpose} onPrivacy={async (state, next) => { try { await mutate(() => updateJourneyProfilePrivacy(state.profileId, { purpose: state.purpose, state: next, lawfulBasis: state.lawfulBasis, policyReference: state.policyReference })); setPrivacy((rows) => rows.map((row) => row.purpose === state.purpose ? { ...row, state: next } : row)); } catch { /* Page alert owns the failure. */ } }} onExport={async () => { setBusy(true); setError(''); try { const result = await createJourneyProfileExport(selectedProfile.profileId, purpose); setExportJob(result.job); } catch (cause) { setError(message(cause, 'Profile export job could not be created.')); } finally { setBusy(false); } }} onPrivacyJob={async (operation, reason) => { setBusy(true); setError(''); try { const result = await createJourneyProfilePrivacyJob(selectedProfile.profileId, { operation, purpose: operation === 'suppress' ? purpose : null, reason }); setPrivacyJob(result.job); await load(); } catch (cause) { setError(message(cause, 'Privacy job could not be created.')); } finally { setBusy(false); } }} /><JourneyIdentityCorrectionWorkspace profiles={profiles} detail={detail} canManage={canManage} busy={busy} audits={audits} corrections={corrections} outcome={commandOutcome} onRefresh={refreshCorrectionStatus} onMerge={(input) => runIdentityCommand(() => mergeJourneyIdentityProfiles(input))} onSplit={(input) => runIdentityCommand(() => splitJourneyIdentityMerge(input))} /></>}{!selectedProfile && !loading && <Empty>No profiles are available.</Empty>}</TabsContent>
      <TabsContent value="groups"><GroupsWorkspace groups={groups} selected={selectedGroup} account360={account360} purpose={purpose} canManage={canManage} busy={busy} onPurpose={setPurpose} onSelect={(id) => { setAccount360(null); void readJourneyIdentityGroup(id).then(setSelectedGroup).catch((reason) => setError(message(reason, 'Account or group could not be loaded.'))); }} onCreate={async (input) => { try { await mutate(() => createJourneyIdentityGroup(input)); } catch { /* Page alert owns the failure. */ } }} /></TabsContent>
      <TabsContent value="segments"><SegmentsWorkspace segments={segments} selected={selectedSegment} canManage={canManage} busy={busy} onSelect={(id) => { void readJourneyIdentitySegment(id).then(setSelectedSegment).catch((reason) => setError(message(reason, 'Segment could not be loaded.'))); }} onCreate={async (name, kind) => { try { await mutate(() => createJourneyIdentitySegment({ name, description: '', rule: { match: 'all', clauses: [{ field: 'profile.kind', op: 'eq', value: kind }] } })); } catch { /* Page alert owns the failure. */ } }} /></TabsContent>
    </Tabs>
  </div>;
}
