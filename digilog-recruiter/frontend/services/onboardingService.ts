import { apiRequest } from "./apiConfig";

export type OnboardingStatus = "draft" | "pending" | "in_progress" | "completed" | "cancelled";
export type EnvelopeStatus = "draft" | "sent" | "viewed" | "partially_signed" | "completed" | "voided" | "expired";
export type DocumentSourceType = "builder" | "uploaded_pdf" | "uploaded_docx";
export type WorkflowItemStatus = "not_started" | "pending" | "in_progress" | "completed" | "blocked" | "skipped" | "failed";

export interface BuilderBlock {
  id: string;
  type: "logo" | "heading" | "text" | "section" | "table" | "signature" | "spacer" | "pageBreak";
  content?: Record<string, any>;
  style?: Record<string, any>;
}

export interface SignatureField {
  id: string;
  role: "candidate" | "internal";
  type: "signature" | "date" | "name" | "email" | "text";
  label?: string;
  key?: string;
  signerKey?: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
}

export interface FileSnapshot {
  url?: string;
  downloadUrl?: string;
  publicId?: string;
  resourceType?: string;
  format?: string;
  bytes?: number;
  originalName?: string;
  mimeType?: string;
  renderedAt?: string;
}

export interface OnboardingDocumentTemplate {
  _id: string;
  name: string;
  description?: string;
  category: string;
  isDefault: boolean;
  isSystem: boolean;
  builderBlocks: BuilderBlock[];
  variables: string[];
  signatureFields: SignatureField[];
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingDocument {
  _id: string;
  title: string;
  description?: string;
  sourceType: DocumentSourceType;
  status: "draft" | "ready" | "sent" | "archived";
  builderBlocks: BuilderBlock[];
  variables?: Record<string, any>;
  signatureFields: SignatureField[];
  originalFile?: FileSnapshot;
  pdfSnapshot?: FileSnapshot;
  lockedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingEnvelopeDocument {
  _id: string;
  document: string | OnboardingDocument;
  title: string;
  status: "pending" | "signed" | "completed" | "voided";
  pdfSnapshot?: FileSnapshot;
  signedPdf?: FileSnapshot;
  signatureFields: SignatureField[];
  signedAt?: string;
}

export interface OnboardingSigner {
  _id: string;
  key?: string;
  role: "candidate" | "internal";
  name?: string;
  email: string;
  order: number;
  status: "pending" | "viewed" | "signed" | "declined";
  viewedAt?: string;
  signedAt?: string;
  lastReminderAt?: string;
}

export interface OnboardingEnvelope {
  _id: string;
  title: string;
  message?: string;
  status: EnvelopeStatus;
  documents: OnboardingEnvelopeDocument[];
  signers: OnboardingSigner[];
  sentAt?: string;
  completedAt?: string;
  voidedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingWorkflowItem {
  _id: string;
  type: "document" | "form" | "task" | "approval" | "handoff";
  title: string;
  description?: string;
  status: WorkflowItemStatus;
  ownerType: "candidate" | "user" | "system";
  order: number;
  dueAt?: string;
  sourceType?: string;
  sourceId?: string;
  lastReminderAt?: string;
  completedAt?: string;
}

export interface OnboardingFormField {
  id: string;
  key: string;
  label: string;
  type: "text" | "textarea" | "email" | "phone" | "date" | "number" | "select" | "checkbox" | "bank_account" | "routing_number" | "tax_id" | "address" | "file";
  required?: boolean;
  sensitive?: boolean;
  options?: string[];
  placeholder?: string;
  helpText?: string;
  order?: number;
}

export interface OnboardingFormTemplate {
  _id: string;
  name: string;
  description?: string;
  category: string;
  status: "active" | "archived";
  version: number;
  isSystem: boolean;
  fields: OnboardingFormField[];
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingPacketTemplate {
  _id: string;
  name: string;
  description?: string;
  category: string;
  status: "active" | "archived";
  version: number;
  documents?: Array<OnboardingDocument | string>;
  formTemplates?: Array<OnboardingFormTemplate | string>;
  workflowItems?: Array<Record<string, any>>;
  reminderRules?: Array<Record<string, any>>;
  completionActions?: Array<Record<string, any>>;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingFormValue {
  fieldId: string;
  key: string;
  label: string;
  type: string;
  sensitive: boolean;
  value?: string | number | boolean | string[];
  revealedValue?: string | number | boolean | string[];
  valuePreview?: string;
  files?: FileSnapshot[];
  updatedAt?: string;
}

export interface OnboardingFormSubmission {
  _id: string;
  title: string;
  status: "draft" | "submitted" | "under_review" | "approved" | "rejected";
  templateSnapshot?: {
    fields?: OnboardingFormField[];
  };
  values: OnboardingFormValue[];
  hasSensitiveValues: boolean;
  submittedAt?: string;
  reviewedAt?: string;
  reviewerNotes?: string;
  rejectionReason?: string;
}

export interface OnboardingApproval {
  _id: string;
  type: "sensitive_data" | "exception" | "completion";
  status: "pending" | "approved" | "rejected" | "cancelled";
  formSubmission?: string;
  notes?: string;
  reviewedAt?: string;
}

export interface OnboardingHandoff {
  _id: string;
  target: "internal_employee_profile" | "payroll" | "identity_provider" | "custom";
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;
  lastError?: string;
  completedAt?: string;
}

export interface CandidateOnboarding {
  _id: string;
  title: string;
  status: OnboardingStatus;
  notes?: string;
  candidate: any;
  candidateAccount?: any;
  documents?: OnboardingDocument[];
  envelopes?: OnboardingEnvelope[];
  workflowItems?: OnboardingWorkflowItem[];
  forms?: OnboardingFormSubmission[];
  approvals?: OnboardingApproval[];
  handoffs?: OnboardingHandoff[];
  progress?: {
    totalItems: number;
    completedItems: number;
    percent: number;
  };
  portalInviteUrl?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingAuditEvent {
  _id: string;
  actorType: "user" | "candidate" | "system";
  actorEmail?: string;
  action: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

async function parseResponse<T>(response: Response, fallback: string): Promise<T> {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.msg || result.error || fallback);
  }
  return result as T;
}

export async function getOnboardingRecords(params: { status?: string; search?: string; candidateId?: string } = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.search) query.set("search", params.search);
  if (params.candidateId) query.set("candidateId", params.candidateId);
  const response = await apiRequest(`/api/onboarding${query.toString() ? `?${query}` : ""}`);
  return parseResponse<{ data: CandidateOnboarding[]; recentEvents: OnboardingAuditEvent[] }>(response, "Failed to load onboarding");
}

export async function getOnboardingDashboard() {
  const response = await apiRequest("/api/onboarding/dashboard");
  const result = await parseResponse<{
    data: {
      statusCounts: Record<string, number>;
      overdueItems: number;
      pendingApprovals: number;
      handoffFailures: number;
      formReviews: number;
    };
  }>(response, "Failed to load onboarding dashboard");
  return result.data;
}

export async function getOnboarding(id: string) {
  const response = await apiRequest(`/api/onboarding/${id}`);
  return parseResponse<{ data: CandidateOnboarding; events: OnboardingAuditEvent[] }>(response, "Failed to load onboarding");
}

export async function startOnboarding(candidateId: string, data: { title?: string; notes?: string; templateId?: string } = {}) {
  const response = await apiRequest(`/api/onboarding/candidates/${candidateId}/start`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return parseResponse<{ data: CandidateOnboarding; inviteUrl: string }>(response, "Failed to start onboarding");
}

export async function getPacketTemplates() {
  const response = await apiRequest("/api/onboarding/templates");
  const result = await parseResponse<{ data: OnboardingPacketTemplate[] }>(response, "Failed to load packet templates");
  return result.data;
}

export async function createPacketTemplate(data: Partial<OnboardingPacketTemplate>) {
  const response = await apiRequest("/api/onboarding/templates", {
    method: "POST",
    body: JSON.stringify(data),
  });
  const result = await parseResponse<{ data: OnboardingPacketTemplate }>(response, "Failed to create packet template");
  return result.data;
}

export async function updatePacketTemplate(id: string, data: Partial<OnboardingPacketTemplate>) {
  const response = await apiRequest(`/api/onboarding/templates/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  const result = await parseResponse<{ data: OnboardingPacketTemplate }>(response, "Failed to update packet template");
  return result.data;
}

export async function getOnboardingFormTemplates() {
  const response = await apiRequest("/api/onboarding/form-templates");
  const result = await parseResponse<{ data: OnboardingFormTemplate[] }>(response, "Failed to load form templates");
  return result.data;
}

export async function createOnboardingFormTemplate(data: Partial<OnboardingFormTemplate>) {
  const response = await apiRequest("/api/onboarding/form-templates", {
    method: "POST",
    body: JSON.stringify(data),
  });
  const result = await parseResponse<{ data: OnboardingFormTemplate }>(response, "Failed to create form template");
  return result.data;
}

export async function revealFormSubmission(id: string) {
  const response = await apiRequest(`/api/onboarding/form-submissions/${id}/reveal`, { method: "POST" });
  const result = await parseResponse<{ data: OnboardingFormSubmission }>(response, "Failed to reveal form values");
  return result.data;
}

export async function reviewFormSubmission(id: string, decision: "approved" | "rejected", notes?: string) {
  const response = await apiRequest(`/api/onboarding/form-submissions/${id}/review`, {
    method: "PATCH",
    body: JSON.stringify({ decision, notes }),
  });
  const result = await parseResponse<{ data: OnboardingFormSubmission }>(response, "Failed to review form submission");
  return result.data;
}

export async function runOnboardingReminders() {
  const response = await apiRequest("/api/onboarding/reminders/run", { method: "POST" });
  const result = await parseResponse<{ data: { scanned: number; sent: number } }>(response, "Failed to run onboarding reminders");
  return result.data;
}

export async function retryOnboardingHandoff(onboardingId: string) {
  const response = await apiRequest(`/api/onboarding/${onboardingId}/handoff/retry`, { method: "POST" });
  const result = await parseResponse<{ data: OnboardingHandoff | null }>(response, "Failed to retry onboarding handoff");
  return result.data;
}

export async function getDocumentTemplates() {
  const response = await apiRequest("/api/onboarding/document-templates");
  const result = await parseResponse<{ data: OnboardingDocumentTemplate[] }>(response, "Failed to load templates");
  return result.data;
}

export async function createDocumentTemplate(data: Partial<OnboardingDocumentTemplate>) {
  const response = await apiRequest("/api/onboarding/document-templates", {
    method: "POST",
    body: JSON.stringify(data),
  });
  const result = await parseResponse<{ data: OnboardingDocumentTemplate }>(response, "Failed to create template");
  return result.data;
}

export async function updateDocumentTemplate(id: string, data: Partial<OnboardingDocumentTemplate>) {
  const response = await apiRequest(`/api/onboarding/document-templates/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  const result = await parseResponse<{ data: OnboardingDocumentTemplate }>(response, "Failed to update template");
  return result.data;
}

export async function deleteDocumentTemplate(id: string) {
  const response = await apiRequest(`/api/onboarding/document-templates/${id}`, { method: "DELETE" });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.msg || "Failed to delete template");
  }
}

export async function getDocuments() {
  const response = await apiRequest("/api/onboarding/documents");
  const result = await parseResponse<{ data: OnboardingDocument[] }>(response, "Failed to load documents");
  return result.data;
}

export async function getDocument(id: string) {
  const response = await apiRequest(`/api/onboarding/documents/${id}`);
  const result = await parseResponse<{ data: OnboardingDocument }>(response, "Failed to load document");
  return result.data;
}

export async function createDocument(data: {
  title: string;
  description?: string;
  templateId?: string;
  builderBlocks?: BuilderBlock[];
  variables?: Record<string, any>;
  signatureFields?: SignatureField[];
}) {
  const response = await apiRequest("/api/onboarding/documents", {
    method: "POST",
    body: JSON.stringify(data),
  });
  const result = await parseResponse<{ data: OnboardingDocument }>(response, "Failed to create document");
  return result.data;
}

export async function updateDocument(id: string, data: Partial<OnboardingDocument>) {
  const response = await apiRequest(`/api/onboarding/documents/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  const result = await parseResponse<{ data: OnboardingDocument }>(response, "Failed to update document");
  return result.data;
}

export async function deleteDocument(id: string) {
  const response = await apiRequest(`/api/onboarding/documents/${id}`, { method: "DELETE" });
  const result = await parseResponse<{ data: OnboardingDocument }>(response, "Failed to remove document");
  return result.data;
}

export async function renderDocument(id: string) {
  const response = await apiRequest(`/api/onboarding/documents/${id}/render`, { method: "POST" });
  const result = await parseResponse<{ data: OnboardingDocument }>(response, "Failed to render document");
  return result.data;
}

export async function getDocumentPreviewBlob(id: string) {
  const response = await apiRequest(`/api/onboarding/documents/${id}/preview`, {
    headers: { Accept: "application/pdf" },
  });

  if (!response.ok) {
    const result = await response.clone().json().catch(() => ({}));
    throw new Error(result.msg || result.error || "Failed to load document preview");
  }

  const blob = await response.blob();
  return new Blob([blob], { type: "application/pdf" });
}

export async function uploadDocument(formData: FormData) {
  const response = await apiRequest("/api/onboarding/documents/upload", {
    method: "POST",
    body: formData,
  });
  const result = await parseResponse<{ data: OnboardingDocument }>(response, "Failed to upload document");
  return result.data;
}

export async function createEnvelope(data: {
  onboardingId: string;
  documentIds: string[];
  title?: string;
  message?: string;
  signers?: Array<{ key?: string; role: "candidate" | "internal"; name?: string; email: string; order?: number }>;
  documentFields?: Record<string, SignatureField[]>;
  internalSigner?: { name?: string; email?: string };
}) {
  const response = await apiRequest("/api/onboarding/envelopes", {
    method: "POST",
    body: JSON.stringify(data),
  });
  const result = await parseResponse<{ data: OnboardingEnvelope }>(response, "Failed to create envelope");
  return result.data;
}

export async function getEnvelope(id: string) {
  const response = await apiRequest(`/api/onboarding/envelopes/${id}`);
  const result = await parseResponse<{ data: OnboardingEnvelope }>(response, "Failed to load envelope");
  return result.data;
}

export async function sendEnvelope(id: string) {
  const response = await apiRequest(`/api/onboarding/envelopes/${id}/send`, { method: "POST" });
  const result = await parseResponse<{ data: OnboardingEnvelope }>(response, "Failed to send envelope");
  return result.data;
}

export async function remindEnvelope(id: string) {
  const response = await apiRequest(`/api/onboarding/envelopes/${id}/remind`, { method: "POST" });
  return parseResponse<{ data: OnboardingEnvelope; reminded: number }>(response, "Failed to send reminder");
}

export async function voidEnvelope(id: string, reason?: string) {
  const response = await apiRequest(`/api/onboarding/envelopes/${id}/void`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
  const result = await parseResponse<{ data: OnboardingEnvelope }>(response, "Failed to void envelope");
  return result.data;
}

export async function getEnvelopeDocumentPreviewBlob(envelopeId: string, documentId: string) {
  const response = await apiRequest(`/api/onboarding/envelopes/${envelopeId}/documents/${documentId}/preview`, {
    headers: { Accept: "application/pdf" },
  });

  if (!response.ok) {
    const result = await response.clone().json().catch(() => ({}));
    throw new Error(result.msg || result.error || "Failed to load envelope document preview");
  }

  const blob = await response.blob();
  return new Blob([blob], { type: "application/pdf" });
}

export async function countersignEnvelope(id: string, signatureDataUrl: string, signerKey?: string) {
  const response = await apiRequest(`/api/onboarding/envelopes/${id}/countersign`, {
    method: "POST",
    body: JSON.stringify({ signatureDataUrl, signerKey }),
  });
  const result = await parseResponse<{ data: OnboardingEnvelope }>(response, "Failed to countersign envelope");
  return result.data;
}

export async function getEnvelopeAudit(id: string) {
  const response = await apiRequest(`/api/onboarding/envelopes/${id}/audit`);
  const result = await parseResponse<{ data: OnboardingAuditEvent[] }>(response, "Failed to load audit trail");
  return result.data;
}

export function newSignatureField(role: "candidate" | "internal" = "candidate"): SignatureField {
  const timestamp = Date.now();
  return {
    id: `${role}-signature-${timestamp}`,
    role,
    signerKey: role === "candidate" ? "candidate-primary" : undefined,
    type: "signature",
    label: role === "candidate" ? "Candidate signature" : "Internal signature",
    page: 1,
    x: 0.12,
    y: 0.72,
    width: 0.3,
    height: 0.08,
    required: true,
  };
}
