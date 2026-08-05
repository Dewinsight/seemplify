import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
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
  createJourneyEventSchema,
  createJourneyEventSchemaVersion,
  type JourneyEventDataClass,
  type JourneyEventPropertyDefinition,
  type JourneyEventPropertyType,
  type JourneyEventSchema
} from '@/lib/journeyEventControlPlane';
import { controlSelectClass } from '@/components/journey-events/shared';

type PropertyDraft = JourneyEventPropertyDefinition & { localId: string; enumText: string };

function localId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

function nextVersion(schema: JourneyEventSchema | null) {
  if (!schema?.versions.length) return '1.0';
  const newest = [...schema.versions].sort((left, right) => {
    const [leftMajor, leftMinor] = left.version.split('.').map(Number);
    const [rightMajor, rightMinor] = right.version.split('.').map(Number);
    return rightMajor - leftMajor || rightMinor - leftMinor;
  })[0];
  const [major, minor] = newest.version.split('.').map(Number);
  return `${major}.${minor + 1}`;
}

function startingProperties(schema: JourneyEventSchema | null): PropertyDraft[] {
  const latest = schema?.versions.length ? [...schema.versions].sort((left, right) => {
    const [leftMajor, leftMinor] = left.version.split('.').map(Number);
    const [rightMajor, rightMinor] = right.version.split('.').map(Number);
    return rightMajor - leftMajor || rightMinor - leftMinor;
  })[0] : null;
  return (latest?.properties || []).map((property) => ({
    ...property,
    localId: localId(),
    enumText: property.enumValues?.join(', ') || ''
  }));
}

function parseEnum(text: string, type: JourneyEventPropertyType) {
  const values = text.split(',').map((value) => value.trim()).filter(Boolean);
  if (!values.length) return undefined;
  if (type === 'number') return values.map(Number).filter(Number.isFinite);
  if (type === 'boolean') return values.filter((value) => value === 'true' || value === 'false').map((value) => value === 'true');
  return type === 'string' ? values : undefined;
}

