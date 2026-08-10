import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthSession } from '@/lib/authSessionContext';
import { api, ApiError } from '@/lib/api';
import {
  killSwitchReasons, listJourneyKillSwitchAudit, listJourneyKillSwitches, listJourneyKillSwitchPauses,
  readPlatformKillSwitch, reviewedAdapters, setPlatformKillSwitch, setScopedKillSwitch, setSpaceKillSwitch,
  type KillSwitchList, type KillSwitchReason, type KillSwitchState, type ScopedKillSwitchLevel
} from '@/lib/journeyKillSwitches';
import type { AuthSession } from '@/types';

const selectClass = 'mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm';
const reasonLabel = (value: string) => value.replaceAll('_',' ').replace(/^./, (letter) => letter.toUpperCase());

function StateRow({ record, canManage, busy, onChange }: { record: KillSwitchState; canManage: boolean; busy: boolean;
  onChange: (record: KillSwitchState, next: 'enabled' | 'disabled') => void }) {
  return <tr className="border-t"><td className="px-3 py-3"><span className="font-medium capitalize">{record.scopeLevel}</span>
    <span className="mt-0.5 block max-w-[320px] truncate font-mono text-xs text-muted-foreground">{record.scopeKey}</span></td>
    <td className="px-3 py-3 text-sm capitalize">{record.state}</td><td className="px-3 py-3 text-sm">{reasonLabel(record.reasonCode)}</td>
    <td className="px-3 py-3 text-sm">{record.revision}</td><td className="px-3 py-3 text-right">{canManage && <Button size="sm"
      variant={record.state === 'enabled' ? 'destructive' : 'outline'} disabled={busy}
      onClick={() => onChange(record, record.state === 'enabled' ? 'disabled' : 'enabled')}>
      {record.state === 'enabled' ? 'Disable' : 'Enable'}</Button>}</td></tr>;
}

