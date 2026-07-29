import type {
  ESignEnvelopeDetail, ESignEnvelopeStatus, ESignField, ESignFieldType, ESignReadiness,
  ESignRecipient, ESignWorkflowSectionKey
} from '@/types';

export const esignFieldDefinitions: Array<{ type: ESignFieldType; label: string; defaultWidth: number; defaultHeight: number }> = [
  { type: 'signature', label: 'Signature', defaultWidth: 0.24, defaultHeight: 0.075 },
  { type: 'initials', label: 'Initials', defaultWidth: 0.13, defaultHeight: 0.065 },
  { type: 'name', label: 'Full name', defaultWidth: 0.22, defaultHeight: 0.045 },
  { type: 'email', label: 'Email', defaultWidth: 0.25, defaultHeight: 0.045 },
  { type: 'date_signed', label: 'Date signed', defaultWidth: 0.18, defaultHeight: 0.045 },
  { type: 'text', label: 'Text', defaultWidth: 0.24, defaultHeight: 0.055 },
  { type: 'checkbox', label: 'Checkbox', defaultWidth: 0.055, defaultHeight: 0.055 },
  { type: 'radio', label: 'Radio group', defaultWidth: 0.2, defaultHeight: 0.075 },
  { type: 'dropdown', label: 'Dropdown', defaultWidth: 0.22, defaultHeight: 0.055 }
];

export const signingRoles = new Set(['signer', 'approver']);

export function esignStatusLabel(status: ESignEnvelopeStatus) {
  return ({ draft: 'Draft', sent: 'Sent', in_progress: 'Awaiting signatures', finalizing: 'Finalizing documents', completed: 'Completed', declined: 'Declined', voided: 'Voided', expired: 'Expired', failed: 'Failed' } as const)[status] || status;
}

function fallbackReadiness(detail: Omit<ESignEnvelopeDetail, 'readiness'> & { readiness?: ESignReadiness }): ESignReadiness {
  const actionRecipients = detail.recipients.filter((recipient) => signingRoles.has(recipient.role));
  const signers = actionRecipients.filter((recipient) => recipient.role === 'signer');
  const fieldsIssues = !actionRecipients.length
    ? ['Add a signer or approver before placing fields.']
    : signers.every((recipient) => detail.fields.some((field) => field.recipientId === recipient.id && ['signature', 'initials'].includes(field.type)))
      ? []
      : ['Assign a signature or initials field to every signer.'];
  const issues: Record<ESignWorkflowSectionKey, string[]> = {
    documents: detail.documents.length ? [] : ['Upload at least one PDF document.'],
    recipients: actionRecipients.length ? [] : ['Add at least one signer or approver.'],
    fields: fieldsIssues,
    message: detail.envelope.title?.trim() && detail.envelope.subject?.trim() && detail.envelope.message?.trim() ? [] : ['Add an agreement name, email subject and message.']
  };
  const sections = Object.fromEntries((Object.keys(issues) as ESignWorkflowSectionKey[]).map((key) => [key, { key, complete: issues[key].length === 0, issues: issues[key] }])) as ESignReadiness['sections'];
  const completedSections = Object.values(sections).filter((section) => section.complete).length;
  return { ready: completedSections === 4, completedSections, totalSections: 4, sections, issues: Object.values(issues).flat() };
}

export function normalizeEnvelopeDetail(input: ESignEnvelopeDetail): ESignEnvelopeDetail {
  const detail = {
    ...input,
    documents: input.documents || [], recipients: input.recipients || [], fields: input.fields || [],
    artifacts: input.artifacts || [], audit: input.audit || [],
    deliveries: (input.deliveries || []).map((delivery) => ({
      ...delivery,
      attempts: Number.isFinite(Number(delivery.attempts)) ? Number(delivery.attempts) : 0,
      recipientName: delivery.recipientName || '', recipientEmail: delivery.recipientEmail || ''
    }))
  };
  return { ...detail, readiness: input.readiness || fallbackReadiness(detail) };
}

export function adminDocumentContentUrl(envelopeId: string, documentId: string) {
  return `/api/esign/envelopes/${encodeURIComponent(envelopeId)}/documents/${encodeURIComponent(documentId)}/content`;
}

export function publicDocumentContentUrl(documentId: string) {
  return `/api/public/esign/documents/${encodeURIComponent(documentId)}/content`;
}

export function recipientLabel(recipient: Pick<ESignRecipient, 'name' | 'email'>) {
  return recipient.name.trim() || recipient.email;
}

export function nextFieldId() { return crypto.randomUUID(); }

export function newField(input: {
  envelopeId: string; documentId: string; recipientId: string; type: ESignFieldType;
  page: number; x: number; y: number;
}): ESignField {
  const definition = esignFieldDefinitions.find((item) => item.type === input.type)!;
  return {
    id: nextFieldId(), ...input, width: definition.defaultWidth, height: definition.defaultHeight,
    required: !['name', 'email', 'date_signed'].includes(input.type), label: definition.label,
    placeholder: input.type === 'text' ? 'Enter text' : '', options: ['radio', 'dropdown'].includes(input.type) ? ['Option 1', 'Option 2'] : []
  };
}
