import { useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import {
  createJourneyEventSource,
  type JourneyEventEnvironment,
  type JourneyEventSource,
  type JourneyEventValidationMode
} from '@/lib/journeyEventControlPlane';
import { controlSelectClass } from '@/components/journey-events/shared';

function lines(value: string) {
  return [...new Set(value.split(/\r?\n|,/u).map((item) => item.trim()).filter(Boolean))];
}

export function CreateEventSourceDialog({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated: (source: JourneyEventSource) => void;
}) {
  const [name, setName] = useState('');
  const [environment, setEnvironment] = useState<JourneyEventEnvironment>('development');
  const [validationMode, setValidationMode] = useState<JourneyEventValidationMode>('observe');
  const [allowedOrigins, setAllowedOrigins] = useState('http://localhost:3000');
  const [allowedBundleIds, setAllowedBundleIds] = useState('');
  const [eventsPerMinute, setEventsPerMinute] = useState(1_000);
  const [bytesPerMinute, setBytesPerMinute] = useState(5_000_000);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || working) return;
    try {
      setWorking(true);
      setError('');
      const result = await createJourneyEventSource({
        name: name.trim(),
        environment,
        validationMode,
        allowedOrigins: lines(allowedOrigins),
        allowedBundleIds: lines(allowedBundleIds),
        eventsPerMinute,
        bytesPerMinute
      });
      onCreated(result.source);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The event source could not be created.');
    } finally {
      setWorking(false);
    }
  }

  return <Dialog open={open} onOpenChange={(next) => { if (!next && !working) onClose(); }}>
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Create event source</DialogTitle>
        <DialogDescription>Use one source for each application and environment. Browser origins and mobile bundle IDs are checked at ingestion.</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={submit}>
        <div>
          <Label className="field-label" htmlFor="event-source-name">Source name</Label>
          <Input id="event-source-name" autoFocus required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Customer portal — development" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="field-label" htmlFor="event-source-environment">Environment</Label>
            <select id="event-source-environment" className={controlSelectClass} value={environment} onChange={(event) => setEnvironment(event.target.value as JourneyEventEnvironment)}>
              <option value="development">Development</option>
              <option value="staging">Staging</option>
              <option value="production">Production</option>
            </select>
          </div>
          <div>
            <Label className="field-label" htmlFor="event-source-validation">Validation mode</Label>
            <select id="event-source-validation" className={controlSelectClass} value={validationMode} onChange={(event) => setValidationMode(event.target.value as JourneyEventValidationMode)}>
              <option value="observe">Observe — record issues</option>
              <option value="warn">Warn — accept and flag</option>
              <option value="enforce">Enforce — reject invalid events</option>
            </select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="field-label" htmlFor="event-source-origins">Allowed browser origins</Label>
            <Textarea id="event-source-origins" rows={4} value={allowedOrigins} onChange={(event) => setAllowedOrigins(event.target.value)} placeholder={'https://app.example.com\nhttp://localhost:3000'} aria-describedby="event-source-origins-help" />
            <p id="event-source-origins-help" className="mt-1 text-xs leading-5 text-muted-foreground">One exact origin per line. HTTP is limited to loopback development origins.</p>
          </div>
          <div>
            <Label className="field-label" htmlFor="event-source-bundles">Allowed app bundle IDs</Label>
            <Textarea id="event-source-bundles" rows={4} value={allowedBundleIds} onChange={(event) => setAllowedBundleIds(event.target.value)} placeholder={'com.example.ios\ncom.example.android'} aria-describedby="event-source-bundles-help" />
            <p id="event-source-bundles-help" className="mt-1 text-xs leading-5 text-muted-foreground">Optional. Enter iOS bundle IDs and Android application IDs, one per line.</p>
          </div>
        </div>
        <fieldset className="grid gap-4 border-0 p-0 sm:grid-cols-2">
          <legend className="sr-only">Source rate policy</legend>
          <div>
            <Label className="field-label" htmlFor="event-source-rate">Events per minute</Label>
            <Input id="event-source-rate" type="number" min={1} max={10_000_000} required value={eventsPerMinute} onChange={(event) => setEventsPerMinute(event.currentTarget.valueAsNumber || 1)} />
          </div>
          <div>
            <Label className="field-label" htmlFor="event-source-bytes">Bytes per minute</Label>
            <Input id="event-source-bytes" type="number" min={1} max={10_000_000_000} required value={bytesPerMinute} onChange={(event) => setBytesPerMinute(event.currentTarget.valueAsNumber || 1)} />
          </div>
        </fieldset>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={working} onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={working || !name.trim()}>
            {working && <LoaderCircle className="animate-spin" />}Create source
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
