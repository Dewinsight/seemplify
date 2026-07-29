import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Loader2, Minus, Plus, Save } from 'lucide-react';
import { toast } from 'sonner';
import { api, json } from '@/lib/api';
import { normalizeEnvelopeDetail } from '@/lib/esign';
import { Link, useParams } from '@/lib/router';
import { Button } from '@/components/ui/button';
import { FieldProperties, PdfAgreementEditor } from '@/components/esign/PdfAgreementEditor';
import type { ESignEnvelopeDetail, ESignField } from '@/types';

export function AgreementPreparePage() {
  const { id = '' } = useParams(); const [detail, setDetail] = useState<ESignEnvelopeDetail | null>(null); const [fields, setFields] = useState<ESignField[]>([]);
  const [selectedId, setSelectedId] = useState(''); const [dirty, setDirty] = useState(false); const [saving, setSaving] = useState(false); const [zoom, setZoom] = useState(0.95);
  const load = useCallback(async () => { const next = normalizeEnvelopeDetail(await api<ESignEnvelopeDetail>(`/api/esign/envelopes/${id}`)); setDetail(next); setFields((current) => dirty ? current : next.fields); }, [dirty, id]);
  useEffect(() => { void load().catch((error) => toast.error(error instanceof Error ? error.message : 'Could not load the field editor.')); }, [id]);
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  function change(next: ESignField[]) { setFields(next); setDirty(true); }
  async function save() {
    if (!detail) return;
    try { setSaving(true); const next = normalizeEnvelopeDetail(await api<ESignEnvelopeDetail>(`/api/esign/envelopes/${id}/fields`, json('PUT', { fields: fields.map((field) => ({ id: detail.fields.some((stored) => stored.id === field.id) ? field.id : undefined, documentId: field.documentId, recipientId: field.recipientId, type: field.type, page: field.page, x: field.x, y: field.y, width: field.width, height: field.height, required: field.required, label: field.label, placeholder: field.placeholder, options: field.options })) }))); setDetail(next); setFields(next.fields); setSelectedId((current) => next.fields.some((field) => field.id === current) ? current : ''); setDirty(false); toast.success('Signing fields saved'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save signing fields.'); }
    finally { setSaving(false); }
  }
  const selected = useMemo(() => fields.find((field) => field.id === selectedId), [fields, selectedId]);
  if (!detail) return <div className="h-screen animate-pulse bg-muted" />;
  return <div className="flex h-[calc(100vh-52px)] min-h-[620px] flex-col overflow-hidden bg-background">
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b bg-card px-3 py-2 sm:px-4"><div className="flex min-w-0 items-center gap-2"><Button variant="ghost" size="icon" asChild><Link to={`/agreements/${id}`} aria-label="Back to agreement"><ArrowLeft /></Link></Button><div className="min-w-0"><div className="truncate text-sm font-semibold">{detail.envelope.title}</div><div className="text-xs text-muted-foreground">Prepare signing fields</div></div></div><div className="flex items-center gap-2"><div className="hidden items-center border sm:flex"><Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.55, value - 0.1))}><Minus /></Button><span className="w-14 text-center text-xs">{Math.round(zoom * 100)}%</span><Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(1.8, value + 0.1))}><Plus /></Button></div>{dirty && <span className="hidden text-xs font-medium text-amber-700 sm:inline">Unsaved changes</span>}<Button size="sm" variant="outline" disabled={!dirty || saving} onClick={() => void save()}>{saving ? <Loader2 className="animate-spin" /> : dirty ? <Save /> : <Check />}{saving ? 'Saving' : dirty ? 'Save fields' : 'Saved'}</Button><Button size="sm" asChild disabled={dirty}><Link to={`/agreements/${id}`}>Review</Link></Button></div></div>
    {!detail.recipients.some((recipient) => ['signer', 'approver'].includes(recipient.role)) ? <div className="m-5 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">Add a signer or approver before placing fields.</div> : !detail.documents.length ? <div className="m-5 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">Upload a PDF before placing fields.</div> : <div className="flex min-h-0 flex-1 flex-col xl:flex-row"><PdfAgreementEditor envelopeId={id} documents={detail.documents} recipients={detail.recipients} fields={fields} onChange={change} selectedId={selectedId} onSelectedIdChange={setSelectedId} zoom={zoom} /><FieldProperties field={selected} recipients={detail.recipients} onChange={(field) => change(fields.map((item) => item.id === field.id ? field : item))} onDelete={() => { change(fields.filter((item) => item.id !== selectedId)); setSelectedId(''); }} /></div>}
  </div>;
}
