import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  updateJourneyEventSource,
  type JourneyEventSource,
  type JourneyEventSourceStatus,
  type JourneyEventValidationMode
} from '@/lib/journeyEventControlPlane';
import { ConfirmationDialog, controlSelectClass, SectionFrame } from '@/components/journey-events/shared';

function toLines(values: string[]) {
  return values.join('\n');
}

function parseLines(value: string) {
  return [...new Set(value.split(/\r?\n|,/u).map((item) => item.trim()).filter(Boolean))];
}

export function EventSourceConfiguration({ source, canManage, onChanged }: {
  source: JourneyEventSource;
  canManage: boolean;
  onChanged: (source: JourneyEventSource) => void;
}) {
  const [name, setName] = useState(source.name);
  const [status, setStatus] = useState<JourneyEventSourceStatus>(source.status);
  const [validationMode, setValidationMode] = useState<JourneyEventValidationMode>(source.validationMode);
  const [origins, setOrigins] = useState(toLines(source.allowedOrigins));
  const [bundles, setBundles] = useState(toLines(source.allowedBundleIds));
  const [eventsPerMinute, setEventsPerMinute] = useState(source.eventsPerMinute);
  const [bytesPerMinute, setBytesPerMinute] = useState(source.bytesPerMinute);
  const [working, setWorking] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const previousSourceId = useRef(source.id);

  useEffect(() => {
    const sourceChanged = previousSourceId.current !== source.id;
    previousSourceId.current = source.id;
    setName(source.name);
    setStatus(source.status);
    setValidationMode(source.validationMode);
    setOrigins(toLines(source.allowedOrigins));
    setBundles(toLines(source.allowedBundleIds));
    setEventsPerMinute(source.eventsPerMinute);
    setBytesPerMinute(source.bytesPerMinute);
    if (sourceChanged) {
      setError('');
      setSaved('');
    }
  }, [source]);

  const dirty = useMemo(() => name.trim() !== source.name
    || status !== source.status
    || validationMode !== source.validationMode
    || JSON.stringify(parseLines(origins)) !== JSON.stringify(source.allowedOrigins)
    || JSON.stringify(parseLines(bundles)) !== JSON.stringify(source.allowedBundleIds)
    || eventsPerMinute !== source.eventsPerMinute
    || bytesPerMinute !== source.bytesPerMinute,
  [bundles, bytesPerMinute, eventsPerMinute, name, origins, source, status, validationMode]);

  async function persist() {
    try {
      setWorking(true);
      setError('');
      setSaved('');
      const result = await updateJourneyEventSource(source.id, source.revision, {
        name: name.trim(),
        status,
        validationMode,
        allowedOrigins: parseLines(origins),
        allowedBundleIds: parseLines(bundles),
        eventsPerMinute,
        bytesPerMinute
      });
      onChanged(result.source);
      setSaved('Source settings saved.');
      setConfirmRevoke(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Source settings could not be saved.');
    } finally {
      setWorking(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canManage || !dirty || working || !name.trim()) return;
    if (source.status !== 'revoked' && status === 'revoked') {
      setConfirmRevoke(true);
      return;
    }
    void persist();
  }

  const locked = !canManage || source.status === 'revoked';
  return <>
    <SectionFrame
      title="Source policy"
      description={canManage ? 'Changes apply to new ingestion requests. Existing accepted events keep their original policy evidence.' : 'You have read-only access to this source.'}
    >
      <form className="space-y-5 p-4 sm:p-5" onSubmit={submit}>
        <fieldset className="space-y-5 border-0 p-0" disabled={locked || working}>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Label className="field-label" htmlFor="source-policy-name">Source name</Label>
              <Input id="source-policy-name" maxLength={120} required value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div>
              <Label className="field-label" htmlFor="source-policy-status">Status</Label>
              <select id="source-policy-status" className={controlSelectClass} value={status} onChange={(event) => setStatus(event.target.value as JourneyEventSourceStatus)}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="revoked">Revoked</option>
              </select>
            </div>
          </div>
          <div>
            <Label className="field-label" htmlFor="source-policy-validation">Tracking-plan validation</Label>
            <select id="source-policy-validation" className={controlSelectClass} value={validationMode} onChange={(event) => setValidationMode(event.target.value as JourneyEventValidationMode)}>
              <option value="observe">Observe — record issues without changing acceptance</option>
              <option value="warn">Warn — accept events and surface schema problems</option>
              <option value="enforce">Enforce — reject events that violate a published schema</option>
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="field-label" htmlFor="source-policy-origins">Allowed browser origins</Label>
              <Textarea id="source-policy-origins" rows={4} value={origins} onChange={(event) => setOrigins(event.target.value)} />
            </div>
            <div>
              <Label className="field-label" htmlFor="source-policy-bundles">Allowed app bundle IDs</Label>
              <Textarea id="source-policy-bundles" rows={4} value={bundles} onChange={(event) => setBundles(event.target.value)} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="field-label" htmlFor="source-policy-events">Events per minute</Label>
              <Input id="source-policy-events" type="number" min={1} max={10_000_000} value={eventsPerMinute} onChange={(event) => setEventsPerMinute(event.currentTarget.valueAsNumber || 1)} />
            </div>
            <div>
              <Label className="field-label" htmlFor="source-policy-bytes">Bytes per minute</Label>
              <Input id="source-policy-bytes" type="number" min={1} max={10_000_000_000} value={bytesPerMinute} onChange={(event) => setBytesPerMinute(event.currentTarget.valueAsNumber || 1)} />
            </div>
          </div>
        </fieldset>
        {source.status === 'revoked' && <p className="text-sm text-destructive">This source is permanently revoked. Its credentials cannot ingest events.</p>}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-h-5 text-xs text-muted-foreground" aria-live="polite">{saved}</p>
          {canManage && source.status !== 'revoked' && <Button type="submit" disabled={!dirty || working || !name.trim()}>
            <Save />{working ? 'Saving…' : 'Save policy'}
          </Button>}
        </div>
      </form>
    </SectionFrame>
    <ConfirmationDialog
      open={confirmRevoke}
      title="Revoke this event source?"
      description="Revocation is permanent. All public and server credentials for this source will stop accepting events. Historical events and audit records remain available."
      confirmLabel="Revoke source"
      destructive
      busy={working}
      onCancel={() => { setConfirmRevoke(false); setStatus(source.status); }}
      onConfirm={() => void persist()}
    />
  </>;
}
