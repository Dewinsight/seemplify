import { useEffect, useRef, useState } from 'react';
import { Copy, Download, KeyRound } from 'lucide-react';
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
import type { JourneyIssuedCredential } from '@/lib/journeyEventControlPlane';

export function CredentialSecretDialog({ issued, sourceName, onDismiss }: {
  issued: JourneyIssuedCredential;
  sourceName: string;
  onDismiss: () => void;
}) {
  const secretRef = useRef<HTMLInputElement>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => secretRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(issued.secret);
      setNotice('Credential copied.');
    } catch {
      secretRef.current?.select();
      setNotice('Select and copy the credential from the field.');
    }
  }

  function download() {
    const safeName = sourceName.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '') || 'event-source';
    const content = [
      '# Seemplify Journey event credential',
      `# Source: ${sourceName}`,
      `# Prefix: ${issued.credential.displayPrefix}`,
      '# Store this value in a secret manager. It will not be shown again.',
      issued.secret,
      ''
    ].join('\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeName}-journey-credential.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice('Credential file downloaded. Remove it from Downloads after storing it securely.');
  }

  function close() {
    if (!acknowledged) return;
    setNotice('');
    onDismiss();
  }

  return <Dialog open onOpenChange={(next) => { if (!next) close(); }}>
    <DialogContent
      className="sm:max-w-xl"
      showCloseButton={false}
      onEscapeKeyDown={(event) => { if (!acknowledged) event.preventDefault(); }}
      onPointerDownOutside={(event) => event.preventDefault()}
    >
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" />Save this credential now</DialogTitle>
        <DialogDescription>This secret is shown once. Seemplify stores only a one-way digest and cannot recover it later.</DialogDescription>
      </DialogHeader>
      <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950" role="alert">
        Treat this as a password. Do not paste it into source code, tickets, chat, analytics, or client-side logs.
      </div>
      <div>
        <Label className="field-label" htmlFor="issued-event-credential">New credential</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input ref={secretRef} id="issued-event-credential" readOnly value={issued.secret} onFocus={(event) => event.currentTarget.select()} className="font-mono text-xs" />
          <Button type="button" variant="outline" onClick={() => void copy()}><Copy />Copy</Button>
          <Button type="button" variant="outline" onClick={download}><Download />Download</Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Safe history label: <span className="font-mono text-foreground">{issued.credential.displayPrefix}</span></p>
      </div>
      <label className="flex cursor-pointer items-start gap-3 border px-3 py-3 text-sm">
        <input type="checkbox" className="mt-0.5 rounded border-input text-primary focus:ring-ring" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
        <span>I stored this credential securely and understand it will be removed from this screen.</span>
      </label>
      <p className="min-h-5 text-xs text-muted-foreground" aria-live="polite">{notice}</p>
      <DialogFooter>
        <Button type="button" disabled={!acknowledged} onClick={close}>Dismiss secret</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
