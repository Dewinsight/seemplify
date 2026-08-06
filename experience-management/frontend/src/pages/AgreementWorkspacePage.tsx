import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Download, Eye, FileText, History, LibraryBig, Loader2, Mail, Plus, RefreshCw, Save, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, json } from '@/lib/api';
import { adminArtifactContentUrl, adminArtifactPreviewUrl, adminDocumentContentUrl, esignStatusLabel, normalizeEnvelopeDetail, signingRoles } from '@/lib/esign';
import { addSignedAgreementToKnowledge, getKnowledgeBases } from '@/lib/knowledgeBases';
import { formatDateTime } from '@/lib/utils';
import { Link, useParams } from '@/lib/router';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { AgreementFieldsStep } from '@/components/esign/AgreementFieldsStep';
import { PdfPreviewDialog } from '@/components/esign/PdfPreviewDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { ESignArtifact, ESignEnvelope, ESignEnvelopeDetail, ESignRecipient, ESignRecipientRole, ESignWorkflowSectionKey, KnowledgeBase } from '@/types';

type RecipientDraft = Pick<ESignRecipient, 'id' | 'name' | 'email' | 'role' | 'routingOrder' | 'accessCodeSet'> & { accessCode: string };
type WorkspaceTab = ESignWorkflowSectionKey | 'review' | 'activity';
const workflowLabels: Record<ESignWorkflowSectionKey, string> = { documents: 'Documents', recipients: 'Recipients', fields: 'Fields', message: 'Message' };
const workflowOrder: Array<ESignWorkflowSectionKey | 'review'> = ['documents', 'recipients', 'fields', 'message', 'review'];
const workflowDescriptions: Record<ESignWorkflowSectionKey | 'review', string> = {
  documents: 'Add the PDFs to sign',
  recipients: 'Choose who takes action',
  fields: 'Place signatures and inputs',
  message: 'Set the email and delivery',
  review: 'Verify and send'
};

function statusVariant(status: ESignEnvelope['status']) {
  if (status === 'completed') return 'success' as const;
  if (['declined', 'voided', 'expired', 'failed'].includes(status)) return 'destructive' as const;
  if (['sent', 'in_progress', 'finalizing'].includes(status)) return 'warning' as const;
  return 'secondary' as const;
}

function recipientDraft(recipient?: ESignRecipient, order = 1): RecipientDraft {
  return recipient ? { id: recipient.id, name: recipient.name, email: recipient.email, role: recipient.role, routingOrder: recipient.routingOrder, accessCodeSet: recipient.accessCodeSet, accessCode: '' }
    : { id: crypto.randomUUID(), name: '', email: '', role: 'signer', routingOrder: order, accessCodeSet: false, accessCode: '' };
}

