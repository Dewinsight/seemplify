import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Minus, Plus, Save } from 'lucide-react';
import { toast } from 'sonner';
import { api, json } from '@/lib/api';
import { normalizeEnvelopeDetail, signingRoles } from '@/lib/esign';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { FieldProperties, PdfAgreementEditor } from '@/components/esign/PdfAgreementEditor';
import type { ESignEnvelopeDetail, ESignField } from '@/types';

type AgreementFieldsStepProps = {
  detail: ESignEnvelopeDetail;
  onDetailChange: (detail: ESignEnvelopeDetail) => void;
  onDirtyChange: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
  className?: string;
};

export function AgreementFieldsStep({
  detail,
  onDetailChange,
  onDirtyChange,
  onSavingChange,
  className
}: AgreementFieldsStepProps) {
  const [fields, setFields] = useState<ESignField[]>(detail.fields);
  const [selectedId, setSelectedId] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(0.95);
  const editable = detail.envelope.status === 'draft';
  const hasActionRecipient = detail.recipients.some((recipient) => signingRoles.has(recipient.role));
  const selected = useMemo(() => fields.find((field) => field.id === selectedId), [fields, selectedId]);

  useEffect(() => {
    if (dirty) return;
    setFields(detail.fields);
    setSelectedId((current) => detail.fields.some((field) => field.id === current) ? current : '');
  }, [detail.fields, dirty]);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => onSavingChange?.(saving), [onSavingChange, saving]);
  useEffect(() => () => {
    onDirtyChange(false);
    onSavingChange?.(false);
  }, [onDirtyChange, onSavingChange]);

  function change(next: ESignField[]) {
    setFields(next);
    setDirty(true);
  }

  async function save() {
    if (!editable || !dirty || !detail.documents.length || !hasActionRecipient) return;
    try {
      setSaving(true);
      const next = normalizeEnvelopeDetail(await api<ESignEnvelopeDetail>(
        `/api/esign/envelopes/${detail.envelope.id}/fields`,
        json('PUT', {
          fields: fields.map((field) => ({
            id: detail.fields.some((stored) => stored.id === field.id) ? field.id : undefined,
            documentId: field.documentId,
            recipientId: field.recipientId,
            type: field.type,
            page: field.page,
            x: field.x,
            y: field.y,
            width: field.width,
            height: field.height,
            required: field.required,
            label: field.label,
            placeholder: field.placeholder,
            options: field.options
          }))
        })
      ));
      setFields(next.fields);
      setSelectedId((current) => next.fields.some((field) => field.id === current) ? current : '');
      setDirty(false);
      onDetailChange(next);
      toast.success('Signing fields saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save signing fields.');
    } finally {
      setSaving(false);
    }
  }

  return <section className={cn('overflow-hidden border bg-card', className)} aria-labelledby="agreement-fields-heading">
    <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div>
        <h2 id="agreement-fields-heading" tabIndex={-1} className="text-base font-semibold">Place signing fields</h2>
        <p className="mt-1 text-sm text-muted-foreground">Choose a recipient, then drag a field onto any PDF page.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center border" aria-label="Document zoom">
          <Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.55, value - 0.1))}><Minus /></Button>
          <span className="w-14 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(1.8, value + 0.1))}><Plus /></Button>
        </div>
        {dirty && <span className="text-xs font-medium text-amber-700">Unsaved changes</span>}
        <Button
          size="sm"
          variant="outline"
          disabled={!editable || !dirty || saving || !detail.documents.length || !hasActionRecipient}
          onClick={() => void save()}
        >
          {saving ? <Loader2 className="animate-spin" /> : dirty ? <Save /> : <Check />}
          {saving ? 'Saving' : dirty ? 'Save fields' : 'Fields saved'}
        </Button>
      </div>
    </div>

    {!detail.documents.length ? <div className="m-5 border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950" role="status">
      Upload a PDF in Documents before placing signing fields.
    </div> : !hasActionRecipient ? <div className="m-5 border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950" role="status">
      Add a signer or approver in Recipients before placing signing fields.
    </div> : <div className="flex min-h-[760px] flex-col overflow-hidden lg:h-[calc(100vh-280px)] lg:min-h-[680px] lg:max-h-[900px] xl:flex-row">
      <PdfAgreementEditor
        envelopeId={detail.envelope.id}
        documents={detail.documents}
        recipients={detail.recipients}
        fields={fields}
        onChange={change}
        selectedId={selectedId}
        onSelectedIdChange={setSelectedId}
        zoom={zoom}
      />
      <FieldProperties
        field={selected}
        recipients={detail.recipients}
        onChange={(field) => change(fields.map((item) => item.id === field.id ? field : item))}
        onDelete={() => {
          change(fields.filter((item) => item.id !== selectedId));
          setSelectedId('');
        }}
      />
    </div>}
  </section>;
}
