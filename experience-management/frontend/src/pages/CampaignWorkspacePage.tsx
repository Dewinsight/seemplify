import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowDown, ArrowLeft, ArrowUp, CalendarClock, CheckCircle2, Clock3, ExternalLink, FileUp, Loader2, Mail, Pause, Pencil, Play, Plus, Save, Send, Trash2, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, json } from '@/lib/api';
import { contactsFromText, customFieldToken } from '@/lib/contactImport';
import { Link, useParams } from '@/lib/router';
import { formatDateTime } from '@/lib/utils';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { Campaign, CampaignContact, CampaignDelivery, CampaignDetail, CampaignStep, CampaignTemplate, CampaignWorkflowSectionKey, Survey } from '@/types';

const variables = ['{{first_name}}', '{{last_name}}', '{{job_title}}', '{{position}}', '{{company}}', '{{custom.field_name}}', '{{survey_title}}', '{{survey_link}}'];
const compatibleEmbeddedTypes = new Set(['single_choice', 'nps', 'csat', 'ces', 'rating', 'graphical_rating']);

function statusVariant(status: Campaign['status']) {
  if (status === 'active') return 'success' as const;
  if (status === 'paused') return 'warning' as const;
  if (status === 'completed') return 'secondary' as const;
  return 'outline' as const;
}