export function SchemaVersionDialog({ open, sourceId, schema, onClose, onSaved }: {
  open: boolean;
  sourceId: string;
  schema: JourneyEventSchema | null;
  onClose: () => void;
  onSaved: (schema: JourneyEventSchema) => void;
}) {
  const [eventName, setEventName] = useState(schema?.eventName || '');
  const [version, setVersion] = useState(nextVersion(schema));
  const [properties, setProperties] = useState<PropertyDraft[]>(startingProperties(schema));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setEventName(schema?.eventName || '');
    setVersion(nextVersion(schema));
    setProperties(startingProperties(schema));
    setError('');
  }, [open, schema]);

  const valid = useMemo(() => /^[a-z][a-z0-9_]{0,127}$/u.test(eventName)
    && /^\d+\.\d+$/u.test(version)
    && properties.every((property) => /^[a-z][a-z0-9_]{0,63}$/u.test(property.name) && property.description.trim()),
  [eventName, properties, version]);

  function addProperty() {
    setProperties((current) => [...current, {
      localId: localId(),
      name: '',
      type: 'string',
      required: false,
      dataClass: 'operational',
      description: '',
      maximumLength: 500,
      enumText: ''
    }]);
  }

  function updateProperty(id: string, patch: Partial<PropertyDraft>) {
    setProperties((current) => current.map((property) => property.localId === id ? { ...property, ...patch } : property));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || working) return;
    const cleanProperties = properties.map(({ localId: _localId, enumText, ...property }) => ({
      ...property,
      maximumLength: property.type === 'string' ? property.maximumLength || null : null,
      maximumItems: property.type === 'array' ? property.maximumItems || null : null,
      enumValues: parseEnum(enumText, property.type)
    }));
    try {
      setWorking(true);
      setError('');
      const result = schema
        ? await createJourneyEventSchemaVersion(schema.id, { version, properties: cleanProperties })
        : await createJourneyEventSchema(sourceId, { eventName, version, properties: cleanProperties });
      onSaved(result.schema);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The schema version could not be created.');
    } finally {
      setWorking(false);
    }
  }

  return <Dialog open={open} onOpenChange={(next) => { if (!next && !working) onClose(); }}>
    <DialogContent className="sm:max-w-4xl">
      <DialogHeader>
        <DialogTitle>{schema ? `Create ${schema.eventName} version` : 'Add tracked event'}</DialogTitle>
        <DialogDescription>{schema
          ? 'Published versions are immutable. Start from the latest definition, then review compatibility before publishing.'
          : 'Define the event before it is instrumented. Event and property names use lower_snake_case.'}</DialogDescription>
      </DialogHeader>
      <form className="space-y-5" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
          <div>
            <Label className="field-label" htmlFor="schema-event-name">Event name</Label>
            <Input id="schema-event-name" autoFocus={!schema} required readOnly={Boolean(schema)} aria-readonly={Boolean(schema)} value={eventName} onChange={(event) => setEventName(event.target.value)} placeholder="checkout_completed" pattern="[a-z][a-z0-9_]{0,127}" />
          </div>
          <div>
            <Label className="field-label" htmlFor="schema-version">Version</Label>
            <Input id="schema-version" required value={version} onChange={(event) => setVersion(event.target.value)} placeholder="1.0" pattern="[0-9]+\.[0-9]+" />
          </div>
        </div>
        <section className="border" aria-labelledby="schema-properties-heading">
          <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
            <div><h3 id="schema-properties-heading" className="text-sm font-semibold">Properties</h3><p className="mt-1 text-xs text-muted-foreground">Do not track free-form content, credentials, message bodies, transcripts, or raw survey responses.</p></div>
            <Button type="button" size="sm" variant="outline" onClick={addProperty}><Plus />Add property</Button>
          </div>
          {properties.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">This event has no properties. Add only fields needed for journey analysis.</p>
            : <div className="divide-y">{properties.map((property, index) => <fieldset key={property.localId} className="grid gap-3 border-0 p-4 lg:grid-cols-12">
              <legend className="sr-only">Property {index + 1}</legend>
              <div className="lg:col-span-3"><Label className="field-label" htmlFor={`schema-property-name-${property.localId}`}>Name</Label><Input id={`schema-property-name-${property.localId}`} required value={property.name} onChange={(event) => updateProperty(property.localId, { name: event.target.value })} placeholder="order_value" pattern="[a-z][a-z0-9_]{0,63}" /></div>
              <div className="lg:col-span-2"><Label className="field-label" htmlFor={`schema-property-type-${property.localId}`}>Type</Label><select id={`schema-property-type-${property.localId}`} className={controlSelectClass} value={property.type} onChange={(event) => updateProperty(property.localId, { type: event.target.value as JourneyEventPropertyType })}><option value="string">String</option><option value="number">Number</option><option value="boolean">Boolean</option><option value="object">Object</option><option value="array">Array</option></select></div>
              <div className="lg:col-span-3"><Label className="field-label" htmlFor={`schema-property-class-${property.localId}`}>Data class</Label><select id={`schema-property-class-${property.localId}`} className={controlSelectClass} value={property.dataClass} onChange={(event) => updateProperty(property.localId, { dataClass: event.target.value as JourneyEventDataClass })}><option value="operational">Operational</option><option value="personal">Personal</option><option value="sensitive">Sensitive</option><option value="prohibited_content">Prohibited content</option></select></div>
              <div className="flex items-end lg:col-span-3"><label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" className="rounded border-input text-primary focus:ring-ring" checked={property.required} onChange={(event) => updateProperty(property.localId, { required: event.target.checked })} />Required</label></div>
              <div className="flex items-end justify-end lg:col-span-1"><Button type="button" size="icon" variant="ghost" aria-label={`Remove property ${property.name || index + 1}`} onClick={() => setProperties((current) => current.filter((item) => item.localId !== property.localId))}><Trash2 /></Button></div>
              <div className="lg:col-span-6"><Label className="field-label" htmlFor={`schema-property-description-${property.localId}`}>Purpose and meaning</Label><Input id={`schema-property-description-${property.localId}`} required value={property.description} onChange={(event) => updateProperty(property.localId, { description: event.target.value })} placeholder="Total after discounts, in the order currency." /></div>
              {property.type === 'string' && <div className="lg:col-span-2"><Label className="field-label" htmlFor={`schema-property-length-${property.localId}`}>Max bytes</Label><Input id={`schema-property-length-${property.localId}`} type="number" min={1} max={16_384} value={property.maximumLength || ''} onChange={(event) => updateProperty(property.localId, { maximumLength: event.currentTarget.valueAsNumber || null })} /></div>}
              {property.type === 'array' && <div className="lg:col-span-2"><Label className="field-label" htmlFor={`schema-property-items-${property.localId}`}>Max items</Label><Input id={`schema-property-items-${property.localId}`} type="number" min={1} max={100} value={property.maximumItems || ''} onChange={(event) => updateProperty(property.localId, { maximumItems: event.currentTarget.valueAsNumber || null })} /></div>}
              {['string', 'number', 'boolean'].includes(property.type) && <div className={property.type === 'string' ? 'lg:col-span-4' : 'lg:col-span-6'}><Label className="field-label" htmlFor={`schema-property-enum-${property.localId}`}>Allowed values <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id={`schema-property-enum-${property.localId}`} value={property.enumText} onChange={(event) => updateProperty(property.localId, { enumText: event.target.value })} placeholder="Comma-separated values" /></div>}
              {property.dataClass === 'prohibited_content' && <p className="text-xs text-destructive lg:col-span-12" role="alert">Prohibited content prevents this version from being published.</p>}
            </fieldset>)}</div>}
        </section>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={working} onClick={onClose}>Cancel</Button><Button type="submit" disabled={!valid || working}>{working ? 'Creating…' : schema ? 'Create draft version' : 'Add event and draft'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