function DocumentStep({ detail, onRefresh, onBusyChange }: { detail: ESignEnvelopeDetail; onRefresh: () => Promise<unknown>; onBusyChange: (busy: boolean) => void }) {
  const [uploading, setUploading] = useState(false);
  const editable = detail.envelope.status === 'draft';
  async function upload(file: File) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return toast.error('Choose a PDF document.');
    const body = new FormData(); body.append('file', file);
    try { setUploading(true); onBusyChange(true); await api(`/api/esign/envelopes/${detail.envelope.id}/documents`, { method: 'POST', body }); toast.success('Document uploaded'); await onRefresh(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not upload the document.'); }
    finally { setUploading(false); onBusyChange(false); }
  }
  async function remove(id: string) {
    if (!window.confirm('Remove this document and its placed fields?')) return;
    try { onBusyChange(true); await api(`/api/esign/envelopes/${detail.envelope.id}/documents/${id}`, { method: 'DELETE' }); toast.success('Document removed'); await onRefresh(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not remove the document.'); }
    finally { onBusyChange(false); }
  }
  return <Card><CardHeader><CardTitle id="agreement-documents-heading" tabIndex={-1}>Documents</CardTitle><p className="text-sm text-muted-foreground">Upload one or more PDF files. Every page opens directly in the Fields step.</p></CardHeader><CardContent className="space-y-4">
    {editable && <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center border border-dashed bg-muted/15 px-6 py-6 text-center transition-colors hover:bg-muted/30"><FileText className="h-5 w-5 text-muted-foreground" /><span className="mt-2 text-sm font-medium">{uploading ? 'Uploading document…' : 'Choose a PDF document'}</span><span className="mt-1 text-xs text-muted-foreground">The server verifies each file before it becomes available to recipients.</span><input className="sr-only" type="file" accept="application/pdf,.pdf" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} /></label>}
    {detail.documents.length ? <div className="divide-y border">{detail.documents.map((document) => <div className="flex items-center justify-between gap-4 px-4 py-3" key={document.id}><div className="min-w-0"><div className="truncate text-sm font-medium">{document.name}</div><div className="mt-1 text-xs text-muted-foreground">{document.pageCount} page{document.pageCount === 1 ? '' : 's'} · {(document.size / 1024 / 1024).toFixed(1)} MB</div></div>{editable ? <Button variant="ghost" size="icon" aria-label={`Remove ${document.name}`} onClick={() => void remove(document.id)}><Trash2 /></Button> : <Button variant="outline" size="sm" asChild><a href={adminDocumentContentUrl(detail.envelope.id, document.id)}><Download />Download</a></Button>}</div>)}</div> : <div className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="alert">Upload at least one PDF before sending.</div>}
  </CardContent></Card>;
}

function RecipientStep({ detail, onRefresh, onDirtyChange }: { detail: ESignEnvelopeDetail; onRefresh: () => Promise<unknown>; onDirtyChange: (dirty: boolean) => void }) {
  const [recipients, setRecipients] = useState<RecipientDraft[]>(() => detail.recipients.map((item) => recipientDraft(item)));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const editable = detail.envelope.status === 'draft';
  useEffect(() => { if (!dirty) setRecipients(detail.recipients.map((item) => recipientDraft(item))); }, [detail.recipients, dirty]);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  function replace(next: RecipientDraft[]) { setRecipients(next); setDirty(true); }
  function change(id: string, values: Partial<RecipientDraft>) { replace(recipients.map((item) => item.id === id ? { ...item, ...values } : item)); }
  const valid = recipients.length > 0 && recipients.some((item) => signingRoles.has(item.role)) && recipients.every((item) => item.name.trim().length >= 2 && /^\S+@\S+\.\S+$/.test(item.email.trim()) && item.routingOrder >= 1);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!valid) return toast.error('Complete every recipient and add at least one signer or approver.');
    try {
      setSaving(true);
      await api(`/api/esign/envelopes/${detail.envelope.id}/recipients`, json('PUT', { recipients: recipients.map((item) => ({
        id: detail.recipients.some((stored) => stored.id === item.id) ? item.id : undefined,
        name: item.name.trim(), email: item.email.trim().toLowerCase(), role: item.role, routingOrder: item.routingOrder,
        ...(item.accessCode ? { accessCode: item.accessCode } : {})
      })) }));
      setDirty(false); toast.success('Recipients saved'); await onRefresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save recipients.'); }
    finally { setSaving(false); }
  }
  return <Card><CardHeader><CardTitle id="agreement-recipients-heading" tabIndex={-1}>Recipients and signing order</CardTitle><p className="text-sm text-muted-foreground">Recipients sharing an order act at the same time. Later orders wait until the earlier group finishes.</p></CardHeader><CardContent><form onSubmit={save} className="space-y-4">
    {!valid && <div className="flex gap-3 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="alert"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />Add at least one signer or approver and complete every name, email and order.</div>}
    <fieldset disabled={!editable || saving} className="space-y-3 border-0 p-0">{recipients.map((recipient, index) => <section className="border" key={recipient.id} aria-label={`Recipient ${index + 1}`}>
      <div className="flex items-center justify-between border-b bg-muted/15 px-4 py-2.5"><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recipient {index + 1}</div><Button type="button" variant="ghost" size="icon" aria-label={`Remove ${recipient.name || `recipient ${index + 1}`}`} onClick={() => replace(recipients.filter((item) => item.id !== recipient.id))}><Trash2 /></Button></div>
      <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_minmax(230px,1.3fr)_170px_100px]">
        <div><Label className="field-label" htmlFor={`recipient-name-${recipient.id}`}>Name <span className="text-destructive">*</span></Label><Input id={`recipient-name-${recipient.id}`} value={recipient.name} onChange={(event) => change(recipient.id, { name: event.target.value })} required /></div>
        <div><Label className="field-label" htmlFor={`recipient-email-${recipient.id}`}>Email <span className="text-destructive">*</span></Label><Input id={`recipient-email-${recipient.id}`} type="email" value={recipient.email} onChange={(event) => change(recipient.id, { email: event.target.value })} required /></div>
        <div><Label className="field-label" htmlFor={`recipient-role-${recipient.id}`}>Role</Label><select id={`recipient-role-${recipient.id}`} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={recipient.role} onChange={(event) => change(recipient.id, { role: event.target.value as ESignRecipientRole })}><option value="signer">Needs to sign</option><option value="approver">Needs to approve</option><option value="cc">Receives a copy</option><option value="viewer">Needs to view</option></select></div>
        <div><Label className="field-label" htmlFor={`recipient-order-${recipient.id}`}>Order</Label><Input id={`recipient-order-${recipient.id}`} type="number" min={1} max={100} value={recipient.routingOrder} onChange={(event) => change(recipient.id, { routingOrder: Math.max(1, Number(event.target.value) || 1) })} /></div>
      </div>
      <div className="border-t bg-muted/10 p-4"><div className="max-w-md"><Label className="field-label" htmlFor={`recipient-code-${recipient.id}`}>Optional access code</Label><Input id={`recipient-code-${recipient.id}`} type="password" autoComplete="new-password" value={recipient.accessCode} onChange={(event) => change(recipient.id, { accessCode: event.target.value })} placeholder={recipient.accessCodeSet ? 'Code is set; enter to replace' : 'Add a PIN for this recipient'} /><p className="mt-1 text-[11px] text-muted-foreground">Share it separately. Access codes are never included in invitation emails.</p></div></div>
    </section>)}</fieldset>
    <div className="flex flex-wrap justify-between gap-2"><Button type="button" variant="outline" disabled={!editable || saving} onClick={() => replace([...recipients, recipientDraft(undefined, detail.envelope.routingMode === 'parallel' ? 1 : Math.max(0, ...recipients.map((item) => item.routingOrder)) + 1)])}><Plus />Add recipient</Button><Button disabled={!editable || !dirty || !valid || saving}>{saving ? <Loader2 className="animate-spin" /> : <Save />}{saving ? 'Saving' : 'Save recipients'}</Button></div>
    {!editable && <p className="text-sm text-muted-foreground">Recipients and routing are locked after the agreement is sent.</p>}
  </form></CardContent></Card>;
}

function MessageStep({ detail, onRefresh, onDirtyChange }: { detail: ESignEnvelopeDetail; onRefresh: () => Promise<unknown>; onDirtyChange: (dirty: boolean) => void }) {
  const [draft, setDraft] = useState(() => ({ title: detail.envelope.title, subject: detail.envelope.subject, message: detail.envelope.message, routingMode: detail.envelope.routingMode, expiresInDays: detail.envelope.expiresInDays, reminderIntervalHours: detail.envelope.reminderIntervalHours }));
  const [dirty, setDirty] = useState(false); const [saving, setSaving] = useState(false);
  const editable = detail.envelope.status === 'draft';
  useEffect(() => { if (!dirty) setDraft({ title: detail.envelope.title, subject: detail.envelope.subject, message: detail.envelope.message, routingMode: detail.envelope.routingMode, expiresInDays: detail.envelope.expiresInDays, reminderIntervalHours: detail.envelope.reminderIntervalHours }); }, [detail.envelope, dirty]);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  function change(values: Partial<typeof draft>) { setDraft((current) => ({ ...current, ...values })); setDirty(true); }
  const valid = draft.title.trim().length >= 2 && draft.subject.trim().length >= 2 && draft.message.trim().length >= 2 && draft.expiresInDays >= 1 && draft.reminderIntervalHours >= 1;
  async function save(event: FormEvent) {
    event.preventDefault(); if (!valid) return toast.error('Complete the agreement name, email and delivery settings.');
    try { setSaving(true); await api(`/api/esign/envelopes/${detail.envelope.id}`, json('PATCH', { ...draft, title: draft.title.trim(), subject: draft.subject.trim(), message: draft.message.trim() })); setDirty(false); toast.success('Message and delivery settings saved'); await onRefresh(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save the message.'); }
    finally { setSaving(false); }
  }
  return <Card><CardHeader><CardTitle id="agreement-message-heading" tabIndex={-1}>Email and delivery</CardTitle><p className="text-sm text-muted-foreground">Write the invitation and decide how recipients receive and complete the agreement.</p></CardHeader><CardContent><form className="space-y-4" onSubmit={save}><fieldset disabled={!editable || saving} className="space-y-4 border-0 p-0">
    <div><Label className="field-label" htmlFor="esign-title">Agreement name <span className="text-destructive">*</span></Label><Input id="esign-title" value={draft.title} onChange={(event) => change({ title: event.target.value })} required /></div>
    <div><Label className="field-label" htmlFor="esign-subject">Email subject <span className="text-destructive">*</span></Label><Input id="esign-subject" value={draft.subject} onChange={(event) => change({ subject: event.target.value })} required maxLength={250} /></div>
    <div><Label className="field-label" htmlFor="esign-message">Email message <span className="text-destructive">*</span></Label><Textarea id="esign-message" rows={7} value={draft.message} onChange={(event) => change({ message: event.target.value })} required maxLength={4000} /></div>
    <div className="grid gap-4 sm:grid-cols-3"><div><Label className="field-label" htmlFor="esign-routing-mode">Routing</Label><select id="esign-routing-mode" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.routingMode} onChange={(event) => change({ routingMode: event.target.value as typeof draft.routingMode })}><option value="sequential">Use recipient order</option><option value="parallel">Send to everyone together</option></select></div><div><Label className="field-label" htmlFor="esign-expiry">Expires after days</Label><Input id="esign-expiry" type="number" min={1} max={365} value={draft.expiresInDays} onChange={(event) => change({ expiresInDays: Number(event.target.value) })} /></div><div><Label className="field-label" htmlFor="esign-reminder">Reminder every hours</Label><Input id="esign-reminder" type="number" min={1} max={720} value={draft.reminderIntervalHours} onChange={(event) => change({ reminderIntervalHours: Number(event.target.value) })} /></div></div>
    <Button disabled={!dirty || !valid || saving}>{saving ? <Loader2 className="animate-spin" /> : <Save />}{saving ? 'Saving' : 'Save message'}</Button>
  </fieldset>{!editable && <p className="mt-4 text-sm text-muted-foreground">Delivery settings are retained for reference after sending.</p>}</form></CardContent></Card>;
}

function deliveryVariant(state: string) {
  if (['sent', 'delivered', 'opened'].includes(state)) return 'success' as const;
  if (['failed', 'bounced'].includes(state)) return 'destructive' as const;
  if (['queued', 'sending'].includes(state)) return 'warning' as const;
  return 'secondary' as const;
}

function recipientVariant(status: ESignRecipient['status']) {
  if (status === 'completed') return 'success' as const;
  if (['declined', 'delivery_failed'].includes(status)) return 'destructive' as const;
  if (['ready', 'sent', 'viewed', 'in_progress'].includes(status)) return 'warning' as const;
  return 'secondary' as const;
}

function readableStatus(value: string) {
  return value.replaceAll('_', ' ').replaceAll('.', ' · ');
}

function AgreementArtifactActions({ artifact, envelopeId }: { artifact: ESignArtifact; envelopeId: string }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [knowledgeBaseId, setKnowledgeBaseId] = useState('');
  const [loadingBases, setLoadingBases] = useState(false);
  const [adding, setAdding] = useState(false);
  const downloadUrl = adminArtifactContentUrl(envelopeId, artifact.id);
  const isSignedDocument = artifact.kind === 'completed_pdf' || artifact.kind === 'completed_document';

  async function openKnowledge() {
    setKnowledgeOpen(true);
    if (knowledgeBases.length || loadingBases) return;
    try {
      setLoadingBases(true);
      const bases = await getKnowledgeBases();
      setKnowledgeBases(bases);
      setKnowledgeBaseId(bases[0]?.id || '');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Knowledge bases could not be loaded.');
      setKnowledgeOpen(false);
    } finally { setLoadingBases(false); }
  }

  async function addToKnowledge() {
    if (!knowledgeBaseId) return;
    try {
      setAdding(true);
      await addSignedAgreementToKnowledge({ knowledgeBaseId, envelopeId, artifactId: artifact.id });
      toast.success('Signed agreement added to the knowledge base. Indexing will continue in the background.');
      setKnowledgeOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The signed agreement could not be added.');
    } finally { setAdding(false); }
  }

  return <div className="border p-2.5">
    <div className="truncate text-sm font-medium" title={artifact.name}>{artifact.name}</div>
    <div className="mt-2 grid grid-cols-2 gap-2">
      <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}><Eye />Preview</Button>
      <Button variant="outline" size="sm" asChild><a href={adminArtifactContentUrl(envelopeId, artifact.id)} aria-label={`Download ${artifact.name}`}><Download />Download</a></Button>
    </div>
    {isSignedDocument && <Button variant="ghost" size="sm" className="mt-1 w-full justify-start" onClick={() => void openKnowledge()}><LibraryBig />Add to knowledge base</Button>}
    <PdfPreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} name={artifact.name} previewUrl={adminArtifactPreviewUrl(envelopeId, artifact.id)} downloadUrl={downloadUrl} />
    <Dialog open={knowledgeOpen} onOpenChange={setKnowledgeOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add signed agreement to knowledge</DialogTitle><DialogDescription>The final signed PDF will be indexed with its source envelope and integrity hash. Existing identical documents are not duplicated.</DialogDescription></DialogHeader>
        {loadingBases ? <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="animate-spin" />Loading knowledge bases…</div>
          : knowledgeBases.length ? <div><Label htmlFor={`agreement-knowledge-${artifact.id}`}>Knowledge base</Label><select id={`agreement-knowledge-${artifact.id}`} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={knowledgeBaseId} onChange={(event) => setKnowledgeBaseId(event.target.value)}>{knowledgeBases.map((base) => <option key={base.id} value={base.id}>{base.name}{base.privacy === 'private' ? ' · Private' : ''}</option>)}</select></div>
            : <div className="border border-dashed px-4 py-6 text-sm text-muted-foreground">Create a knowledge base first, then return here to add the signed agreement.</div>}
        <DialogFooter><Button variant="outline" onClick={() => setKnowledgeOpen(false)} disabled={adding}>Cancel</Button><Button onClick={() => void addToKnowledge()} disabled={adding || !knowledgeBaseId}>{adding ? <Loader2 className="animate-spin" /> : <LibraryBig />}Add and index</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

function ActivityStep({ detail, envelopeId, working, onRetryFinalization }: {
  detail: ESignEnvelopeDetail; envelopeId: string; working: boolean; onRetryFinalization: () => Promise<void>;
}) {
  const { envelope } = detail;
  const finalizationFailed = envelope.status === 'failed' && Boolean(envelope.finalizationError);
  return <div className="space-y-5">
    {finalizationFailed && <div className="flex flex-col gap-4 border border-red-200 bg-red-50 px-5 py-4 text-red-950 sm:flex-row sm:items-start sm:justify-between" role="alert">
      <div className="flex min-w-0 gap-3"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><div><div className="font-medium">Document finalization failed</div><p className="mt-1 break-words text-sm leading-6">{envelope.finalizationError}</p><p className="mt-1 text-xs text-red-800">Attempt {envelope.finalizationAttempt || 0}. Recipient signatures remain recorded while the final document is rebuilt.</p></div></div>
      <Button variant="outline" className="shrink-0 border-red-300 bg-white" disabled={working} onClick={() => void onRetryFinalization()}>{working ? <Loader2 className="animate-spin" /> : <RefreshCw />}Retry finalization</Button>
    </div>}

    <Card><CardHeader><CardTitle>Recipient progress</CardTitle><p className="text-sm text-muted-foreground">Current routing and signing state for every person on this agreement.</p></CardHeader><CardContent className="px-0 pb-0"><div className="overflow-x-auto"><table className="data-table min-w-[760px]"><thead><tr><th>Recipient</th><th>Role</th><th>Order</th><th>Status</th><th>Sent</th><th>Viewed</th><th>Completed</th></tr></thead><tbody>{detail.recipients.map((recipient) => <tr key={recipient.id}>
      <td><div className="font-medium">{recipient.name}</div><div className="mt-0.5 text-xs text-muted-foreground">{recipient.email}</div></td>
      <td className="capitalize">{readableStatus(recipient.role)}</td><td>{recipient.routingOrder}</td>
      <td><Badge variant={recipientVariant(recipient.status)} className="capitalize">{readableStatus(recipient.status)}</Badge></td>
      <td>{recipient.sentAt ? formatDateTime(recipient.sentAt) : 'Not yet'}</td><td>{recipient.viewedAt ? formatDateTime(recipient.viewedAt) : 'Not yet'}</td><td>{recipient.completedAt ? formatDateTime(recipient.completedAt) : 'Not yet'}</td>
    </tr>)}</tbody></table></div>{!detail.recipients.length && <div className="px-5 pb-8 text-sm text-muted-foreground">No recipients have been added.</div>}</CardContent></Card>

    <Card><CardHeader><CardTitle>Email delivery</CardTitle><p className="text-sm text-muted-foreground">Invitation, reminder and completion email attempts update here in real time.</p></CardHeader><CardContent className="px-0 pb-0">{detail.deliveries.length ? <div className="overflow-x-auto"><table className="data-table min-w-[1040px]"><thead><tr><th>Recipient</th><th>Message</th><th>State</th><th>Attempts</th><th>Timeline</th><th>Provider</th><th>Updated</th></tr></thead><tbody>{detail.deliveries.map((delivery) => <tr key={delivery.id}>
      <td><div className="font-medium">{delivery.recipientName}</div><div className="mt-0.5 text-xs text-muted-foreground">{delivery.recipientEmail}</div></td>
      <td className="capitalize">{readableStatus(delivery.kind)}</td>
      <td><Badge variant={deliveryVariant(delivery.state)} className="capitalize">{readableStatus(delivery.state)}</Badge>{delivery.error && <div className="mt-1.5 max-w-xs break-words text-xs leading-5 text-destructive">{delivery.error}</div>}</td>
      <td>{delivery.attempts}</td>
      <td className="whitespace-nowrap text-xs leading-5"><div>Scheduled {formatDateTime(delivery.scheduledAt)}</div>{delivery.sentAt && <div>Sent {formatDateTime(delivery.sentAt)}</div>}{delivery.deliveredAt && <div>Delivered {formatDateTime(delivery.deliveredAt)}</div>}{delivery.openedAt && <div>Opened {formatDateTime(delivery.openedAt)}</div>}{delivery.bouncedAt && <div className="text-destructive">Bounced {formatDateTime(delivery.bouncedAt)}</div>}</td>
      <td><div className="max-w-[220px] break-all text-xs">{delivery.providerStatus || 'No provider update'}</div>{delivery.providerMessageId && <div className="mt-1 max-w-[220px] break-all font-mono text-[11px] text-muted-foreground">{delivery.providerMessageId}</div>}{delivery.providerUpdatedAt && <div className="mt-1 text-[11px] text-muted-foreground">{formatDateTime(delivery.providerUpdatedAt)}</div>}</td>
      <td className="whitespace-nowrap">{formatDateTime(delivery.updatedAt)}</td>
    </tr>)}</tbody></table></div> : <div className="px-5 pb-8 text-sm text-muted-foreground">No emails have been queued. Delivery attempts appear after the agreement is sent.</div>}</CardContent></Card>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]"><Card><CardHeader><CardTitle>Signing history</CardTitle></CardHeader><CardContent className="px-0 pb-0">{detail.audit.length ? <div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Event</th><th>Actor</th><th>When</th></tr></thead><tbody>{detail.audit.map((event) => <tr key={event.id}><td className="font-medium capitalize">{readableStatus(event.action)}</td><td>{event.actorName || event.actorType || 'System'}</td><td>{formatDateTime(event.createdAt)}</td></tr>)}</tbody></table></div> : <div className="px-5 pb-8 text-sm text-muted-foreground">Activity appears here as documents are sent, viewed and completed.</div>}</CardContent></Card>
      <Card className="h-fit"><CardHeader><CardTitle>Files and evidence</CardTitle></CardHeader><CardContent className="space-y-2">{detail.artifacts.length ? detail.artifacts.map((artifact) => <AgreementArtifactActions key={artifact.id} artifact={artifact} envelopeId={envelopeId} />) : <div className="flex gap-3 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4 shrink-0" />Completed documents and the completion certificate will appear here.</div>}</CardContent></Card>
    </div>
  </div>;
}

export function AgreementWorkspacePage() {
  const { id = '' } = useParams();
  const requestedStep = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('step');
  const initialTab: WorkspaceTab = workflowOrder.includes(requestedStep as ESignWorkflowSectionKey | 'review') ? requestedStep as WorkspaceTab : 'documents';
  const [detail, setDetail] = useState<ESignEnvelopeDetail | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab);
  const [fieldsVisited, setFieldsVisited] = useState(initialTab === 'fields');
  const [recipientDirty, setRecipientDirty] = useState(false);
  const [messageDirty, setMessageDirty] = useState(false);
  const [fieldDirty, setFieldDirty] = useState(false);
  const [fieldSaving, setFieldSaving] = useState(false);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [working, setWorking] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false); const [voidReason, setVoidReason] = useState('');
  const loadSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    const next = normalizeEnvelopeDetail(await api<ESignEnvelopeDetail>(`/api/esign/envelopes/${id}`));
    if (sequence === loadSequence.current) setDetail(next);
    return next;
  }, [id]);
  const acceptDetail = useCallback((next: ESignEnvelopeDetail) => {
    loadSequence.current += 1;
    setDetail(next);
  }, []);
  useEffect(() => { void load().catch((error) => toast.error(error instanceof Error ? error.message : 'Could not load the agreement.')); }, [load]);
  const refreshWhenClean = useCallback(() => { if (!recipientDirty && !messageDirty && !fieldDirty) void load(); }, [fieldDirty, load, messageDirty, recipientDirty]);
  useLiveRefresh(refreshWhenClean);
  const onRecipientDirty = useCallback((value: boolean) => setRecipientDirty(value), []);
  const onMessageDirty = useCallback((value: boolean) => setMessageDirty(value), []);
  const onFieldDirty = useCallback((value: boolean) => setFieldDirty(value), []);
  const onFieldSaving = useCallback((value: boolean) => setFieldSaving(value), []);
  const hasUnsavedChanges = recipientDirty || messageDirty || fieldDirty;
  useUnsavedChanges(hasUnsavedChanges);
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const guardLinks = (event: globalThis.MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
      const href = anchor?.getAttribute('href');
      if (!anchor || !href || href.startsWith('#') || anchor.target === '_blank' || href === `${window.location.pathname}${window.location.search}`) return;
      if (!window.confirm('Leave this agreement and discard your unsaved changes?')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener('click', guardLinks, true);
    return () => document.removeEventListener('click', guardLinks, true);
  }, [hasUnsavedChanges]);
  useEffect(() => {
    if (!detail) return;
    const frame = window.requestAnimationFrame(() => {
      const activeStep = document.querySelector<HTMLElement>('[data-workflow-step][data-state="active"]');
      const scroller = activeStep?.parentElement?.parentElement;
      if (activeStep && scroller) scroller.scrollTo({ left: Math.max(0, activeStep.offsetLeft - (scroller.clientWidth - activeStep.clientWidth) / 2), behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, detail?.envelope.id]);

  const workflow = useMemo(() => {
    if (!detail) return [];
    return (Object.entries(workflowLabels) as Array<[ESignWorkflowSectionKey, string]>).map(([key, label]) => {
      const backend = detail.readiness.sections[key];
      const localDirty = key === 'recipients' ? recipientDirty : key === 'message' ? messageDirty : key === 'fields' ? fieldDirty : false;
      return { key, label, complete: backend.complete && !localDirty, issues: localDirty ? [`Save the ${label.toLowerCase()} changes.`] : backend.issues };
    });
  }, [detail, fieldDirty, messageDirty, recipientDirty]);
  const ready = Boolean(detail?.readiness.ready) && workflow.length === 4 && workflow.every((section) => section.complete);
  const workflowBusy = documentBusy || fieldSaving || working;

  function goTo(tab: WorkspaceTab) {
    if (tab === 'fields') setFieldsVisited(true);
    setActiveTab(tab);
    const headingId = tab === 'documents' ? 'agreement-documents-heading'
      : tab === 'recipients' ? 'agreement-recipients-heading'
        : tab === 'fields' ? 'agreement-fields-heading'
          : tab === 'message' ? 'agreement-message-heading'
            : tab === 'review' ? 'agreement-review-heading'
              : 'agreement-activity-heading';
    window.requestAnimationFrame(() => document.getElementById(headingId)?.focus());
  }

  async function send() {
    if (!ready) {
      const first = workflow.find((section) => !section.complete);
      goTo(first?.key || 'review');
      return toast.error(first?.issues[0] || 'Complete the agreement before sending.');
    }
    try {
      setWorking(true);
      await api(`/api/esign/envelopes/${id}/send`, json('POST', {}));
      toast.success('Agreement sent');
      await load();
    } catch (error) {
      try {
        const current = await load();
        const first = (Object.keys(workflowLabels) as ESignWorkflowSectionKey[]).find((key) => !current.readiness.sections[key].complete);
        if (first) goTo(first);
      } catch {}
      toast.error(error instanceof Error ? error.message : 'Could not send the agreement.');
    } finally {
      setWorking(false);
    }
  }
  async function remind() { try { setWorking(true); await api(`/api/esign/envelopes/${id}/remind`, json('POST', {})); toast.success('Reminder queued for current recipients'); await load(); } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not send reminders.'); } finally { setWorking(false); } }
  async function voidAgreement() { if (voidReason.trim().length < 2) return; try { setWorking(true); await api(`/api/esign/envelopes/${id}/void`, json('POST', { reason: voidReason.trim() })); setVoidOpen(false); toast.success('Agreement voided'); await load(); } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not void the agreement.'); } finally { setWorking(false); } }
  async function retryFinalization() { try { setWorking(true); await api(`/api/esign/envelopes/${id}/retry-finalization`, json('POST', {})); toast.success('Document finalization queued again'); await load(); } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not retry document finalization.'); } finally { setWorking(false); } }
  if (!detail) return <div className="h-96 animate-pulse bg-muted" />;
  const { envelope } = detail;
  const completedCount = workflow.filter((item) => item.complete).length;
  const firstIncomplete = workflow.find((item) => !item.complete);
  const activeIndex = workflowOrder.indexOf(activeTab as ESignWorkflowSectionKey | 'review');
  const previousStep = activeIndex > 0 ? workflowOrder[activeIndex - 1] : null;
  const nextStep = activeIndex >= 0 && activeIndex < workflowOrder.length - 1 ? workflowOrder[activeIndex + 1] : null;
  const currentSection = activeTab === 'review' || activeTab === 'activity' ? null : workflow.find((item) => item.key === activeTab);
  const canAdvance = Boolean(currentSection?.complete) && !workflowBusy;
  const advanceIssue = documentBusy ? 'Wait for the document upload to finish.'
    : fieldSaving ? 'Wait for the signing fields to finish saving.'
      : currentSection?.issues[0] || '';

  return <div className="space-y-5">
    <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-3 mb-2"><Link to="/agreements"><ArrowLeft />All agreements</Link></Button>
        <div className="flex flex-wrap items-center gap-3"><h1 className="page-title">{envelope.title}</h1><Badge variant={statusVariant(envelope.status)}>{esignStatusLabel(envelope.status)}</Badge></div>
        <p className="page-description">{detail.documents.length} document{detail.documents.length === 1 ? '' : 's'} · {detail.recipients.length} recipient{detail.recipients.length === 1 ? '' : 's'} · Updated {formatDateTime(envelope.updatedAt)}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant={activeTab === 'activity' ? 'secondary' : 'outline'} size="sm" onClick={() => goTo('activity')}><History />Activity</Button>
        {envelope.status === 'draft' ? <Button size="sm" disabled={!ready || workflowBusy} onClick={() => goTo('review')}><Send />Review and send</Button>
          : ['sent', 'in_progress'].includes(envelope.status) ? <><Button variant="outline" size="sm" disabled={working} onClick={() => void remind()}><Mail />Send reminder</Button><Button variant="destructive" size="sm" disabled={working} onClick={() => setVoidOpen(true)}>Void</Button></> : null}
      </div>
    </div>

    {envelope.status === 'draft' && <div className={`flex gap-3 border px-4 py-3 text-sm ${ready ? 'border-emerald-200 bg-emerald-50 text-emerald-950' : 'border-amber-200 bg-amber-50 text-amber-950'}`} aria-live="polite">
      {ready ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
      <div><div className="font-medium">{ready ? 'Every required step is complete.' : `${completedCount} of 4 required steps complete.`}</div><div className="mt-0.5 text-xs">{ready ? 'Review the agreement before invitations are sent.' : firstIncomplete?.issues[0]}</div></div>
    </div>}

    <Tabs value={activeTab} onValueChange={(value) => goTo(value as WorkspaceTab)}>
      <div className="border bg-card">
        <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="text-sm font-semibold">Agreement preparation</div><div className="mt-0.5 text-xs text-muted-foreground">Complete the four required sections, then review the final delivery.</div></div>
          <div className="text-xs font-medium text-muted-foreground">{completedCount} / 4 required sections complete</div>
        </div>
        <div className="overflow-x-auto">
          <TabsList className="grid min-w-[840px] grid-cols-5 items-stretch gap-0 border-b-0" aria-label="Agreement preparation">
            {workflowOrder.map((key, index) => {
              const section = key === 'review' ? null : workflow.find((item) => item.key === key);
              const complete = key === 'review' ? ready : Boolean(section?.complete);
              const status = key === 'review' ? ready ? 'Ready' : 'Waiting for required steps' : complete ? 'Complete' : 'Needs attention';
              return <TabsTrigger value={key} key={key} data-workflow-step className="h-full min-w-0 items-start justify-start gap-3 border-b-0 border-r px-4 py-4 text-left last:border-r-0 data-[state=active]:border-b-0 data-[state=active]:bg-primary/5">
                <span className={`grid h-7 w-7 shrink-0 place-items-center border text-xs font-semibold ${complete ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-border bg-background text-muted-foreground'}`}>{index + 1}</span>
                <span className="min-w-0"><span className="block text-sm font-semibold text-foreground">{key === 'review' ? 'Review' : workflowLabels[key]}</span><span className="mt-0.5 block text-[11px] font-normal leading-4 text-muted-foreground">{workflowDescriptions[key]}</span><span className={`mt-1 block text-[11px] ${complete ? 'text-emerald-700' : 'text-amber-700'}`}>{status}</span></span>
              </TabsTrigger>;
            })}
          </TabsList>
        </div>
      </div>

      <TabsContent value="documents"><DocumentStep detail={detail} onRefresh={load} onBusyChange={setDocumentBusy} /></TabsContent>
      <TabsContent value="recipients" forceMount className="data-[state=inactive]:hidden"><RecipientStep detail={detail} onRefresh={load} onDirtyChange={onRecipientDirty} /></TabsContent>
      {fieldsVisited && <TabsContent value="fields" forceMount className="data-[state=inactive]:hidden"><AgreementFieldsStep detail={detail} onDetailChange={acceptDetail} onDirtyChange={onFieldDirty} onSavingChange={onFieldSaving} /></TabsContent>}
      <TabsContent value="message" forceMount className="data-[state=inactive]:hidden"><MessageStep detail={detail} onRefresh={load} onDirtyChange={onMessageDirty} /></TabsContent>
      <TabsContent value="review">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card><CardHeader><CardTitle id="agreement-review-heading" tabIndex={-1}>{envelope.status === 'draft' ? 'Review and send' : 'Agreement summary'}</CardTitle><p className="text-sm text-muted-foreground">Check every required part before invitations are delivered.</p></CardHeader><CardContent className="space-y-5">
            <div className="divide-y border">{workflow.map((section) => <button type="button" key={section.key} className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/30" onClick={() => goTo(section.key)}><div><div className="text-sm font-medium">{section.label}</div><div className={`mt-1 text-xs leading-5 ${section.complete ? 'text-muted-foreground' : 'text-destructive'}`}>{section.complete ? section.key === 'documents' ? `${detail.documents.length} PDF document${detail.documents.length === 1 ? '' : 's'}` : section.key === 'recipients' ? `${detail.recipients.length} recipient${detail.recipients.length === 1 ? '' : 's'}` : section.key === 'fields' ? `${detail.fields.length} placed field${detail.fields.length === 1 ? '' : 's'}` : 'Email and delivery settings saved' : section.issues.join(' ')}</div></div>{section.complete ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-700" /> : <AlertCircle className="mt-0.5 h-5 w-5 text-amber-700" />}</button>)}</div>
            {envelope.status === 'draft' ? <div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => goTo('message')}><ChevronLeft />Back to message</Button><Button disabled={!ready || workflowBusy} onClick={() => void send()}><Send />{working ? 'Sending' : 'Send for signature'}</Button></div>{!ready && <p className="mt-2 text-xs text-destructive">Complete every required section before sending.</p>}</div> : <p className="text-sm text-muted-foreground">This agreement is {esignStatusLabel(envelope.status).toLowerCase()}.</p>}
          </CardContent></Card>
          <Card className="h-fit"><CardHeader><CardTitle>Delivery summary</CardTitle></CardHeader><CardContent className="space-y-4 text-sm">
            <div><div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Routing</div><div className="mt-1">{envelope.routingMode === 'parallel' ? 'All action recipients together' : 'Recipient order, one group at a time'}</div></div>
            <div><div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Expiry</div><div className="mt-1">{envelope.expiresInDays} days after sending</div></div>
            <div><div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reminders</div><div className="mt-1">Every {envelope.reminderIntervalHours} hours while pending</div></div>
            <div className="flex gap-2 border-t pt-4 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />The server checks every requirement again before sending.</div>
          </CardContent></Card>
        </div>
      </TabsContent>
      <TabsContent value="activity"><div id="agreement-activity-heading" tabIndex={-1}><ActivityStep detail={detail} envelopeId={id} working={working} onRetryFinalization={retryFinalization} /></div></TabsContent>
    </Tabs>

    {envelope.status === 'draft' && activeTab !== 'activity' && activeTab !== 'review' && <div className="sticky bottom-24 z-20 flex flex-col gap-3 border bg-background/95 px-4 py-3 shadow-panel backdrop-blur sm:flex-row sm:items-center sm:justify-between" aria-label="Workflow navigation">
      <Button variant="outline" disabled={!previousStep} onClick={() => previousStep && goTo(previousStep)}><ChevronLeft />Back</Button>
      <div className="min-w-0 text-center text-xs text-muted-foreground" id="workflow-next-requirement">{nextStep && !canAdvance ? advanceIssue : nextStep ? `Continue to ${nextStep === 'review' ? 'Review' : workflowLabels[nextStep]}.` : ''}</div>
      {nextStep ? <Button disabled={!canAdvance} aria-describedby={!canAdvance ? 'workflow-next-requirement' : undefined} onClick={() => goTo(nextStep)}>Next: {nextStep === 'review' ? 'Review' : workflowLabels[nextStep]}<ChevronRight /></Button> : <div className="hidden h-9 w-[120px] sm:block" aria-hidden="true" />}
    </div>}

    <Dialog open={voidOpen} onOpenChange={setVoidOpen}><DialogContent><DialogHeader><DialogTitle>Void agreement</DialogTitle><DialogDescription>This is irreversible. Outstanding signing links will stop working.</DialogDescription></DialogHeader><div><Label className="field-label" htmlFor="void-reason">Reason <span className="text-destructive">*</span></Label><Textarea id="void-reason" value={voidReason} onChange={(event) => setVoidReason(event.target.value)} rows={4} /></div><DialogFooter><Button variant="outline" onClick={() => setVoidOpen(false)}>Cancel</Button><Button variant="destructive" disabled={working || voidReason.trim().length < 2} onClick={() => void voidAgreement()}>{working ? <Loader2 className="animate-spin" /> : <Clock3 />}Void agreement</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