function dateTimeInputValue(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function deliveryLifecycle(delivery: CampaignDelivery) {
  if (delivery.state !== 'sent') return delivery.state;
  if (!delivery.providerStatus || ['sent', 'request'].includes(delivery.providerStatus)) return 'accepted';
  return delivery.providerStatus;
}

function providerEventTime(delivery: CampaignDelivery) {
  return delivery.clickedAt || delivery.openedAt || delivery.deliveredAt || delivery.bouncedAt
    || delivery.complainedAt || delivery.unsubscribedAt || delivery.providerUpdatedAt;
}

function emptyStep(campaignId: string, position: number, template?: CampaignTemplate): CampaignStep {
  return {
    id: crypto.randomUUID(), campaignId, position, delayMinutes: position === 0 ? 0 : 3 * 24 * 60,
    subject: template?.subject || 'A quick follow-up: {{survey_title}}', mode: template?.mode || 'plain',
    bodyText: template?.bodyText || 'Hello {{first_name}},\n\nWe would still value your feedback.\n\n{{survey_link}}',
    bodyHtml: template?.bodyHtml || '<p>Hello {{first_name}},</p><p>We would still value your feedback.</p><p><a href="{{survey_link}}">Share feedback</a></p>',
    embedQuestionId: null
  };
}

function SequenceEditor({ detail, templates, onRefresh, onDraftState }: { detail: CampaignDetail; templates: CampaignTemplate[]; onRefresh: () => Promise<void>; onDraftState: (state: { dirty: boolean; valid: boolean }) => void }) {
  const [steps, setSteps] = useState<CampaignStep[]>(detail.steps);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testing, setTesting] = useState(false);
  useEffect(() => { if (!dirty) setSteps(detail.steps); }, [detail.steps, dirty]);
  const embeddedQuestions = (detail.survey.questions || []).filter((question) => question.page === 1 && compatibleEmbeddedTypes.has(question.type));
  const availableVariables = useMemo(() => [...variables, ...new Set(detail.contacts.flatMap((contact) => Object.keys(contact.customData || {}).map((label) => customFieldToken(label)).filter(Boolean).map((key) => `{{custom.${key}}}`)))], [detail.contacts]);
  const editable = detail.campaign.status === 'draft' && !detail.campaign.launchedAt;
  const valid = steps.length > 0 && steps.every((step) => step.subject.trim() && (step.mode === 'html' ? step.bodyHtml : step.bodyText).trim());
  useEffect(() => onDraftState({ dirty, valid: Boolean(valid) }), [dirty, onDraftState, valid]);
  function change(index: number, values: Partial<CampaignStep>) { setSteps((current) => current.map((step, stepIndex) => stepIndex === index ? { ...step, ...values } : step)); setDirty(true); }
  function move(index: number, offset: number) { const target = index + offset; if (target < 0 || target >= steps.length) return; const next = [...steps]; [next[index], next[target]] = [next[target], next[index]]; setSteps(next.map((step, position) => ({ ...step, position }))); setDirty(true); }
  function remove(index: number) { if (steps.length === 1) return toast.error('A campaign needs at least one message.'); setSteps((current) => current.filter((_, stepIndex) => stepIndex !== index).map((step, position) => ({ ...step, position }))); setDirty(true); }
  function applyTemplate(index: number, templateId: string) { const template = templates.find((item) => item.id === templateId); if (!template) return; change(index, { subject: template.subject, mode: template.mode, bodyText: template.bodyText, bodyHtml: template.bodyHtml }); }
  function applySequenceTemplate(templateId: string) {
    const template = templates.find((item) => item.id === templateId); if (!template) return;
    const templateSteps = template.steps?.length ? template.steps : [{
      delayMinutes: 0, subject: template.subject, mode: template.mode, bodyText: template.bodyText,
      bodyHtml: template.bodyHtml, embedQuestionId: null
    }];
    setSteps(templateSteps.map((step, position) => ({
      ...step, id: crypto.randomUUID(), campaignId: detail.campaign.id, position,
      embedQuestionId: step.embedQuestionId || null
    })));
    setDirty(true);
    toast.success(`${template.name} loaded. Save the sequence when it is ready.`);
  }
  async function save() {
    try { setSaving(true); await api(`/api/campaigns/${detail.campaign.id}/steps`, json('PUT', { steps: steps.map((step, position) => ({ ...step, position })) })); setDirty(false); toast.success('Sequence saved'); await onRefresh(); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save sequence.'); return false; }
    finally { setSaving(false); }
  }
  async function sendTest() {
    if (!testEmail) return toast.error('Enter an address for the test email.');
    try {
      setTesting(true); if (dirty && !await save()) return;
      const result = await api<{ outcomes: Array<{ email: string; status: 'sent' | 'failed'; error?: string }> }>(`/api/campaigns/${detail.campaign.id}/test`, json('POST', { email: testEmail }));
      const failed = result.outcomes.filter((outcome) => outcome.status === 'failed');
      if (failed.length) return toast.error(failed[0].error || 'The provider rejected the test email.');
      toast.success('Test email accepted by the provider');
    }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not send test email.'); }
    finally { setTesting(false); }
  }
  return <div className="space-y-4">
    {!editable && <div className="border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">The saved sequence is locked after campaign launch.</div>}
    <fieldset disabled={!editable || saving} className="space-y-4 border-0 p-0">
    <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center"><div><div className="font-semibold">Email sequence</div><p className="mt-1 text-sm text-muted-foreground">Plain text is the default. Add HTML only when the design is important enough to justify it.</p></div><div className="flex flex-wrap gap-2"><select aria-label="Load sequence template" className="h-9 min-w-52 rounded-md border border-input bg-background px-3 text-sm" defaultValue="" onChange={(event) => { applySequenceTemplate(event.target.value); event.target.value = ''; }}><option value="">Load sequence template</option>{templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}</select><Button variant="outline" onClick={() => { setSteps((current) => [...current, emptyStep(detail.campaign.id, current.length, templates[0])]); setDirty(true); }}><Plus />Add step</Button><Button disabled={!dirty || saving || !valid} onClick={save}>{saving ? <Loader2 className="animate-spin" /> : <Save />}{saving ? 'Saving' : 'Save sequence'}</Button></div></div>
    {!valid && <div className="flex gap-3 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="alert"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>Every email step requires both a subject and message before the sequence can be saved.</span></div>}
    {steps.map((step, index) => <section className="border bg-card" key={step.id}>
      <div className="flex min-h-12 items-center justify-between gap-3 border-b px-4 py-2"><div><span className="text-sm font-semibold">Step {index + 1}</span><span className="ml-2 text-xs text-muted-foreground">{index === 0 ? 'Initial invitation' : `${step.delayMinutes} minutes after the previous step`}</span></div><div className="flex"><Button variant="ghost" size="icon" aria-label={`Move step ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp /></Button><Button variant="ghost" size="icon" aria-label={`Move step ${index + 1} down`} disabled={index === steps.length - 1} onClick={() => move(index, 1)}><ArrowDown /></Button><Button variant="ghost" size="icon" aria-label={`Delete step ${index + 1}`} disabled={steps.length === 1} onClick={() => remove(index)}><Trash2 /></Button></div></div>
      <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          {index > 0 && <div><Label className="field-label" htmlFor={`step-delay-${step.id}`}>Delay after previous step</Label><div className="flex gap-2"><Input id={`step-delay-${step.id}`} className="max-w-36" type="number" min={1} value={step.delayMinutes % 1440 === 0 ? step.delayMinutes / 1440 : step.delayMinutes % 60 === 0 ? step.delayMinutes / 60 : step.delayMinutes} onChange={(event) => { const amount = Math.max(1, Number(event.target.value)); const unit = step.delayMinutes % 1440 === 0 ? 1440 : step.delayMinutes % 60 === 0 ? 60 : 1; change(index, { delayMinutes: amount * unit }); }} /><select aria-label={`Step ${index + 1} delay unit`} className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={step.delayMinutes % 1440 === 0 ? 'days' : step.delayMinutes % 60 === 0 ? 'hours' : 'minutes'} onChange={(event) => { const current = step.delayMinutes % 1440 === 0 ? step.delayMinutes / 1440 : step.delayMinutes % 60 === 0 ? step.delayMinutes / 60 : step.delayMinutes; const factor = event.target.value === 'days' ? 1440 : event.target.value === 'hours' ? 60 : 1; change(index, { delayMinutes: Math.max(1, current) * factor }); }}><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option></select></div></div>}
          <div><Label className="field-label" htmlFor={`step-subject-${step.id}`}>Subject <span className="text-destructive" aria-hidden="true">*</span></Label><Input id={`step-subject-${step.id}`} value={step.subject} required aria-required="true" aria-invalid={!step.subject.trim()} onChange={(event) => change(index, { subject: event.target.value })} /></div>
          <div className="grid gap-3 sm:grid-cols-2"><div><Label className="field-label">Message format</Label><select aria-label={`Step ${index + 1} message format`} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={step.mode} onChange={(event) => change(index, { mode: event.target.value as CampaignStep['mode'] })}><option value="plain">Plain text (recommended)</option><option value="html">HTML email</option></select></div><div><Label className="field-label">Start from template</Label><select aria-label={`Step ${index + 1} template`} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" defaultValue="" onChange={(event) => { applyTemplate(index, event.target.value); event.target.value = ''; }}><option value="">Choose a template</option>{templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}</select></div></div>
          <div><Label className="field-label" htmlFor={`step-body-${step.id}`}>{step.mode === 'html' ? 'HTML source' : 'Message'} <span className="text-destructive" aria-hidden="true">*</span></Label><Textarea id={`step-body-${step.id}`} className={step.mode === 'html' ? 'font-mono text-xs' : ''} rows={10} value={step.mode === 'html' ? step.bodyHtml : step.bodyText} required aria-required="true" aria-invalid={!(step.mode === 'html' ? step.bodyHtml : step.bodyText).trim()} onChange={(event) => change(index, step.mode === 'html' ? { bodyHtml: event.target.value } : { bodyText: event.target.value })} /></div>
          <div><Label className="field-label">Embed a question</Label><select aria-label={`Step ${index + 1} embedded question`} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={step.embedQuestionId || ''} onChange={(event) => change(index, { embedQuestionId: event.target.value || null })}><option value="">Survey link only</option>{embeddedQuestions.map((question, questionIndex) => <option value={question.id} key={question.id}>{questionIndex + 1}. {question.title}</option>)}</select><p className="mt-1 text-xs leading-5 text-muted-foreground">Compatible choices open the survey with that answer preselected. The respondent can review it before submitting.</p></div>
        </div>
        <aside className="border-l-0 lg:border-l lg:pl-5"><div className="text-sm font-semibold">Preview</div><div className="mt-3 min-h-52 border bg-white p-4 text-sm text-slate-900">{step.mode === 'html' ? <iframe title={`Step ${index + 1} HTML preview`} sandbox="" srcDoc={step.bodyHtml} className="h-56 w-full border-0" /> : <div className="whitespace-pre-wrap leading-6">{step.bodyText}</div>}</div><div className="mt-4 text-xs leading-5 text-muted-foreground">Variables: {availableVariables.join(', ')}</div></aside>
      </div>
    </section>)}
    <Card><CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-end"><div className="flex-1"><Label className="field-label" htmlFor="campaign-test-email">Send a test</Label><Input id="campaign-test-email" type="email" placeholder="you@company.com" value={testEmail} onChange={(event) => setTestEmail(event.target.value)} /></div><Button variant="outline" disabled={testing} onClick={sendTest}>{testing ? <Loader2 className="animate-spin" /> : <Mail />}{testing ? 'Sending' : 'Send test email'}</Button></CardContent></Card>
    </fieldset>
  </div>;
}

type ContactCustomField = { id: string; label: string; value: string };
type ContactDraft = { email: string; firstName: string; lastName: string; jobTitle: string; company: string; customFields: ContactCustomField[] };

function contactDraft(contact?: CampaignContact): ContactDraft {
  return {
    email: contact?.email || '', firstName: contact?.firstName || '', lastName: contact?.lastName || '',
    jobTitle: contact?.jobTitle || '', company: contact?.company || '',
    customFields: Object.entries(contact?.customData || {}).flatMap(([label, value]) =>
      ['string', 'number', 'boolean'].includes(typeof value) ? [{ id: crypto.randomUUID(), label, value: String(value) }] : [])
  };
}

function customEntries(contact: CampaignContact) {
  return Object.entries(contact.customData || {}).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value));
}

function AudienceEditor({ detail, onRefresh }: { detail: CampaignDetail; onRefresh: () => Promise<void> }) {
  const [importOpen, setImportOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [person, setPerson] = useState<ContactDraft>(() => contactDraft());
  const [draft, setDraft] = useState('');
  const [working, setWorking] = useState(false);
  const parsedContacts = useMemo(() => contactsFromText(draft), [draft]);
  const canManage = detail.campaign.status === 'draft' || detail.campaign.status === 'paused';
  const knownCustomFields = useMemo(() => [...new Set(detail.contacts.flatMap((contact) => customEntries(contact).map(([label]) => label)))].sort(), [detail.contacts]);
  const importedCustomFields = useMemo(() => [...new Set(parsedContacts.flatMap((contact) => Object.keys(contact.customData)))], [parsedContacts]);

  function openNewContact() { setEditingId(null); setPerson(contactDraft()); setContactOpen(true); }
  function openContact(contact: CampaignContact) { setEditingId(contact.id); setPerson(contactDraft(contact)); setContactOpen(true); }
  function changeCustomField(id: string, values: Partial<ContactCustomField>) {
    setPerson((current) => ({ ...current, customFields: current.customFields.map((field) => field.id === id ? { ...field, ...values } : field) }));
  }

  async function saveContact(event: FormEvent) {
    event.preventDefault();
    if (!canManage) return toast.error('Pause the campaign before editing its audience.');
    const populated = person.customFields.filter((field) => field.label.trim() || field.value.trim());
    if (populated.some((field) => !field.label.trim() || !field.value.trim())) return toast.error('Each custom field needs both a name and a value.');
    const tokens = populated.map((field) => customFieldToken(field.label));
    if (tokens.some((token) => !token) || new Set(tokens).size !== tokens.length) return toast.error('Custom field names must be unique and contain a letter or number.');
    const customData = Object.fromEntries(populated.map((field) => [field.label.trim(), field.value.trim()]));
    const payload = { email: person.email, firstName: person.firstName, lastName: person.lastName, jobTitle: person.jobTitle, company: person.company, customData };
    try {
      setWorking(true);
      if (editingId) await api(`/api/campaigns/${detail.campaign.id}/contacts/${editingId}`, json('PUT', payload));
      else await api(`/api/campaigns/${detail.campaign.id}/contacts`, json('POST', { contacts: [payload] }));
      toast.success(editingId ? 'Contact updated' : 'Contact added');
      setContactOpen(false); await onRefresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save contact.'); }
    finally { setWorking(false); }
  }

  async function importContacts(event: FormEvent) {
    event.preventDefault();
    if (!parsedContacts.length) return toast.error('Add at least one valid email address.');
    if (parsedContacts.length > 1000) return toast.error('Import up to 1,000 contacts at a time.');
    try {
      setWorking(true);
      const result = await api<{ summary?: { imported?: number; skipped?: number } }>(`/api/campaigns/${detail.campaign.id}/contacts`, json('POST', { contacts: parsedContacts }));
      const imported = result.summary?.imported ?? parsedContacts.length; const skipped = result.summary?.skipped || 0;
      toast.success(`${imported} contact${imported === 1 ? '' : 's'} imported${skipped ? ` · ${skipped} skipped` : ''}`);
      setDraft(''); setImportOpen(false); await onRefresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not import contacts.'); }
    finally { setWorking(false); }
  }

  async function chooseFile(file?: File) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast.error('Contact files must be 5 MB or smaller.');
    setDraft(await file.text());
  }
  async function remove(contactId: string) {
    try { await api(`/api/campaigns/${detail.campaign.id}/contacts/${contactId}`, { method: 'DELETE' }); await onRefresh(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not remove contact.'); }
  }

  return <>
    <Card className="overflow-hidden">
      <CardHeader className="gap-3 border-b sm:flex-row sm:items-center sm:justify-between">
        <div><CardTitle>Audience · {detail.metrics.contacts}</CardTitle><p className="mt-1 text-xs leading-5 text-muted-foreground">People and their personalization data for this campaign.</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={!canManage} onClick={() => setImportOpen(true)}><FileUp />Import list</Button><Button size="sm" disabled={!canManage} onClick={openNewContact}><Plus />Add person</Button></div>
      </CardHeader>
      {!canManage && <div className="border-b bg-muted/35 px-5 py-3 text-xs leading-5 text-muted-foreground">Pause this campaign to add or edit people. Existing contact details remain available to review.</div>}
      <CardContent className="px-0 pb-0">
        {detail.contacts.length < detail.metrics.contacts && <p className="border-b px-5 py-3 text-xs text-muted-foreground">Showing the latest {detail.contacts.length.toLocaleString()} contacts.</p>}
        {detail.contacts.length ? <div className="overflow-x-auto"><table className="data-table min-w-[1120px]"><thead><tr><th>Person</th><th>Job title / position</th><th>Company</th><th>Custom fields</th><th>Status</th><th>Current step</th><th>Next send</th><th /></tr></thead><tbody>{detail.contacts.map((contact) => {
          const fields = customEntries(contact);
          return <tr key={contact.id}><td><button type="button" className="text-left hover:underline" onClick={() => openContact(contact)}><span className="block font-medium">{[contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.email}</span><span className="mt-1 block text-xs text-muted-foreground">{contact.email}</span></button></td><td>{contact.jobTitle || '—'}</td><td>{contact.company || '—'}</td><td>{fields.length ? <div className="flex max-w-64 flex-wrap gap-1">{fields.slice(0, 2).map(([label, value]) => <span className="border bg-muted/30 px-1.5 py-0.5 text-[11px]" key={label}>{label}: {String(value)}</span>)}{fields.length > 2 && <span className="px-1.5 py-0.5 text-[11px] text-muted-foreground">+{fields.length - 2}</span>}</div> : '—'}</td><td className="capitalize">{contact.status}</td><td>{contact.currentStep < 0 ? 'Not started' : contact.currentStep + 1}</td><td>{contact.nextSendAt ? formatDateTime(contact.nextSendAt) : '—'}</td><td><div className="flex justify-end"><Button variant="ghost" size="icon" aria-label={`${canManage ? 'Edit' : 'View'} ${contact.email}`} onClick={() => openContact(contact)}><Pencil /></Button><Button variant="ghost" size="icon" aria-label={`Remove ${contact.email}`} disabled={!canManage || contact.status !== 'active'} onClick={() => void remove(contact.id)}><Trash2 /></Button></div></td></tr>;
        })}</tbody></table></div> : <div className="px-5 py-16 text-center"><Users className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-sm font-medium">No contacts yet</div><p className="mt-1 text-xs text-muted-foreground">Add one person or import a list to build this campaign’s audience.</p></div>}
      </CardContent>
    </Card>

    <Dialog open={contactOpen} onOpenChange={setContactOpen}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{editingId ? canManage ? 'Edit contact' : 'Contact details' : 'Add person'}</DialogTitle><DialogDescription>Keep the person’s identity and campaign personalization data together.</DialogDescription></DialogHeader>
        <form className="space-y-5" onSubmit={saveContact}>
          <div><Label className="field-label" htmlFor="contact-email">Email address</Label><Input id="contact-email" type="email" required maxLength={320} readOnly={!canManage || Boolean(editingId && detail.campaign.launchedAt)} value={person.email} onChange={(event) => setPerson((current) => ({ ...current, email: event.target.value }))} /><p className="mt-1 text-xs text-muted-foreground">{editingId && detail.campaign.launchedAt ? 'Email is locked after launch to preserve delivery and unsubscribe history.' : 'Required for delivery and duplicate detection.'}</p></div>
          <div className="grid gap-4 sm:grid-cols-2"><div><Label className="field-label" htmlFor="contact-first-name">First name</Label><Input id="contact-first-name" maxLength={150} readOnly={!canManage} value={person.firstName} onChange={(event) => setPerson((current) => ({ ...current, firstName: event.target.value }))} /></div><div><Label className="field-label" htmlFor="contact-last-name">Last name</Label><Input id="contact-last-name" maxLength={150} readOnly={!canManage} value={person.lastName} onChange={(event) => setPerson((current) => ({ ...current, lastName: event.target.value }))} /></div></div>
          <div className="grid gap-4 sm:grid-cols-2"><div><Label className="field-label" htmlFor="contact-job-title">Job title / position</Label><Input id="contact-job-title" maxLength={180} readOnly={!canManage} value={person.jobTitle} onChange={(event) => setPerson((current) => ({ ...current, jobTitle: event.target.value }))} /></div><div><Label className="field-label" htmlFor="contact-company">Company</Label><Input id="contact-company" maxLength={250} readOnly={!canManage} value={person.company} onChange={(event) => setPerson((current) => ({ ...current, company: event.target.value }))} /></div></div>
          <section className="space-y-3 border-t pt-4"><div className="flex items-center justify-between gap-3"><div><div className="text-sm font-semibold">Custom fields</div><p className="mt-1 text-xs text-muted-foreground">Add details such as region, customer tier or account owner.</p></div>{canManage && <Button type="button" variant="outline" size="sm" disabled={person.customFields.length >= 25} onClick={() => setPerson((current) => ({ ...current, customFields: [...current.customFields, { id: crypto.randomUUID(), label: '', value: '' }] }))}><Plus />Add custom field</Button>}</div>
            {person.customFields.length ? <div className="space-y-2">{person.customFields.map((field, index) => <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px]" key={field.id}><Input aria-label={`Custom field ${index + 1} name`} list="campaign-custom-field-options" placeholder="Field name" maxLength={64} readOnly={!canManage} value={field.label} onChange={(event) => changeCustomField(field.id, { label: event.target.value })} /><Input aria-label={`Custom field ${index + 1} value`} placeholder="Value" maxLength={500} readOnly={!canManage} value={field.value} onChange={(event) => changeCustomField(field.id, { value: event.target.value })} />{canManage ? <Button type="button" variant="ghost" size="icon" aria-label={`Remove custom field ${index + 1}`} onClick={() => setPerson((current) => ({ ...current, customFields: current.customFields.filter((item) => item.id !== field.id) }))}><X /></Button> : <span />}</div>)}</div> : <div className="border border-dashed px-4 py-5 text-center text-xs text-muted-foreground">No custom fields for this person.</div>}
            <datalist id="campaign-custom-field-options">{knownCustomFields.map((field) => <option value={field} key={field} />)}</datalist>
          </section>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setContactOpen(false)}>{canManage ? 'Cancel' : 'Close'}</Button>{canManage && <Button disabled={working}>{working ? <Loader2 className="animate-spin" /> : <Save />}{working ? 'Saving' : editingId ? 'Save contact' : 'Add person'}</Button>}</DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog open={importOpen} onOpenChange={setImportOpen}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Import an audience list</DialogTitle><DialogDescription>Paste rows or upload CSV/TXT. Named columns become structured or custom contact fields.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={importContacts}>
          <div><Label className="field-label" htmlFor="campaign-contacts">Contacts</Label><Textarea id="campaign-contacts" rows={9} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={'email,first name,last name,job title,company,region,customer tier\nada@example.com,Ada,Lovelace,CTO,Analytical Co,London,Enterprise'} /><p className="mt-1 text-xs leading-5 text-muted-foreground">Use an email column. First name, last name, job title/position and company are recognized; every other named column becomes a custom field.</p></div>
          <label className="flex cursor-pointer items-center justify-center gap-2 border border-dashed px-4 py-3 text-sm font-medium hover:bg-muted/30"><FileUp className="h-4 w-4" />Choose CSV or TXT<input className="sr-only" type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(event) => void chooseFile(event.target.files?.[0])} /></label>
          {draft && <div className="border bg-muted/20 px-4 py-3 text-xs leading-5"><span className="font-semibold">{parsedContacts.length.toLocaleString()} valid contact{parsedContacts.length === 1 ? '' : 's'} detected.</span>{importedCustomFields.length ? <span className="ml-2 text-muted-foreground">Custom fields: {importedCustomFields.join(', ')}.</span> : null}</div>}
          {parsedContacts.length > 0 && <div className="overflow-x-auto border"><table className="data-table min-w-[640px]"><thead><tr><th>Email</th><th>Name</th><th>Job title</th><th>Company</th></tr></thead><tbody>{parsedContacts.slice(0, 3).map((contact) => <tr key={contact.email}><td>{contact.email}</td><td>{[contact.firstName, contact.lastName].filter(Boolean).join(' ') || '—'}</td><td>{contact.jobTitle || '—'}</td><td>{contact.company || '—'}</td></tr>)}</tbody></table>{parsedContacts.length > 3 && <div className="border-t px-4 py-2 text-xs text-muted-foreground">Previewing 3 of {parsedContacts.length.toLocaleString()} contacts.</div>}</div>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button><Button disabled={working || !parsedContacts.length || parsedContacts.length > 1000}>{working ? <Loader2 className="animate-spin" /> : <Users />}{working ? 'Importing' : `Import ${parsedContacts.length || ''} contact${parsedContacts.length === 1 ? '' : 's'}`}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}

function Activity({ detail }: { detail: CampaignDetail }) {
  const historyNote = detail.metrics.totalDeliveries && detail.deliveries.length < detail.metrics.totalDeliveries
    ? ` Showing the latest ${detail.deliveries.length.toLocaleString()} of ${detail.metrics.totalDeliveries.toLocaleString()} events.`
    : '';
  return <Card className="overflow-hidden"><CardHeader><CardTitle>Delivery history</CardTitle><p className="text-xs leading-5 text-muted-foreground">Accepted means Brevo accepted the request. Secured provider events then update delivery, engagement, bounce, complaint and unsubscribe status in real time.{historyNote}</p></CardHeader><CardContent className="px-0 pb-0">{detail.deliveries.length ? <div className="overflow-x-auto"><table className="data-table min-w-[980px]"><thead><tr><th>Recipient</th><th>Step</th><th>Lifecycle</th><th>Scheduled</th><th>Accepted</th><th>Provider event</th><th>Attempt</th><th>Error</th></tr></thead><tbody>{detail.deliveries.map((delivery) => <tr key={delivery.id}><td>{delivery.email || detail.contacts.find((contact) => contact.id === delivery.contactId)?.email || '—'}</td><td>{delivery.stepPosition + 1}</td><td className="capitalize">{deliveryLifecycle(delivery).replace(/_/g, ' ')}</td><td>{formatDateTime(delivery.scheduledAt)}</td><td>{formatDateTime(delivery.sentAt)}</td><td>{formatDateTime(providerEventTime(delivery))}</td><td>{delivery.attempt}</td><td className="max-w-xs truncate text-xs text-destructive">{delivery.error || '—'}</td></tr>)}</tbody></table></div> : <div className="px-5 py-16 text-center"><Clock3 className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-sm font-medium">Nothing sent yet</div><p className="mt-1 text-xs text-muted-foreground">Delivery events appear here when the campaign launches.</p></div>}</CardContent></Card>;
}

type CampaignWorkspaceTab = CampaignWorkflowSectionKey | 'review' | 'activity';
const workflowLabels: Record<CampaignWorkflowSectionKey, string> = { setup: 'Setup', audience: 'Audience', sequence: 'Sequence', schedule: 'Schedule' };

export function CampaignWorkspacePage() {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [activeTab, setActiveTab] = useState<CampaignWorkspaceTab>('setup');
  const [working, setWorking] = useState(false);
  const [name, setName] = useState('');
  const [selectedSurveyId, setSelectedSurveyId] = useState('');
  const [startAt, setStartAt] = useState('');
  const [stopOnResponse, setStopOnResponse] = useState(true);
  const setupDirtyRef = useRef(false); const scheduleDirtyRef = useRef(false);
  const [setupDirty, setSetupDirty] = useState(false); const [scheduleDirty, setScheduleDirty] = useState(false);
  const [sequenceDraft, setSequenceDraft] = useState({ dirty: false, valid: true });
  const onSequenceDraftState = useCallback((next: { dirty: boolean; valid: boolean }) => {
    setSequenceDraft((current) => current.dirty === next.dirty && current.valid === next.valid ? current : next);
  }, []);
  const markSetupDirty = () => { setupDirtyRef.current = true; setSetupDirty(true); };
  const markScheduleDirty = () => { scheduleDirtyRef.current = true; setScheduleDirty(true); };
  const load = useCallback(async () => {
    const [next, templateRows, surveyRows] = await Promise.all([api<CampaignDetail>(`/api/campaigns/${id}`), api<CampaignTemplate[]>('/api/campaign-templates'), api<Survey[]>('/api/surveys')]);
    setDetail(next); setTemplates(templateRows); setSurveys(surveyRows);
    if (!setupDirtyRef.current) { setName(next.campaign.name); setSelectedSurveyId(next.campaign.surveyId); }
    if (!scheduleDirtyRef.current) { setStartAt(dateTimeInputValue(next.campaign.startsAt)); setStopOnResponse(next.campaign.settings?.stopOnResponse !== false); }
  }, [id]);
  useEffect(() => { void load().catch((error) => toast.error(error instanceof Error ? error.message : 'Could not load campaign.')); }, [load]);
  useLiveRefresh(() => { void load(); });
  useEffect(() => { if (detail?.campaign.status !== 'active') return; const timer = window.setInterval(() => void load(), 5000); return () => window.clearInterval(timer); }, [detail?.campaign.status, load]);

  const selectedSurvey = surveys.find((item) => item.id === selectedSurveyId);
  const workflowSections = useMemo(() => {
    if (!detail) return [];
    if (detail.campaign.status !== 'draft') return (Object.entries(workflowLabels) as Array<[CampaignWorkflowSectionKey, string]>).map(([key, label]) => ({ key, label, issues: [], complete: true }));
    const setupIssues: string[] = [];
    if (name.trim().length < 2) setupIssues.push('Enter a campaign name.');
    if (!selectedSurvey) setupIssues.push('Select a survey.');
    else if (selectedSurvey.status !== 'live') setupIssues.push('Publish the selected survey.');
    if (!setupDirty && selectedSurveyId === detail.campaign.surveyId) {
      for (const issue of detail.readiness.sections.setup.issues) if (!setupIssues.includes(issue)) setupIssues.push(issue);
    }
    if (setupDirty) setupIssues.push('Save the setup changes.');
    const sequenceIssues = sequenceDraft.dirty
      ? [sequenceDraft.valid ? 'Save the sequence changes.' : 'Complete and save every email step.']
      : detail.readiness.sections.sequence.issues;
    const scheduleIssues: string[] = [];
    if (!startAt || !Number.isFinite(new Date(startAt).getTime())) scheduleIssues.push('Set a campaign start time.');
    if (scheduleDirty) scheduleIssues.push('Save the schedule changes.');
    return [
      { key: 'setup' as const, label: 'Setup', issues: setupIssues },
      { key: 'audience' as const, label: 'Audience', issues: detail.readiness.sections.audience.issues },
      { key: 'sequence' as const, label: 'Sequence', issues: sequenceIssues },
      { key: 'schedule' as const, label: 'Schedule', issues: scheduleIssues }
    ].map((section) => ({ ...section, complete: section.issues.length === 0 }));
  }, [detail, name, scheduleDirty, selectedSurvey, selectedSurveyId, sequenceDraft, setupDirty, startAt]);
  const completedSteps = workflowSections.filter((section) => section.complete).length;
  const workflowReady = workflowSections.length === 4 && completedSteps === 4;
  const hasUnsavedChanges = setupDirty || scheduleDirty || sequenceDraft.dirty;
  useUnsavedChanges(hasUnsavedChanges);
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const confirmNavigation = (event: MouseEvent) => {
      const link = (event.target as HTMLElement | null)?.closest('a[href]') as HTMLAnchorElement | null;
      if (!link || link.target || link.href === window.location.href) return;
      if (!window.confirm('Leave this campaign and discard unsaved changes?')) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    document.addEventListener('click', confirmNavigation, true);
    return () => document.removeEventListener('click', confirmNavigation, true);
  }, [hasUnsavedChanges]);

  async function transition(action: 'launch' | 'pause' | 'resume') {
    if (!detail) return;
    if (action === 'launch' && !workflowReady) {
      const firstIncomplete = workflowSections.find((section) => !section.complete);
      setActiveTab(firstIncomplete?.key || 'review');
      return toast.error(firstIncomplete?.issues[0] || 'Complete the campaign workflow before launch.');
    }
    try { setWorking(true); await api(`/api/campaigns/${id}/${action}`, json('POST', {})); toast.success(action === 'launch' ? 'Campaign launched' : action === 'pause' ? 'Campaign paused' : 'Campaign resumed'); await load(); }
    catch (error) { toast.error(error instanceof Error ? error.message : `Could not ${action} campaign.`); }
    finally { setWorking(false); }
  }
  async function saveSetup() {
    if (name.trim().length < 2) return toast.error('Enter a campaign name with at least two characters.');
    if (!selectedSurveyId) return toast.error('Select the survey for this campaign.');
    try {
      setWorking(true);
      await api(`/api/campaigns/${id}`, json('PUT', { name: name.trim(), ...(detail?.campaign.launchedAt ? {} : { surveyId: selectedSurveyId }) }));
      setupDirtyRef.current = false; setSetupDirty(false); toast.success('Campaign setup saved'); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save campaign setup.'); }
    finally { setWorking(false); }
  }
  async function saveSchedule() {
    if (!detail) return;
    if (!startAt) return toast.error('Set the campaign start time before saving this step.');
    const date = new Date(startAt); if (!Number.isFinite(date.getTime())) return toast.error('Choose a valid campaign start time.');
    try {
      setWorking(true);
      await api(`/api/campaigns/${id}`, json('PUT', { ...(detail.campaign.launchedAt ? {} : { startAt: date.toISOString() }), settings: { ...detail.campaign.settings, stopOnResponse } }));
      scheduleDirtyRef.current = false; setScheduleDirty(false); toast.success('Campaign schedule saved'); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save the campaign schedule.'); }
    finally { setWorking(false); }
  }
  if (!detail) return <div className="h-96 animate-pulse bg-muted" />;
  const { campaign, metrics, survey, collector } = detail;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'your local timezone';
  return <div className="space-y-5">
    <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end"><div><Button variant="ghost" size="sm" asChild className="-ml-3 mb-2"><Link to="/campaigns"><ArrowLeft />All campaigns</Link></Button><div className="flex items-center gap-3"><h1 className="page-title">{campaign.name}</h1><Badge variant={statusVariant(campaign.status)} className="capitalize">{campaign.status}</Badge></div><p className="page-description">{survey.title} · Email sequence through {collector.name}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" asChild><a href={collector.publicUrl} target="_blank" rel="noreferrer"><ExternalLink />Survey link</a></Button>{campaign.status === 'active' ? <Button variant="outline" size="sm" disabled={working} onClick={() => void transition('pause')}><Pause />Pause</Button> : campaign.status === 'paused' ? <Button size="sm" disabled={working} onClick={() => void transition('resume')}><Play />Resume</Button> : campaign.status === 'draft' ? <Button size="sm" disabled={working} onClick={() => setActiveTab('review')}><Send />Review and launch</Button> : null}</div></div>
    <div className="grid border bg-card sm:grid-cols-3 lg:grid-cols-6">{[
      ['Audience', metrics.contacts], ['Queued', metrics.queued], ['Accepted', metrics.sent], ['Responses', metrics.responded], ['Failed', metrics.failed], ['Skipped', metrics.skipped]
    ].map(([label, value]) => <div className="border-b px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0" key={label}><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-lg font-semibold">{value}</div></div>)}</div>
    {campaign.status === 'draft' && <div className={`flex items-center gap-3 border px-4 py-3 text-sm ${workflowReady ? 'border-emerald-200 bg-emerald-50 text-emerald-950' : 'border-amber-200 bg-amber-50 text-amber-950'}`} aria-live="polite">{workflowReady ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}<span>{workflowReady ? 'All required steps are complete. Review the campaign before launch.' : `${completedSteps} of 4 required steps complete. Open any step marked “Needs attention” to finish it.`}</span></div>}
    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as CampaignWorkspaceTab)}>
      <TabsList className="w-full justify-start gap-6 overflow-x-auto" aria-label="Campaign workflow">
        {workflowSections.map((section, index) => <TabsTrigger value={section.key} key={section.key} className="flex min-w-max items-center gap-2" title={section.issues.join(' ')}><span>{index + 1}. {section.label}</span>{section.complete ? <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" /> : <AlertCircle className="h-4 w-4 text-amber-700" aria-hidden="true" />}<span className="sr-only">{section.complete ? 'Complete' : 'Needs attention'}</span></TabsTrigger>)}
        <TabsTrigger value="review" className="flex min-w-max items-center gap-2"><span>5. Review</span>{workflowReady ? <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" /> : <AlertCircle className="h-4 w-4 text-amber-700" aria-hidden="true" />}<span className="sr-only">{workflowReady ? 'Ready' : 'Needs attention'}</span></TabsTrigger>
        <TabsTrigger value="activity" className="min-w-max gap-2">Activity</TabsTrigger>
      </TabsList>
      <TabsContent value="setup"><fieldset disabled={working} className="border-0 p-0"><Card className="max-w-2xl"><CardHeader><CardTitle>Campaign setup</CardTitle><p className="text-xs leading-5 text-muted-foreground">Name the campaign and select the exact survey recipients should receive.</p></CardHeader><CardContent className="space-y-4"><div><Label className="field-label" htmlFor="campaign-settings-name">Campaign name <span className="text-destructive" aria-hidden="true">*</span></Label><Input id="campaign-settings-name" value={name} required aria-required="true" aria-invalid={name.trim().length < 2} onChange={(event) => { markSetupDirty(); setName(event.target.value); }} />{name.trim().length < 2 && <p className="mt-1 text-xs text-destructive">Enter at least two characters.</p>}</div><div><Label className="field-label" htmlFor="campaign-settings-survey">Survey <span className="text-destructive" aria-hidden="true">*</span></Label><select id="campaign-settings-survey" aria-required="true" aria-invalid={!selectedSurveyId || selectedSurvey?.status !== 'live'} aria-describedby="campaign-settings-survey-help" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={selectedSurveyId} disabled={Boolean(campaign.launchedAt)} onChange={(event) => { markSetupDirty(); setSelectedSurveyId(event.target.value); }}><option value="">Select the survey to send</option>{surveys.map((item) => <option value={item.id} key={item.id}>{item.title} ({item.status})</option>)}</select><p id="campaign-settings-survey-help" className={`mt-1 text-xs leading-5 ${selectedSurvey && selectedSurvey.status !== 'live' ? 'text-destructive' : 'text-muted-foreground'}`}>{campaign.launchedAt ? 'The survey is locked after launch so recipient links and response attribution remain correct.' : !selectedSurvey ? 'Required: choose the exact survey for this campaign.' : selectedSurvey.status !== 'live' ? 'This survey must be published before the setup step is complete.' : 'The selected live survey will be linked in every campaign message.'}</p></div><Button disabled={working || !setupDirty || name.trim().length < 2 || !selectedSurveyId} onClick={() => void saveSetup()}><Save />{working ? 'Saving' : 'Save setup'}</Button></CardContent></Card></fieldset></TabsContent>
      <TabsContent value="audience" forceMount className="data-[state=inactive]:hidden"><AudienceEditor detail={detail} onRefresh={load} /></TabsContent>
      <TabsContent value="sequence" forceMount className="data-[state=inactive]:hidden"><SequenceEditor detail={detail} templates={templates} onRefresh={load} onDraftState={onSequenceDraftState} /></TabsContent>
      <TabsContent value="schedule"><fieldset disabled={working} className="border-0 p-0"><Card className="max-w-2xl"><CardHeader><CardTitle>Campaign schedule</CardTitle><p className="text-xs leading-5 text-muted-foreground">Choose and save when the first message may enter the delivery queue.</p></CardHeader><CardContent className="space-y-4">{!startAt && !campaign.launchedAt && <div className="flex gap-3 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="alert"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><div><div className="font-medium">Start time required</div><p className="mt-1 text-xs leading-5">Select a date and time below. The campaign cannot launch until this step is saved.</p></div></div>}<div><Label className="field-label" htmlFor="campaign-start-at">Start time <span className="text-destructive" aria-hidden="true">*</span></Label><div className="flex flex-col gap-2 sm:flex-row"><Input id="campaign-start-at" type="datetime-local" value={startAt} required aria-required="true" aria-invalid={!startAt} disabled={Boolean(campaign.launchedAt)} onChange={(event) => { markScheduleDirty(); setStartAt(event.target.value); }} /><Button type="button" variant="outline" disabled={Boolean(campaign.launchedAt)} onClick={() => { markScheduleDirty(); setStartAt(dateTimeInputValue(new Date().toISOString())); }}><CalendarClock />Use current time</Button></div><p className={`mt-1 text-xs ${!startAt ? 'text-destructive' : 'text-muted-foreground'}`}>{campaign.launchedAt ? 'The start time is locked after launch so queued delivery times remain accurate.' : `Required. Times are entered in ${timezone}. A past time starts as soon as the campaign is launched.`}</p></div><label className="flex items-start gap-3 border-t pt-4 text-sm"><input type="checkbox" className="mt-1 rounded border-input text-primary focus:ring-primary" checked={stopOnResponse} onChange={(event) => { markScheduleDirty(); setStopOnResponse(event.target.checked); }} /><span><span className="font-medium">Stop follow-ups after a response</span><span className="mt-1 block text-xs text-muted-foreground">Queued sequence messages are skipped as soon as this recipient completes the survey.</span></span></label><Button disabled={working || !scheduleDirty || !startAt} onClick={() => void saveSchedule()}><Save />{working ? 'Saving' : 'Save schedule'}</Button></CardContent></Card></fieldset></TabsContent>
      <TabsContent value="review"><Card className="max-w-3xl"><CardHeader><CardTitle>{campaign.status === 'draft' ? 'Review and launch' : 'Campaign summary'}</CardTitle><p className="text-xs leading-5 text-muted-foreground">{campaign.status === 'draft' ? 'Every required workflow step must be complete. You can return to any step without losing your place.' : 'The campaign setup and delivery choices are retained here for reference.'}</p></CardHeader><CardContent className="space-y-5"><div className="divide-y border">{workflowSections.map((section) => <button type="button" className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left hover:bg-muted/30" key={section.key} onClick={() => setActiveTab(section.key)}><div><div className="text-sm font-medium">{workflowLabels[section.key]}</div><div className={`mt-1 text-xs leading-5 ${section.complete ? 'text-muted-foreground' : 'text-destructive'}`}>{section.complete ? section.key === 'audience' ? campaign.status === 'draft' ? `${detail.contacts.filter((contact) => contact.status === 'active').length} active contact${detail.contacts.filter((contact) => contact.status === 'active').length === 1 ? '' : 's'}` : `${metrics.contacts} campaign contact${metrics.contacts === 1 ? '' : 's'}` : section.key === 'sequence' ? `${detail.steps.length} saved message${detail.steps.length === 1 ? '' : 's'}` : section.key === 'schedule' ? formatDateTime(campaign.startsAt) : `${survey.title} selected` : section.issues.join(' ')}</div></div>{section.complete ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-label="Complete" /> : <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-label="Needs attention" />}</button>)}</div>{campaign.status === 'draft' ? <div><Button disabled={working || !workflowReady} onClick={() => void transition('launch')}><Send />{working ? 'Launching' : 'Launch campaign'}</Button>{!workflowReady && <p className="mt-2 text-xs text-destructive" role="status">Complete the steps marked “Needs attention” before launching.</p>}</div> : <p className="text-sm text-muted-foreground">This campaign is {campaign.status}. Its setup is retained here for reference.</p>}</CardContent></Card></TabsContent>
      <TabsContent value="activity"><Activity detail={detail} /></TabsContent>
    </Tabs>
  </div>;
}
