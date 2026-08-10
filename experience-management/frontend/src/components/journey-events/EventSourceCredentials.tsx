import { useCallback, useEffect, useState } from 'react';
import { KeyRound, LoaderCircle, RefreshCw, RotateCw, ShieldX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  createJourneyEventCredential,
  listJourneyEventCredentials,
  revokeJourneyEventCredential,
  rotateJourneyEventCredential,
  type JourneyEventCredential,
  type JourneyEventCredentialKind,
  type JourneyEventSource,
  type JourneyIssuedCredential
} from '@/lib/journeyEventControlPlane';
import {
  ConfirmationDialog,
  controlSelectClass,
  formatControlPlaneDate,
  SectionFrame,
  StatusLabel
} from '@/components/journey-events/shared';

function credentialKind(kind: JourneyEventCredentialKind) {
  return kind === 'public_write' ? 'Public write key' : 'Server secret';
}

export function EventSourceCredentials({ source, canManage, onIssued }: {
  source: JourneyEventSource;
  canManage: boolean;
  onIssued: (issued: JourneyIssuedCredential) => void;
}) {
  const [credentials, setCredentials] = useState<JourneyEventCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [kind, setKind] = useState<JourneyEventCredentialKind>('public_write');
  const [rotateTarget, setRotateTarget] = useState<JourneyEventCredential | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<JourneyEventCredential | null>(null);
  const [overlapHours, setOverlapHours] = useState(1);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const result = await listJourneyEventCredentials(source.id);
      setCredentials(result.credentials);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Credential history could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [source.id]);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    if (!canManage || source.status !== 'active' || working) return;
    try {
      setWorking(true);
      setError('');
      const result = await createJourneyEventCredential(source.id, kind);
      setCreateOpen(false);
      await load();
      if (!result.secret) throw new Error('This credential request was already completed, so its one-time secret cannot be shown. Rotate the listed credential to issue a new secret.');
      onIssued({ secret: result.secret, credential: result.credential });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The credential could not be created.');
    } finally {
      setWorking(false);
    }
  }

  async function rotate() {
    if (!canManage || !rotateTarget || source.status !== 'active' || working) return;
    try {
      setWorking(true);
      setError('');
      const result = await rotateJourneyEventCredential(rotateTarget.id, Math.round(overlapHours * 3_600));
      setRotateTarget(null);
      await load();
      if (!result.secret) throw new Error('This rotation was already completed, so its one-time secret cannot be shown. Start a new rotation to issue another secret.');
      onIssued({ secret: result.secret, credential: result.credential });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The credential could not be rotated.');
    } finally {
      setWorking(false);
    }
  }

  async function revoke() {
    if (!canManage || !revokeTarget || working) return;
    try {
      setWorking(true);
      setError('');
      await revokeJourneyEventCredential(revokeTarget.id);
      setRevokeTarget(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The credential could not be revoked.');
    } finally {
      setWorking(false);
    }
  }

  const createAction = canManage && source.status === 'active'
    ? <Button size="sm" onClick={() => setCreateOpen(true)}><KeyRound />Create credential</Button>
    : undefined;

  return <>
    <SectionFrame
      title="Credentials"
      description="Only prefixes and lifecycle metadata are retained. Full secrets appear once when created or rotated."
      action={createAction}
    >
      {error && <div className="border-b bg-red-50 px-4 py-3 text-sm text-destructive" role="alert">{error}</div>}
      {loading ? <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />Loading credentials…</div>
        : credentials.length === 0 ? <div className="px-5 py-8">
          <p className="text-sm font-medium">No credentials yet</p>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">Create a public write key for browser or mobile SDKs, or a server secret for trusted backend ingestion.</p>
        </div>
          : <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="data-table min-w-[820px]">
                <caption className="sr-only">Credential prefixes and lifecycle history for {source.name}</caption>
                <thead><tr><th scope="col">Prefix</th><th scope="col">Kind</th><th scope="col">Status</th><th scope="col">Created</th><th scope="col">Expires</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>{credentials.map((credential) => <tr key={credential.id}>
                  <td><code className="text-xs">{credential.displayPrefix}</code></td>
                  <td>{credentialKind(credential.kind)}</td>
                  <td><StatusLabel status={credential.status} /></td>
                  <td className="whitespace-nowrap text-xs text-muted-foreground">{formatControlPlaneDate(credential.createdAt)}</td>
                  <td className="whitespace-nowrap text-xs text-muted-foreground">{formatControlPlaneDate(credential.expiresAt)}</td>
                  <td className="text-right">{canManage && credential.status === 'active' && source.status === 'active' && <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => { setOverlapHours(1); setRotateTarget(credential); }}><RotateCw />Rotate</Button>
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setRevokeTarget(credential)}><ShieldX />Revoke</Button>
                  </div>}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <ul className="divide-y sm:hidden" aria-label={`Credential history for ${source.name}`}>
              {credentials.map((credential) => <li key={credential.id} className="space-y-3 px-4 py-4">
                <div className="flex items-start justify-between gap-3"><code className="break-all text-xs">{credential.displayPrefix}</code><StatusLabel status={credential.status} /></div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs"><div><dt className="text-muted-foreground">Kind</dt><dd className="mt-0.5">{credentialKind(credential.kind)}</dd></div><div><dt className="text-muted-foreground">Created</dt><dd className="mt-0.5">{formatControlPlaneDate(credential.createdAt)}</dd></div><div><dt className="text-muted-foreground">Expires</dt><dd className="mt-0.5">{formatControlPlaneDate(credential.expiresAt)}</dd></div></dl>
                {canManage && credential.status === 'active' && source.status === 'active' && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => { setOverlapHours(1); setRotateTarget(credential); }}><RotateCw />Rotate</Button><Button size="sm" variant="outline" className="text-destructive" onClick={() => setRevokeTarget(credential)}><ShieldX />Revoke</Button></div>}
              </li>)}
            </ul>
          </>}
      <div className="flex justify-end border-t px-4 py-3"><Button type="button" size="sm" variant="ghost" disabled={loading} onClick={() => void load()}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh</Button></div>
    </SectionFrame>

    <Dialog open={createOpen} onOpenChange={(next) => { if (!working) setCreateOpen(next); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Create credential</DialogTitle><DialogDescription>The complete secret will appear once after creation. Choose the narrowest credential that fits the integration.</DialogDescription></DialogHeader>
        <div>
          <Label className="field-label" htmlFor="credential-kind">Credential kind</Label>
          <select id="credential-kind" className={controlSelectClass} value={kind} onChange={(event) => setKind(event.target.value as JourneyEventCredentialKind)}>
            <option value="public_write">Public write key — browser and mobile SDKs</option>
            <option value="server_secret">Server secret — trusted backend only</option>
          </select>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Both credentials can only write events. They cannot read customer profiles, schemas, or workspace data.</p>
        </div>
        <DialogFooter><Button variant="outline" disabled={working} onClick={() => setCreateOpen(false)}>Cancel</Button><Button disabled={working} onClick={() => void create()}>{working ? 'Creating…' : 'Create credential'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(rotateTarget)} onOpenChange={(next) => { if (!next && !working) setRotateTarget(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Rotate credential</DialogTitle><DialogDescription>A new secret will be issued. The current credential can remain valid briefly so deployed clients can switch without dropping events.</DialogDescription></DialogHeader>
        <div><Label className="field-label" htmlFor="credential-overlap">Overlap hours</Label><Input id="credential-overlap" type="number" min={0} max={168} step={0.25} value={overlapHours} onChange={(event) => setOverlapHours(Math.max(0, Math.min(168, event.currentTarget.valueAsNumber || 0)))} /><p className="mt-1 text-xs text-muted-foreground">Use 0 to revoke the current credential immediately. Maximum overlap is 7 days.</p></div>
        <DialogFooter><Button variant="outline" disabled={working} onClick={() => setRotateTarget(null)}>Cancel</Button><Button disabled={working} onClick={() => void rotate()}>{working ? 'Rotating…' : 'Rotate credential'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <ConfirmationDialog
      open={Boolean(revokeTarget)}
      title="Revoke this credential?"
      description={`Requests using ${revokeTarget?.displayPrefix || 'this credential'} will fail immediately. This action cannot be undone.`}
      confirmLabel="Revoke credential"
      destructive
      busy={working}
      onCancel={() => setRevokeTarget(null)}
      onConfirm={() => void revoke()}
    />
  </>;
}