export function JourneyKillSwitchPage() {
  const contextSession = useAuthSession(); const [session, setSession] = useState<AuthSession | null>(contextSession);
  const [data, setData] = useState<KillSwitchList | null>(null); const [platform, setPlatform] = useState<KillSwitchState | null>(null);
  const [pauses, setPauses] = useState<Array<{id:string;queueId:string;previousState:string;leaseReleased:boolean;reasonCode:string;resumption:string|null}>>([]);
  const [auditCount, setAuditCount] = useState(0); const [error, setError] = useState(''); const [busy, setBusy] = useState('');
  const [reason, setReason] = useState<KillSwitchReason>('operational_incident');
  const [level, setLevel] = useState<ScopedKillSwitchLevel>('workflow'); const [scopeKey, setScopeKey] = useState('');
  const canManage = Boolean(session?.activeSpace && session.activeSpace.role !== 'member');
  const platformAdmin = Boolean(session?.permissions?.platformAdmin);

  const load = useCallback(async () => {
    setBusy('load'); setError('');
    try {
      const activeSession = contextSession || await api<AuthSession>('/api/auth/session'); setSession(activeSession);
      const [switches, pauseResult, auditResult, platformResult] = await Promise.all([
        listJourneyKillSwitches(), listJourneyKillSwitchPauses(), listJourneyKillSwitchAudit(),
        activeSession.permissions?.platformAdmin ? readPlatformKillSwitch() : Promise.resolve(null)
      ]);
      setData(switches); setPauses(pauseResult.pauses); setAuditCount(auditResult.events.length);
      setPlatform(platformResult?.switch || null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load journey safety switches.'); }
    finally { setBusy(''); }
  }, [contextSession]);
  useEffect(() => { void load(); }, [load]);

  async function mutate(label: string, operation: () => Promise<unknown>, disabling: boolean) {
    if (disabling && !window.confirm('Disable this scope and pause matching pending work? Active leases will be released.')) return;
    setBusy(label); setError('');
    try { await operation(); toast.success(disabling ? 'Matching work paused.' : 'Scope re-evaluated.'); await load(); }
    catch (cause) { const message = cause instanceof ApiError && cause.status === 409
      ? 'This switch changed elsewhere. Refresh and try again.' : cause instanceof Error ? cause.message : 'The switch could not be changed.';
      setError(message); }
    finally { setBusy(''); }
  }
  function changeScoped(record: KillSwitchState, next: 'enabled' | 'disabled') {
    void mutate(`${record.scopeLevel}:${record.scopeKey}`,
      () => setScopedKillSwitch(record.scopeLevel as ScopedKillSwitchLevel, record.scopeKey, record, next,
        next === 'enabled' ? 'recovery_verified' : reason), next === 'disabled');
  }
  function createScoped() {
    const key = scopeKey.trim(); if (!key) return;
    void mutate(`new:${level}:${key}`, () => setScopedKillSwitch(level, key, null, 'disabled', reason), true);
  }
  if (!data && busy === 'load') return <div className="grid min-h-64 place-items-center text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Loading journey safety switches</div>;

  return <div className="min-w-0 space-y-5" data-testid="journey-kill-switch-workspace">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">Journey safety switches</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Pause workflow delivery by platform, space, workflow, reviewed adapter, or hashed profile scope.</p></div>
      <Button variant="outline" disabled={busy === 'load'} onClick={() => void load()}><RefreshCw className={busy === 'load' ? 'animate-spin' : ''} />Refresh</Button></header>
    <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"><div className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>Disabling a scope immediately holds matching ready work and releases active leases with a new fencing token. Enabling never bypasses another switch, safety gate, or paused workflow.</div></div></div>
    {!canManage && <div className="border bg-muted/40 px-4 py-3 text-sm">Read-only: only space owners and administrators can change space, workflow, adapter, or profile switches.</div>}
    {error && <div role="alert" className="border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>}
    <section className="border bg-card" aria-labelledby="space-switch-heading"><div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 id="space-switch-heading" className="font-medium">Space switch</h2><p className="mt-1 text-xs text-muted-foreground">Current space only. Revision {data?.scopes.find((item) => item.scopeLevel === 'space')?.revision || 0}.</p></div>
      {canManage && <Button size="sm" variant={data?.scopes.find((item) => item.scopeLevel === 'space')?.state === 'disabled' ? 'outline' : 'destructive'} disabled={Boolean(busy)} onClick={() => {
        const current = data?.scopes.find((item) => item.scopeLevel === 'space') || null; const next = current?.state === 'disabled' ? 'enabled' : 'disabled';
        void mutate('space', () => setSpaceKillSwitch(current, next, next === 'enabled' ? 'recovery_verified' : reason), next === 'disabled');
      }}>{data?.scopes.find((item) => item.scopeLevel === 'space')?.state === 'disabled' ? 'Enable space' : 'Disable space'}</Button>}</div></section>
    {platformAdmin && <section className="border bg-card" aria-labelledby="platform-switch-heading"><div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 id="platform-switch-heading" className="font-medium">Platform switch</h2><p className="mt-1 text-xs text-muted-foreground">Platform administrators only. This affects every space.</p></div>
      <Button size="sm" variant={platform?.state === 'disabled' ? 'outline' : 'destructive'} disabled={Boolean(busy)} onClick={() => { const next = platform?.state === 'disabled' ? 'enabled' : 'disabled';
        void mutate('platform', () => setPlatformKillSwitch(platform, next, next === 'enabled' ? 'recovery_verified' : reason), next === 'disabled'); }}>
        {platform?.state === 'disabled' ? 'Enable platform' : 'Disable platform'}</Button></div></section>}
    {canManage && <section className="border bg-card" aria-labelledby="new-scope-heading"><div className="border-b px-4 py-3"><h2 id="new-scope-heading" className="font-medium">Disable a narrower scope</h2></div>
      <div className="grid gap-4 p-4 md:grid-cols-[180px_minmax(0,1fr)_220px_auto] md:items-end"><div><Label htmlFor="switch-level">Level</Label><select id="switch-level" className={selectClass} value={level} onChange={(event) => { setLevel(event.target.value as ScopedKillSwitchLevel); setScopeKey(''); }}>
        <option value="workflow">Workflow</option><option value="adapter">Adapter</option><option value="profile">Profile hash</option></select></div>
      <div><Label htmlFor="switch-scope">Scope</Label>{level === 'adapter' ? <select id="switch-scope" className={selectClass} value={scopeKey} onChange={(event) => setScopeKey(event.target.value)}><option value="">Select adapter</option>{reviewedAdapters.map((adapter) => <option key={adapter} value={adapter}>{reasonLabel(adapter)}</option>)}</select>
        : <Input id="switch-scope" className="mt-2" value={scopeKey} onChange={(event) => setScopeKey(event.target.value)} placeholder={level === 'profile' ? '64-character SHA-256 profile reference' : 'Workflow ID'} />}</div>
      <div><Label htmlFor="switch-reason">Reason</Label><select id="switch-reason" className={selectClass} value={reason} onChange={(event) => setReason(event.target.value as KillSwitchReason)}>{killSwitchReasons.filter((item) => item !== 'recovery_verified').map((item) => <option key={item} value={item}>{reasonLabel(item)}</option>)}</select></div>
      <Button disabled={Boolean(busy) || !scopeKey.trim()} onClick={createScoped}><ShieldAlert />Disable scope</Button></div></section>}
    <section className="overflow-hidden border bg-card" aria-labelledby="configured-scopes-heading"><div className="border-b px-4 py-3"><h2 id="configured-scopes-heading" className="font-medium">Configured scopes</h2></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left"><thead><tr className="text-xs text-muted-foreground"><th className="px-3 py-2 font-medium">Scope</th><th className="px-3 py-2 font-medium">State</th><th className="px-3 py-2 font-medium">Reason</th><th className="px-3 py-2 font-medium">Revision</th><th className="px-3 py-2"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{data?.scopes.length ? data.scopes.map((record) => <StateRow key={`${record.scopeLevel}:${record.scopeKey}`} record={record} canManage={canManage} busy={Boolean(busy)} onChange={changeScoped} />)
          : <tr className="border-t"><td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">No space-scoped switches have been configured.</td></tr>}</tbody></table></div></section>
    <section className="border bg-card" aria-labelledby="pause-history-heading"><div className="border-b px-4 py-3"><h2 id="pause-history-heading" className="font-medium">Pending-work history</h2><p className="mt-1 text-xs text-muted-foreground">{pauses.length} recorded transitions · {auditCount} recent audit events</p></div>
      <div className="divide-y">{pauses.slice(0,8).map((pause) => <div key={pause.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_160px_160px]"><span className="truncate font-mono text-xs">{pause.queueId}</span><span>{pause.leaseReleased ? 'Lease released' : `Paused from ${pause.previousState}`}</span><span className="text-muted-foreground">{pause.resumption ? reasonLabel(pause.resumption) : 'Held'}</span></div>)}
        {!pauses.length && <p className="px-4 py-6 text-sm text-muted-foreground">No pending work has been paused by these switches.</p>}</div></section>
  </div>;
}
